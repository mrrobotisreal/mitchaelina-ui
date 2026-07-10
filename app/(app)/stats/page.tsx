import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatLabShell from '@/components/chatlab/chat-lab-shell';
import StatsView from '@/components/chatlab/stats/stats-view';

// /stats — usage & spend analytics + the credit ledger.
export default function ChatLabStatsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <ChatLabShell>
        <StatsView />
      </ChatLabShell>
    </Suspense>
  );
}
