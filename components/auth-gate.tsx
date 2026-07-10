'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthState } from '@/lib/auth';

// UX-level gate ONLY. The real enforcement boundary is the API (Firebase
// ID-token verification + email allowlist on /api/*) — a determined user
// can't read anything without a valid, allowlisted token regardless of this
// component. This just avoids flashing the app to signed-out visitors and
// bounces them to sign in.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuthState();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth');
  }, [status, router]);

  if (status === 'authenticated') return <>{children}</>;

  // 'loading', or 'unauthenticated' mid-redirect: show a centered spinner.
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
