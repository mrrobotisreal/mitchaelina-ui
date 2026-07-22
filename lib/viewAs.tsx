'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Admin "view-as" state. When an admin activates view-as, GET requests carry an
// `X-View-As: <email>` header so the API returns that user's data (read-only —
// the server rejects any mutation carrying the header, and the UI additionally
// disables mutating affordances). Non-admins never activate it.
//
// The active email is persisted to sessionStorage so a reload keeps the lens
// within the tab, and mirrored into a module-level getter that apiClient.ts
// reads WITHOUT importing React — that keeps the transport layer decoupled from
// the provider while still attaching the header. On any change we clear the
// whole query cache so cached userA data never flashes under userB's view.

const STORAGE_KEY = 'mitchaelina.viewAs';

// Module-level mirror of the active view-as email. apiClient.ts reads this via
// getViewAsEmail() so it can attach the header on GETs without a React import.
let currentViewAsEmail: string | null = null;

/** Read the active view-as email (null when not viewing as another user).
 *  Used by apiClient.apiGet to attach the X-View-As header. */
export function getViewAsEmail(): string | null {
  return currentViewAsEmail;
}

function readStored(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

interface ViewAsContextValue {
  /** The email being viewed, or null when viewing your own data. */
  viewAsEmail: string | null;
  /** True whenever a view-as lens is active (read-only mode). */
  viewingAs: boolean;
  /** Activate view-as for an email (clears the query cache). */
  setViewAs: (email: string | null) => void;
  /** Exit view-as (clears the query cache). */
  exitViewAs: () => void;
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null);

export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [viewAsEmail, setViewAsEmailState] = useState<string | null>(null);

  // Hydrate from sessionStorage once on mount (keeps SSR markup stable — the
  // module mirror is also seeded so an early apiGet sees the right value).
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      currentViewAsEmail = stored;
      setViewAsEmailState(stored);
      // Whatever was cached under the previous (own) view must not leak.
      qc.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback(
    (email: string | null) => {
      currentViewAsEmail = email;
      setViewAsEmailState(email);
      try {
        if (email) window.sessionStorage.setItem(STORAGE_KEY, email);
        else window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // sessionStorage unavailable (private mode / SSR) — in-memory only.
      }
      // Drop every cached query so userA's data never renders under userB's
      // view (and vice-versa on exit). Fresh fetches carry the new header.
      qc.clear();
    },
    [qc],
  );

  const value: ViewAsContextValue = {
    viewAsEmail,
    viewingAs: viewAsEmail !== null,
    setViewAs: apply,
    exitViewAs: () => apply(null),
  };

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

/** Access the view-as state. Safe to call outside the provider (returns the
 *  inert default) so non-admin code paths need no special-casing. */
export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext);
  if (!ctx) {
    return { viewAsEmail: null, viewingAs: false, setViewAs: () => {}, exitViewAs: () => {} };
  }
  return ctx;
}
