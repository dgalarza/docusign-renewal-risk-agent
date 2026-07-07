'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type LedgerEntry = {
  id: number;
  time: string;
  kind: string;
  label: string;
  detail: string | null;
};

export type LedgerPhase = 'idle' | 'recording' | 'complete' | 'failed';

type LedgerGroupId =
  | 'workflow'
  | 'intake'
  | 'risk-review'
  | 'run-close'
  | 'human-review';

type LedgerGroup = {
  id: LedgerGroupId;
  title: string;
  kinds: string[];
};

const LEDGER_GROUPS: LedgerGroup[] = [
  {
    id: 'workflow',
    title: 'Workflow',
    kinds: ['run-open', 'dispatch'],
  },
  {
    id: 'intake',
    title: 'Intake Agent',
    kinds: ['intake', 'tool-call', 'tool-result', 'normalize'],
  },
  {
    id: 'risk-review',
    title: 'Risk Review Agent',
    kinds: ['risk-review', 'policy-tool-call', 'policy-tool-result'],
  },
  {
    id: 'run-close',
    title: 'Run closed',
    kinds: ['run-close', 'error'],
  },
  {
    id: 'human-review',
    title: 'Human review',
    kinds: ['human-approval', 'workflow-builder'],
  },
];

const phaseLabels: Record<LedgerPhase, string> = {
  idle: 'Ready',
  recording: 'Recording',
  complete: 'Complete',
  failed: 'Failed',
};

export function RunLedger({
  phase,
  entries,
}: {
  phase: LedgerPhase;
  entries: LedgerEntry[];
}) {
  const [openGroups, setOpenGroups] = useState<Set<LedgerGroupId>>(
    () => new Set(['risk-review']),
  );
  const visibleGroups = groupsWithEntries(entries, phase);

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-secondary/70 pb-6 pl-10 pr-6 sm:pl-14 lg:pl-16"
      aria-label="Run ledger"
      aria-live="polite"
    >
      <header className="flex items-center justify-between border-b py-4">
        <span className="font-data text-xs font-semibold uppercase tracking-[0.24em] text-foreground">
          Run ledger
        </span>
        <span className="flex items-center gap-2 font-data text-xs uppercase tracking-[0.14em]">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              phase === 'recording' && 'ledger-recording bg-primary',
              phase === 'complete' && 'bg-live',
              phase === 'failed' && 'bg-urgent',
              phase === 'idle' && 'border border-input bg-transparent',
            )}
          />
          <span
            className={cn(
              phase === 'recording' && 'text-primary',
              phase === 'complete' && 'text-live',
              phase === 'failed' && 'text-urgent',
              phase === 'idle' && 'text-muted-foreground',
            )}
          >
            {phaseLabels[phase]}
          </span>
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleGroups.map(group => (
          <LedgerAccordion
            key={group.id}
            group={group}
            entries={entriesForGroup(entries, group)}
            open={openGroups.has(group.id)}
            phase={phase}
            onToggle={() =>
              setOpenGroups(current => {
                const next = new Set(current);

                if (next.has(group.id)) {
                  next.delete(group.id);
                } else {
                  next.add(group.id);
                }

                return next;
              })
            }
          />
        ))}
      </div>
    </aside>
  );
}

function LedgerAccordion({
  group,
  entries,
  open,
  phase,
  onToggle,
}: {
  group: LedgerGroup;
  entries: LedgerEntry[];
  open: boolean;
  phase: LedgerPhase;
  onToggle: () => void;
}) {
  const hasEntries = entries.length > 0;

  return (
    <section className="border-b">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
        onClick={onToggle}
      >
        <span className="text-base font-semibold leading-tight text-foreground">{group.title}</span>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>

      {open ? (
        <div className="pb-4">
          {hasEntries ? (
            <ol className="grid gap-4">
              {entries.map((entry, index) => (
                <LedgerEvent
                  key={entry.id}
                  entry={entry}
                  active={phase === 'recording' && index === entries.length - 1}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              No information to view
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LedgerEvent({
  entry,
  active,
}: {
  entry: LedgerEntry;
  active: boolean;
}) {
  return (
    <li className="ledger-entry-in grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
      <span className="font-data text-xs tabular-nums text-muted-foreground">{entry.time}</span>
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm leading-5',
            entry.kind === 'error' ? 'text-urgent' : 'text-foreground',
          )}
        >
          {entry.label}
        </span>
        {entry.detail ? (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {entry.detail}
          </span>
        ) : null}
        {active ? (
          <span className="mt-2 inline-flex items-center gap-2 font-data text-[0.65rem] uppercase tracking-[0.14em] text-primary">
            <span aria-hidden className="ledger-recording size-1.5 rounded-full bg-primary" />
            Live
          </span>
        ) : null}
      </span>
    </li>
  );
}

function groupsWithEntries(entries: LedgerEntry[], phase: LedgerPhase) {
  if (phase === 'idle') {
    return LEDGER_GROUPS.slice(0, 3);
  }

  const groups = LEDGER_GROUPS.filter(group => entriesForGroup(entries, group).length > 0);

  if (groups.length === 0) {
    return LEDGER_GROUPS.slice(0, 3);
  }

  return groups;
}

function entriesForGroup(entries: LedgerEntry[], group: LedgerGroup) {
  return entries.filter(entry => group.kinds.includes(entry.kind));
}
