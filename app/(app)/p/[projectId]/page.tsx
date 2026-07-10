import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatLabShell from '@/components/chatlab/chat-lab-shell';
import ProjectView from '@/components/chatlab/projects/project-view';

// /p/[projectId] — the project home: chats + context (instructions/
// description, assets, memory). Next 16: `params` is a Promise.
export default async function ChatLabProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <ChatLabShell>
        <ProjectView projectId={projectId} />
      </ChatLabShell>
    </Suspense>
  );
}
