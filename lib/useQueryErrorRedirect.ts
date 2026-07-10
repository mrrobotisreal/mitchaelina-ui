'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from './apiClient';

// Centralized handling for a stale/expired session surfaced by a query: a
// 401 means the Firebase token is gone or invalid, so send the user back to
// sign in. 403 (not allowlisted) and 404 (missing row) are NOT redirected —
// those are rendered inline by the views. Implemented once here so pages don't
// each re-derive it.
export function useQueryErrorRedirect(error: unknown): void {
  const router = useRouter();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/auth');
    }
  }, [error, router]);
}
