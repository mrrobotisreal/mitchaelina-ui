'use client';

import { useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import ChatLabSidebar from './chat-lab-sidebar';

// Two-pane chat-lab layout: a fixed 280px sidebar on md+ and, below md, a
// Sheet toggled from a small header button. The main pane owns its own
// internal scrolling (the app shell renders this route full-bleed).
export default function ChatLabShell({ children }: { children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex min-h-0 w-full flex-1">
      <div className="hidden w-[280px] shrink-0 border-r border-border md:flex md:flex-col">
        <ChatLabSidebar />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile header: sidebar toggle */}
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open chat list"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PanelLeft className="size-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Chats</SheetTitle>
              </SheetHeader>
              <ChatLabSidebar onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold">Mitchaelina</span>
        </div>
        {children}
      </div>
    </div>
  );
}
