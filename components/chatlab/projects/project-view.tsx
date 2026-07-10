'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AudioLines,
  Brain,
  Download,
  FileCode,
  FileText,
  FileType,
  Image as ImageIcon,
  Info,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/apiClient';
import { useQueryErrorRedirect } from '@/lib/useQueryErrorRedirect';
import { relativeTime } from '@/lib/relativeTime';
import {
  useChatLabProject,
  useCreateChatLabSession,
  useRefreshChatLabMemory,
} from '@/lib/chatlab/useChatLab';
import {
  checkProjectAssetFile,
  deleteChatLabProjectAsset,
  readImageDimensions,
  uploadChatLabProjectAsset,
} from '@/lib/chatlab/api';
import {
  CHATLAB_MAX_PROJECT_ASSETS,
  chatLabProjectAssetAccept,
  chatLabProjectAssetMaxBytes,
  type ChatLabProjectAsset,
  type ChatLabProjectAssetKind,
} from '@/schemas/chatLab';
import { formatBytes, displayNameFromEmail } from '../display';
import { groupByRecency } from '../recency';
import SessionRows from '../session-rows';
import ChatLabMarkdown from '../markdown';
import ProjectEditDialog from './project-edit-dialog';

// The project home: header (name/edit/creator/counts), a Chats column, and a
// Context column (Instructions & Description · Assets · Memory).

const ASSET_KIND_ICON: Record<ChatLabProjectAssetKind, typeof FileText> = {
  text: FileText,
  code: FileCode,
  image: ImageIcon,
  audio: AudioLines,
  pdf: FileType,
};

interface PendingAssetUpload {
  localId: number;
  file: File;
  progress: number;
  status: 'uploading' | 'error';
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const projectQuery = useChatLabProject(projectId);
  const createSession = useCreateChatLabSession();
  const refreshMemory = useRefreshChatLabMemory();
  useQueryErrorRedirect(projectQuery.error);

  const [editOpen, setEditOpen] = useState(false);
  const [uploads, setUploads] = useState<PendingAssetUpload[]>([]);
  const [deletingAsset, setDeletingAsset] = useState<ChatLabProjectAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localIdRef = useRef(0);

  const project = projectQuery.data;
  const chatGroups = useMemo(() => groupByRecency(project?.sessions ?? []), [project?.sessions]);

