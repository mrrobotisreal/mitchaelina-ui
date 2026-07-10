'use client';

import { useMemo, useState } from 'react';
import { Brain, Check, ChevronsUpDown, ImageIcon, Search, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ChatLabModel } from '@/schemas/chatLab';

// Per-message model picker: a searchable Popover list grouped by provider.
// Each row shows name, context length, capability icons (image input,
// reasoning) and per-MTok pricing. The catalog arrives pre-sorted (Anthropic →
// OpenAI → others; newest first within a provider) — grouping preserves that.

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
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
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

  const selected = models.find((m) => m.id === value) ?? null;

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q
      ? models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      : models;
    const byProvider = new Map<string, ChatLabModel[]>();
    for (const m of visible) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()];
  }, [models, filter]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFilter('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent/50',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          aria-label="Choose a model"
        >
          <span className="min-w-0 truncate">{selected ? selected.name : 'Choose a model'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search models…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
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
        <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          Pricing is per million tokens (input / output).
        </p>
      </PopoverContent>
    </Popover>
  );
}
