'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Download,
  File as FileIcon,
  FileSearch,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ImageViewerModal from './image-viewer-modal';
import VideoViewerModal from './video-viewer-modal';
import { formatBytes } from './display';
import { relativeTime } from '@/lib/relativeTime';
import { formatDurationMs } from '@/lib/formatDuration';
import type { ChatLabAttachment, ChatLabMessage, ChatLabToolActivity } from '@/schemas/chatLab';
import type { ChatStreamState, ChatStreamToolEvent } from '@/lib/chatlab/useChatStream';
import ChatLabMarkdown, { CopyButton } from './markdown';
import MessageFeedback from './message-feedback';

// The conversation pane: persisted messages + the optimistic pending user
// message + the live streaming assistant block.
//
// Auto-scroll: stick to the bottom ONLY when the user is already within ~80px
// of it (tracked via a scroll listener), so reading history during streaming
// isn't hijacked. We scroll the container's scrollTop directly inside a
// requestAnimationFrame — never scrollIntoView on newly mounted animated nodes
// (see the positioned-cards fix).

interface MessageListProps {
  sessionId: string;
  messages: ChatLabMessage[];
  stream: ChatStreamState;
  emptyState: React.ReactNode;
  isLoading: boolean;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// "Thought for 3m 14s · Responded in 3m 51s" — reasoning part only when the
// turn actually thought; "—" cases (historical rows) render nothing.
function TimingLine({ durationMs, reasoningMs }: { durationMs?: number | null; reasoningMs?: number | null }) {
  if (durationMs == null) return null;
  return (
    <span className="tabular-nums">
      {reasoningMs != null ? `Thought for ${formatDurationMs(reasoningMs)} · ` : ''}
      Responded in {formatDurationMs(durationMs)}
    </span>
  );
}

// Live 1s ticker shown while streaming: "Thinking… 45s" while reasoning
// deltas arrive with no content yet, "Responding… 12s" otherwise. Cleared on
// unmount (the block swaps to the persisted row when the stream settles).
function LiveTicker({ startedAt, thinking }: { startedAt: number; thinking: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      {thinking ? 'Thinking…' : 'Responding…'} {formatDurationMs(elapsed)}
    </p>
  );
}

function AttachmentChips({ attachments }: { attachments: ChatLabAttachment[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [videoIndex, setVideoIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === 'image');
  const videos = attachments.filter((a) => a.contentType.startsWith('video/'));
  const files = attachments.filter((a) => a.kind !== 'image' && !a.contentType.startsWith('video/'));
  return (
    <div className="mt-1.5 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90"
              aria-label={`Open ${a.fileName}`}
            >
              <img src={a.viewUrl} alt={a.fileName} className="h-28 w-auto max-w-[220px] object-cover" />
            </button>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {videos.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setVideoIndex(i)}
              className="overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90"
              aria-label={`Play ${a.fileName}`}
            >
              {/* muted preview frame; the modal owns real playback */}
              <video src={a.viewUrl} muted playsInline preload="metadata" className="h-28 w-auto max-w-[220px] object-cover" />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.id}
          href={a.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="flex max-w-xs items-center gap-2.5 rounded-lg border border-border bg-background p-2.5 no-underline transition-colors hover:bg-accent/40"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <FileIcon className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{a.fileName}</p>
            {a.sizeBytes > 0 && <p className="text-[10px] text-muted-foreground">{formatBytes(a.sizeBytes)}</p>}
          </div>
          <Download className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
      ))}
      {/* ChatLabAttachment is structurally compatible with the viewer's
          minimal attachment shape (viewUrl/downloadUrl), so the lightbox is
          reused as-is. */}
      <ImageViewerModal
        attachments={images}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onOpenChange={(o) => {
          if (!o) setLightboxIndex(null);
        }}
      />
      <VideoViewerModal
        videos={videos}
        startIndex={videoIndex ?? 0}
        open={videoIndex !== null}
        onOpenChange={(o) => {
          if (!o) setVideoIndex(null);
        }}
      />
    </div>
  );
}

