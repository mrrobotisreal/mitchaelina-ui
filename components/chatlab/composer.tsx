'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Send, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  CHATLAB_MAX_ATTACHMENTS,
  chatLabAccept,
  chatLabMaxBytes,
  type ChatLabAttachmentKind,
  type ChatLabEffortOrOff,
  type ChatLabModel,
} from '@/schemas/chatLab';
import {
  deleteChatLabAttachment,
  isChatLabAttachmentOversize,
  readImageDimensions,
  resolveChatLabAttachment,
  uploadChatLabAttachment,
} from '@/lib/chatlab/api';
import ModelPicker from './model-picker';
import ReasoningPicker from './reasoning-picker';

interface PendingAttachment {
  localId: number;
  file: File;
  kind: ChatLabAttachmentKind;
  contentType: string;
  previewUrl?: string; // object URL for image previews
  progress: number; // 0–100
  attachmentId?: string;
  status: 'uploading' | 'done' | 'error';
  controller: AbortController;
}

interface ComposerProps {
  sessionId: string;
  models: ChatLabModel[];
  model: string | null;
  onModelChange: (modelId: string) => void;
  reasoningEffort: ChatLabEffortOrOff;
  onReasoningEffortChange: (effort: ChatLabEffortOrOff) => void;
  isStreaming: boolean;
  /** Project chat + assets present + selected model can't call tools. */
  assetHint?: boolean;
  onSend: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
}

