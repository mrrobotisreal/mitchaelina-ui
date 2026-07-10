// Firebase client integration — LAZILY initialized.
//
// Nothing initializes Firebase at module-evaluation time, so importing this
// module (directly or transitively) during Next static generation never throws
// `auth/invalid-api-key`, even with blank NEXT_PUBLIC_FB_* env values. The app
// and auth SDKs are created on demand inside async getters, and only in the
// browser where relevant. When the config is missing, the getters return null
// and auth actions fail with a clear message rather than crashing the build.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FB_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FB_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FB_MEASUREMENT_ID,
};

/** True only when every required Firebase config value is present. */
export function hasFirebaseConfig(): boolean {
  return (
    [
      firebaseConfig.apiKey,
      firebaseConfig.authDomain,
      firebaseConfig.projectId,
      firebaseConfig.appId,
    ] as const
  ).every((value) => typeof value === 'string' && value.trim().length > 0);
}

/** The GA4 measurement id ("G-…"); undefined/empty when analytics is off. */
export function firebaseMeasurementId(): string | undefined {
  return firebaseConfig.measurementId;
}

/** Returns the Firebase app, initializing it on first use. Null if unconfigured. */
export function getFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseConfig()) return null;
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  if (typeof window === 'undefined') return null;
  const app = getFirebaseApp();
  if (!app) return null;
  const { getAuth } = await import('firebase/auth');
  return getAuth(app);
}

/**
 * Returns the current user's Firebase ID token, or null when nobody is
 * signed in (or Firebase isn't configured). Used to attach Authorization
 * headers to API calls — the entire /api surface is auth-gated server-side.
 */
export async function getCurrentIdToken(): Promise<string | null> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

// Auth state observer. Returns an unsubscribe function synchronously; the real
// listener attaches once Firebase resolves (browser + configured).
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  let unsubscribe = () => {};
  void getFirebaseAuth().then(async (auth) => {
    if (!auth) {
      callback(null);
      return;
    }
    const { onAuthStateChanged } = await import('firebase/auth');
    unsubscribe = onAuthStateChanged(auth, callback);
  });
  return () => unsubscribe();
};
