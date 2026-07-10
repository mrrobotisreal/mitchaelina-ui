import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatLabShell from '@/components/chatlab/chat-lab-shell';
import ChatLabSession from '@/components/chatlab/chat-lab-session';

// /p/[projectId]/c/[sessionId] — a chat inside a project. Renders the SAME
// session screen as the general route; the project breadcrumb comes from the
// session detail's `project` field, so the projectId segment needs no explicit
// prop. Next 16: `params` is a Promise.
export default async function ChatLabProjectSessionPage({
  params,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <ChatLabShell>
        <ChatLabSession sessionId={sessionId} />
      </ChatLabShell>
    </Suspense>
  );
}
