'use client';

import { Brain } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ChatLabEffortOrOff, ChatLabModel } from '@/schemas/chatLab';

// Per-message reasoning-effort picker: Off + the model's supportedEfforts.
// Disabled (with a tooltip) for models without reasoning support; the parent
// auto-resets the value to Off when switching to such a model.

// Radix Select forbids an empty item value, so Off travels as this sentinel in
// the widget and is mapped back to '' (the wire value) at the boundary.
const OFF = 'off';

const EFFORT_LABEL: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
};

interface ReasoningPickerProps {
  model: ChatLabModel | null;
  value: ChatLabEffortOrOff;
  onChange: (effort: ChatLabEffortOrOff) => void;
  disabled?: boolean;
}

export default function ReasoningPicker({ model, value, onChange, disabled }: ReasoningPickerProps) {
  const supported = model?.supportsReasoning ?? false;
  const efforts = model?.supportedEfforts ?? [];

  const select = (
    <Select
      value={value === '' ? OFF : value}
      onValueChange={(v) => onChange(v === OFF ? '' : (v as ChatLabEffortOrOff))}
      disabled={disabled || !supported}
    >
      <SelectTrigger size="sm" className="h-8 gap-1 text-xs" aria-label="Reasoning effort">
        <Brain className="size-3.5 text-muted-foreground" />
        <SelectValue placeholder="Reasoning" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={OFF}>Off</SelectItem>
        {efforts.map((e) => (
          <SelectItem key={e} value={e}>
            {EFFORT_LABEL[e] ?? e}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (supported) return select;

  return (
    <TooltipProvider>
      <Tooltip>
        {/* span wrapper: Radix tooltips don't fire on disabled elements. */}
        <TooltipTrigger asChild>
          <span tabIndex={0}>{select}</span>
        </TooltipTrigger>
        <TooltipContent>This model doesn&apos;t support adjustable reasoning</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
