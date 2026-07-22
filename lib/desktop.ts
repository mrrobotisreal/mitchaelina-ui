'use client';

// Typed accessor for the Electron desktop bridge (window.mitchaelinaDesktop,
// injected by ui/desktop/preload.js). On the web this global is absent and
// every helper here degrades to "not desktop" — the local file-access feature
// stays completely dormant.
//
// NEVER import this from a server component: it touches `window`.

import { useEffect, useState } from 'react';

/** Fuzzy file-search result from the main-process index. */
export interface DesktopSearchResult {
  path: string;
  isDir: boolean;
  score: number;
}

/** A mention read (or a one-level directory listing rendered as text). */
export interface DesktopMentionRead {
  content: string;
  truncated: boolean;
}

/** Policy decision for a tool call (mirrors local/policy.js). */
export interface DesktopToolEvaluation {
  decision: 'auto' | 'approve' | 'deny';
  summary: string;
}

/** Result of executing a tool in main (mirrors the executors' return shape). */
export interface DesktopToolResult {
  ok: boolean;
  resultText: string;
  detail?: string;
  diff?: string;
}

/** The bridge surface exposed by preload.js. */
export interface MitchaelinaDesktop {
  platform: string;
  version(): Promise<string>;
  listRoots(): Promise<string[]>;
  addRoot(): Promise<string[]>;
  removeRoot(path: string): Promise<string[]>;
  searchFiles(query: string, limit?: number): Promise<DesktopSearchResult[]>;
  readMention(path: string): Promise<DesktopMentionRead | { ok: false; error: string }>;
  evaluateTool(name: string, argsJson: string): Promise<DesktopToolEvaluation | { ok: false; error: string }>;
  executeTool(name: string, argsJson: string, opts: { approved: boolean }): Promise<DesktopToolResult>;
  setSessionAutoApprove(kind: 'writes' | 'commands', on: boolean): Promise<{ writes: boolean; commands: boolean }>;
}

declare global {
  interface Window {
    mitchaelinaDesktop?: MitchaelinaDesktop;
  }
}

/** The bridge, or null when not running inside the desktop shell. */
export function getDesktop(): MitchaelinaDesktop | null {
  if (typeof window === 'undefined') return null;
  return window.mitchaelinaDesktop ?? null;
}

/** True when running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return getDesktop() !== null;
}

// A mention read succeeded when it carries `content` (the error shape has none).
export function isMentionRead(v: DesktopMentionRead | { ok: false; error: string }): v is DesktopMentionRead {
  return typeof (v as DesktopMentionRead)?.content === 'string';
}

// An evaluation succeeded when it carries a `decision`.
export function isToolEvaluation(
  v: DesktopToolEvaluation | { ok: false; error: string },
): v is DesktopToolEvaluation {
  return typeof (v as DesktopToolEvaluation)?.decision === 'string';
}

/**
 * React hook: the bridge (or null), resolved after mount so SSR markup stays
 * stable (the server always renders the web/null variant, and the client
 * upgrades on hydration). Use this in client components to gate desktop-only UI.
 */
export function useDesktop(): MitchaelinaDesktop | null {
  const [bridge, setBridge] = useState<MitchaelinaDesktop | null>(null);
  useEffect(() => {
    setBridge(getDesktop());
  }, []);
  return bridge;
}
