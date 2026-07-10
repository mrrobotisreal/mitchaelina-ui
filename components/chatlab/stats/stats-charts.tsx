'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { formatUsd, formatTokens } from './stats-table';
import { formatDurationMs } from '@/lib/formatDuration';
import type { ChatLabStatsBreakdownRow, ChatLabStatsTimeseriesPoint } from '@/schemas/chatLab';

// The three stats charts (recharts, dark-theme palette): spend over time
// stacked by model (top-8 + "other" from the API), total tokens over time, and
// spend by model. All bucket boundaries are UTC.

const PALETTE = ['#8b5cf6', '#22d3ee', '#f59e0b', '#34d399', '#f472b6', '#60a5fa', '#f87171', '#a3e635', '#94a3b8'];

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
} as const;

function bucketLabel(iso: string): string {
  return iso.slice(5, 10); // MM-DD (UTC)
}

/** Pivot (bucket, key) points into recharts rows {bucket, [key]: cost}. */
function pivotByKey(points: ChatLabStatsTimeseriesPoint[]): { rows: Record<string, string | number>[]; keys: string[] } {
  const keys: string[] = [];
  const seen = new Set<string>();
  const byBucket = new Map<string, Record<string, string | number>>();
  for (const p of points) {
    const key = p.key || 'total';
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    let row = byBucket.get(p.bucket);
    if (!row) {
      row = { bucket: bucketLabel(p.bucket) };
      byBucket.set(p.bucket, row);
    }
    row[key] = Number((((row[key] as number) ?? 0) + p.costUsd).toFixed(6));
  }
  // "other" always renders last (bottom of the legend, top of the stack).
  keys.sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : 0));
  return { rows: [...byBucket.values()], keys };
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="h-64 w-full">{children}</div>
    </Card>
  );
}

function EmptyChart() {
  return <p className="flex h-full items-center justify-center text-sm italic text-muted-foreground">No data in range.</p>;
}

export function SpendOverTimeChart({ points }: { points: ChatLabStatsTimeseriesPoint[] }) {
  const { rows, keys } = useMemo(() => pivotByKey(points), [points]);
  return (
    <ChartCard title="Spend over time (by model, USD)">
      {rows.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="bucket" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v: number) => formatUsd(v)} width={70} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatUsd(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keys.map((key, i) => (
              <Bar key={key} dataKey={key} stackId="spend" fill={PALETTE[i % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function TokensOverTimeChart({ points }: { points: ChatLabStatsTimeseriesPoint[] }) {
  const rows = useMemo(
    () => points.map((p) => ({ bucket: bucketLabel(p.bucket), tokens: p.totalTokens })),
    [points],
  );
  return (
    <ChartCard title="Tokens over time (total)">
      {rows.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="bucket" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v: number) => formatTokens(v)} width={60} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatTokens(Number(v))} />
            <Line type="monotone" dataKey="tokens" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/** Response time over time (avg + p95, chat turns with metrics only). Buckets
 *  without measured chat events carry null latency and leave a gap. */
export function ResponseTimeChart({ points }: { points: ChatLabStatsTimeseriesPoint[] }) {
  const rows = useMemo(
    () =>
      points.map((p) => ({
        bucket: bucketLabel(p.bucket),
        avg: p.avgDurationMs ?? null,
        p95: p.p95DurationMs ?? null,
      })),
    [points],
  );
  const hasData = rows.some((r) => r.avg != null || r.p95 != null);
  return (
    <ChartCard title="Response time over time (avg / p95)">
      {!hasData ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="bucket" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v: number) => formatDurationMs(v)} width={70} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatDurationMs(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="avg" name="avg" stroke={PALETTE[0]} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="p95" name="p95" stroke={PALETTE[2]} strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function SpendByModelChart({ rows }: { rows: ChatLabStatsBreakdownRow[] }) {
  const data = useMemo(
    () => rows.slice(0, 10).map((r) => ({ model: r.label, cost: Number(r.costUsd.toFixed(6)) })),
    [rows],
  );
  return (
    <ChartCard title="Spend by model (USD)">
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => formatUsd(v)} />
            <YAxis type="category" dataKey="model" {...AXIS} width={190} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatUsd(Number(v))} />
            <Bar dataKey="cost" fill={PALETTE[1]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
