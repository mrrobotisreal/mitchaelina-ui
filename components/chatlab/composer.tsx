'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, Loader2, Paperclip, Send, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isMentionRead, useDesktop, type DesktopSearchResult } from '@/lib/desktop';
import LocalAccessDialog from './local-access-dialog';
import {
  CHATLAB_MAX_ATTACHMENTS,
  chatLabAccept,
  chatLabMaxBytes,
  type ChatLabAttachmentKind,
  type ChatLabEffortOrOff,
  type ChatLabGenerationOptions,
  type ChatLabModel,
  type ChatLabOutputModality,
} from '@/schemas/chatLab';
import {
  deleteChatLabAttachment,
  isChatLabAttachmentOversize,
  readImageDimensions,
  resolveChatLabAttachment,
  uploadChatLabAttachment,
} from '@/lib/chatlab/api';
import { useViewAs } from '@/lib/viewAs';
import ModelPicker from './model-picker';
import ReasoningPicker from './reasoning-picker';
import GenerationOptions from './generation-options';

// The output modalities a model can PRODUCE (text chat, image gen, video gen).
// A model may support more than one (e.g. Gemini-image does text + image); the
// composer shows the toggle only then, and auto-forces the single option
// otherwise (Seedream → Image, Veo → Video, Opus → Text).
function modelModalities(m: ChatLabModel | null): ChatLabOutputModality[] {
  if (!m) return ['text'];
  const out: ChatLabOutputModality[] = [];
  if (m.supportsText) out.push('text');
  if (m.supportsImageGen) out.push('image');
  if (m.supportsVideoGen) out.push('video');
  return out.length > 0 ? out : ['text'];
}

const MODALITY_LABEL: Record<ChatLabOutputModality, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
};

// Image-only accept string for generation modes (attachments are references /
// frames, never files).
const GENERATION_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Desktop-only local file-access payload attached to a send. */
export interface LocalSendPayload {
  localTools: boolean;
  localContext: { path: string; content: string }[];
  localEnv: { platform: string; roots: string[] };
}

/** One @-mentioned file/directory pill. `error` marks a read that failed at
 *  send time (oversize / outside roots) — surfaced, never blocks the send. */
interface MentionPill {
  path: string;
  isDir: boolean;
  error?: boolean;
}

// Detect an active "@token" ending at the caret: the nearest '@' that is at the
// start or preceded by whitespace, with no whitespace between it and the caret.
// Returns the token text + its start index, or null when no mention is active.
function detectMention(text: string, caret: number): { token: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // '@' must start a word
  const token = upto.slice(at + 1);
  if (/\s/.test(token)) return null; // whitespace ends the mention
  return { token, start: at };
}

