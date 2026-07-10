import { Suspense } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import ChatLabShell from '@/components/chatlab/chat-lab-shell';

// / — the chat lab with no session open: sidebar + an empty state prompting
// the user to pick or start a chat.
export default function ChatLabPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <ChatLabShell>
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <FlaskConical className="size-6 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">Select a chat or start a new one</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare models on OCR, structured extraction, and general tasks — pick a model per message.
            </p>
          </div>
        </div>
      </ChatLabShell>
    </Suspense>
  );
}
