'use client';

// Firebase Analytics (GA4) — lazy, guarded, and strictly optional.
//
// Analytics must NEVER crash the app, block rendering, or affect the build
// when unconfigured. Every entry point below no-ops unless ALL guards pass:
// browser-only, NEXT_PUBLIC_FB_MEASUREMENT_ID present, and
// isSupported() from firebase/analytics (it can return false in some
// environments — e.g. cookies disabled, unsupported browsers).
//
// Event params never include message content, emails, or any chat text.

import type { Analytics } from 'firebase/analytics';
import { firebaseMeasurementId, getFirebaseApp } from '@/lib/firebase';

let instancePromise: Promise<Analytics | null> | null = null;

/**
 * Lazily initializes firebase/analytics on the shared Firebase app. Returns
 * null (and caches the null) when any guard fails, making every downstream
 * call a silent no-op.
 */
export function getAnalyticsInstance(): Promise<Analytics | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!firebaseMeasurementId()?.trim()) return Promise.resolve(null);
  if (!instancePromise) {
    instancePromise = (async () => {
      try {
        const app = getFirebaseApp();
        if (!app) return null;
        const { getAnalytics, isSupported } = await import('firebase/analytics');
        if (!(await isSupported())) return null;
        return getAnalytics(app);
      } catch {
        return null;
      }
    })();
  }
  return instancePromise;
}

/** Thin logEvent wrapper over the lazy instance; no-op when unavailable. */
export function track(eventName: string, params?: Record<string, unknown>): void {
  void (async () => {
    try {
      const analytics = await getAnalyticsInstance();
      if (!analytics) return;
      const { logEvent } = await import('firebase/analytics');
      logEvent(analytics, eventName, params);
    } catch {
      // Analytics failures are never the user's problem.
    }
  })();
}
