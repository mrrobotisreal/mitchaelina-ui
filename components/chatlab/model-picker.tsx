'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  Brain,
  Check,
  ChevronsUpDown,
  Clock,
  ImageIcon,
  ImagePlus,
  Search,
  Video,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ChatLabModel } from '@/schemas/chatLab';

// Per-message model picker. Grew from a Popover into a Dialog once filters and
// sorting landed — the extra chrome needs the room. The list stays grouped by
// provider (the catalog arrives pre-sorted: Anthropic → OpenAI → others;
// newest first within a provider); filters narrow rows INSIDE their sections
// and sorting reorders INSIDE sections — the section structure never changes.
// Each row shows name, context length, capability icons (image input,
// image generation, video generation, reasoning, tools) and per-MTok pricing.

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatPerMTok(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`;
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'z-ai':
      return 'Z.AI';
    case 'moonshotai':
      return 'Moonshot AI';
    case 'x-ai': // OpenRouter's xAI provider slug is hyphenated
      return 'xAI';
    case 'black-forest-labs':
      return 'Black Forest Labs';
    case 'bytedance':
    case 'bytedance-seed':
      return 'ByteDance';
    case 'kwaivgi':
      return 'Kling';
    case 'sourceful':
      return 'Sourceful';
    case 'recraft':
      return 'Recraft';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

// ---- Filters & sorting -----------------------------------------------------

type TypeFilter = 'text' | 'imageGen' | 'videoGen';
type SortKey = 'newest' | 'alphabetical' | 'inputCost' | 'outputCost';

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'imageGen', label: 'Image gen' },
  { key: 'videoGen', label: 'Video gen' },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Release date' },
  { key: 'alphabetical', label: 'A–Z' },
  { key: 'inputCost', label: 'Input cost' },
  { key: 'outputCost', label: 'Output cost' },
];

function hasType(m: ChatLabModel, t: TypeFilter): boolean {
  if (t === 'text') return m.supportsText;
  if (t === 'imageGen') return m.supportsImageGen;
  return m.supportsVideoGen;
}

// A cost bound is active unless its field is blank or "*". Unparseable text is
// treated as no bound rather than filtering everything out.
function parseCostBound(raw: string): number | null {
  const v = raw.trim();
  if (v === '' || v === '*') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Sorts one provider section in place for the chosen key. 'newest' keeps the
// catalog's created-desc order; cost sorts are ascending (cheapest first).
function sortSection(list: ChatLabModel[], sort: SortKey): ChatLabModel[] {
  const sorted = [...list];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
      break;
    case 'alphabetical':
      sorted.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      break;
    case 'inputCost':
      sorted.sort((a, b) => a.pricing.promptUsdPerMTok - b.pricing.promptUsdPerMTok || a.id.localeCompare(b.id));
      break;
    case 'outputCost':
      sorted.sort(
        (a, b) => a.pricing.completionUsdPerMTok - b.pricing.completionUsdPerMTok || a.id.localeCompare(b.id),
      );
      break;
  }
  return sorted;
}

interface ModelPickerProps {
  models: ChatLabModel[];
  value: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  /** Image attachments are pending: gray out non-vision models (still
   *  selectable — the composer's disabled Send is the enforcement). */
  dimNonVision?: boolean;
}

export default function ModelPicker({ models, value, onChange, disabled, dimNonVision }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [types, setTypes] = useState<TypeFilter[]>([]);
  const [maxInput, setMaxInput] = useState('');
  const [maxOutput, setMaxOutput] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const selected = models.find((m) => m.id === value) ?? null;

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const inBound = parseCostBound(maxInput);
    const outBound = parseCostBound(maxOutput);
    const visible = models.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      // Every selected type must be supported (selecting none = no type filter).
      if (types.length > 0 && !types.every((t) => hasType(m, t))) return false;
      if (inBound !== null && m.pricing.promptUsdPerMTok > inBound) return false;
      if (outBound !== null && m.pricing.completionUsdPerMTok > outBound) return false;
      return true;
    });
    // Insertion order preserves the catalog's provider ordering; each section
    // is then sorted independently so sections never interleave.
    const byProvider = new Map<string, ChatLabModel[]>();
    for (const m of visible) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()].map(([provider, list]) => [provider, sortSection(list, sort)] as const);
  }, [models, filter, types, maxInput, maxOutput, sort]);

  const toggleType = (t: TypeFilter) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const reset = () => {
    setFilter('');
    setTypes([]);
    setMaxInput('');
    setMaxOutput('');
    setSort('newest');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent/50',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        aria-label="Choose a model"
      >
        <span className="min-w-0 truncate">{selected ? selected.name : 'Choose a model'}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base">Choose a model</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search models…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by capability">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleType(t.key)}
                aria-pressed={types.includes(t.key)}
                className={cn(
                  'rounded-full border border-border px-2.5 py-0.5 text-xs transition-colors',
                  types.includes(t.key)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Max $/MTok</span>
            <input
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              placeholder="in: *"
              inputMode="decimal"
              aria-label="Max input cost ($/MTok); blank or * ignores input cost"
              className="h-6 w-14 rounded border border-border bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
            <input
              value={maxOutput}
              onChange={(e) => setMaxOutput(e.target.value)}
              placeholder="out: *"
              inputMode="decimal"
              aria-label="Max output cost ($/MTok); blank or * ignores output cost"
              className="h-6 w-14 rounded border border-border bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {sort === 'alphabetical' ? <ArrowDownAZ className="size-3.5" /> : <Clock className="size-3.5" />}
            <label className="sr-only" htmlFor="model-sort">
              Sort within sections
            </label>
            <select
              id="model-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus:border-ring"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Grouped list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {groups.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No models match.</p>}
          {groups.map(([provider, list]) => (
            <div key={provider}>
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {providerLabel(provider)}
              </div>
              {list.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                    reset();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60',
                    m.id === value && 'bg-accent',
                    dimNonVision && !m.supportsImages && 'opacity-40',
                  )}
                  title={dimNonVision && !m.supportsImages ? `${m.name} can't see images` : undefined}
                >
                  <Check className={cn('size-3.5 shrink-0', m.id === value ? 'text-primary' : 'invisible')} />
                  <span className="min-w-0 flex-1 truncate" title={m.id}>
                    {m.name}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatContext(m.contextLength)}
                  </span>
                  {m.supportsImages && (
                    <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Supports image input" />
                  )}
                  {m.supportsImageGen && (
                    <ImagePlus className="size-3.5 shrink-0 text-muted-foreground" aria-label="Generates images" />
                  )}
                  {m.supportsVideoGen && (
                    <Video className="size-3.5 shrink-0 text-muted-foreground" aria-label="Generates video" />
                  )}
                  {m.supportsReasoning && (
                    <Brain className="size-3.5 shrink-0 text-muted-foreground" aria-label="Supports reasoning" />
                  )}
                  {m.supportsTools && (
                    <Wrench
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Can read project assets on demand"
                    >
                      <title>Can read project assets on demand</title>
                    </Wrench>
                  )}
                  <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {formatPerMTok(m.pricing.promptUsdPerMTok)} / {formatPerMTok(m.pricing.completionUsdPerMTok)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className="border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          Pricing is per million tokens (input / output); generation models billed per output show $0 here. Icons:
          image input · image gen · video gen · reasoning · tools.
        </p>
      </DialogContent>
    </Dialog>
  );
}
