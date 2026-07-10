'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// One reusable column-config table for the per-model/project/user/chat/kind
// breakdowns. Numbers right-align; the whole table scrolls horizontally inside
// its own container on narrow screens.

export interface StatsColumn<T> {
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

export default function StatsTable<T>({
  rows,
  columns,
  keyFor,
  emptyText,
}: {
  rows: T[];
  columns: StatsColumn<T>[];
  keyFor: (row: T) => string;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm italic text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn(
                  'border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  col.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyFor(row)} className="hover:bg-accent/30">
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={cn(
                    'border-b border-border/50 px-3 py-1.5 align-top',
                    col.align === 'right' && 'text-right tabular-nums',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatUsd(v: number): string {
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  return String(v);
}
