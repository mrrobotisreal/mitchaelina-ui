'use client';

import { useState } from 'react';
import { Info, Loader2, Pencil, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { relativeTime } from '@/lib/relativeTime';
import { useChatLabCredits, useChatLabCreditMutations } from '@/lib/chatlab/useChatLab';
import { displayNameFromEmail } from '../display';
import { formatUsd } from './stats-table';
import type { ChatLabCreditEntry, ChatLabStatsSummary } from '@/schemas/chatLab';

// The balance card + "Manage credits" ledger dialog. Balance semantics (also
// in the info tooltip): credited = entries with effective date <= now; spend
// counts usage since the FIRST entry's effective date; a backdated top-up
// retroactively shifts the balance; unknown-cost events under-count spend so
// the number renders with "≈" and a footnote.

const LOW_BALANCE_THRESHOLD_USD = 10;

interface EntryFormState {
  entryType: 'deposit' | 'adjustment';
  amount: string;
  date: string; // yyyy-mm-dd (interpreted as UTC midnight)
  note: string;
}

const EMPTY_FORM: EntryFormState = { entryType: 'deposit', amount: '', date: '', note: '' };

export default function BalanceCard({ summary }: { summary: ChatLabStatsSummary }) {
  const [manageOpen, setManageOpen] = useState(false);
  const { balance, totals } = summary;
  const approx = totals.unknownCostEvents > 0 || totals.estimatedCostEvents > 0;

  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Wallet className="size-3.5" />
            Credit balance
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  Balance = credits with an effective date in the past, minus usage since the first entry&apos;s
                  effective date. Backdated entries shift the balance retroactively. Usage before the first deposit is
                  excluded from the balance (but still shown in all stats). Times in UTC.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </p>
          {balance.hasLedger ? (
            <>
              <p
                className={cn(
                  'mt-1 text-3xl font-semibold tabular-nums',
                  balance.currentUsd < LOW_BALANCE_THRESHOLD_USD && 'text-destructive',
                )}
              >
                {approx && <span title="Some events have unknown or estimated costs">≈</span>}
                {formatUsd(balance.currentUsd)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatUsd(balance.totalCreditedUsd)} credited · {formatUsd(balance.totalSpentUsd)} spent
                {balance.trackingSince && <> · tracking since {new Date(balance.trackingSince).toISOString().slice(0, 10)} (UTC)</>}
              </p>
              {approx && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  ≈ {totals.unknownCostEvents} event(s) with unknown cost, {totals.estimatedCostEvents} estimated from
                  catalog pricing.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No credits tracked yet — set a starting balance to see what&apos;s left.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
          {balance.hasLedger ? 'Manage credits' : 'Set a starting balance'}
        </Button>
      </div>

      <CreditsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </Card>
  );
}

function CreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const creditsQuery = useChatLabCredits();
  const { create, update, remove } = useChatLabCreditMutations();
  const [form, setForm] = useState<EntryFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const entries = creditsQuery.data?.entries ?? [];
  const saving = create.isPending || update.isPending;

  const startEdit = (e: ChatLabCreditEntry) => {
    setEditingId(e.id);
    setForm({
      entryType: e.entryType,
      amount: String(e.amountUsd),
      date: e.effectiveAt.slice(0, 10),
      note: e.note,
    });
  };

  const submit = async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Enter a non-zero amount');
      return;
    }
    if (!form.date) {
      toast.error('Pick an effective date');
      return;
    }
    const body = {
      entryType: form.entryType,
      amountUsd: amount,
      effectiveAt: `${form.date}T00:00:00Z`, // UTC midnight
      note: form.note.trim() || undefined,
    };
    try {
      if (editingId) {
        await update.mutateAsync({ entryId: editingId, body });
      } else {
        await create.mutateAsync(body);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save entry');
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Credit ledger</DialogTitle>
          <DialogDescription>
            Deposits are OpenRouter top-ups; use an adjustment (±) to reconcile drift against the OpenRouter dashboard
            (their fees and rounding). Dates are UTC.
          </DialogDescription>
        </DialogHeader>

        {/* Entries table */}
        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          {entries.length === 0 ? (
            <p className="p-4 text-sm italic text-muted-foreground">No entries yet — add your starting balance below.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {['Type', 'Amount', 'Effective', 'Note', 'By', ''].map((hdr) => (
                    <th key={hdr} className="border-b border-border px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {hdr}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-accent/30">
                    <td className="border-b border-border/50 px-2 py-1.5 capitalize">{e.entryType}</td>
                    <td className={cn('border-b border-border/50 px-2 py-1.5 tabular-nums', e.amountUsd < 0 && 'text-destructive')}>
                      {formatUsd(e.amountUsd)}
                    </td>
                    <td className="border-b border-border/50 px-2 py-1.5 tabular-nums" title={relativeTime(e.effectiveAt)}>
                      {e.effectiveAt.slice(0, 10)}
                    </td>
                    <td className="max-w-40 truncate border-b border-border/50 px-2 py-1.5" title={e.note}>
                      {e.note}
                    </td>
                    <td className="border-b border-border/50 px-2 py-1.5">{displayNameFromEmail(e.createdByEmail)}</td>
                    <td className="border-b border-border/50 px-2 py-1.5">
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          aria-label="Edit entry"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteEntry(e.id)}
                          aria-label="Delete entry"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add / edit form */}
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {editingId ? 'Edit entry' : 'Add entry'}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="ce-type">
                Type
              </label>
              <Select
                value={form.entryType}
                onValueChange={(v) => setForm((f) => ({ ...f, entryType: v as 'deposit' | 'adjustment' }))}
              >
                <SelectTrigger id="ce-type" size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="ce-amount">
                Amount (USD{form.entryType === 'adjustment' ? ', ±' : ''})
              </label>
              <Input
                id="ce-amount"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="h-8 w-28"
                placeholder="25.00"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="ce-date">
                Effective date (UTC)
              </label>
              <Input
                id="ce-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="h-8 w-40"
              />
            </div>
            <div className="min-w-40 flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="ce-note">
                Note
              </label>
              <Input
                id="ce-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="h-8"
                placeholder="e.g. OpenRouter top-up"
              />
            </div>
            {editingId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={() => void submit()} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {editingId ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
