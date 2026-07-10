// Shared API plumbing: Bearer-token attachment, error shaping, and the query
// retry policy, so the auth header + error handling live in exactly one
// place. getBaseURL() already includes the `/api` suffix, so paths here start
// at `/chatlab/...`.

import { getBaseURL } from '@/lib/utils';
import { getCurrentIdToken } from '@/lib/firebase';

/** ApiError carries the HTTP status so the retry policy and the 401→sign-in
 *  redirect can branch on it. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Prefer the API's {"error": "..."} body; fall back to the status line.
async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (body && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Non-JSON / empty body — fall through.
  }
  return res.statusText || `Request failed (${res.status})`;
}

async function authToken(): Promise<string> {
  const token = await getCurrentIdToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  return token;
}

/** GET an API endpoint, returning parsed JSON. */
export async function apiGet(path: string): Promise<unknown> {
  const token = await authToken();
  const res = await fetch(`${getBaseURL()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new ApiError(res.status, await safeErrorMessage(res));
  return res.json();
}

/** Send a mutating request (POST/DELETE) with an optional JSON body. Tolerates
 *  an empty response body (returns {}). */
export async function apiSend(method: 'POST' | 'DELETE' | 'PUT', path: string, body?: unknown): Promise<unknown> {
  const token = await authToken();
  const res = await fetch(`${getBaseURL()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await safeErrorMessage(res));
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

// Shared retry policy: never retry auth/authz/not-found (401/403/404), otherwise
// up to two attempts.
export const queryRetry = (failureCount: number, error: unknown): boolean =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;
