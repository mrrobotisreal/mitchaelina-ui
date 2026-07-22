'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { useCreateChatLabProject } from '@/lib/chatlab/useChatLab';
import { useViewAs } from '@/lib/viewAs';

// New Project dialog: name (required) + description + instructions. Create
// navigates to the project page. Controlled from the sidebar's Plus button.
export default function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const createProject = useCreateChatLabProject();
  // Creating a project is a mutation — blocked while viewing another user
  // (the sidebar trigger is also disabled; this is defense-in-depth).
  const { viewingAs } = useViewAs();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');

  const reset = () => {
    setName('');
    setDescription('');
    setInstructions('');
  };

  const handleCreate = async () => {
    if (viewingAs) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) {
      toast.error('Project name must be 1–120 characters');
      return;
    }
    try {
      const project = await createProject.mutateAsync({ name: trimmed, description, instructions });
      onOpenChange(false);
      reset();
      router.push(`/p/${project.id}`);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project groups chats and gives them shared context: instructions, files, and a living memory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="np-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder="e.g. Handwriting OCR evaluation"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="np-desc" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What are the chats in this project about?"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="np-instr" className="text-sm font-medium">
              Instructions
            </label>
            <textarea
              id="np-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="Special instructions the model should follow in every chat"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={createProject.isPending || !name.trim() || viewingAs}
            title={viewingAs ? 'Read-only while viewing another user' : undefined}
          >
            {createProject.isPending && <Loader2 className="size-4 animate-spin" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
