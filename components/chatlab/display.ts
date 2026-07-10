// Display helpers shared across the chat-lab UI. Names are derived client-side
// from the email local-part (e.g. "mitch@…" → "mitch") — the app stores no
// display names.

export function displayNameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? '').trim();
  return local || email;
}

// Human-readable byte size (e.g. "3.2 MB", "812 KB").
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
