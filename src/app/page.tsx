'use client';

import { AlertCircle, CheckCircle2, ExternalLink, FileSearch, Loader2, Search, Send } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RenewalAgreementTableRow,
  RenewalDecisionResult,
  RenewalReviewWorkflowResult,
  RenewalRiskAgentGuidance,
  RenewalRiskFinding,
  FollowUpAction,
} from '@/mastra/domain/schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunLedger, type LedgerEntry, type LedgerPhase } from '@/components/run-ledger';
import { PipelineOverview, type PipelinePhase } from '@/components/pipeline-overview';
import { cn, withDocusignUtmParams } from '@/lib/utils';

type UiStatus = RenewalReviewWorkflowResult['status'] | 'idle' | 'loading';

const DEFAULT_REVIEW_WINDOW_DAYS = 90;

/**
 * Maps each streamed ledger event `kind` to a pipeline stage index so the
 * orchestration diagram lights up in step with the run.
 *   0 Workflow · 1 Intake Agent · 2 Risk review · 3 Risk brief
 */
const STAGE_BY_KIND: Record<string, number> = {
  'run-open': 0,
  dispatch: 0,
  intake: 1,
  'tool-call': 1,
  'tool-result': 1,
  normalize: 1,
  'risk-review': 2,
  'policy-tool-call': 2,
  'policy-tool-result': 2,
  'run-close': 3,
  'human-approval': 3,
  'workflow-builder': 3,
};

const statusLabels: Record<UiStatus, string> = {
  idle: 'Ready',
  loading: 'Running',
  live: 'Live',
  empty: 'Empty',
  missing_fields: 'Missing fields',
  error: 'Error',
};

const FOLLOW_UP_ACTIONS = [
  'no_action',
  'owner_review',
  'legal_review',
  'renegotiate',
  'prepare_cancellation_notice',
  'escalate_missed_deadline',
] as const satisfies FollowUpAction[];

const followUpActionLabels: Record<FollowUpAction, string> = {
  no_action: 'No action',
  owner_review: 'Owner review',
  legal_review: 'Legal review',
  renegotiate: 'Renegotiate',
  prepare_cancellation_notice: 'Prepare cancellation',
  escalate_missed_deadline: 'Escalate missed deadline',
};

