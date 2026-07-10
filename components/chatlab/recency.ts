// Recency grouping shared by the sidebar's general list and the project
// page's chat list.

export type RecencyGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

export const RECENCY_GROUP_ORDER: RecencyGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

export function recencyGroup(iso: string, now = new Date()): RecencyGroup {
  const then = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff <= 7) return 'Previous 7 days';
  return 'Older';
}

/** Group sessions (already newest-first) preserving order within each group. */
export function groupByRecency<T extends { updatedAt: string }>(items: T[]): Array<readonly [RecencyGroup, T[]]> {
  const map = new Map<RecencyGroup, T[]>();
  for (const item of items) {
    const g = recencyGroup(item.updatedAt);
    map.set(g, [...(map.get(g) ?? []), item]);
  }
  return RECENCY_GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g) as T[]] as const);
}
