'use client';

import { useState } from 'react';
import { Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChatLabFeedbackCategories, useMessageFeedback } from '@/lib/chatlab/useChatLab';
import { relativeTime } from '@/lib/relativeTime';
import { displayNameFromEmail } from './display';
import type { ChatLabFeedbackRating, ChatLabMessageFeedback } from '@/schemas/chatLab';

// 👍/👎 on an assistant message: ghost icon buttons next to the copy button;
// clicking opens a popover with the rating's standard category chips (server-
// defined), an "Other…" free-text toggle, Submit and (when editing) Remove.
// Both users' feedback is visible — hovering a filled thumb summarizes who
// said what. In project chats a save/remove also refreshes the project memory
// server-side (the steering mechanism).

interface MessageFeedbackProps {
  sessionId: string;
  messageId: string;
  feedback: ChatLabMessageFeedback[] | null;
}

function feedbackSummary(f: ChatLabMessageFeedback): string {
  const parts = [
    `${f.rating === 'up' ? '👍' : '👎'} ${displayNameFromEmail(f.raterEmail)}`,
    f.categories.join(', '),
    f.comment ? `"${f.comment}"` : '',
    relativeTime(f.updatedAt),
  ].filter(Boolean);
  return parts.join(' · ');
}

export default function MessageFeedback({ sessionId, messageId, feedback }: MessageFeedbackProps) {
  const { data: categories } = useChatLabFeedbackCategories();
  const { put, remove } = useMessageFeedback(sessionId);

  const mine = feedback?.find((f) => f.isMine) ?? null;
  const others = (feedback ?? []).filter((f) => !f.isMine);

  const [open, setOpen] = useState<ChatLabFeedbackRating | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [comment, setComment] = useState('');

  const openFor = (rating: ChatLabFeedbackRating) => {
    // Seed from the existing rating when editing the same thumb.
    if (mine && mine.rating === rating) {
      setSelected(mine.categories);
      setComment(mine.comment);
      setOtherOpen(mine.comment !== '');
    } else {
      setSelected([]);
      setComment('');
      setOtherOpen(false);
    }
    setOpen(rating);
  };

  const submit = async () => {
    if (!open) return;
    try {
      await put.mutateAsync({
        messageId,
        body: { rating: open, categories: selected, comment: comment.trim() || undefined },
      });
      setOpen(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save feedback');
    }
  };

  const removeMine = async () => {
    try {
      await remove.mutateAsync(messageId);
      setOpen(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove feedback');
    }
  };

  const options = open ? (categories?.[open] ?? []) : [];
  const summaryTitle = [mine, ...others]
    .filter((f): f is ChatLabMessageFeedback => !!f)
    .map(feedbackSummary)
    .join('\n');

  const thumb = (rating: ChatLabFeedbackRating) => {
    const Icon = rating === 'up' ? ThumbsUp : ThumbsDown;
    const filledByMe = mine?.rating === rating;
    const filledByOther = others.some((f) => f.rating === rating);
    return (
      <Popover open={open === rating} onOpenChange={(o) => (o ? openFor(rating) : setOpen(null))}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={rating === 'up' ? 'Rate response up' : 'Rate response down'}
            title={summaryTitle || undefined}
            className={cn(
              'flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground',
              filledByMe
                ? rating === 'up'
                  ? 'text-primary'
                  : 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            <Icon className={cn('size-3.5', filledByMe && 'fill-current')} />
            {filledByOther && <span className="text-[10px]">·</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <p className="mb-2 text-xs font-medium">
            {rating === 'up' ? 'What was good?' : 'What went wrong?'}{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {options.map((opt) => {
              const active = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => (active ? prev.filter((id) => id !== opt.id) : [...prev, opt.id]))
                  }
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setOtherOpen((v) => !v)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                otherOpen
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              Other…
            </button>
          </div>
          {otherOpen && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2048}
              placeholder="What should future responses do differently?"
              className="mb-2 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
          )}
          <div className="flex items-center justify-between">
            {mine ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => void removeMine()} disabled={remove.isPending}>
                {remove.isPending && <Loader2 className="size-3 animate-spin" />}
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" className="h-7 text-xs" onClick={() => void submit()} disabled={put.isPending}>
              {put.isPending && <Loader2 className="size-3 animate-spin" />}
              Submit
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <span className="inline-flex items-center gap-0.5">
      {thumb('up')}
      {thumb('down')}
    </span>
  );
}