// Collapsible reasoning block (persisted or live). `live` shows the pulsing
// indicator; `defaultOpen` is used while reasoning streams before the answer.
function ReasoningBlock({
  text,
  open,
  onOpenChange,
  live,
}: {
  text: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  live?: boolean;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-2">
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
        <Brain className={cn('size-3.5', live && 'animate-pulse text-primary')} />
        Reasoning
        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Tool-activity chips: live (streaming, may show a spinner while "running")
// and persisted (from toolActivity — always ok/error).
function ToolChips({ items }: { items: Array<ChatStreamToolEvent | ChatLabToolActivity> }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {items.map((t, i) => {
        const status = t.status as 'running' | 'ok' | 'error';
        return (
          <span
            key={`${t.assetId}-${i}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
              status === 'error'
                ? 'border-destructive/50 text-destructive'
                : 'border-border text-muted-foreground',
            )}
          >
            {status === 'running' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : status === 'ok' ? (
              <Check className="size-3 text-primary" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            <FileSearch className="size-3" />
            Reading asset: {t.assetName}
          </span>
        );
      })}
    </div>
  );
}

function UserBubble({ content, attachments }: { content: string; attachments?: ChatLabAttachment[] }) {
  return (
    <div className="flex flex-col items-end px-4 py-2">
      {content && (
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-foreground">
          {content}
        </div>
      )}
      {attachments && <AttachmentChips attachments={attachments} />}
    </div>
  );
}

function AssistantMessage({ message, sessionId }: { message: ChatLabMessage; sessionId: string }) {
  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {message.model && (
          <Badge variant="secondary" className="text-[10px]">
            {message.model}
          </Badge>
        )}
        {message.reasoningEffort ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Brain className="size-3" />
            {message.reasoningEffort}
          </Badge>
        ) : null}
        {message.status === 'interrupted' && (
          <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">
            interrupted
          </Badge>
        )}
        {message.status === 'error' && (
          <Badge variant="outline" className="border-destructive/50 text-[10px] text-destructive">
            error
          </Badge>
        )}
      </div>

      {message.toolActivity && <ToolChips items={message.toolActivity} />}
      {message.reasoning && <ReasoningBlock text={message.reasoning} />}

      {message.content ? (
        <ChatLabMarkdown content={message.content} />
      ) : (
        message.status !== 'error' && <p className="text-sm italic text-muted-foreground">(no output)</p>
      )}

      {message.status === 'error' && message.errorMessage && (
        <p className="mt-1 text-sm text-destructive">{message.errorMessage}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {message.promptTokens != null && message.completionTokens != null && (
          <span className="tabular-nums">
            {message.promptTokens} in · {message.completionTokens} out
            {message.reasoningTokens ? ` · ${message.reasoningTokens} reasoning` : ''}
          </span>
        )}
        {message.totalCostUsd != null && <span className="tabular-nums">{formatCost(message.totalCostUsd)}</span>}
        <TimingLine durationMs={message.durationMs} reasoningMs={message.reasoningMs} />
        <span>{relativeTime(message.createdAt)}</span>
        {message.content && <CopyButton text={message.content} label="Copy markdown" />}
        <MessageFeedback sessionId={sessionId} messageId={message.id} feedback={message.feedback} />
      </div>
    </div>
  );
}

// The live streaming assistant block: collapsible reasoning (auto-collapsed
// once the answer starts) above the streaming markdown, with a blinking cursor.
function StreamingAssistant({ stream }: { stream: ChatStreamState }) {
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const collapsedOnce = useRef(false);
  useEffect(() => {
    if (stream.assistantText && !collapsedOnce.current) {
      collapsedOnce.current = true;
      setReasoningOpen(false);
    }
  }, [stream.assistantText]);

  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {stream.model && (
          <Badge variant="secondary" className="text-[10px]">
            {stream.model}
          </Badge>
        )}
        {stream.reasoningEffort ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Brain className="size-3" />
            {stream.reasoningEffort}
          </Badge>
        ) : null}
      </div>

      <ToolChips items={stream.toolEvents} />
      {stream.reasoningText && (
        <ReasoningBlock text={stream.reasoningText} open={reasoningOpen} onOpenChange={setReasoningOpen} live />
      )}

      {stream.assistantText ? (
        <div className="relative">
          <ChatLabMarkdown content={stream.assistantText} />
          {stream.status === 'streaming' && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 align-text-bottom" aria-hidden />
          )}
        </div>
      ) : (
        !stream.reasoningText &&
        stream.toolEvents.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Waiting for the model…
          </p>
        )
      )}

      {/* Live elapsed ticker while streaming; once the usage event lands
          (done, pre-refetch) show the final server-measured timing so the
          footer appears without waiting for the reconciling refetch. */}
      {stream.status === 'streaming' && stream.startedAt != null && (
        <LiveTicker startedAt={stream.startedAt} thinking={!!stream.reasoningText && !stream.assistantText} />
      )}
      {stream.status === 'done' && stream.usage?.durationMs != null && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          <TimingLine durationMs={stream.usage.durationMs} reasoningMs={stream.usage.reasoningMs} />
        </div>
      )}
    </div>
  );
}

export default function MessageList({ sessionId, messages, stream, emptyState, isLoading }: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 80;
  };

  // Keep the live block mounted through 'done' too: the hook resets to idle
  // only after the invalidated session query has refetched, so the streamed
  // text never vanishes before the persisted row takes over.
  const streaming =
    stream.status === 'streaming' ||
    (stream.status === 'done' && (stream.assistantText !== '' || stream.reasoningText !== ''));

  // Stick to bottom on new content only when already near the bottom. Direct
  // scrollTop assignment inside rAF — no scrollIntoView.
  useLayoutEffect(() => {
    if (!atBottomRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      rafRef.current = null;
    });
  }, [messages, stream.assistantText, stream.reasoningText, stream.pendingUser, streaming]);
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // Jump to the bottom when a session first loads.
  const sessionLoaded = !isLoading && messages.length > 0;
  const initialised = useRef(false);
  useLayoutEffect(() => {
    if (!sessionLoaded || initialised.current) return;
    initialised.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionLoaded]);

  const showEmpty = !isLoading && messages.length === 0 && !stream.pendingUser && !streaming;

  return (
    <div ref={scrollerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : showEmpty ? (
        emptyState
      ) : (
        <div className="mx-auto w-full max-w-3xl pb-4 pt-2">
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} content={m.content} attachments={m.attachments} />
            ) : (
              <AssistantMessage key={m.id} message={m} sessionId={sessionId} />
            ),
          )}
          {stream.pendingUser && <UserBubble content={stream.pendingUser.content} />}
          {streaming && <StreamingAssistant stream={stream} />}
        </div>
      )}
    </div>
  );
}
