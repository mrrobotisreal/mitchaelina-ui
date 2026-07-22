'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Loader2, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getDesktop } from '@/lib/desktop';

// Desktop-only "Local access" manager: lists the folders the user has granted
// the app permission to read/edit, with add (native picker, opened in main) and
// remove. All the real work happens over the origin-checked bridge; this is
// just the UI. On the web this dialog is never rendered (the composer gates it
// behind isDesktop()).

export default function LocalAccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [roots, setRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = getDesktop();
    if (!bridge) return;
    try {
      setRoots(await bridge.listRoots());
    } catch {
      setRoots([]);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const add = async () => {
    const bridge = getDesktop();
    if (!bridge) return;
    setBusy(true);
    try {
      setRoots(await bridge.addRoot());
    } catch {
      // ignore — picker cancelled or failed
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    const bridge = getDesktop();
    if (!bridge) return;
    try {
      setRoots(await bridge.removeRoot(path));
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Local folder access</DialogTitle>
          <DialogDescription>
            Grant the app access to specific folders on this computer. Tool-capable models can then read and
            (with your explicit approval) edit files inside them, and you can <code>@</code>-mention files as
            context. Access never extends outside the folders you grant here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {roots.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No folders granted yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {roots.map((root) => (
                <li
                  key={root}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5"
                >
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={root}>
                    {root}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(root)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`Remove ${root}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Grant a folder…
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
