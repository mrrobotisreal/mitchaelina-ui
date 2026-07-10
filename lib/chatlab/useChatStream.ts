'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBaseURL } from '@/lib/utils';
import { getCurrentIdToken } from '@/lib/firebase';
import { extractSSERecords, parseSSERecordData } from '@/lib/sse';
import { track } from '@/lib/analyticsClient';
import { chatLabKeys, projectKeys } from './useChatLab';
import {
  ChatLabStreamEventSchema,
  type ChatLabEffortOrOff,
  type ChatLabSessionDetailResponse,
  type ChatLabUsage,
} from '@/schemas/chatLab';

// The chat-lab send hook. POSTs the message and consumes the SSE-formatted
// response body via fetch + ReadableStream with a Bearer header (EventSource
// cannot send Authorization — see Hard Constraint 4 / useFeedbackEvents.ts).
// Exposes reactive streaming state plus stop(); the server persists partials
// on abort (status='interrupted'), so Stop is just an AbortController abort.
//
// Reconciliation model: the caller renders `pendingUser` (the optimistic user
// message) and the live assistantText/reasoningText while status==='streaming';
// on any terminal condition the session + sessions queries are invalidated and,
// once the refetch lands (invalidateQueries resolves after active queries
// refetch), the hook resets to idle — the persisted rows take over seamlessly.

export type ChatStreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface PendingUserMessage {
  content: string;
  model: string;
  reasoningEffort: ChatLabEffortOrOff;
  attachmentCount: number;
}

/** One in-stream read_asset execution, for the live activity chips. */
export interface ChatStreamToolEvent {
  name: string;
  assetId: string;
  assetName: string;
  status: 'running' | 'ok' | 'error';
}

export interface ChatStreamState {
  status: ChatStreamStatus;
  pendingUser: PendingUserMessage | null;
  assistantText: string;
  reasoningText: string;
  toolEvents: ChatStreamToolEvent[];
  usage: ChatLabUsage | null;
  error: string | null;
  model: string | null;
  reasoningEffort: ChatLabEffortOrOff | null;
  /** Date.now() when the send started — drives the live Thinking…/Responding…
   *  ticker (display-only; the server measures the persisted metrics). */
  startedAt: number | null;
}

const IDLE: ChatStreamState = {
  status: 'idle',
  pendingUser: null,
  assistantText: '',
  reasoningText: '',
  toolEvents: [],
  usage: null,
  error: null,
  model: null,
  reasoningEffort: null,
  startedAt: null,
};

export interface SendMessageParams {
  sessionId: string;
  content: string;
  model: string;
  reasoningEffort: ChatLabEffortOrOff;
  attachmentIds: string[];
}

export function useChatStream(sessionId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<ChatStreamState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: chatLabKeys.session(sessionId) }),
      // sessionsRoot prefix hits BOTH the general list and any project lists
      // (recency + auto-title); the projects list refreshes chat counts and
      // memory status for project chats.
      qc.invalidateQueries({ queryKey: chatLabKeys.sessionsRoot }),
      qc.invalidateQueries({ queryKey: projectKeys.projects() }),
    ]);
  }, [qc, sessionId]);

  const sendMessage = useCallback(
    async (params: SendMessageParams) => {
      if (controllerRef.current) return; // one in-flight send at a time
      const controller = new AbortController();
      controllerRef.current = controller;

      // Analytics: metadata only — never message content. `project` comes
      // from the cached session detail (present by the time a send happens).
      const cachedDetail = qc.getQueryData<ChatLabSessionDetailResponse>(chatLabKeys.session(params.sessionId));
      track('chat_message_sent', {
        model: params.model,
        reasoning_effort: params.reasoningEffort,
        project: Boolean(cachedDetail?.session.projectId),
      });

      setState({
        ...IDLE,
        status: 'streaming',
        pendingUser: {
          content: params.content,
          model: params.model,
          reasoningEffort: params.reasoningEffort,
          attachmentCount: params.attachmentIds.length,
        },
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        startedAt: Date.now(),
      });

      // Surface the error via toast, reconcile with the persisted rows (which
      // carry the error badge when the server got that far), then reset so the
      // composer re-enables.
      const fail = async (message: string) => {
        toast.error(message);
        await invalidate();
        setState(IDLE);
      };

      try {
        const token = await getCurrentIdToken();
        if (!token) {
          controllerRef.current = null;
          await fail('Not signed in');
          return;
        }
        const res = await fetch(`${getBaseURL()}/chatlab/sessions/${encodeURIComponent(params.sessionId)}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            content: params.content,
            model: params.model,
            reasoningEffort: params.reasoningEffort,
            attachmentIds: params.attachmentIds,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // Pre-stream failure: the body is house-shaped JSON {"error": "..."}.
          let message = `Request failed (${res.status})`;
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body.error === 'string' && body.error.trim()) message = body.error;
          } catch {
            // Non-JSON body — keep the status-line message.
          }
          controllerRef.current = null;
          await fail(message);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamError: string | null = null;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { records, rest } = extractSSERecords(buffer);
          buffer = rest;
          for (const record of records) {
            const data = parseSSERecordData(record);
            if (data === null) continue; // ": ping" keepalives
            let parsed;
            try {
              parsed = ChatLabStreamEventSchema.parse(JSON.parse(data));
            } catch {
              continue; // malformed frame — persisted rows reconcile
            }
            switch (parsed.type) {
              case 'meta':
                break; // ids are reconciled via refetch
              case 'reasoning':
                setState((s) => ({ ...s, reasoningText: s.reasoningText + parsed.text }));
                break;
              case 'delta':
                setState((s) => ({ ...s, assistantText: s.assistantText + parsed.text }));
                break;
              case 'tool':
                // "running" appends a chip; the matching "ok"/"error" upgrades
                // the most recent still-running chip for that asset.
                setState((s) => {
                  if (parsed.status === 'running') {
                    return { ...s, toolEvents: [...s.toolEvents, parsed] };
                  }
                  const events = [...s.toolEvents];
                  for (let i = events.length - 1; i >= 0; i--) {
                    if (events[i].assetId === parsed.assetId && events[i].status === 'running') {
                      events[i] = parsed;
                      return { ...s, toolEvents: events };
                    }
                  }
                  return { ...s, toolEvents: [...events, parsed] };
                });
                break;
              case 'usage':
                setState((s) => ({ ...s, usage: parsed }));
                break;
              case 'done':
                setState((s) => ({ ...s, status: 'done' }));
                break;
              case 'error':
                streamError = parsed.message;
                break;
            }
          }
        }

        controllerRef.current = null;
        if (streamError) toast.error(streamError);
        await invalidate();
        setState(IDLE);
      } catch (err) {
        controllerRef.current = null;
        if ((err as { name?: string })?.name === 'AbortError') {
          // Stop button / navigation: the server persists the partial as
          // 'interrupted' — just reconcile.
          await invalidate();
          setState(IDLE);
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to send message';
        await fail(message);
      }
    },
    [invalidate, qc],
  );

  /** Abort the in-flight send (the Stop button). Safe to call when idle. */
  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { ...state, sendMessage, stop, isStreaming: state.status === 'streaming' };
}
