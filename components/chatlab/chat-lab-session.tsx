'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FlaskConical, FolderKanban, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { useQueryErrorRedirect } from '@/lib/useQueryErrorRedirect';
import { useChatLabModels, useChatLabProject, useChatLabSession, useChatLabSessions } from '@/lib/chatlab/useChatLab';
import { useChatStream } from '@/lib/chatlab/useChatStream';
import type { ChatLabEffortOrOff } from '@/schemas/chatLab';
import MessageList from './message-list';
import Composer from './composer';

// The active session screen: message history + live stream + composer. Model /
// effort selection is per MESSAGE (kept as local state); the initial values
// come from the session's lastModel/lastReasoningEffort and, for a brand-new
// session, from the most recent session's lastModel. Project chats add a
// breadcrumb chip and the "assets need a tool-capable model" composer hint.
export default function ChatLabSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const modelsQuery = useChatLabModels();
  const sessionQuery = useChatLabSession(sessionId);
  const { data: sessions } = useChatLabSessions();
  const stream = useChatStream(sessionId);

  const projectRef = sessionQuery.data?.project ?? null;
  // Project detail (asset count for the composer hint) — cached; only fetched
  // for project chats.
  const projectQuery = useChatLabProject(projectRef?.id ?? null);

  useQueryErrorRedirect(sessionQuery.error);
  useQueryErrorRedirect(modelsQuery.error);

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<ChatLabEffortOrOff>('');
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed the pickers once the session + catalog have loaded: this session's
  // last selection, else the most recent other session's, else the first
  // catalog model. Render-time state adjustment (React's "derived state"
  // pattern) so navigating between sessions re-seeds without effect cascades.
  if (seededFor !== sessionId && models.length > 0 && sessionQuery.data?.session.id === sessionId) {
    const valid = (id: string | null | undefined) => (id && models.some((m) => m.id === id) ? id : null);
    const session = sessionQuery.data.session;
    const fallback = sessions?.find((s) => s.id !== sessionId && valid(s.lastModel))?.lastModel ?? null;
    const chosen = valid(session.lastModel) ?? valid(fallback) ?? models[0].id;
    const chosenModel = models.find((m) => m.id === chosen);
    const lastEffort = session.lastReasoningEffort ?? '';
    setModel(chosen);
    setEffort(
      chosenModel?.supportsReasoning && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(lastEffort)
        ? (lastEffort as ChatLabEffortOrOff)
        : '',
    );
    setSeededFor(sessionId);
  }

  if (sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-medium text-foreground">This chat no longer exists.</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-sm text-primary underline underline-offset-2"
        >
          Back to the chat lab
        </button>
      </div>
    );
  }

  const emptyState = (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <FlaskConical className="size-6 text-primary" />
      </div>
      <div>
        <p className="font-medium text-foreground">{sessionQuery.data?.session.title ?? 'New Chat'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a model below and send a message — attach an image or file to test OCR and extraction.
        </p>
      </div>
    </div>
  );

  const selectedModel = models.find((m) => m.id === model) ?? null;
  const assetHint =
    !!projectRef &&
    (projectQuery.data?.assets.length ?? 0) > 0 &&
    !!selectedModel &&
    !selectedModel.supportsTools;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {projectRef && (
        <div className="border-b border-border px-4 py-1.5">
          <Link
            href={`/p/${projectRef.id}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <FolderKanban className="size-3.5 shrink-0" />
            <span className="truncate">{projectRef.name}</span>
          </Link>
        </div>
      )}
      <MessageList
        sessionId={sessionId}
        messages={sessionQuery.data?.messages ?? []}
        stream={stream}
        emptyState={emptyState}
        isLoading={sessionQuery.isLoading}
      />
      <div className="border-t border-border bg-background p-3">
        <div className="mx-auto w-full max-w-3xl">
          {modelsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading models…
            </div>
          ) : modelsQuery.isError ? (
            <div className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
              {modelsQuery.error instanceof ApiError && modelsQuery.error.status === 503
                ? 'AI chat is not configured on the server.'
                : 'Could not load the model catalog.'}{' '}
              <button type="button" className="text-primary underline underline-offset-2" onClick={() => void modelsQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <Composer
              sessionId={sessionId}
              models={models}
              model={model}
              onModelChange={setModel}
              reasoningEffort={effort}
              onReasoningEffortChange={setEffort}
              isStreaming={stream.isStreaming}
              assetHint={assetHint}
              onSend={(content, attachmentIds) => {
                if (!model) return;
                void stream.sendMessage({ sessionId, content, model, reasoningEffort: effort, attachmentIds });
              }}
              onStop={stream.stop}
            />
          )}
        </div>
      </div>
    </div>
  );
}
