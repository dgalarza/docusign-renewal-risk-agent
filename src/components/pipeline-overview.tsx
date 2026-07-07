'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { LedgerEntry } from '@/components/run-ledger';
import { cn } from '@/lib/utils';

export type PipelinePhase = 'idle' | 'running' | 'complete' | 'failed';

type StageState = 'planned' | 'active' | 'done' | 'failed';

type Stage = {
  title: string;
  actor: string;
  description: string;
  detailKinds: string[];
};

/**
 * The four in-run stages, in the order the Mastra workflow reports them. Index
 * maps directly to the `activeStage` the page derives from ledger events:
 *   0 Workflow · 1 Intake Agent · 2 Risk review (policy tool + agent) · 3 Risk brief
 */
const STAGES: Stage[] = [
  {
    title: 'Workflow',
    actor: 'Mastra orchestration',
    description: 'Dispatches the run and sequences each agent.',
    detailKinds: ['run-open', 'dispatch'],
  },
  {
    title: 'Intake Agent',
    actor: 'Docusign MCP',
    description: 'Discovers completed agreements in Agreement Manager and normalizes the fields.',
    detailKinds: ['intake', 'tool-call', 'tool-result', 'normalize'],
  },
  {
    title: 'Risk review',
    actor: 'Policy tool + Risk Review Agent',
    description: 'Deterministic policy classifies every agreement; the agent adds bounded judgment.',
    detailKinds: ['risk-review', 'policy-tool-call', 'policy-tool-result'],
  },
  {
    title: 'Risk brief',
    actor: 'Ranked findings',
    description: 'Prioritized findings, recommended actions, and suggested reviewers.',
    detailKinds: ['run-close', 'error'],
  },
];

const NEXT_STAGE: Stage = {
  title: 'Human review',
  actor: 'Workflow Builder',
  description: 'A reviewer approves or edits, then routes follow-up. Next story.',
  detailKinds: ['human-approval', 'workflow-builder'],
};

export function PipelineOverview({
  phase,
  activeStage,
  entries,
}: {
  phase: PipelinePhase;
  activeStage: number;
  entries: LedgerEntry[];
}) {
  const stages = [...STAGES, NEXT_STAGE];

  return (
    <section>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <p className="font-data text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Multi-agent orchestration
          </p>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            One workflow, two agents, and a deterministic policy tool that stays the source of truth.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="grid gap-3">
          {stages.map((stage, index) => (
            <StageRow
              key={stage.title}
              stage={stage}
              state={
                index < STAGES.length
                  ? stageState(index, phase, activeStage)
                  : 'planned'
              }
              upcoming={index === STAGES.length}
              entries={entries.filter(entry => stage.detailKinds.includes(entry.kind))}
              hasConnector={index < stages.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function stageState(
  index: number,
  phase: PipelinePhase,
  activeStage: number,
): StageState {
  if (phase === 'idle') {
    return 'planned';
  }

  if (phase === 'complete') {
    return 'done';
  }

  if (index < activeStage) {
    return 'done';
  }

  if (index === activeStage) {
    return phase === 'failed' ? 'failed' : 'active';
  }

  return 'planned';
}

function StageRow({
  stage,
  state,
  upcoming,
  entries,
  hasConnector,
}: {
  stage: Stage;
  state: StageState;
  upcoming: boolean;
  entries: LedgerEntry[];
  hasConnector: boolean;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-4">
      <div className="relative flex justify-center pt-4">
        {hasConnector ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-[1.375rem] h-[calc(100%+0.75rem)] w-0.5 -translate-x-1/2 bg-primary"
          />
        ) : null}
        <TimelineDot state={state} upcoming={upcoming} />
      </div>
      <StageCard stage={stage} state={state} upcoming={upcoming} entries={entries} />
    </div>
  );
}

function TimelineDot({
  state,
  upcoming,
}: {
  state: StageState;
  upcoming: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{ borderColor: 'var(--primary)' }}
      className={cn(
        'relative z-10 size-3 rounded-full border-2 bg-card',
        state === 'active' && 'ledger-recording bg-primary',
        state === 'done' && 'bg-primary',
        state === 'failed' && 'bg-card',
        (state === 'planned' || upcoming) && 'bg-card',
      )}
    />
  );
}

function StageCard({
  stage,
  state,
  upcoming,
  entries,
}: {
  stage: Stage;
  state: StageState;
  upcoming: boolean;
  entries: LedgerEntry[];
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const DetailsIcon = detailsOpen ? ChevronDown : ChevronRight;

  return (
    <div
      className={cn(
        'rounded-2xl border px-5 py-4 transition-colors',
        upcoming
          ? 'bg-card'
          : state === 'active'
            ? 'border-primary/40 bg-accent'
            : state === 'failed'
              ? 'border-urgent/40 bg-urgent-wash'
              : 'bg-card',
      )}
    >
      <div className="font-data text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
        {stage.actor}
      </div>
      <div
        className={cn(
          'mt-1 flex flex-wrap items-center gap-2 text-base font-semibold leading-tight',
          upcoming ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        <span>{stage.title}</span>
        {upcoming ? (
          <span className="rounded-md border border-input bg-card px-2 py-0.5 font-data text-[0.62rem] font-normal uppercase tracking-[0.12em] text-muted-foreground">
            Next
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.description}</p>

      <button
        type="button"
        className="mt-3 flex w-full items-center justify-between border-t pt-3"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen(open => !open)}
      >
        <p className="m-0 text-sm font-normal leading-6 text-muted-foreground">Details</p>
        <DetailsIcon className="size-4 text-muted-foreground" aria-hidden />
      </button>

      {detailsOpen ? <StageDetails entries={entries} /> : null}
    </div>
  );
}

function StageDetails({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-3 rounded-xl border bg-secondary/60 px-4 py-3 text-sm leading-6 text-muted-foreground">
        No information to view
      </p>
    );
  }

  return (
    <ol className="mt-3 grid gap-3 rounded-xl border bg-secondary/60 px-4 py-3">
      {entries.map(entry => (
        <li key={entry.id} className="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3">
          <span className="font-data text-xs tabular-nums text-muted-foreground">{entry.time}</span>
          <span className="min-w-0">
            <span
              className={cn(
                'block text-sm leading-5',
                entry.kind === 'error' ? 'text-urgent' : 'text-foreground',
              )}
            >
              {formatEventText(entry.label)}
            </span>
            {entry.detail ? (
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {formatEventText(entry.detail)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function formatEventText(value: string) {
  return value.replaceAll('docusign_getAllAgreements', 'Agreement discovery');
}
