'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, ChevronDown, Eye, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthState, signOut } from '@/lib/auth';
import { useMe } from '@/lib/chatlab/useChatLab';
import { useViewAs } from '@/lib/viewAs';

// Minimal private chrome. The chat lab IS the entire product, so the shell is
// always full-bleed: the multi-pane app owns its own internal scrolling. Only
// mounted inside AuthGate, so the user is authenticated by the time this
// renders.
//
// For NON-admins this renders byte-for-byte the original chrome (a plain email
// span). For admins the email becomes a "view-as" dropdown (My account + one
// item per other allowlisted user), and a read-only banner shows under the
// header while a view-as lens is active.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuthState();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const { data: me } = useMe();
  const { viewAsEmail, viewingAs, setViewAs, exitViewAs } = useViewAs();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace('/auth');
    }
  };

  const isAdmin = me?.isAdmin ?? false;
  // The other allowlisted accounts (never the admin's own email).
  const otherUsers = (me?.users ?? []).filter((u) => u.toLowerCase() !== (me?.email ?? '').toLowerCase());

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-brand text-lg tracking-tight">
            <img src="/avatar.webp" alt="" className="size-8 rounded-full object-cover" />
            Mitchaelina
          </Link>
          <div className="flex items-center gap-3">
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    {viewingAs ? (
                      <span className="flex items-center gap-1.5">
                        <Eye className="size-4" />
                        <span className="hidden max-w-[16rem] truncate sm:inline">{viewAsEmail}</span>
                      </span>
                    ) : (
                      <span className="hidden max-w-[16rem] truncate sm:inline">{me?.email}</span>
                    )}
                    <ChevronDown className="size-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>View as</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => exitViewAs()}>
                    <Check className={`size-4 ${viewingAs ? 'opacity-0' : 'opacity-100'}`} />
                    <span className="truncate">My account</span>
                  </DropdownMenuItem>
                  {otherUsers.length > 0 && <DropdownMenuSeparator />}
                  {otherUsers.map((u) => (
                    <DropdownMenuItem key={u} onSelect={() => setViewAs(u)}>
                      <Check className={`size-4 ${viewAsEmail === u ? 'opacity-100' : 'opacity-0'}`} />
                      <span className="truncate">{u}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              user?.email && (
                <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
              )
            )}
            <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
        {viewingAs && (
          <div className="flex w-full items-center justify-between gap-4 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
            <span className="flex items-center gap-2">
              <Eye className="size-4 shrink-0" />
              Viewing as <span className="font-medium">{viewAsEmail}</span> — read-only
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-amber-500/40 bg-background/40"
              onClick={() => exitViewAs()}
            >
              Exit
            </Button>
          </div>
        )}
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col">{children}</main>
    </div>
  );
}
