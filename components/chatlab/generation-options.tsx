'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ChatLabGenerationOptions, ChatLabModel, ChatLabOutputModality } from '@/schemas/chatLab';

// The media-generation options popover. When the selected model advertises
// normalized capabilities (generationCaps), every control is RESTRICTED to what
// that model actually supports — aspect ratios + resolutions become the model's
// sets, duration becomes a Select of the exact allowed values, and audio-capable
// video models gain an Audio toggle. When caps are absent (a text model that
// somehow got here, a discovery gap, or an older API), the controls fall back to
// the generic lists and a free-typed duration — exactly the pre-caps behavior.
//
// Everything defaults to "Auto" (the provider default) and is omitted from the
// request when left as Auto. The server validates strictly against the same caps
// as a backstop; the UI aims to make that backstop unreachable.

// Radix Select forbids an empty item value, so "Auto" travels as this sentinel
// and maps back to '' / undefined at the boundary.
const AUTO = 'auto';

// Generic fallbacks used ONLY when the model advertises no caps for that knob.
// The aspect fallback is the historical grouped set, flattened; it is fed
// through the same grouping logic as live caps so the visual language matches.
const FALLBACK_ASPECTS = ['16:9', '3:2', '4:3', '1:1', '9:16', '2:3', '3:4'];
const IMAGE_RESOLUTIONS = ['512', '1K', '2K', '4K'];
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];

// parseRatio turns "16:9" into [16, 9]; returns null for anything malformed
// (non-numeric, zero/negative), so novel-but-valid ratios pass and junk is
// skipped rather than crashing.
function parseRatio(ratio: string): [number, number] | null {
  const [w, h] = ratio.split(':').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return [w, h];
}

// groupAspectRatios buckets a flat ratio list into Landscape / Square / Portrait
// by orientation (w/h: >1 landscape, =1 square, <1 portrait) so novel ratios
// like 21:9, 4:5, 2:1 group correctly, and sorts widest→squarest within each
// group — matching the existing visual language. Empty groups are dropped.
function groupAspectRatios(ratios: string[]): { label: string; ratios: string[] }[] {
  const landscape: string[] = [];
  const square: string[] = [];
  const portrait: string[] = [];
  const seen = new Set<string>();
  for (const r of ratios) {
    if (seen.has(r)) continue;
    const parsed = parseRatio(r);
    if (!parsed) continue;
    seen.add(r);
    const [w, h] = parsed;
    if (w > h) landscape.push(r);
    else if (w === h) square.push(r);
    else portrait.push(r);
  }
  const value = (r: string) => {
    const [w, h] = parseRatio(r) as [number, number];
    return w / h;
  };
  // Landscape: widest (largest w/h) first, toward square. Portrait: tallest
  // (smallest w/h) first, toward square. Both read "most extreme → squarest".
  landscape.sort((a, b) => value(b) - value(a));
  portrait.sort((a, b) => value(a) - value(b));
  const groups: { label: string; ratios: string[] }[] = [];
  if (landscape.length) groups.push({ label: 'Landscape', ratios: landscape });
  if (square.length) groups.push({ label: 'Square', ratios: square });
  if (portrait.length) groups.push({ label: 'Portrait', ratios: portrait });
  return groups;
}

// A small box drawn to the EXACT aspect ratio it labels: the longer side fills
// a 16px square box, the shorter side scales proportionally — so 16:9 is a wide
// rectangle, 9:16 a tall one, 3:4 slightly tall, 1:1 a square. `currentColor`
// so it tracks the row's text color (incl. the selected/hover states).
function AspectRatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const box = 16;
  const width = w >= h ? box : Math.round((w / h) * box);
  const height = h >= w ? box : Math.round((h / w) * box);
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
      <span className="rounded-[2px] border border-current" style={{ width, height }} />
    </span>
  );
}

/**
 * sanitizeGenerationOptions resets any current selection the given model+modality
 * does not support back to Auto, returning a new options object. It is the pure
 * core of the composer's "switching models can't leave a stale, now-invalid
 * pick" behavior.
 *
 * Enforcement is caps-driven and per-knob: a knob is reset ONLY when the model
 * advertises a non-empty set for it AND the current value is not a member. When
 * caps are absent (or empty for that knob) nothing is reset — the model is
 * treated as supporting anything (loose posture), exactly like the server. The
 * video-only knobs (duration, audio) are additionally cleared whenever the
 * modality is not video, since they are meaningless for image generation.
 *
 * Pure and idempotent: calling it on an already-valid selection returns an
 * equivalent object (compare with generationOptionsEqual before writing, to
 * avoid redundant state updates / render loops).
 *
 * @param opts     the current generation options (may be undefined-ish fields)
 * @param model    the newly-selected model (null = none) — source of caps
 * @param modality the active output modality ('image' | 'video')
 * @returns a new ChatLabGenerationOptions with unsupported values reset to Auto
 */