  if (projectQuery.error instanceof ApiError && projectQuery.error.status === 404) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-medium text-foreground">This project no longer exists.</p>
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
  if (projectQuery.isLoading || !project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleNewChat = async () => {
    try {
      const session = await createSession.mutateAsync(projectId);
      router.push(`/p/${projectId}/c/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create chat');
    }
  };

  const startAssetUpload = async (file: File) => {
    const check = checkProjectAssetFile(file);
    if (!check) {
      toast.error(`Unsupported asset type: ${file.name}`);
      return;
    }
    if (check.oversize) {
      const maxMB = Math.round(chatLabProjectAssetMaxBytes(check.kind) / (1024 * 1024));
      toast.error(`${file.name} exceeds the ${maxMB} MB ${check.kind} limit`);
      return;
    }
    if ((project.assets.length ?? 0) + uploads.length >= CHATLAB_MAX_PROJECT_ASSETS) {
      toast.error(`A project can have at most ${CHATLAB_MAX_PROJECT_ASSETS} assets`);
      return;
    }
    const localId = ++localIdRef.current;
    setUploads((prev) => [...prev, { localId, file, progress: 0, status: 'uploading' }]);

    let dims: { width: number | null; height: number | null } = { width: null, height: null };
    if (check.kind === 'image') dims = await readImageDimensions(file);

    try {
      await uploadChatLabProjectAsset({
        projectId,
        file,
        width: dims.width,
        height: dims.height,
        onProgress: (p) => setUploads((prev) => prev.map((u) => (u.localId === localId ? { ...u, progress: p } : u))),
      });
      setUploads((prev) => prev.filter((u) => u.localId !== localId));
      void projectQuery.refetch();
    } catch (err) {
      setUploads((prev) => prev.map((u) => (u.localId === localId ? { ...u, status: 'error' } : u)));
      toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
    }
  };

  const handleDeleteAsset = async () => {
    if (!deletingAsset) return;
    try {
      await deleteChatLabProjectAsset(projectId, deletingAsset.id);
      setDeletingAsset(null);
      void projectQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete asset');
    }
  };

  const handleRefreshMemory = async () => {
    try {
      const res = await refreshMemory.mutateAsync(projectId);
      if (res.status === 'disabled') {
        toast('Project memory is disabled — set DR_CHATLAB_MEMORY_MODEL on the server to enable it.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh memory');
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {/* ---- Header ---- */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                aria-label="Edit project"
                title="Edit name, description, and instructions"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Created by {displayNameFromEmail(project.createdByEmail)} · {project.chatCount}{' '}
              {project.chatCount === 1 ? 'chat' : 'chats'} · {project.assetCount}{' '}
              {project.assetCount === 1 ? 'asset' : 'assets'}
            </p>
          </div>
          <Button onClick={() => void handleNewChat()} disabled={createSession.isPending} className="gap-2">
            {createSession.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            New chat
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- Chats column ---- */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Chats</h2>
            {project.sessions.length === 0 ? (
              <Card className="p-5 text-sm text-muted-foreground">No chats in this project yet.</Card>
            ) : (
              <Card className="gap-3 p-3">
                {chatGroups.map(([group, list]) => (
                  <div key={group}>
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </div>
                    <SessionRows
                      sessions={list}
                      hrefFor={(s) => `/p/${projectId}/c/${s.id}`}
                      deleteRedirect={`/p/${projectId}`}
                    />
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* ---- Context column ---- */}
          <div className="space-y-4">
            {/* Instructions & Description */}
            <Card className="gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Instructions &amp; Description</h3>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {project.description || <span className="italic text-muted-foreground">No description yet.</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {project.instructions || (
                    <span className="italic text-muted-foreground">
                      No instructions yet — they&apos;re injected into every chat in this project.
                    </span>
                  )}
                </p>
              </div>
            </Card>

            {/* Assets */}
            <Card className="gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Assets{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({project.assets.length}/{CHATLAB_MAX_PROJECT_ASSETS})
                  </span>
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={project.assets.length + uploads.length >= CHATLAB_MAX_PROJECT_ASSETS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-3.5" /> Upload
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Markdown, text, code, images, audio (mp3/wav), and PDFs. Tool-capable models read these on demand.
              </p>

              {uploads.length > 0 && (
                <div className="space-y-2">
                  {uploads.map((u) => (
                    <div key={u.localId} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                      <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{u.file.name}</p>
                        {u.status === 'uploading' ? (
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                            <div className="h-full bg-primary transition-all" style={{ width: `${u.progress}%` }} />
                          </div>
                        ) : (
                          <p className="text-[10px] text-destructive">Upload failed</p>
                        )}
                      </div>
                      {u.status === 'error' && (
                        <button
                          type="button"
                          onClick={() => setUploads((prev) => prev.filter((x) => x.localId !== u.localId))}
                          aria-label="Dismiss failed upload"
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {project.assets.length === 0 && uploads.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">No assets yet.</p>
              ) : (
                <div className="space-y-1">
                  {project.assets.map((a) => {
                    const Icon = ASSET_KIND_ICON[a.kind];
                    return (
                      <div key={a.id} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm" title={a.fileName}>
                            {a.fileName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(a.sizeBytes)} · {displayNameFromEmail(a.uploadedByEmail)}
                          </p>
                        </div>
                        <a
                          href={a.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          aria-label={`Download ${a.fileName}`}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                        >
                          <Download className="size-4" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setDeletingAsset(a)}
                          aria-label={`Delete ${a.fileName}`}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={chatLabProjectAssetAccept()}
                className="hidden"
                onChange={(e) => {
                  for (const file of Array.from(e.target.files ?? [])) void startAssetUpload(file);
                  e.target.value = '';
                }}
              />
            </Card>

            {/* Memory */}
            <Card className="gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <Brain className="size-4 text-primary" />
                  Memory
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        Updates automatically every night (4 AM MT) when anything in the project changed — chats,
                        description, instructions, assets, or feedback. Each update replaces the previous memory. Use
                        Refresh to update now.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </h3>
                <div className="flex items-center gap-2">
                  {project.memoryStatus === 'updating' && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Loader2 className="size-3 animate-spin" /> updating
                    </Badge>
                  )}
                  {project.memoryStatus === 'error' && (
                    <Badge variant="outline" className="border-destructive/50 text-[10px] text-destructive">
                      update failed
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleRefreshMemory()}
                    disabled={refreshMemory.isPending || project.memoryStatus === 'updating' || project.memoryStatus === 'disabled'}
                  >
                    <RefreshCw className={cn('size-3.5', refreshMemory.isPending && 'animate-spin')} />
                    Refresh memory
                  </Button>
                </div>
              </div>

              {project.memoryStatus === 'disabled' ? (
                <p className="text-sm italic text-muted-foreground">
                  Project memory is disabled — set <code className="rounded bg-muted px-1">DR_CHATLAB_MEMORY_MODEL</code>{' '}
                  on the server to enable automatic memory.
                </p>
              ) : project.memory ? (
                <>
                  <ChatLabMarkdown content={project.memory} />
                  {project.memoryUpdatedAt && (
                    <p className="text-[11px] text-muted-foreground">Updated {relativeTime(project.memoryUpdatedAt)}</p>
                  )}
                </>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No memory yet — it builds automatically as you chat.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>

      <ProjectEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        initialName={project.name}
        initialDescription={project.description}
        initialInstructions={project.instructions}
      />

      <AlertDialog open={!!deletingAsset} onOpenChange={(o) => !o && setDeletingAsset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingAsset?.fileName}” will be removed from the project library. Models will no longer be able to
              read it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAsset();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
