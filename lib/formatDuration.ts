// Humanize a millisecond duration for the chat-lab performance displays:
//   <1s   → "0.8s"
//   <60s  → "12s"
//   <1h   → "3m 14s"
//   ≥1h   → "1h 02m"
// Tiny and pure — shared by the message footer, the live streaming ticker,
// and the Usage & Stats performance tables.
export function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}
