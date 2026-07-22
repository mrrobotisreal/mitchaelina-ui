'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBaseURL } from '@/lib/utils';
import { getCurrentIdToken } from '@/lib/firebase';
import { extractSSERecords, parseSSERecordData } from '@/lib/sse';
import { track } from '@/lib/analyticsClient';
import { getDesktop, isToolEvaluation } from '@/lib/desktop';
import { chatLabKeys, projectKeys } from './useChatLab';
import {
  ChatLabStreamEventSchema,
  type ChatLabEffortOrOff,
  type ChatLabGenerationEvent,
  type ChatLabGenerationOptions,
  type ChatLabOutputModality,
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

/** One in-stream desktop local tool call, for the live tool cards. Progresses
 *  pending → (awaiting-approval) → running → ok|error. */
export interface ChatStreamLocalToolCall {
  callId: string;
  name: string;
  args: string; // raw JSON argument string
  status: 'pending' | 'awaiting-approval' | 'running' | 'ok' | 'error';
  summary?: string;
  detail?: string;
  diff?: string;
}

export interface ChatStreamState {
  status: ChatStreamStatus;
  pendingUser: PendingUserMessage | null;
  assistantText: string;
  reasoningText: string;
  toolEvents: ChatStreamToolEvent[];
  localToolCalls: ChatStreamLocalToolCall[];
  usage: ChatLabUsage | null;
  error: string | null;
  model: string | null;
  reasoningEffort: ChatLabEffortOrOff | null;
  /** Non-null during a media-generation send — drives the "Generating image/
   *  video…" placeholder in place of "Waiting for the model…". */
  generation: Pick<ChatLabGenerationEvent, 'modality' | 'status'> | null;
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
  localToolCalls: [],
  usage: null,
  error: null,
  model: null,
  reasoningEffort: null,
  generation: null,
  startedAt: null,
};

export interface SendMessageParams {
  sessionId: string;
  content: string;
  model: string;
  reasoningEffort: ChatLabEffortOrOff;
  attachmentIds: string[];
  /** "" / "text" = a normal chat completion; "image"/"video" = generation. */
  outputModality: ChatLabOutputModality;
  /** Optional generation knobs (ignored for text). */
  generationOptions?: ChatLabGenerationOptions;
  /** Desktop only: enable the client-executed local tool suite (the server
   *  force-disables it for non-tool models / generation / view-as). */
  localTools?: boolean;
  /** Desktop only: @-mentioned files (content read client-side) sent as
   *  up-front context. */
  localContext?: { path: string; content: string }[];
  /** Desktop only: platform + granted roots, for the local-tools system prompt. */
  localEnv?: { platform: string; roots: string[] };
}

// Drop empty option fields so the request carries only real overrides (the
// server treats absent fields as provider defaults).
function cleanGenerationOptions(o?: ChatLabGenerationOptions): ChatLabGenerationOptions | null {
  if (!o) return null;
  const out: ChatLabGenerationOptions = {};
  if (o.aspectRatio) out.aspectRatio = o.aspectRatio;
  if (o.resolution) out.resolution = o.resolution;
  if (o.durationSeconds && o.durationSeconds > 0) out.durationSeconds = o.durationSeconds;
  return Object.keys(out).length > 0 ? out : null;
}

// updateLocalToolCall patches one call entry by callId (functional-update safe).
function updateLocalToolCall(
  s: ChatStreamState,
  callId: string,
  patch: Partial<ChatStreamLocalToolCall>,
): ChatStreamState {
  return {
    ...s,
    localToolCalls: s.localToolCalls.map((c) => (c.callId === callId ? { ...c, ...patch } : c)),
  };
}

// The session-scoped always-allow class a tool belongs to (for "Always allow").
function alwaysAllowKind(name: string): 'writes' | 'commands' | null {
  if (name === 'edit_file' || name === 'write_file') return 'writes';
  if (name === 'run_command') return 'commands';
  return null;
}

export function useChatStream(sessionId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<ChatStreamState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);
  // Mirror of the live local tool calls so the approve/deny callbacks can read
  // a call's name/args without threading them through the UI.
  const localCallsRef = useRef<ChatStreamLocalToolCall[]>([]);
  useEffect(() => {
    localCallsRef.current = state.localToolCalls;
  }, [state.localToolCalls]);

  // POST one local tool result back to the suspended send goroutine. Best
  // effort: a 409 (call no longer pending, e.g. after a server-side timeout) or
  // any network error is swallowed — the stream reconciles regardless.
  const postLocalToolResult = useCallback(
    async (body: { callId: string; ok: boolean; resultText: string; detail: string; diff: string }) => {
      try {
        const token = await getCurrentIdToken();
        if (!token) return;
        await fetch(`${getBaseURL()}/chatlab/sessions/${encodeURIComponent(sessionId)}/local-tool-results`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        // ignore — the server times out and the loop continues
      }
    },
    [sessionId],
  );

  // Execute a tool via the desktop bridge (approved = the user clicked Approve,
  // honored only for approve-class decisions in main) and POST the result.
  const runAndPost = useCallback(
    async (call: { callId: string; name: string; args: string }, approved: boolean) => {
      setState((s) => updateLocalToolCall(s, call.callId, { status: 'running' }));
      const bridge = getDesktop();
      let result: { ok: boolean; resultText: string; detail?: string; diff?: string };
      if (!bridge) {
        result = { ok: false, resultText: 'The desktop bridge is unavailable.', detail: 'no bridge' };
      } else {
        try {
          result = await bridge.executeTool(call.name, call.args, { approved });
        } catch {
          result = { ok: false, resultText: 'The local tool failed to execute.', detail: 'error' };
        }
      }
      await postLocalToolResult({
        callId: call.callId,
        ok: result.ok,
        resultText: result.resultText,
        detail: result.detail ?? '',
        diff: result.diff ?? '',
      });
      setState((s) =>
        updateLocalToolCall(s, call.callId, {
          status: result.ok ? 'ok' : 'error',
          detail: result.detail,
          diff: result.diff,
        }),
      );
    },
    [postLocalToolResult],
  );

  // Handle a "pending" local_tool event: append the card, evaluate the policy,
  // then auto-run (read-only), await approval (mutations), or refuse (deny /
  // no bridge). Never throws — every failure becomes a posted error result so
  // the server never hangs.
  const handleLocalToolPending = useCallback(
    async (ev: { callId: string; name: string; args: string }) => {
      setState((s) => ({
        ...s,
        localToolCalls: [...s.localToolCalls, { callId: ev.callId, name: ev.name, args: ev.args, status: 'pending' }],
      }));
      const bridge = getDesktop();
      if (!bridge) {
        // Stale/misconfigured client: post an error result immediately so the
        // model can react rather than the turn hanging until timeout.
        await runAndPost(ev, false);
        return;
      }
      let evaluation;
      try {
        evaluation = await bridge.evaluateTool(ev.name, ev.args);
      } catch {
        evaluation = null;
      }
      if (!evaluation || !isToolEvaluation(evaluation)) {
        await postLocalToolResult({ callId: ev.callId, ok: false, resultText: 'User denied this action.', detail: '', diff: '' });
        setState((s) => updateLocalToolCall(s, ev.callId, { status: 'error', detail: 'unavailable' }));
        return;
      }
      setState((s) => updateLocalToolCall(s, ev.callId, { summary: evaluation.summary }));
      if (evaluation.decision === 'auto') {
        await runAndPost(ev, false);
      } else if (evaluation.decision === 'approve') {
        setState((s) => updateLocalToolCall(s, ev.callId, { status: 'awaiting-approval' }));
      } else {
        await postLocalToolResult({ callId: ev.callId, ok: false, resultText: 'User denied this action.', detail: '', diff: '' });
        setState((s) => updateLocalToolCall(s, ev.callId, { status: 'error', detail: 'denied' }));
      }
    },
    [postLocalToolResult, runAndPost],
  );

  // Approve an awaiting-approval call (optionally granting a session-scoped
  // always-allow for its class); deny refuses it. Exposed to the tool cards.
  const approveLocalTool = useCallback(
    async (callId: string, opts?: { always?: boolean }) => {
      const call = localCallsRef.current.find((c) => c.callId === callId);
      if (!call || call.status !== 'awaiting-approval') return;
      if (opts?.always) {
        const kind = alwaysAllowKind(call.name);
        if (kind) void getDesktop()?.setSessionAutoApprove(kind, true);
      }
      await runAndPost(call, true);
    },
    [runAndPost],
  );

  const denyLocalTool = useCallback(
    async (callId: string) => {
      const call = localCallsRef.current.find((c) => c.callId === callId);
      if (!call || call.status !== 'awaiting-approval') return;
      await postLocalToolResult({ callId, ok: false, resultText: 'User denied this action.', detail: '', diff: '' });
      setState((s) => updateLocalToolCall(s, callId, { status: 'error', detail: 'denied' }));
    },
    [postLocalToolResult],
  );

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
        output_modality: params.outputModality,
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
            outputModality: params.outputModality,
            generationOptions:
              params.outputModality === 'text' ? null : cleanGenerationOptions(params.generationOptions),
            // Desktop local file access (omitted/false on the web).
            localTools: params.localTools ?? false,
            localContext: params.localContext ?? [],
            localEnv: params.localEnv ?? null,
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
              case 'local_tool':
                if (parsed.status === 'pending') {
                  // Fire-and-forget: the SSE reader must keep draining while
                  // the client executes (or waits for approval) — the server is
                  // blocked on our result POST.
                  void handleLocalToolPending(parsed);
                } else {
                  // Terminal echo from the server (after it received our POST):
                  // merge the server-capped detail/diff and confirm status.
                  setState((s) => updateLocalToolCall(s, parsed.callId, {
                    status: parsed.status,
                    detail: parsed.detail,
                    diff: parsed.diff,
                  }));
                }
                break;
              case 'usage':
                setState((s) => ({ ...s, usage: parsed }));
                break;
              case 'generation':
                setState((s) => ({ ...s, generation: { modality: parsed.modality, status: parsed.status } }));
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
    [invalidate, qc, handleLocalToolPending],
  );

  /** Abort the in-flight send (the Stop button). Safe to call when idle. */
  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return {
    ...state,
    sendMessage,
    stop,
    approveLocalTool,
    denyLocalTool,
    isStreaming: state.status === 'streaming',
  };
}
