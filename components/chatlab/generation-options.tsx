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
import type { ChatLabGenerationOptions, ChatLabOutputModality } from '@/schemas/chatLab';

// The media-generation options popover: aspect ratio + resolution (both
// modalities) and duration (video only). Everything defaults to "Auto" (the
// provider default) and is omitted from the request when left as Auto — the
// server loosely validates and lets the provider 400 on model-specific
// mismatches. Shown only when the composer's output modality is image/video.

// Radix Select forbids an empty item value, so "Auto" travels as this sentinel
// and maps back to '' at the boundary.
const AUTO = 'auto';

// Aspect ratios grouped by orientation so portrait/landscape are easy to find
// (e.g. Sora's portrait vs landscape). Widest→squarest within each section.
const ASPECT_GROUPS: { label: string; ratios: string[] }[] = [
  { label: 'Landscape', ratios: ['16:9', '3:2', '4:3'] },
  { label: 'Square', ratios: ['1:1'] },
  { label: 'Portrait', ratios: ['9:16', '2:3', '3:4'] },
];

const IMAGE_RESOLUTIONS = ['512', '1K', '2K', '4K'];
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];

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

interface GenerationOptionsProps {
  modality: Exclude<ChatLabOutputModality, 'text'>;
  value: ChatLabGenerationOptions;
  onChange: (options: ChatLabGenerationOptions) => void;
  disabled?: boolean;
}

export default function GenerationOptions({ modality, value, onChange, disabled }: GenerationOptionsProps) {
  const resolutions = modality === 'video' ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;

  // A compact badge count of how many overrides are active (so the trigger hints
  // at non-default settings without opening the popover).
  const activeCount =
    (value.aspectRatio ? 1 : 0) +
    (value.resolution ? 1 : 0) +
    (modality === 'video' && value.durationSeconds ? 1 : 0);

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
              {ASPECT_GROUPS.map((g) => (
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

        {modality === 'video' && (
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
      </PopoverContent>
    </Popover>
  );
}
