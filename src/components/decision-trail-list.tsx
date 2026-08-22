'use client';

import { ArrowRight, ChevronDown, ChevronRight, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import type { FollowUpAction, RenewalDecisionResult } from '@/mastra/domain/schemas';
import type { DecisionTrailRow } from '@/mastra/tools/decision-trail';
import {
  FOLLOW_UP_ACTIONS,
  formatActionLabel,
  workflowBuilderStatusLabel,
} from '@/components/renewal-values';
import { cn } from '@/lib/utils';

type DecisionKind = DecisionTrailRow['decision'];
type WorkflowBuilderStatus = RenewalDecisionResult['workflowBuilder']['status'];

const ROW_GRID =
  'sm:grid-cols-[minmax(9rem,0.9fr)_minmax(0,1.6fr)_minmax(6.5rem,0.7fr)_minmax(0,1.7fr)_minmax(8rem,0.9fr)_minmax(7rem,0.8fr)_2rem]';

const decisionLabels: Record<DecisionKind, string> = {
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected',
};

const workflowBuilderChipLabels: Record<WorkflowBuilderStatus, string> = {
  triggered: 'Triggered',
  failed: 'Failed',
  skipped: 'Skipped',
  not_configured: 'Not configured',
};

/**
 * Accordion list over the append-only decision trail. The only client state
 * is which row is expanded; every value shown comes straight from the row.
 */
export function DecisionTrailList({ decisions }: { decisions: DecisionTrailRow[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (decisions.length === 0) {
    return <EmptyTrail />;
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className={cn('hidden gap-3 border-b bg-secondary/70 px-5 py-4 sm:grid', ROW_GRID)}>
        <ColumnHeading>Decided at</ColumnHeading>
        <ColumnHeading>Supplier</ColumnHeading>
        <ColumnHeading>Decision</ColumnHeading>
        <ColumnHeading>Recommended → selected</ColumnHeading>
        <ColumnHeading>Workflow Builder</ColumnHeading>
        <ColumnHeading>Reviewer</ColumnHeading>
        <span aria-hidden />
      </div>

      {decisions.map(row => {
        const expanded = row.id === expandedId;

        return (
          <div key={row.id} className="border-b last:border-b-0">
            <DecisionSummaryRow
              row={row}
              expanded={expanded}
              onSelect={() => setExpandedId(current => (current === row.id ? null : row.id))}
            />
            {expanded ? <DecisionDetail row={row} /> : null}
          </div>
        );
      })}
    </section>
  );
}

function ColumnHeading({ children }: { children: string }) {
  return (
    <span className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </span>
  );
}

function MobileLabel({ children }: { children: string }) {
  return (
    <span className="mb-1 block font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
      {children}
    </span>
  );
}

function DecisionSummaryRow({
  row,
  expanded,
  onSelect,
}: {
  row: DecisionTrailRow;
  expanded: boolean;
  onSelect: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onSelect}
      className={cn(
        'grid w-full grid-cols-1 gap-3 px-5 py-4 text-left transition-colors',
        ROW_GRID,
        expanded ? 'bg-accent shadow-[inset_0.25rem_0_0_var(--primary)]' : 'bg-card hover:bg-secondary/50',
      )}
    >
      <div className="self-center">
        <MobileLabel>Decided at</MobileLabel>
        <DecidedAt value={row.decidedAt} />
      </div>
      <div className="min-w-0 self-center">
        <MobileLabel>Supplier</MobileLabel>
        <span className="block truncate text-sm font-semibold text-foreground">
          {row.supplier ?? 'Unknown supplier'}
        </span>
      </div>
      <div className="self-center">
        <MobileLabel>Decision</MobileLabel>
        <DecisionChip decision={row.decision} />
      </div>
      <div className="min-w-0 self-center">
        <MobileLabel>Recommended → selected</MobileLabel>
        <ActionTransition
          recommended={row.recommendedAction}
          selected={row.selectedAction}
        />
      </div>
      <div className="self-center">
        <MobileLabel>Workflow Builder</MobileLabel>
        <WorkflowBuilderChip status={row.workflowBuilderStatus} />
      </div>
      <div className="min-w-0 self-center">
        <MobileLabel>Reviewer</MobileLabel>
        <span className="block truncate text-sm text-foreground">{row.reviewer}</span>
      </div>
      <span className="hidden items-center justify-center self-center text-muted-foreground sm:flex">
        <Chevron className="size-4" aria-hidden />
      </span>
    </button>
  );
}

function DecidedAt({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className="font-data text-xs text-foreground">{value}</span>;
  }

  const day = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 16);

  return (
    <span className="whitespace-nowrap font-data text-xs tabular-nums text-foreground" title={value}>
      {day}
      <span className="ml-1.5 text-muted-foreground">{time}Z</span>
    </span>
  );
}

function DecisionChip({ decision }: { decision: DecisionKind }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium',
        decision === 'approved' && 'border-live/30 bg-live-wash text-live',
        decision === 'edited' && 'border-caution/30 bg-caution-wash text-caution',
        decision === 'rejected' && 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {decisionLabels[decision]}
    </span>
  );
}

