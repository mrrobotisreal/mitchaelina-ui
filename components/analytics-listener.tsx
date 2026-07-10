'use client';

// Fires a page_view event on every App Router route change. Client-side
// navigations don't produce automatic page_views reliably, so we watch
// usePathname() and log explicitly. Mounted once in providers.tsx; renders
// nothing. No-ops entirely when analytics is unconfigured.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/analyticsClient';

export default function AnalyticsListener() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    track('page_view', { page_path: pathname });
  }, [pathname]);

  return null;
}
