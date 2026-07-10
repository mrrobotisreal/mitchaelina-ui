'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useDeleteChatLabSession, useRenameChatLabSession } from '@/lib/chatlab/useChatLab';
import type { ChatLabSession } from '@/schemas/chatLab';

// Session rows + their rename/delete affordances, shared by the sidebar
// (general list + expanded project) and the project page's chat list. hrefFor
// decides the destination (/c/{id} for general chats, /p/{pid}/c/{id} for
// project chats).

interface SessionRowsProps {
  sessions: ChatLabSession[];
  hrefFor: (session: ChatLabSession) => string;
  activeId?: string | null;
  /** Called after any navigation (mobile sheet closes itself). */
  onNavigate?: () => void;
  /** Where to go when the currently-open session is deleted. */
  deleteRedirect?: string;
  indent?: boolean;
}

export default function SessionRows({ sessions, hrefFor, activeId, onNavigate, deleteRedirect, indent }: SessionRowsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const renameSession = useRenameChatLabSession();
  const deleteSession = useDeleteChatLabSession();

  const [renaming, setRenaming] = useState<ChatLabSession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ChatLabSession | null>(null);

  const handleRename = async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    if (!title || title.length > 120) {
      toast.error('Title must be 1–120 characters');
      return;
    }
    try {
      await renameSession.mutateAsync({ sessionId: renaming.id, title });
      setRenaming(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename chat');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const wasOpen = pathname?.includes(`/c/${deleting.id}`) ?? false;
    try {
      await deleteSession.mutateAsync(deleting.id);
      setDeleting(null);
      if (wasOpen) {
        router.push(deleteRedirect ?? '/');
        onNavigate?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete chat');
    }
  };

  return (
    <div className={cn('space-y-0.5', indent && 'ml-4 border-l border-border pl-1.5')}>
      {sessions.map((s) => (
        <div
          key={s.id}
          className={cn(
            'group flex items-center gap-1 rounded-md text-sm text-foreground/80 transition-colors hover:bg-accent/50',
            activeId === s.id && 'bg-accent font-medium text-foreground',
          )}
        >
          <Link
            href={hrefFor(s)}
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
            title={s.title}
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for ${s.title}`}
                className="mr-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={!s.isMine}
                onSelect={() => {
                  setRenaming(s);
                  setRenameValue(s.title);
                }}
              >
                <Pencil className="size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={!s.isMine} onSelect={() => setDeleting(s)}>
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={120}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleRename();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRename()} disabled={renameSession.isPending}>
              {renameSession.isPending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and all of its messages and attachments will be permanently deleted. This can&apos;t
              be undone.
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
              {deleteSession.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
