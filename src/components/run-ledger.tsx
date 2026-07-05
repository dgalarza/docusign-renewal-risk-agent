'use client';

import { cn } from '@/lib/utils';

export type LedgerEntry = {
  id: number;
  time: string;
  kind: string;
  label: string;
  detail: string | null;
};

export type LedgerPhase = 'idle' | 'recording' | 'complete' | 'failed';

const PLANNED_STATIONS = [
  'Workflow dispatched to Mastra',
  'Intake Agent engaged',
  'Docusign MCP queries',
  'Agreement rows normalized',
  'Results returned',
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
  return (
    <aside
      className="rounded-lg border bg-card"
      aria-label="Run ledger"
      aria-live="polite"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-data text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Run ledger
        </span>
        <span className="flex items-center gap-1.5 font-data text-[11px] uppercase tracking-[0.08em]">
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
              phase === 'recording' && 'text-accent-foreground',
              phase === 'complete' && 'text-live',
              phase === 'failed' && 'text-urgent',
              phase === 'idle' && 'text-muted-foreground',
            )}
          >
            {phaseLabels[phase]}
          </span>
        </span>
      </header>

      {phase === 'idle' ? <PlannedRoute /> : <RecordedEntries entries={entries} phase={phase} />}
    </aside>
  );
}

function PlannedRoute() {
  return (
    <div className="px-4 py-4">
      <ol className="relative flex flex-col gap-4 border-l pl-4">
        {PLANNED_STATIONS.map(station => (
          <li key={station} className="relative text-sm text-muted-foreground">
            <span
              aria-hidden
              className="absolute -left-[21.5px] top-1.5 size-2 rounded-full border border-input bg-card"
            />
            {station}
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t pt-3 text-xs leading-5 text-muted-foreground">
        Each run is recorded here as the Mastra workflow reports it, entry by entry.
      </p>
    </div>
  );
}

function RecordedEntries({
  entries,
  phase,
}: {
  entries: LedgerEntry[];
  phase: LedgerPhase;
}) {
  return (
    <div className="px-4 py-4">
      <ol className="relative flex flex-col gap-4 border-l pl-4">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const isActive = isLast && phase === 'recording';

          return (
            <li key={entry.id} className="ledger-entry-in relative">
              <span
                aria-hidden
                className={cn(
                  'absolute -left-[21.5px] top-1.5 size-2 rounded-full',
                  entry.kind === 'error'
                    ? 'bg-urgent'
                    : isActive
                      ? 'ledger-recording bg-primary'
                      : isLast
                        ? 'bg-primary'
                        : 'border border-primary/50 bg-card',
                )}
              />
              <div className="font-data text-[11px] tabular-nums text-muted-foreground">
                {entry.time}
              </div>
              <div
                className={cn(
                  'text-sm leading-5',
                  entry.kind === 'error' ? 'text-urgent' : 'text-foreground',
                )}
              >
                {entry.label}
              </div>
              {entry.detail ? (
                <div className="text-xs leading-5 text-muted-foreground">{entry.detail}</div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
