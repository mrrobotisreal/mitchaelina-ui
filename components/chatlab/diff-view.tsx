'use client';

import { cn } from '@/lib/utils';

// Renders a unified diff (as produced by the desktop `diff.createTwoFilesPatch`)
// with green/red line backgrounds. No dependencies — the diff is parsed by line
// prefix. Horizontally scrollable so long lines never break the page layout.
//
// Line classes:
//   '@@ …'        → hunk header (muted)
//   'diff/index/--- /+++ '  → file header lines (muted, quiet)
//   '+…'          → addition (green)
//   '-…'          → deletion (red)
//   ' …' / other  → context (default)

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'bg-muted/60 text-muted-foreground';
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ')
  ) {
    return 'text-muted-foreground/70';
  }
  if (line.startsWith('+')) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (line.startsWith('-')) return 'bg-red-500/15 text-red-700 dark:text-red-300';
  return 'text-foreground/80';
}

export default function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, '').split('\n');
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-muted/20">
      <pre className="min-w-full text-[11px] leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className={cn('whitespace-pre px-2 font-mono', lineClass(line))}>
            {line === '' ? ' ' : line}
          </div>
        ))}
      </pre>
    </div>
  );
}
