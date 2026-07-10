'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthState, signOut } from '@/lib/auth';

// Minimal private chrome. The chat lab IS the entire product, so the shell is
// always full-bleed: the multi-pane app owns its own internal scrolling. Only
// mounted inside AuthGate, so the user is authenticated by the time this
// renders.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuthState();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace('/auth');
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Mitchaelina
          </Link>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            )}
            <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col">{children}</main>
    </div>
  );
}