function WorkflowBuilderChip({ status }: { status: string | null }) {
  const known = isWorkflowBuilderStatus(status) ? status : null;

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 font-data text-[0.68rem] font-medium uppercase tracking-[0.04em]',
        known === 'triggered' && 'border-live/30 bg-live-wash text-live',
        known === 'failed' && 'border-urgent/30 bg-urgent-wash text-urgent',
        (known === 'skipped' || known === 'not_configured' || known === null) &&
          'border-border bg-secondary text-muted-foreground',
      )}
      title={known ? workflowBuilderStatusLabel(known) : undefined}
    >
      {known ? workflowBuilderChipLabels[known] : 'Unknown'}
    </span>
  );
}

/**
 * Shows the policy's recommended action next to what the reviewer selected.
 * The arrow and highlight only appear when they differ — that is the human
 * override, and it is the thing an auditor wants to spot at a glance.
 */
function ActionTransition({
  recommended,
  selected,
}: {
  recommended: string | null;
  selected: string;
}) {
  const overridden = recommended !== null && recommended !== selected;

  if (!overridden) {
    return (
      <span className="block truncate text-sm text-foreground">{actionLabel(selected)}</span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="truncate text-muted-foreground line-through decoration-muted-foreground/50">
        {actionLabel(recommended)}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-caution" aria-hidden />
      <span className="truncate rounded-md bg-caution-wash px-1.5 py-0.5 font-medium text-caution">
        {actionLabel(selected)}
      </span>
    </span>
  );
}

function DecisionDetail({ row }: { row: DecisionTrailRow }) {
  const { followUpPlan, workflowBuilder } = row.record;

  return (
    <div className="grid gap-6 border-t bg-secondary/40 px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <DetailLabel>Reviewer notes</DetailLabel>
        {row.reviewerNotes ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{row.reviewerNotes}</p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">No notes recorded.</p>
        )}
        <DetailLabel className="mt-5">Agreement</DetailLabel>
        <p className="mt-2 break-all font-data text-xs text-foreground">{row.agreementId}</p>
      </div>

      <div className="min-w-0">
        <DetailLabel>Follow-up plan</DetailLabel>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            {formatActionLabel(followUpPlan.action)}
          </p>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">
            {followUpPlan.status}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{followUpPlan.details}</p>
      </div>

      <div className="min-w-0">
        <DetailLabel>Workflow Builder</DetailLabel>
        <p className="mt-2 text-sm font-medium text-foreground">
          {workflowBuilderStatusLabel(workflowBuilder.status)}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{workflowBuilder.details}</p>
        {row.workflowInstanceId ? (
          <p className="mt-2 font-data text-xs text-muted-foreground">
            Instance {row.workflowInstanceId}
          </p>
        ) : null}
        {row.workflowInstanceUrl ? (
          <a
            href={row.workflowInstanceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex w-fit items-center gap-1 text-sm font-medium text-accent-foreground underline-offset-2 hover:underline"
          >
            Open workflow instance
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function DetailLabel({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground', className)}>
      {children}
    </p>
  );
}

function EmptyTrail() {
  return (
    <section className="overflow-hidden rounded-2xl border bg-secondary/60">
      <div className="border-b bg-card px-6 py-4">
        <span className="font-data text-xs uppercase tracking-[0.08em] text-muted-foreground">
          Decision trail · No decisions recorded yet
        </span>
      </div>
      <div className="flex min-h-72 flex-col items-center justify-center gap-5 px-8 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border bg-card">
          <FileText className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="max-w-xl text-base leading-7 text-muted-foreground">
          Nothing has been decided yet. Each approve, edit, or reject at the review checkpoint
          is appended here as one row.
        </p>
      </div>
    </section>
  );
}

function actionLabel(action: string) {
  return (FOLLOW_UP_ACTIONS as readonly string[]).includes(action)
    ? formatActionLabel(action as FollowUpAction)
    : action;
}

function isWorkflowBuilderStatus(value: string | null): value is WorkflowBuilderStatus {
  return (
    value === 'triggered' || value === 'failed' || value === 'skipped' || value === 'not_configured'
  );
}
