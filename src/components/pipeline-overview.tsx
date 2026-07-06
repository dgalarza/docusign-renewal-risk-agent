'use client';

import {
  ArrowRight,
  Check,
  FileCheck,
  Gavel,
  Loader2,
  Search,
  Sparkles,
  UserCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type PipelinePhase = 'idle' | 'running' | 'complete' | 'failed';

type StageKind = 'deterministic' | 'agent' | 'system' | 'human';

type StageState = 'planned' | 'active' | 'done' | 'failed';

type Stage = {
  icon: LucideIcon;
  title: string;
  actor: string;
  description: string;
  kind: StageKind;
};

/**
 * The four in-run stages, in the order the Mastra workflow reports them. Index
 * maps directly to the `activeStage` the page derives from ledger events:
 *   0 Workflow · 1 Intake Agent · 2 Risk review (policy tool + agent) · 3 Risk brief
 */
const STAGES: Stage[] = [
  {
    icon: Workflow,
    title: 'Workflow',
    actor: 'Mastra orchestration',
    description: 'Dispatches the run and sequences each agent.',
    kind: 'system',
  },
  {
    icon: Search,
    title: 'Intake Agent',
    actor: 'Docusign MCP',
    description: 'Discovers completed agreements in Agreement Manager and normalizes the fields.',
    kind: 'agent',
  },
  {
    icon: Gavel,
    title: 'Risk review',
    actor: 'Policy tool + Risk Review Agent',
    description: 'Deterministic policy classifies every agreement; the agent adds bounded judgment.',
    kind: 'deterministic',
  },
  {
    icon: FileCheck,
    title: 'Risk brief',
    actor: 'Ranked findings',
    description: 'Prioritized findings, recommended actions, and suggested reviewers.',
    kind: 'system',
  },
];

const NEXT_STAGE: Stage = {
  icon: UserCheck,
  title: 'Human review',
  actor: 'Workflow Builder',
  description: 'A reviewer approves or edits, then routes follow-up. Next story.',
  kind: 'human',
};

export function PipelineOverview({
  phase,
  activeStage,
}: {
  phase: PipelinePhase;
  activeStage: number;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-data text-[11px] font-medium uppercase tracking-[0.16em] text-accent-foreground">
            Multi-agent orchestration
          </p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            One workflow, two agents, and a deterministic policy tool that stays the source of truth.
          </p>
        </div>
        <Legend />
      </div>

      <div className="flex flex-col gap-2 px-4 py-4 lg:flex-row lg:items-stretch lg:gap-0">
        {STAGES.map((stage, index) => (
          <div key={stage.title} className="contents">
            <StageCard stage={stage} state={stageState(index, phase, activeStage)} />
            <Connector />
          </div>
        ))}
        <StageCard stage={NEXT_STAGE} state="planned" upcoming />
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

function StageCard({
  stage,
  state,
  upcoming = false,
}: {
  stage: Stage;
  state: StageState;
  upcoming?: boolean;
}) {
  const Icon = stage.icon;

  return (
    <div
      className={cn(
        'relative flex flex-1 flex-col gap-2 rounded-md border px-3 py-3 transition-colors',
        upcoming
          ? 'border-dashed bg-transparent'
          : state === 'active'
            ? 'border-primary/40 bg-accent'
            : state === 'done'
              ? 'border-live/30 bg-live-wash/50'
              : state === 'failed'
                ? 'border-urgent/40 bg-urgent-wash'
                : 'bg-card',
      )}
    >
      {upcoming ? (
        <span className="absolute right-2 top-2 rounded-full border border-input px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          Next
        </span>
      ) : null}

      <div className="flex items-center gap-2">
        <StageIcon Icon={Icon} state={state} upcoming={upcoming} />
        <div className="min-w-0">
          <div
            className={cn(
              'truncate text-sm font-medium',
              upcoming ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {stage.title}
          </div>
          <div className="truncate font-data text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {stage.actor}
          </div>
        </div>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">{stage.description}</p>

      {stage.kind === 'deterministic' ? (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <KindChip icon={Gavel} label="Deterministic" tone="live" />
          <KindChip icon={Sparkles} label="Agent judgment" tone="accent" />
        </div>
      ) : null}
    </div>
  );
}

function StageIcon({
  Icon,
  state,
  upcoming,
}: {
  Icon: LucideIcon;
  state: StageState;
  upcoming: boolean;
}) {
  const showCheck = state === 'done';
  const showSpinner = state === 'active';

  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border',
        upcoming
          ? 'border-dashed border-input text-muted-foreground'
          : state === 'active'
            ? 'border-primary/30 bg-primary text-primary-foreground'
            : state === 'done'
              ? 'border-live/30 bg-live-wash text-live'
              : state === 'failed'
                ? 'border-urgent/30 bg-urgent-wash text-urgent'
                : 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {showCheck ? (
        <Check className="size-4" />
      ) : showSpinner ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Icon className="size-4" />
      )}
    </span>
  );
}

function Connector() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center py-1 text-muted-foreground lg:px-1 lg:py-0"
    >
      <ArrowRight className="hidden size-4 lg:block" />
      <span className="h-4 w-px bg-border lg:hidden" />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 font-data text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-live" />
        Deterministic
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-primary" />
        Agent judgment
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full border border-input" />
        Human · next
      </span>
    </div>
  );
}

function KindChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'live' | 'accent';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'live'
          ? 'border-live/30 bg-live-wash text-live'
          : 'border-primary/25 bg-accent text-accent-foreground',
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