export default function RenewalDiscoveryPage() {
  const initialParams = useMemo(() => {
    if (typeof window === 'undefined') {
      return new URLSearchParams();
    }

    return new URLSearchParams(window.location.search);
  }, []);
  const [asOfDate, setAsOfDate] = useState(
    initialParams.get('asOfDate') ?? new Date().toISOString().slice(0, 10),
  );
  const [result, setResult] = useState<RenewalReviewWorkflowResult | null>(null);
  const [status, setStatus] = useState<UiStatus>('idle');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(null);
  const [decisionResults, setDecisionResults] = useState<Record<string, RenewalDecisionResult>>({});
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionLoadingId, setDecisionLoadingId] = useState<string | null>(null);
  const entryIdRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  const rows = result?.rows ?? [];
  const isLoading = status === 'loading';
  const activeStage = deriveActiveStage(entries);

  const selectedRow = rows.find(row => row.agreementId === selectedAgreementId) ?? null;
  const selectedFinding =
    (selectedRow &&
      result?.riskBrief?.findings.find(
        finding => finding.agreementId === selectedRow.agreementId,
      )) ??
    null;
  const selectedGuidance =
    (selectedRow &&
      result?.riskReview?.reviewerGuidance.find(
        guidance => guidance.agreementId === selectedRow.agreementId,
      )) ??
    null;
  const selectedDecisionResult = selectedRow
    ? decisionResults[selectedRow.agreementId] ?? null
    : null;

  const pushEntry = (kind: string, label: string, detail: string | null = null) => {
    entryIdRef.current += 1;
    const entry: LedgerEntry = {
      id: entryIdRef.current,
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      kind,
      label,
      detail,
    };

    setEntries(previous => [...previous, entry]);
  };

  function discoverRenewals() {
    eventSourceRef.current?.close();
    setStatus('loading');
    setResult(null);
    setEntries([]);
    setSelectedAgreementId(null);
    setDecisionResults({});
    setDecisionError(null);
    pushEntry('run-open', 'Run opened', `As of ${asOfDate}`);

    const query = new URLSearchParams({
      asOfDate,
      reviewWindowDays: String(DEFAULT_REVIEW_WINDOW_DAYS),
    });
    window.history.replaceState({}, '', `/?${query.toString()}`);

    const source = new EventSource(`/api/renewals/stream?${query.toString()}`);
    eventSourceRef.current = source;
    let settled = false;

    const settle = () => {
      settled = true;
      source.close();
    };

    source.addEventListener('progress', event => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        kind: string;
        label: string;
        detail: string | null;
      };

      pushEntry(data.kind, data.label, data.detail);
    });

    source.addEventListener('result', event => {
      const payload = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as RenewalReviewWorkflowResult;

      setResult(payload);
      setStatus(payload.status);
      pushEntry(
        'run-close',
        `Run closed — ${payload.rows.length} ${payload.rows.length === 1 ? 'agreement' : 'agreements'}`,
        `Status ${statusLabels[payload.status].toLowerCase()}`,
      );
      settle();
    });

    source.addEventListener('failure', event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        message: string;
      };

      applyFailure(payload.message);
      settle();
    });

    source.onerror = () => {
      if (!settled) {
        applyFailure('The progress stream disconnected before the run finished.');
        settle();
      }
    };

    function applyFailure(message: string) {
      setResult({
        status: 'error',
        sourceLabel: 'Docusign MCP',
        asOfDate,
        reviewWindowDays: DEFAULT_REVIEW_WINDOW_DAYS,
        message: 'Renewal discovery request failed.',
        rows: [],
        availableTools: [],
        selectedTool: null,
        errors: [message],
        riskBrief: null,
        riskReview: null,
      });
      setStatus('error');
      pushEntry('error', 'Run failed', message);
    }
  }

  async function submitDecision(input: {
    row: RenewalAgreementTableRow;
    finding: RenewalRiskFinding;
    decision: 'approved' | 'edited' | 'rejected';
    selectedAction: FollowUpAction;
    notes: string;
  }) {
    setDecisionLoadingId(input.row.agreementId);
    setDecisionError(null);

    try {
      const response = await fetch('/api/renewals/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          row: input.row,
          finding: input.finding,
          decision: {
            agreementId: input.row.agreementId,
            decision: input.decision,
            selectedAction: input.selectedAction,
            reviewer: 'Demo Reviewer',
            notes: input.notes,
          },
        }),
      });
      const payload = (await response.json()) as RenewalDecisionResult | { message?: string };

      if (!response.ok) {
        throw new Error('message' in payload ? payload.message ?? 'Decision failed.' : 'Decision failed.');
      }

      const resultPayload = payload as RenewalDecisionResult;
      setDecisionResults(previous => ({
        ...previous,
        [input.row.agreementId]: resultPayload,
      }));
      pushEntry(
        'human-approval',
        `${input.row.supplier} ${input.decision === 'rejected' ? 'rejected' : 'approved'}`,
        `${formatActionLabel(resultPayload.followUpPlan.action)} · ${resultPayload.followUpPlan.status}`,
      );
      pushEntry(
        'workflow-builder',
        workflowBuilderStatusLabel(resultPayload.workflowBuilder.status),
        resultPayload.workflowBuilder.details,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDecisionError(message);
      pushEntry('error', 'Decision failed', message);
    } finally {
      setDecisionLoadingId(null);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <p className="mb-3 font-data text-[11px] font-medium uppercase tracking-[0.2em] text-accent-foreground">
              Renewal risk · Intake Agent
            </p>
            <h1 className="font-display text-4xl font-medium leading-tight text-foreground">
              Supplier renewal discovery
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Completed supplier agreements from Docusign Agreement Manager, screened for
              renewal dates inside the next {DEFAULT_REVIEW_WINDOW_DAYS} days.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="grid gap-2 text-sm font-medium text-muted-foreground">
                As of date
                <Input
                  className="bg-card"
                  type="date"
                  value={asOfDate}
                  onChange={event => {
                    setAsOfDate(event.target.value);
                    setResult(null);
                    setStatus('idle');
                    setEntries([]);
                    setSelectedAgreementId(null);
                  }}
                />
              </label>

              <Button disabled={isLoading} onClick={discoverRenewals}>
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Run discovery
              </Button>
            </div>
            <p className="font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground sm:text-right">
              Review window · {DEFAULT_REVIEW_WINDOW_DAYS} days
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-8">
        <PipelineOverview phase={toPipelinePhase(status)} activeStage={activeStage} />
      </div>

      <div className="mx-auto grid w-full max-w-[1440px] items-start gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-8">
        <RunLedger phase={toLedgerPhase(status)} entries={entries} />

        <div className="flex min-w-0 flex-col gap-6">
          {status === 'error' && result ? (
            <Alert variant="destructive">
              <AlertTitle className="flex items-center gap-2">
                <AlertCircle className="size-4" />
                Renewal discovery failed
              </AlertTitle>
              <AlertDescription>
                {[result.message, ...result.errors].filter(Boolean).join(' ')}
              </AlertDescription>
            </Alert>
          ) : null}

          <ResultBar result={result} status={status} />

          {rows.length > 0 ? <SummaryStrip rows={rows} riskBrief={result?.riskBrief ?? null} /> : null}
          {result?.riskReview ? (
            <RiskReviewPanel rows={rows} riskReview={result.riskReview} />
          ) : null}

          {rows.length > 0 ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,380px)] xl:items-start">
              <section className="min-w-0 overflow-x-auto rounded-lg border bg-card">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Supplier</TableHead>
                      <TableHead>Renewal date</TableHead>
                      <TableHead>Notice deadline</TableHead>
                      <TableHead className="text-right">Days to notice</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Renewal type</TableHead>
                      <TableHead>Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(row => (
                      <AgreementRow
                        key={row.agreementId}
                        row={row}
                        finding={
                          result?.riskBrief?.findings.find(
                            riskFinding => riskFinding.agreementId === row.agreementId,
                          ) ?? null
                        }
                        selected={row.agreementId === selectedAgreementId}
                        onSelect={() => {
                          setDecisionError(null);
                          setSelectedAgreementId(current =>
                            current === row.agreementId ? null : row.agreementId,
                          );
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </section>

              <RenewalDetailPanel
                row={selectedRow}
                finding={selectedFinding}
                guidance={selectedGuidance}
                decisionResult={selectedDecisionResult}
                decisionError={decisionError}
                decisionPending={selectedRow?.agreementId === decisionLoadingId}
                onSubmitDecision={submitDecision}
              />
            </div>
          ) : (
            <section className="rounded-lg border bg-card">
              <div className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {emptyStateMessage(status)}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function emptyStateMessage(status: UiStatus) {
  if (status === 'loading') {
    return 'Intake in progress — the run ledger records each step as it completes.';
  }

  if (status === 'error') {
    return 'No agreements were returned because the run failed.';
  }

  if (status === 'empty') {
    return 'No supplier agreements renew inside this window.';
  }

  return 'Run discovery to pull completed supplier agreements from Docusign Agreement Manager.';
}

function deriveActiveStage(entries: LedgerEntry[]): number {
  let stage = 0;

  for (const entry of entries) {
    const mapped = STAGE_BY_KIND[entry.kind];

    if (typeof mapped === 'number' && mapped > stage) {
      stage = mapped;
    }
  }

  return stage;
}

function toPipelinePhase(status: UiStatus): PipelinePhase {
  if (status === 'idle') {
    return 'idle';
  }

  if (status === 'loading') {
    return 'running';
  }

  if (status === 'error') {
    return 'failed';
  }

  return 'complete';
}

function toLedgerPhase(status: UiStatus): LedgerPhase {
  if (status === 'idle') {
    return 'idle';
  }

  if (status === 'loading') {
    return 'recording';
  }

  if (status === 'error') {
    return 'failed';
  }

  return 'complete';
}

function ResultBar({
  result,
  status,
}: {
  result: RenewalReviewWorkflowResult | null;
  status: UiStatus;
}) {
  const sourceLabel = result?.sourceLabel ?? 'Docusign MCP';
  const message =
    status === 'loading'
      ? 'The Intake Agent is querying Agreement Manager through Docusign MCP.'
      : status === 'idle'
        ? 'No run recorded yet for this date.'
        : status === 'error'
          ? null
          : result?.message ?? null;

  if (status === 'error') {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-data text-xs text-muted-foreground">
          {sourceLabel}
          {result?.selectedTool ? ` · ${result.selectedTool}` : ''}
        </div>
        {message ? (
          <p className="mt-1 text-sm leading-5 text-foreground">{message}</p>
        ) : null}
      </div>
      <StatusChip status={status} />
    </div>
  );
}

function StatusChip({ status }: { status: UiStatus }) {
  return (
    <span
      className={cn(
        'w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        status === 'live' && 'border-live/30 bg-live-wash text-live',
        status === 'missing_fields' && 'border-caution/30 bg-caution-wash text-caution',
        status === 'error' && 'border-urgent/30 bg-urgent-wash text-urgent',
        status === 'loading' && 'border-accent-foreground/20 bg-accent text-accent-foreground',
        (status === 'idle' || status === 'empty') && 'border-border bg-secondary text-secondary-foreground',
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

function SummaryStrip({
  rows,
  riskBrief,
}: {
  rows: RenewalAgreementTableRow[];
  riskBrief: RenewalReviewWorkflowResult['riskBrief'];
}) {
  const autoRenewing = rows.filter(row => row.renewalType === 'auto_renews').length;
  const valuedRows = rows.filter(row => typeof row.agreementValue === 'number');
  const portfolioValue = valuedRows.reduce(
    (total, row) => total + (row.agreementValue ?? 0),
    0,
  );
  const portfolioCurrency = valuedRows[0]?.currency || 'USD';
  const urgentOrBlocked =
    riskBrief?.findings.filter(
      finding => finding.classification === 'urgent' || finding.classification === 'blocked',
    ).length ?? 0;
  const legalReviews =
    riskBrief?.findings.filter(finding => finding.recommendedAction === 'legal_review').length ?? 0;

  return (
    <dl className="grid grid-cols-2 divide-border rounded-lg border bg-card sm:grid-cols-4 sm:divide-x">
      <StatTile
        label="Reviewed"
        value={String(riskBrief?.agreementsReviewed ?? rows.length)}
        detail="Deterministic policy"
      />
      <StatTile
        label="Urgent or blocked"
        value={String(urgentOrBlocked)}
        detail={autoRenewing > 0 ? `${autoRenewing} auto-renewing` : null}
      />
      <StatTile
        label="Legal review"
        value={String(legalReviews)}
        detail="Recommended action"
      />
      <StatTile
        label="Portfolio value"
        value={
          valuedRows.length > 0
            ? new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: portfolioCurrency,
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(portfolioValue)
            : 'Not extracted'
        }
        detail={valuedRows.length < rows.length ? `${valuedRows.length} of ${rows.length} valued` : null}
      />
    </dl>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-xl font-semibold text-foreground">{value}</dd>
      {detail ? <p className="m-0 truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function RiskReviewPanel({
  rows,
  riskReview,
}: {
  rows: RenewalAgreementTableRow[];
  riskReview: NonNullable<RenewalReviewWorkflowResult['riskReview']>;
}) {
  const supplierByAgreementId = new Map(rows.map(row => [row.agreementId, row.supplier]));
  const priorityLabels = riskReview.priorityAgreementIds
    .map(agreementId => supplierByAgreementId.get(agreementId) ?? agreementId)
    .slice(0, 3);

  return (
    <section className="rounded-lg border bg-card px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div>
          <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-accent-foreground">
            Risk Review Agent judgment
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {riskReview.portfolioJudgment}
          </p>
          {priorityLabels.length > 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Review first: {priorityLabels.join(', ')}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3">
          {riskReview.reviewerGuidance.slice(0, 3).map(guidance => (
            <div key={guidance.agreementId} className="border-l-2 border-accent-foreground pl-3">
              <div className="text-sm font-medium text-foreground">
                {supplierByAgreementId.get(guidance.agreementId) ?? guidance.agreementId}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {guidance.judgment}
              </p>
              <p className="mt-1 font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {formatSuggestedReviewer(guidance.suggestedReviewer)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatSuggestedReviewer(
  reviewer: NonNullable<RenewalReviewWorkflowResult['riskReview']>['reviewerGuidance'][number]['suggestedReviewer'],
) {
  const labels: Record<typeof reviewer, string> = {
    procurement_owner: 'Procurement owner',
    legal: 'Legal',
    executive_escalation: 'Executive escalation',
    none: 'No reviewer',
  };

  return labels[reviewer];
}

function AgreementRow({
  row,
  finding,
  selected,
  onSelect,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const missing = row.source.missingFields;

  return (
    <TableRow
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'cursor-pointer transition-colors',
        selected && 'bg-accent hover:bg-accent',
      )}
    >
      <TableCell className="font-medium text-foreground">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'h-8 w-0.5 shrink-0 rounded-full transition-colors',
              selected ? 'bg-primary' : 'bg-transparent',
            )}
          />
          <div className="min-w-0">
            <div className="truncate">{row.supplier}</div>
            <div className="flex items-center gap-1.5">
              <span className="max-w-52 truncate text-xs font-normal text-muted-foreground">
                {row.agreementTitle}
              </span>
              {missing.length > 0 ? (
                <span
                  aria-hidden
                  className="inline-block size-1.5 shrink-0 rounded-full bg-caution"
                  title={`Missing fields: ${missing.join(', ')}`}
                />
              ) : null}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <DataValue value={row.renewalDate} />
      </TableCell>
      <TableCell>
        <DataValue value={row.noticeDeadline} />
      </TableCell>
      <TableCell className="text-right">
        <DaysToNotice days={row.daysUntilNoticeDeadline} />
      </TableCell>
      <TableCell className="text-right">
        <MoneyValue value={row.agreementValue} currency={row.currency} />
      </TableCell>
      <TableCell>
        <RenewalTypeLabel value={row.renewalType} />
      </TableCell>
      <TableCell>
        {finding ? <RiskClassification finding={finding} /> : <NotExtracted />}
      </TableCell>
    </TableRow>
  );
}

function RenewalDetailPanel({
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
  onSubmitDecision: (input: {
    row: RenewalAgreementTableRow;
    finding: RenewalRiskFinding;
    decision: 'approved' | 'edited' | 'rejected';
    selectedAction: FollowUpAction;
    notes: string;
  }) => Promise<void>;
}) {
  const [selectedAction, setSelectedAction] = useState<FollowUpAction>('owner_review');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setSelectedAction(finding?.recommendedAction ?? 'owner_review');
    setNotes('');
  }, [row?.agreementId, finding?.recommendedAction]);

  if (!row) {
    return (
      <aside className="hidden rounded-lg border border-dashed bg-card xl:sticky xl:top-6 xl:block">
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

  const missing = row.source.missingFields;

  return (
    <aside
      className="rounded-lg border bg-card xl:sticky xl:top-6"
      aria-label={`Renewal-risk detail for ${row.supplier}`}
    >
      <div className="border-b px-4 py-4">
        <p className="font-data text-[11px] font-medium uppercase tracking-[0.16em] text-accent-foreground">
          Renewal-risk detail
        </p>
        <h2 className="mt-2 font-display text-xl font-medium leading-tight text-foreground">
          {row.supplier}
        </h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{row.agreementTitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {finding ? <RiskClassification finding={finding} /> : <NotReviewed />}
          {finding ? (
            <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              <ActionValue action={finding.recommendedAction} />
            </span>
          ) : null}
        </div>
      </div>

      {finding ? (
        <div className="border-b px-4 py-4">
          <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Policy rationale
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{finding.rationale}</p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b px-4 py-4">
        <DetailFact label="Renewal date">
          <DataValue value={row.renewalDate} />
        </DetailFact>
        <DetailFact label="Renewal type">
          <RenewalTypeLabel value={row.renewalType} />
        </DetailFact>
        <DetailFact label="Notice period">
          <NoticePeriodValue noticePeriodDays={row.noticePeriodDays} />
        </DetailFact>
        <DetailFact label="Notice deadline">
          <DataValue value={row.noticeDeadline} />
        </DetailFact>
        <DetailFact label="Days to notice">
          <DaysToNotice days={row.daysUntilNoticeDeadline} />
        </DetailFact>
        <DetailFact label="Value">
          <MoneyValue value={row.agreementValue} currency={row.currency} />
        </DetailFact>
      </dl>

      {finding && finding.extractedSignals.length > 0 ? (
        <div className="border-b px-4 py-4">
          <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Extracted signals
          </p>
          <ul className="mt-2 space-y-1.5">
            {finding.extractedSignals.map(signal => (
              <li key={signal} className="flex gap-2 text-sm leading-5 text-foreground">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent-foreground" />
                {signal}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {guidance ? (
        <div className="border-b px-4 py-4">
          <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-accent-foreground">
            Risk Review Agent
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{guidance.judgment}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {guidance.reasonForPriority}
          </p>
          <p className="mt-2 font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {formatSuggestedReviewer(guidance.suggestedReviewer)}
          </p>
        </div>
      ) : null}

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

      <div className="flex flex-col gap-2 px-4 py-4">
        <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Source record
        </p>
        <div className="font-data text-xs leading-5 text-muted-foreground">
          {row.source.recordId ?? row.agreementId}
          {row.source.toolName ? ` · ${row.source.toolName}` : ''}
        </div>
        {row.source.recordUrl ? (
          <a
            href={withDocusignUtmParams(row.source.recordUrl)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-foreground underline-offset-2 hover:underline"
          >
            Open in Docusign
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {missing.length > 0 ? <MissingFieldsChip fields={missing} /> : null}
      </div>
    </aside>
  );
}

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
  onSubmitDecision: (input: {
    row: RenewalAgreementTableRow;
    finding: RenewalRiskFinding;
    decision: 'approved' | 'edited' | 'rejected';
    selectedAction: FollowUpAction;
    notes: string;
  }) => Promise<void>;
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
    <div className="border-b px-4 py-4">
      <p className="font-data text-[11px] font-medium uppercase tracking-[0.12em] text-accent-foreground">
        Human approval
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        Approve the policy recommendation or override it before Workflow Builder acts.
      </p>

      <label className="mt-3 grid gap-1.5 text-xs font-medium text-muted-foreground">
        Override action
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <label className="mt-3 grid gap-1.5 text-xs font-medium text-muted-foreground">
        Reviewer notes
        <textarea
          className="min-h-20 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Add context for the request"
        />
      </label>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Button
          disabled={decisionPending}
          onClick={() => submit('approved', finding.recommendedAction)}
          size="sm"
        >
          {decisionPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Approve
        </Button>
        <Button
          disabled={decisionPending}
          onClick={() => submit('edited', selectedAction)}
          size="sm"
          variant="secondary"
        >
          <Send className="size-4" />
          Override
        </Button>
        <Button
          disabled={decisionPending}
          onClick={() => submit('rejected', 'no_action')}
          size="sm"
          variant="outline"
        >
          Reject
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
    <div className="mt-4 rounded-md border bg-secondary px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {formatActionLabel(result.followUpPlan.action)}
        </p>
        <span className="rounded-full border border-border bg-card px-2 py-0.5 font-data text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
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
      <dt className="font-data text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function NotReviewed() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      Not reviewed
    </span>
  );
}

function RiskClassification({ finding }: { finding: RenewalRiskFinding }) {
  const labels: Record<RenewalRiskFinding['classification'], string> = {
    standard: 'Standard',
    needs_review: 'Needs review',
    urgent: 'Urgent',
    blocked: 'Blocked',
  };

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        finding.classification === 'standard' && 'border-live/30 bg-live-wash text-live',
        finding.classification === 'needs_review' && 'border-caution/30 bg-caution-wash text-caution',
        finding.classification === 'urgent' && 'border-urgent/30 bg-urgent-wash text-urgent',
        finding.classification === 'blocked' && 'border-urgent/40 bg-urgent text-white',
      )}
      title={finding.rationale}
    >
      {labels[finding.classification]}
    </span>
  );
}

function ActionValue({ action }: { action: RenewalRiskFinding['recommendedAction'] }) {
  return <span className="whitespace-nowrap">{formatActionLabel(action)}</span>;
}

function formatActionLabel(action: FollowUpAction) {
  return followUpActionLabels[action];
}

function workflowBuilderStatusLabel(
  status: RenewalDecisionResult['workflowBuilder']['status'],
) {
  const labels: Record<typeof status, string> = {
    not_configured: 'Workflow Builder not configured',
    triggered: 'Workflow Builder started',
    failed: 'Workflow Builder failed',
    skipped: 'Workflow Builder skipped',
  };

  return labels[status];
}

function DataValue({ value }: { value: string | null }) {
  if (!value) {
    return <NotExtracted />;
  }

  return <span className="whitespace-nowrap font-data text-[13px] tabular-nums">{value}</span>;
}

function MoneyValue({ value, currency }: { value: number | null; currency: string }) {
  if (typeof value !== 'number') {
    return <NotExtracted />;
  }

  return (
    <span className="whitespace-nowrap font-data text-[13px] tabular-nums">
      {new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }).format(value)}
    </span>
  );
}

function NoticePeriodValue({ noticePeriodDays }: { noticePeriodDays: number | null }) {
  if (noticePeriodDays === null) {
    return <NotExtracted />;
  }

  return (
    <span className="whitespace-nowrap font-data text-[13px] tabular-nums">
      {noticePeriodDays} days
    </span>
  );
}

function DaysToNotice({ days }: { days: number | null }) {
  if (typeof days !== 'number') {
    return <NotExtracted />;
  }

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 font-data text-xs tabular-nums',
        days <= 14
          ? 'border-urgent/30 bg-urgent-wash text-urgent'
          : days <= 30
            ? 'border-caution/30 bg-caution-wash text-caution'
            : 'border-border bg-secondary text-secondary-foreground',
      )}
    >
      {formatDayCount(days)}
    </span>
  );
}

function RenewalTypeLabel({ value }: { value: RenewalAgreementTableRow['renewalType'] }) {
  const labels: Record<RenewalAgreementTableRow['renewalType'], string> = {
    auto_renews: 'Auto-renews',
    manual_renewal: 'Manual renewal',
    evergreen: 'Evergreen',
    none: 'None',
    not_extracted: 'Not extracted',
  };

  if (value === 'not_extracted') {
    return <NotExtracted />;
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          value === 'auto_renews' && 'bg-urgent',
          value === 'evergreen' && 'bg-caution',
          (value === 'manual_renewal' || value === 'none') && 'bg-input',
        )}
      />
      {labels[value]}
    </span>
  );
}

function MissingFieldsChip({ fields }: { fields: string[] }) {
  return (
    <div
      className="inline-flex whitespace-nowrap rounded-full border border-caution/30 bg-caution-wash px-2 py-0.5 text-xs text-caution"
      title={`Missing fields: ${fields.join(', ')}`}
    >
      {fields.length} {fields.length === 1 ? 'field' : 'fields'} missing
    </div>
  );
}

function NotExtracted() {
  return <span className="text-sm text-muted-foreground">Not extracted</span>;
}

function formatDayCount(days: number) {
  if (days < 0) {
    return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`;
  }

  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
