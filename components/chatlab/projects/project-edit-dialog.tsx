'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdateChatLabProject } from '@/lib/chatlab/useChatLab';
import { useViewAs } from '@/lib/viewAs';

// Edit dialog for a project's name/description/instructions. Projects are
// COLLABORATIVELY editable — both portal users get this, the server enforces
// nothing beyond auth. scope="name" narrows it to the rename affordance used
// by the sidebar menu. Description/instructions changes fire the memory
// updater server-side.
export default function ProjectEditDialog({
  open,
  onOpenChange,
  projectId,
  scope = 'full',
  initialName,
  initialDescription = '',
  initialInstructions = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  scope?: 'full' | 'name';
  initialName: string;
  initialDescription?: string;
  initialInstructions?: string;
}) {
  const updateProject = useUpdateChatLabProject();
  // Editing a project is a mutation (and refreshes memory) — blocked while
  // viewing another user (the trigger is also disabled; defense-in-depth).
  const { viewingAs } = useViewAs();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [instructions, setInstructions] = useState(initialInstructions);

  // Re-seed whenever the dialog (re)opens for possibly-new values —
  // render-time state adjustment (React's "derived state" pattern), no effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setInstructions(initialInstructions);
    }
  }

  const handleSave = async () => {
    if (viewingAs) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) {
      toast.error('Project name must be 1–120 characters');
      return;
    }
    try {
      await updateProject.mutateAsync({
        projectId,
        body: scope === 'name' ? { name: trimmed } : { name: trimmed, description, instructions },
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update project');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{scope === 'name' ? 'Rename project' : 'Edit project'}</DialogTitle>
          {scope === 'full' && (
            <DialogDescription>
              Changes to the description or instructions also refresh the project memory.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="pe-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="pe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (scope === 'name' && e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>
          {scope === 'full' && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="pe-desc" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="pe-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What are the chats in this project about?"
                  className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pe-instr" className="text-sm font-medium">
                  Instructions
                </label>
                <textarea
                  id="pe-instr"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={5}
                  placeholder="Special instructions the model should follow in every chat"
                  className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={updateProject.isPending || viewingAs}
            title={viewingAs ? 'Read-only while viewing another user' : undefined}
          >
            {updateProject.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