// Short display name for a mention pill (basename, dirs keep a trailing slash).
function mentionLabel(pill: MentionPill): string {
  const trimmed = pill.path.replace(/\/+$/, '');
  const base = trimmed.split(/[\\/]/).pop() || pill.path;
  return pill.isDir ? `${base}/` : base;
}

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
  /** Output modality (text chat vs image/video generation) — controlled by the
   *  parent so it can re-seed when the model changes. */
  outputModality: ChatLabOutputModality;
  onOutputModalityChange: (modality: ChatLabOutputModality) => void;
  generationOptions: ChatLabGenerationOptions;
  onGenerationOptionsChange: (options: ChatLabGenerationOptions) => void;
  isStreaming: boolean;
  /** Project chat + assets present + selected model can't call tools. */
  assetHint?: boolean;
  onSend: (content: string, attachmentIds: string[], local?: LocalSendPayload) => void;
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
  outputModality,
  onOutputModalityChange,
  generationOptions,
  onGenerationOptionsChange,
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

  // Read-only while an admin is viewing another user's data: sending is a
  // mutation the server rejects under view-as, so the whole composer is
  // disabled (belt; the API is the suspenders).
  const { viewingAs } = useViewAs();

  // Desktop local file access — null on the web (feature stays dormant).
  const desktop = useDesktop();

  // @-mention state (desktop only). `mentions` are the selected pills; the
  // autocomplete panel is active whenever mentionQuery !== null.
  const [mentions, setMentions] = useState<MentionPill[]>([]);
  const mentionsRef = useRef<MentionPill[]>([]);
  useEffect(() => {
    mentionsRef.current = mentions;
  }, [mentions]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [mentionResults, setMentionResults] = useState<DesktopSearchResult[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [localDialogOpen, setLocalDialogOpen] = useState(false);

  const selectedModel = models.find((m) => m.id === model) ?? null;
  const modalities = useMemo(() => modelModalities(selectedModel), [selectedModel]);
  const isGeneration = outputModality !== 'text';

  // Auto-reset effort to Off when switching to a model without reasoning.
  useEffect(() => {
    if (selectedModel && !selectedModel.supportsReasoning && reasoningEffort !== '') {
      onReasoningEffortChange('');
    }
  }, [selectedModel, reasoningEffort, onReasoningEffortChange]);

  // Keep the output modality valid for the selected model (the parent holds the
  // state; the composer corrects it on model change, like the reasoning reset).
  useEffect(() => {
    if (selectedModel && !modalities.includes(outputModality)) {
      onOutputModalityChange(modalities[0]);
    }
  }, [selectedModel, modalities, outputModality, onOutputModalityChange]);

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
  // pending image attachments + a text-only model → send is blocked. Not
  // applicable in generation modes (images there are references/frames).
  const imagesPending = attachments.some((a) => a.kind === 'image');
  const visionBlocked = !isGeneration && imagesPending && !!selectedModel && !selectedModel.supportsImages;

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
      if (isGeneration && kind !== 'image') {
        toast.error('Only images can guide media generation');
        return;
      }
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
    [sessionId, isGeneration],
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

  // --- @ mentions (desktop only) --------------------------------------------
  const closeMentionPanel = useCallback(() => {
    setMentionQuery(null);
    setMentionStart(-1);
    setMentionResults([]);
    setMentionIndex(0);
  }, []);

  // Recompute the active "@token" from the textarea's current value + caret.
  const syncMention = useCallback(() => {
    if (!desktop || isGeneration) {
      closeMentionPanel();
      return;
    }
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const found = detectMention(el.value, caret);
    if (!found) {
      closeMentionPanel();
      return;
    }
    setMentionQuery(found.token);
    setMentionStart(found.start);
  }, [desktop, isGeneration, closeMentionPanel]);

  // Debounced fuzzy search as the mention query changes.
  useEffect(() => {
    if (mentionQuery === null || !desktop) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await desktop.searchFiles(mentionQuery, 12);
        if (!cancelled) {
          setMentionResults(results);
          setMentionIndex(0);
        }
      } catch {
        if (!cancelled) setMentionResults([]);
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery, desktop]);

  // Insert a selected result as a pill and strip the "@token" from the text.
  const selectMention = useCallback(
    (result: DesktopSearchResult) => {
      const el = textareaRef.current;
      if (!el || mentionStart < 0) return;
      const caret = el.selectionStart ?? el.value.length;
      const next = text.slice(0, mentionStart) + text.slice(caret);
      setText(next);
      setMentions((prev) =>
        prev.some((m) => m.path === result.path) ? prev : [...prev, { path: result.path, isDir: result.isDir }],
      );
      closeMentionPanel();
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) {
          node.focus();
          node.selectionStart = node.selectionEnd = mentionStart;
        }
      });
    },
    [text, mentionStart, closeMentionPanel],
  );

  const removeMention = useCallback((path: string) => {
    setMentions((prev) => prev.filter((m) => m.path !== path));
  }, []);

  const panelOpen = mentionQuery !== null && mentionResults.length > 0;

  // Generation always needs a text prompt; text chat can send on attachments
  // alone.
  const hasContent = isGeneration
    ? text.trim().length > 0
    : text.trim().length > 0 || readyAttachments.length > 0 || mentions.length > 0;
  const canSend = !isStreaming && !uploading && !visionBlocked && !!model && hasContent && !viewingAs;

  const handleSend = async () => {
    if (!canSend || !model) return;
    const ids = readyAttachments.map((a) => a.attachmentId as string);

    // Desktop text send: read @-mention contents + gather granted roots.
    let local: LocalSendPayload | undefined;
    if (desktop && !isGeneration) {
      let roots: string[] = [];
      try {
        roots = await desktop.listRoots();
      } catch {
        roots = [];
      }
      const localContext: { path: string; content: string }[] = [];
      const pills = mentionsRef.current;
      for (const pill of pills) {
        try {
          const res = await desktop.readMention(pill.path);
          if (isMentionRead(res)) {
            localContext.push({ path: pill.path, content: res.content });
          } else {
            setMentions((prev) => prev.map((m) => (m.path === pill.path ? { ...m, error: true } : m)));
          }
        } catch {
          setMentions((prev) => prev.map((m) => (m.path === pill.path ? { ...m, error: true } : m)));
        }
      }
      local = {
        localTools: !!selectedModel?.supportsTools,
        localContext,
        localEnv: { platform: desktop.platform, roots },
      };
      // Nudge the user to grant a folder when they @-mentioned or a tool-capable
      // model has nothing to work with.
      if ((pills.length > 0 || selectedModel?.supportsTools) && roots.length === 0) {
        setLocalDialogOpen(true);
      }
    }

    onSend(text, ids, local);
    for (const a of attachmentsRef.current) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    setText('');
    setMentions([]);
    closeMentionPanel();
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

      {/* @-mention pills (desktop only) */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border p-2">
          {mentions.map((m) => (
            <span
              key={m.path}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
                m.error ? 'border-destructive/50 text-destructive' : 'border-border bg-muted/40 text-foreground',
              )}
              title={m.error ? `${m.path} — could not be read` : m.path}
            >
              {m.isDir ? <FolderOpen className="size-3" /> : <FileText className="size-3" />}
              {mentionLabel(m)}
              <button
                type="button"
                onClick={() => removeMention(m.path)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`Remove ${m.path}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="relative px-3 pt-2">
        {/* @-mention autocomplete panel (above the textarea) */}
        {panelOpen && (
          <div className="absolute bottom-full left-2 z-20 mb-1 max-h-64 w-[min(28rem,calc(100%-1rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            {mentionResults.map((r, i) => (
              <button
                key={r.path}
                type="button"
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus
                  selectMention(r);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  i === mentionIndex ? 'bg-accent text-foreground' : 'text-muted-foreground',
                )}
              >
                {r.isDir ? (
                  <FolderOpen className="size-3.5 shrink-0" />
                ) : (
                  <FileText className="size-3.5 shrink-0" />
                )}
                <span className="truncate font-mono">{r.path}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            syncMention();
          }}
          onKeyUp={syncMention}
          onClick={syncMention}
          onKeyDown={(e) => {
            if (panelOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const chosen = mentionResults[mentionIndex];
                if (chosen) selectMention(chosen);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                closeMentionPanel();
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          disabled={viewingAs}
          placeholder={
            viewingAs
              ? 'Read-only while viewing another user'
              : isGeneration
                ? `Describe the ${outputModality} to generate… (Enter to send)`
                : desktop
                  ? 'Message the model… (@ to mention a local file, Enter to send)'
                  : 'Message the model… (Enter to send, Shift+Enter for a new line)'
          }
          className="max-h-60 min-h-[2.5rem] w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {/* Toolbar: attach · model · reasoning · send/stop */}
      <div className="flex items-center gap-1.5 p-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={viewingAs || attachments.length >= CHATLAB_MAX_ATTACHMENTS}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Attach files"
          title={
            viewingAs
              ? 'Read-only while viewing another user'
              : isGeneration
                ? 'Attach an image to guide generation'
                : 'Attach images, PDFs, or text files'
          }
        >
          <Paperclip className="size-4" />
        </button>
        {desktop && !isGeneration && (
          <button
            type="button"
            onClick={() => setLocalDialogOpen(true)}
            disabled={viewingAs}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Local folder access"
            title="Grant local folder access for @-mentions and file editing"
          >
            <FolderOpen className="size-4" />
          </button>
        )}
        <ModelPicker
          models={models}
          value={model}
          onChange={onModelChange}
          disabled={isStreaming}
          dimNonVision={imagesPending && !isGeneration}
        />
        {modalities.length > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Output type">
            {modalities.map((m) => (
              <button
                key={m}
                type="button"
                disabled={isStreaming}
                onClick={() => onOutputModalityChange(m)}
                aria-pressed={outputModality === m}
                className={cn(
                  'h-8 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  outputModality === m
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {MODALITY_LABEL[m]}
              </button>
            ))}
          </div>
        )}
        {isGeneration ? (
          <GenerationOptions
            modality={outputModality as Exclude<ChatLabOutputModality, 'text'>}
            value={generationOptions}
            onChange={onGenerationOptionsChange}
            disabled={isStreaming}
          />
        ) : (
          <ReasoningPicker
            model={selectedModel}
            value={reasoningEffort}
            onChange={onReasoningEffortChange}
            disabled={isStreaming}
          />
        )}
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

      {viewingAs && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          Read-only while viewing another user — you can inspect this chat but not send messages.
        </p>
      )}
      {visionBlocked && selectedModel && (
        <p className="px-3 pb-2 text-[11px] text-destructive">
          {selectedModel.name} can&apos;t see images — pick a vision-capable model or remove the image.
        </p>
      )}
      {assetHint && !isGeneration && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          This model can&apos;t read project assets on demand — text assets are inlined, other assets unavailable.
        </p>
      )}
      {desktop && !isGeneration && !!selectedModel && !selectedModel.supportsTools && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          {selectedModel.name} can&apos;t use local tools — @-mentioned files are still sent as context, but it
          can&apos;t read or edit files on its own. Pick a tool-capable model for that.
        </p>
      )}
      {isGeneration && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          {outputModality === 'video'
            ? 'Generating video — attach an image to use as the first frame (optional).'
            : 'Generating an image — attach image(s) to guide it (optional).'}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={isGeneration ? GENERATION_IMAGE_ACCEPT : chatLabAccept()}
        className="hidden"
        onChange={(e) => {
          onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {desktop && <LocalAccessDialog open={localDialogOpen} onOpenChange={setLocalDialogOpen} />}
    </div>
  );
}