// The chat composer: auto-growing textarea (Enter sends, Shift+Enter newline),
// attachment chips with upload progress, and a toolbar row with the model +
// reasoning pickers and Send/Stop. Send is disabled while uploads are in
// flight or when there is nothing to send.
export default function Composer({
  sessionId,
  models,
  model,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  isStreaming,
  assetHint,
  onSend,
  onStop,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localIdRef = useRef(0);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const selectedModel = models.find((m) => m.id === model) ?? null;

  // Auto-reset effort to Off when switching to a model without reasoning.
  useEffect(() => {
    if (selectedModel && !selectedModel.supportsReasoning && reasoningEffort !== '') {
      onReasoningEffortChange('');
    }
  }, [selectedModel, reasoningEffort, onReasoningEffortChange]);

  // Auto-grow the textarea up to a cap; reset height when cleared.
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);
  useEffect(autoGrow, [text, autoGrow]);

  // Abort in-flight uploads + revoke object URLs on unmount.
  useEffect(
    () => () => {
      for (const a of attachmentsRef.current) {
        a.controller.abort();
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    },
    [],
  );

  const uploading = attachments.some((a) => a.status === 'uploading');
  const readyAttachments = attachments.filter((a) => a.status === 'done' && a.attachmentId);
  // Vision guard (client half — the server 400s as belt-and-suspenders):
  // pending image attachments + a text-only model → send is blocked.
  const imagesPending = attachments.some((a) => a.kind === 'image');
  const visionBlocked = imagesPending && !!selectedModel && !selectedModel.supportsImages;

  const startUpload = useCallback(
    async (file: File) => {
      if (attachmentsRef.current.length >= CHATLAB_MAX_ATTACHMENTS) {
        toast.error(`At most ${CHATLAB_MAX_ATTACHMENTS} attachments per message`);
        return;
      }
      const resolved = resolveChatLabAttachment(file);
      if (!resolved) {
        toast.error(`Unsupported file type: ${file.name}`);
        return;
      }
      const { kind, contentType } = resolved;
      if (isChatLabAttachmentOversize(file.size, kind, contentType)) {
        const maxMB = Math.round(chatLabMaxBytes(kind, contentType) / (1024 * 1024));
        toast.error(`${file.name} exceeds the ${maxMB} MB limit`);
        return;
      }
      const localId = ++localIdRef.current;
      const controller = new AbortController();
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
      const pending: PendingAttachment = {
        localId,
        file,
        kind,
        contentType,
        previewUrl,
        progress: 0,
        status: 'uploading',
        controller,
      };
      setAttachments((prev) => [...prev, pending]);

      let dims: { width: number | null; height: number | null } = { width: null, height: null };
      if (kind === 'image') dims = await readImageDimensions(file);

      try {
        const attachmentId = await uploadChatLabAttachment({
          sessionId,
          file,
          kind,
          contentType,
          width: dims.width,
          height: dims.height,
          signal: controller.signal,
          onAttachmentId: (id) =>
            setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, attachmentId: id } : a))),
          onProgress: (p) =>
            setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, progress: p } : a))),
        });
        setAttachments((prev) =>
          prev.map((a) => (a.localId === localId ? { ...a, attachmentId, progress: 100, status: 'done' } : a)),
        );
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return; // user cancelled — row already removed
        setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, status: 'error' } : a)));
        toast.error(`Upload failed: ${file.name}`);
      }
    },
    [sessionId],
  );

  const onPickFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) void startUpload(file);
  };

  const removeAttachment = (localId: number) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target) {
        target.controller.abort();
        // A completed-but-unbound upload must be deleted server-side too.
        if (target.status === 'done' && target.attachmentId) {
          void deleteChatLabAttachment(sessionId, target.attachmentId).catch(() => {});
        }
        if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  };

  const canSend =
    !isStreaming &&
    !uploading &&
    !visionBlocked &&
    !!model &&
    (text.trim().length > 0 || readyAttachments.length > 0);

  const handleSend = () => {
    if (!canSend || !model) return;
    const ids = readyAttachments.map((a) => a.attachmentId as string);
    onSend(text, ids);
    for (const a of attachmentsRef.current) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    setText('');
    textareaRef.current?.focus();
  };

  return (
    <div className="rounded-xl border border-border bg-background focus-within:border-primary/50">
      {/* Pending attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border p-2">
          {attachments.map((a) => (
            <div key={a.localId} className="relative flex w-40 flex-col gap-1 rounded-md border border-border bg-muted/40 p-2">
              <div className="flex items-center gap-2">
                {a.previewUrl ? (
                  <img src={a.previewUrl} alt={a.file.name} className="size-8 shrink-0 rounded object-cover" />
                ) : (
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs" title={a.file.name}>
                  {a.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.localId)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {a.status === 'uploading' && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                  <div className="h-full bg-primary transition-all" style={{ width: `${a.progress}%` }} />
                </div>
              )}
              {a.status === 'error' && <span className="text-[10px] text-destructive">Upload failed</span>}
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="px-3 pt-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Message the model… (Enter to send, Shift+Enter for a new line)"
          className="max-h-60 min-h-[2.5rem] w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Toolbar: attach · model · reasoning · send/stop */}
      <div className="flex items-center gap-1.5 p-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachments.length >= CHATLAB_MAX_ATTACHMENTS}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Attach files"
          title="Attach images, PDFs, or text files"
        >
          <Paperclip className="size-4" />
        </button>
        <ModelPicker
          models={models}
          value={model}
          onChange={onModelChange}
          disabled={isStreaming}
          dimNonVision={imagesPending}
        />
        <ReasoningPicker
          model={selectedModel}
          value={reasoningEffort}
          onChange={onReasoningEffortChange}
          disabled={isStreaming}
        />
        <div className="flex-1" />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-destructive px-3 text-xs font-medium text-white transition-colors hover:bg-destructive/90"
            aria-label="Stop generating"
          >
            <Square className="size-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            title={
              visionBlocked && selectedModel
                ? `${selectedModel.name} can't see images — pick a vision-capable model or remove the image.`
                : undefined
            }
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground',
            )}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        )}
      </div>

      {visionBlocked && selectedModel && (
        <p className="px-3 pb-2 text-[11px] text-destructive">
          {selectedModel.name} can&apos;t see images — pick a vision-capable model or remove the image.
        </p>
      )}
      {assetHint && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          This model can&apos;t read project assets on demand — text assets are inlined, other assets unavailable.
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={chatLabAccept()}
        className="hidden"
        onChange={(e) => {
          onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
