import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatLabShell from '@/components/chatlab/chat-lab-shell';
import ChatLabSession from '@/components/chatlab/chat-lab-session';

// /c/[sessionId] — an open chat session. Next 16: `params` is a Promise.
export default async function ChatLabSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
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
