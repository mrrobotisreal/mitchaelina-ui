'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useChatLabProjects,
  useChatLabSessions,
  useCreateChatLabSession,
  useDeleteChatLabProject,
} from '@/lib/chatlab/useChatLab';
import type { ChatLabProject, ChatLabSession } from '@/schemas/chatLab';
import { groupByRecency } from './recency';
import SessionRows from './session-rows';
import NewProjectDialog from './projects/new-project-dialog';
import ProjectEditDialog from './projects/project-edit-dialog';

// The chat-lab sidebar, top → bottom: New Chat (general) · divider · Projects
// (header row with a New Project action, then the project list — the ACTIVE
// project expands to show its chats; navigation IS expansion, no independent
// toggle state) · divider · the general chats grouped by recency (naturally
// project-free thanks to the API default).

interface ChatLabSidebarProps {
  /** Called after any navigation (mobile sheet closes itself). */
  onNavigate?: () => void;
}

export default function ChatLabSidebar({ onNavigate }: ChatLabSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: sessions, isLoading } = useChatLabSessions();
  const { data: projects, isLoading: projectsLoading } = useChatLabProjects();
  const createSession = useCreateChatLabSession();

  const activeSessionId = useMemo(() => pathname?.match(/\/c\/([^/?]+)/)?.[1] ?? null, [pathname]);
  const activeProjectId = useMemo(
    () => pathname?.match(/^\/p\/([^/?]+)/)?.[1] ?? null,
    [pathname],
  );

  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const generalGroups = useMemo(() => groupByRecency(sessions ?? []), [sessions]);

  const handleNewChat = async () => {
    try {
      const session = await createSession.mutateAsync(undefined);
      router.push(`/c/${session.id}`);
      onNavigate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create chat');
    }
  };

  return (
    <nav className="flex h-full w-full flex-col p-2">
      <Button onClick={() => void handleNewChat()} disabled={createSession.isPending} className="w-full justify-start gap-2">
        {createSession.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        New Chat
      </Button>
      <Separator className="my-2" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---- Projects ---- */}
        <div className="flex items-center justify-between px-2 py-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <FolderKanban className="size-3.5" />
            Projects
          </span>
          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            aria-label="New project"
            title="New project"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-0.5">
          {projectsLoading && (
            <div className="space-y-2 px-1 pt-1">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          )}
          {!projectsLoading && (projects?.length ?? 0) === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p>
          )}
          {(projects ?? []).map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              active={activeProjectId === p.id}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        <Separator className="my-2" />

        {/* ---- General chats ---- */}
        {isLoading && (
          <div className="space-y-2 px-1 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        )}
        {!isLoading && (sessions?.length ?? 0) === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">No chats yet — start one!</p>
        )}
        <div className="space-y-3">
          {generalGroups.map(([group, list]) => (
            <div key={group}>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <SessionRows
                sessions={list}
                hrefFor={(s) => `/c/${s.id}`}
                activeId={activeSessionId}
                onNavigate={onNavigate}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Pinned footer: usage & spend analytics. */}
      <Separator className="my-2" />
      <Link
        href="/stats"
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent/50',
          pathname === '/stats' && 'bg-accent font-medium text-foreground',
        )}
      >
        <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
        Usage &amp; Stats
      </Link>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreated={onNavigate} />
    </nav>
  );
}

// One project row. The active project expands to list its chats plus a "New
// chat in project" action; others render collapsed (clicking navigates, which
// expands).
function ProjectRow({
  project,
  active,
  activeSessionId,
  onNavigate,
}: {
  project: ChatLabProject;
  active: boolean;
  activeSessionId: string | null;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const createSession = useCreateChatLabSession();
  const deleteProject = useDeleteChatLabProject();
  const { data: projectSessions } = useChatLabSessions(active ? { projectId: project.id } : {});
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const Chevron = active ? ChevronDown : ChevronRight;

  const handleNewChatInProject = async () => {
    try {
      const session = await createSession.mutateAsync(project.id);
      router.push(`/p/${project.id}/c/${session.id}`);
      onNavigate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create chat');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProject.mutateAsync(project.id);
      setDeleteOpen(false);
      if (active) {
        router.push('/');
        onNavigate?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md text-sm text-foreground/80 transition-colors hover:bg-accent/50',
          active && 'bg-accent font-medium text-foreground',
        )}
      >
        <Link
          href={`/p/${project.id}`}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
          title={project.name}
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${project.name}`}
              className="mr-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {/* Projects are collaboratively editable — rename for everyone. */}
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            {/* Whole-project delete stays with the creator. */}
            <DropdownMenuItem variant="destructive" disabled={!project.isMine} onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {active && (
        <div className="mt-0.5">
          <SessionRows
            sessions={projectSessions ?? []}
            hrefFor={(s: ChatLabSession) => `/p/${project.id}/c/${s.id}`}
            activeId={activeSessionId}
            onNavigate={onNavigate}
            deleteRedirect={`/p/${project.id}`}
            indent
          />
          <button
            type="button"
            onClick={() => void handleNewChatInProject()}
            disabled={createSession.isPending}
            className="ml-4 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border-l border-border py-1.5 pl-3.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {createSession.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            New chat in project
          </button>
        </div>
      )}

      <ProjectEditDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        projectId={project.id}
        scope="name"
        initialName={project.name}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{project.name}” will be permanently deleted, including ALL of its chats and assets. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteProject.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
