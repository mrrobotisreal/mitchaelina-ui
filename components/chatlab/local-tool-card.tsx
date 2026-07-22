'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FilePen,
  FileText,
  FolderOpen,
  Loader2,
  Search,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import DiffView from './diff-view';

// Names of the desktop local tools (mirrors the server's local suite / the
// desktop policy). Used to route a persisted toolActivity entry to this card
// instead of the read_asset chip.
export const LOCAL_TOOL_NAMES = new Set([
  'search_files',
  'list_directory',
  'read_file',
  'grep_files',
  'edit_file',
  'write_file',
  'run_command',
]);

export function isLocalToolName(name: string): boolean {
  return LOCAL_TOOL_NAMES.has(name);
}

/** Normalized card data — satisfied by both a live call and a persisted
 *  toolActivity row. */
export interface LocalToolCardData {
  name: string;
  path?: string;
  command?: string;
  status: 'pending' | 'awaiting-approval' | 'running' | 'ok' | 'error';
  summary?: string;
  detail?: string;
  diff?: string;
  /** Raw JSON arguments — only present for live calls (drives the approval
   *  preview). */
  args?: string;
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const cls = cn('size-3.5', className);
  switch (name) {
    case 'list_directory':
      return <FolderOpen className={cls} />;
    case 'read_file':
      return <FileText className={cls} />;
    case 'search_files':
    case 'grep_files':
      return <Search className={cls} />;
    case 'run_command':
      return <Terminal className={cls} />;
    case 'edit_file':
    case 'write_file':
      return <FilePen className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

function StatusIcon({ status }: { status: LocalToolCardData['status'] }) {
  if (status === 'ok') return <Check className="size-3 text-emerald-600 dark:text-emerald-400" />;
  if (status === 'error') return <AlertTriangle className="size-3 text-destructive" />;
  return <Loader2 className="size-3 animate-spin text-muted-foreground" />;
}

// The proposed-change preview shown BEFORE a mutation runs (no diff exists yet):
// for edit_file the old→new strings, for write_file the content size, for
// run_command the command.
function ApprovalPreview({ name, args }: { name: string; args?: string }) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = args ? (JSON.parse(args) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  if (name === 'edit_file') {
    const oldStr = String(parsed.old_str ?? '');
    const newStr = String(parsed.new_str ?? '');
    return (
      <div className="mt-2 space-y-1 overflow-x-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px]">
        {oldStr.split('\n').map((l, i) => (
          <div key={`o-${i}`} className="whitespace-pre bg-red-500/15 text-red-700 dark:text-red-300">
            - {l}
          </div>
        ))}
        {newStr.split('\n').map((l, i) => (
          <div key={`n-${i}`} className="whitespace-pre bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            + {l}
          </div>
        ))}
      </div>
    );
  }
  if (name === 'write_file') {
    const content = String(parsed.content ?? '');
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        Will write {content.length.toLocaleString()} characters to this file.
      </p>
    );
  }
  if (name === 'run_command') {
    return (
      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px]">
        {String(parsed.command ?? '')}
      </pre>
    );
  }
  return null;
}

interface LocalToolCardProps {
  data: LocalToolCardData;
  onApprove?: (opts?: { always?: boolean }) => void;
  onDeny?: () => void;
}

// deriveTarget is the monospace label: an explicit command/path (persisted
// rows), else parsed from the raw args (live calls), else the summary/name.
function deriveTarget(data: LocalToolCardData): string {
  if (data.command) return data.command;
  if (data.path) return data.path;
  try {
    const a = JSON.parse(data.args ?? '{}') as Record<string, unknown>;
    const v = a.command ?? a.path ?? a.query ?? a.pattern;
    if (typeof v === 'string' && v) return v;
  } catch {
    // fall through
  }
  return data.summary || data.name;
}

export default function LocalToolCard({ data, onApprove, onDeny }: LocalToolCardProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  const target = deriveTarget(data);
  const awaiting = data.status === 'awaiting-approval';
  const isCommand = data.name === 'run_command';

  return (
    <div
      className={cn(
        'mb-1.5 rounded-lg border p-2.5 text-xs',
        data.status === 'error'
          ? 'border-destructive/40 bg-destructive/5'
          : awaiting
            ? 'border-amber-500/50 bg-amber-500/5'
            : 'border-border bg-muted/20',
      )}
    >
      <div className="flex items-center gap-2">
        <ToolIcon name={data.name} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={target}>
          {target}
        </span>
        {data.detail && <span className="shrink-0 text-[10px] text-muted-foreground">{data.detail}</span>}
        <StatusIcon status={data.status} />
      </div>

      {awaiting && (
        <div className="mt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {isCommand ? 'Run this command?' : 'Apply this change?'}
          </p>
          <ApprovalPreview name={data.name} args={data.args} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onApprove?.()}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onApprove?.({ always: true })}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              Always allow (this chat)
            </button>
            <button
              type="button"
              onClick={() => onDeny?.()}
              className="rounded-md border border-destructive/50 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {data.diff && (
        <Collapsible open={diffOpen} onOpenChange={setDiffOpen} className="mt-2">
          <CollapsibleTrigger className="group flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
            {diffOpen ? 'Hide diff' : 'Show diff'}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5">
            <DiffView diff={data.diff} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