export function sanitizeGenerationOptions(
  opts: ChatLabGenerationOptions,
  model: ChatLabModel | null,
  modality: Exclude<ChatLabOutputModality, 'text'>,
): ChatLabGenerationOptions {
  const caps = model?.generationCaps;
  const next: ChatLabGenerationOptions = { ...opts };

  if (next.aspectRatio && caps?.aspectRatios?.length && !caps.aspectRatios.includes(next.aspectRatio)) {
    next.aspectRatio = undefined;
  }
  if (next.resolution && caps?.resolutions?.length && !caps.resolutions.includes(next.resolution)) {
    next.resolution = undefined;
  }

  if (modality !== 'video') {
    // Duration + audio are video-only concepts.
    next.durationSeconds = undefined;
    next.generateAudio = undefined;
  } else {
    if (next.durationSeconds && caps?.durations?.length && !caps.durations.includes(next.durationSeconds)) {
      next.durationSeconds = undefined;
    }
    if (next.generateAudio !== undefined && !caps?.generateAudio) {
      next.generateAudio = undefined;
    }
  }
  return next;
}

/** Field-wise equality for the four generation knobs (used to skip no-op state
 *  writes after sanitization). */
export function generationOptionsEqual(a: ChatLabGenerationOptions, b: ChatLabGenerationOptions): boolean {
  return (
    (a.aspectRatio ?? undefined) === (b.aspectRatio ?? undefined) &&
    (a.resolution ?? undefined) === (b.resolution ?? undefined) &&
    (a.durationSeconds ?? undefined) === (b.durationSeconds ?? undefined) &&
    (a.generateAudio ?? undefined) === (b.generateAudio ?? undefined)
  );
}

interface GenerationOptionsProps {
  modality: Exclude<ChatLabOutputModality, 'text'>;
  model: ChatLabModel | null;
  value: ChatLabGenerationOptions;
  onChange: (options: ChatLabGenerationOptions) => void;
  disabled?: boolean;
}

export default function GenerationOptions({ modality, model, value, onChange, disabled }: GenerationOptionsProps) {
  const caps = model?.generationCaps;

  // Per-knob choice lists: the model's set when it advertises one, else the
  // generic fallback (so a caps gap degrades to the full list, never a blank).
  const aspectGroups = groupAspectRatios(caps?.aspectRatios?.length ? caps.aspectRatios : FALLBACK_ASPECTS);
  const resolutions = caps?.resolutions?.length
    ? caps.resolutions
    : modality === 'video'
      ? VIDEO_RESOLUTIONS
      : IMAGE_RESOLUTIONS;
  const durations = caps?.durations ?? [];
  const showDurationSelect = modality === 'video' && durations.length > 0;
  const showDurationInput = modality === 'video' && !showDurationSelect;
  const showAudio = modality === 'video' && !!caps?.generateAudio;

  // A compact badge count of how many overrides are active (so the trigger hints
  // at non-default settings without opening the popover).
  const activeCount =
    (value.aspectRatio ? 1 : 0) +
    (value.resolution ? 1 : 0) +
    (modality === 'video' && value.durationSeconds ? 1 : 0) +
    (showAudio && value.generateAudio !== undefined ? 1 : 0);

  const audioValue = value.generateAudio === undefined ? AUTO : value.generateAudio ? 'on' : 'off';

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Generation options"
      >
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        Options
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Aspect ratio</label>
          <Select
            value={value.aspectRatio || AUTO}
            onValueChange={(v) => onChange({ ...value, aspectRatio: v === AUTO ? '' : v })}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto</SelectItem>
              {aspectGroups.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.ratios.map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="flex items-center gap-2">
                        <AspectRatioIcon ratio={r} />
                        {r}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Resolution</label>
          <Select
            value={value.resolution || AUTO}
            onValueChange={(v) => onChange({ ...value, resolution: v === AUTO ? '' : v })}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto</SelectItem>
              {resolutions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showDurationSelect && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Duration</label>
            <Select
              value={value.durationSeconds ? String(value.durationSeconds) : AUTO}
              onValueChange={(v) =>
                onChange({ ...value, durationSeconds: v === AUTO ? undefined : parseInt(v, 10) })
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto</SelectItem>
                {durations.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showDurationInput && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="gen-duration">
              Duration (seconds)
            </label>
            <input
              id="gen-duration"
              type="number"
              min={0}
              max={60}
              inputMode="numeric"
              placeholder="Auto"
              value={value.durationSeconds ? String(value.durationSeconds) : ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                onChange({ ...value, durationSeconds: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
            />
          </div>
        )}

        {showAudio && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Audio</label>
            <Select
              value={audioValue}
              onValueChange={(v) =>
                onChange({ ...value, generateAudio: v === AUTO ? undefined : v === 'on' })
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto</SelectItem>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
