// Relative timestamp formatting. Pure and unit-testable (`now` is
// injectable). Two subtleties:
//   1. Round by MAGNITUDE, then reapply sign. JS Math.round(-1.5) === -1 (rounds
//      toward +∞), so a 90s-old comment via Math.round(diffSec/60) would read
//      "1 minute ago". Rounding abs first gives the expected "2 minutes ago".
//   2. Clamp minor future skew: a timestamp up to ~30s ahead (residual clock
//      skew) shows "just now" instead of "in N seconds". Larger future values
//      are left alone so a genuinely wrong clock stays visible.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((then - now) / 1000); // >0 future, <0 past
  if (diffSec > 0 && diffSec <= 30) return 'just now';
  const abs = Math.abs(diffSec);
  const sign = diffSec < 0 ? -1 : 1;
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  if (abs < 2592000) return rtf.format(sign * Math.round(abs / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' } as Intl.DateTimeFormatOptions);
}
