'use client';

// Mitchaelina auth — a deliberately THIN module. It intentionally does NOT:
// create accounts, write user profiles, offer Google/OAuth, or expose password
// reset. Accounts are provisioned by hand in the Firebase console — the app is
// for exactly two people. The real security boundary is the API (Firebase
// ID-token verification + email allowlist on /api/*); this is just the
// sign-in seam.

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getFirebaseAuth, onAuthStateChange } from '@/lib/firebase';
import { track } from '@/lib/analyticsClient';

// One generic message for every failed sign-in, so we never reveal whether an
// account exists (auth/invalid-credential, auth/user-not-found,
// auth/wrong-password, auth/too-many-requests, auth/invalid-email all map here).
const GENERIC_SIGN_IN_ERROR = 'Invalid email or password.';

/** signIn authenticates with email + password only. Throws an Error whose
 *  message is safe to surface directly in the UI. */
export async function signIn(email: string, password: string): Promise<User> {
  const auth = await getFirebaseAuth();
  if (!auth) {
    // Missing NEXT_PUBLIC_FB_* config — a deployment problem, not a credential
    // one. Distinct message so it isn't mistaken for a bad password.
    throw new Error('Authentication is unavailable. Please try again later.');
  }
  try {
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
    // Firebase's standard event name for a successful sign-in.
    track('login');
    return user;
  } catch {
    // Swallow the Firebase error code — always return the same generic message.
    throw new Error(GENERIC_SIGN_IN_ERROR);
  }
}

/** signOut is a plain Firebase sign-out (no profile bookkeeping). */
export async function signOut(): Promise<void> {
  const auth = await getFirebaseAuth();
  if (!auth) return;
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
  track('sign_out');
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  user: User | null;
  status: AuthStatus;
}

/** useAuthState subscribes to Firebase auth state. Starts in 'loading' until
 *  the first callback resolves (browser + configured), then reflects presence
 *  of a signed-in user. Used by the gate and the shell. */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, status: 'loading' });

  useEffect(() => {
    const unsubscribe = onAuthStateChange((user) => {
      setState({ user, status: user ? 'authenticated' : 'unauthenticated' });
    });
    return unsubscribe;
  }, []);

  return state;
}
