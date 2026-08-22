'use client';

import { CheckCircle2, ExternalLink, FileSearch, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type {
  FollowUpAction,
  RenewalAgreementTableRow,
  RenewalDecisionResult,
  RenewalRiskAgentGuidance,
  RenewalRiskFinding,
} from '@/mastra/domain/schemas';
import { Button } from '@/components/ui/button';
import {
  DataValue,
  DaysToNotice,
  FOLLOW_UP_ACTIONS,
  formatActionLabel,
  MoneyValue,
  NoticeDeadlineValue,
  NoticePeriodValue,
  RenewalTypeLabel,
  workflowBuilderStatusLabel,
} from '@/components/renewal-values';
import { withDocusignUtmParams } from '@/lib/utils';

export type DecisionSubmitInput = {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding;
  decision: 'approved' | 'edited' | 'rejected';
  selectedAction: FollowUpAction;
  notes: string;
};

export function RenewalDetailPanel({
  row,
  finding,
  guidance,
  decisionResult,
  decisionError,
  decisionPending,
  onSubmitDecision,
}: {
  row: RenewalAgreementTableRow | null;
  finding: RenewalRiskFinding | null;
  guidance: RenewalRiskAgentGuidance | null;
  decisionResult: RenewalDecisionResult | null;
  decisionError: string | null;
  decisionPending: boolean;
  onSubmitDecision: (input: DecisionSubmitInput) => Promise<void>;
}) {
  const [selectedAction, setSelectedAction] = useState<FollowUpAction>('owner_review');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setSelectedAction(finding?.recommendedAction ?? 'owner_review');
    setNotes('');
  }, [row?.agreementId, finding?.recommendedAction]);

  if (!row) {
    return (
      <aside className="hidden rounded-lg border border-dashed bg-card xl:block">
        <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <FileSearch className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">Select an agreement</p>
          <p className="max-w-56 text-xs leading-5 text-muted-foreground">
            Pick a row to see the full renewal-risk picture — dates, policy rationale, and the
            extracted signals behind it.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <div
      className="bg-secondary/55 px-5 py-5"
      aria-label={`Renewal-risk detail for ${row.supplier}`}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <div className="flex h-full flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailFact label="Renewal date">
              <DataValue value={row.renewalDate} />
            </DetailFact>
            <DetailFact label="Notice deadline">
              <NoticeDeadlineValue value={row.noticeDeadline} derived={row.noticeDeadlineDerived} />
            </DetailFact>
            <DetailFact label="Renewal type">
              <RenewalTypeLabel value={row.renewalType} />
            </DetailFact>
            <DetailFact label="Notice period">
              <NoticePeriodValue noticePeriodDays={row.noticePeriodDays} />
            </DetailFact>
            <DetailFact label="Days to notice">
              <DaysToNotice days={row.daysUntilNoticeDeadline} />
            </DetailFact>
            <DetailFact label="Contract value">
              <MoneyValue value={row.agreementValue} currency={row.currency} />
            </DetailFact>
          </dl>

          {guidance || finding || row.source.recordUrl ? (
            <div className="flex flex-1 flex-col rounded-xl border bg-card px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p className="font-data text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-primary">
                  Risk Review Agent
                </p>
              </div>

              {guidance ? (
                <>
                  <p className="mt-4 text-sm leading-6 text-foreground">
                    {guidance.judgment}
                  </p>
                  {guidance.reasonForPriority ? (
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {guidance.reasonForPriority}
                    </p>
                  ) : null}
                </>
              ) : null}

              {row.source.recordUrl ? (
                <div className="mt-auto border-t pt-4">
                  <p className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                    Source record
                  </p>
                  <a
                    href={withDocusignUtmParams(row.source.recordUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Open in Docusign
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <DecisionPanel
            row={row}
            finding={finding}
            selectedAction={selectedAction}
            setSelectedAction={setSelectedAction}
            notes={notes}
            setNotes={setNotes}
            decisionResult={decisionResult}
            decisionError={decisionError}
            decisionPending={decisionPending}
            onSubmitDecision={onSubmitDecision}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Human approval checkpoint — the governed moment of the demo. The reviewer
 * approves the policy recommendation, overrides it with another follow-up
 * action, or rejects follow-up entirely. The decision posts to
 * POST /api/renewals/decisions, which appends to the SQLite decision trail and hands
 * approved actions to Docusign Workflow Builder.
 */
function DecisionPanel({
  row,
  finding,
  selectedAction,
  setSelectedAction,
  notes,
  setNotes,
  decisionResult,
  decisionError,
  decisionPending,
  onSubmitDecision,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding | null;
  selectedAction: FollowUpAction;
  setSelectedAction: (action: FollowUpAction) => void;
  notes: string;
  setNotes: (notes: string) => void;
  decisionResult: RenewalDecisionResult | null;
  decisionError: string | null;
  decisionPending: boolean;
  onSubmitDecision: (input: DecisionSubmitInput) => Promise<void>;
}) {
  if (!finding) {
    return null;
  }

  const submit = (
    decision: 'approved' | 'edited' | 'rejected',
    action: FollowUpAction,
  ) =>
    onSubmitDecision({
      row,
      finding,
      decision,
      selectedAction: action,
      notes,
    });

  return (
    <div className="rounded-xl border bg-card px-4 py-4">
      <p className="font-data text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-primary">
        Human approval
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        Approve the policy recommendation or override it before Workflow Builder acts.
      </p>

      <label className="mt-3 grid gap-1.5 text-sm font-medium text-muted-foreground">
        Override action
        <select
          className="h-10 rounded-lg border border-input bg-card px-3 pr-10 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selectedAction}
          onChange={event => setSelectedAction(event.target.value as FollowUpAction)}
        >
          {FOLLOW_UP_ACTIONS.map(action => (
            <option key={action} value={action}>
              {formatActionLabel(action)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 grid gap-1.5 text-sm font-medium text-muted-foreground">
        Reviewer notes
        <textarea
          className="min-h-24 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Add context for the request"
        />
      </label>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          className="w-fit px-0 text-urgent hover:bg-transparent hover:text-urgent"
          disabled={decisionPending}
          onClick={() => submit('rejected', 'no_action')}
          size="sm"
          variant="ghost"
        >
          Reject
        </Button>
        <Button
          className="rounded-lg"
          disabled={decisionPending}
          onClick={() =>
            submit(
              selectedAction === finding.recommendedAction ? 'approved' : 'edited',
              selectedAction,
            )
          }
          size="sm"
        >
          {decisionPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Submit
        </Button>
      </div>

      {decisionError ? (
        <p className="mt-3 rounded-md border border-urgent/30 bg-urgent-wash px-3 py-2 text-xs leading-5 text-urgent">
          {decisionError}
        </p>
      ) : null}

      {decisionResult ? <DecisionResultCard result={decisionResult} /> : null}
    </div>
  );
}

function DecisionResultCard({ result }: { result: RenewalDecisionResult }) {
  return (
    <div className="mt-4 rounded-xl border bg-secondary px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {formatActionLabel(result.followUpPlan.action)}
        </p>
        <span className="rounded-full border border-border bg-card px-2 py-0.5 font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">
          {result.followUpPlan.status}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {result.followUpPlan.details}
      </p>
      <div className="mt-3 border-t pt-3">
        <p className="font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Workflow Builder
        </p>
        <p className="mt-1 text-xs leading-5 text-foreground">
          {workflowBuilderStatusLabel(result.workflowBuilder.status)}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {result.workflowBuilder.details}
        </p>
        {result.workflowBuilder.instanceUrl ? (
          <a
            href={result.workflowBuilder.instanceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-foreground underline-offset-2 hover:underline"
          >
            Open workflow instance
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm leading-6 text-muted-foreground">
        {label}
      </dt>
      <dd className="m-0 text-sm leading-6 text-foreground">{children}</dd>
    </div>
  );
}
