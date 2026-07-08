'use client';

import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  RenewalAgreementTableRow,
  RenewalDecisionResult,
  RenewalReviewWorkflowResult,
  RenewalRiskFinding,
} from '@/mastra/domain/schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LedgerEntry } from '@/components/run-ledger';
import { PipelineOverview, type PipelinePhase } from '@/components/pipeline-overview';
import {
  RenewalDetailPanel,
  type DecisionSubmitInput,
} from '@/components/renewal-detail-panel';
import { RiskReviewPanel } from '@/components/risk-review-panel';
import {
  DataValue,
  formatActionLabel,
  MoneyValue,
  NotReviewed,
  RiskClassification,
  workflowBuilderStatusLabel,
} from '@/components/renewal-values';
import { cn, normalizeCurrencyCode } from '@/lib/utils';

type UiStatus = RenewalReviewWorkflowResult['status'] | 'idle' | 'loading';

/**
 * The workflow's two discovery sources: `docusign_mcp` runs the Intake Agent
 * against live Docusign MCP; `fixture` loads the bundled sample portfolio so
 * the full UI — including risk review, human approval, and the Workflow
 * Builder handoff states — works with no Docusign credentials.
 */
type DiscoverySource = 'docusign_mcp' | 'fixture';

const DEFAULT_REVIEW_WINDOW_DAYS = 120;

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

const sourceDisplayLabels: Record<DiscoverySource, string> = {
  docusign_mcp: 'Docusign MCP',
  fixture: 'Demo fixture',
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
  const [source, setSource] = useState<DiscoverySource>(
    initialParams.get('source') === 'fixture' ? 'fixture' : 'docusign_mcp',
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

  const resetRun = () => {
    setResult(null);
    setStatus('idle');
    setEntries([]);
    setSelectedAgreementId(null);
  };

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
      source,
    });
    window.history.replaceState({}, '', `/?${query.toString()}`);

    const eventSource = new EventSource(`/api/renewals/stream?${query.toString()}`);
    eventSourceRef.current = eventSource;
    let settled = false;

    const settle = () => {
      settled = true;
      eventSource.close();
    };

    eventSource.addEventListener('progress', event => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        kind: string;
        label: string;
        detail: string | null;
      };

      pushEntry(data.kind, data.label, data.detail);
    });

    eventSource.addEventListener('result', event => {
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

    eventSource.addEventListener('failure', event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        message: string;
      };

      applyFailure(payload.message);
      settle();
    });

    eventSource.onerror = () => {
      if (!settled) {
        applyFailure('The progress stream disconnected before the run finished.');
        settle();
      }
    };

    function applyFailure(message: string) {
      setResult({
        status: 'error',
        sourceLabel: sourceDisplayLabels[source],
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

  async function submitDecision(input: DecisionSubmitInput) {
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
    <main className="min-h-screen bg-card">
      <div className="grid min-h-screen w-full bg-card lg:grid-cols-[24rem_minmax(0,1fr)] xl:grid-cols-[28rem_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col border-b bg-secondary/70 lg:border-b-0 lg:border-r">
          <div className="py-7 pl-10 pr-6 sm:pl-14 lg:pl-16">
            <p className="font-data text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Renewal risk · Intake Agent
            </p>
            <h1 className="mt-5 font-display text-[2.85rem] font-medium leading-[0.98] text-foreground">
              Supplier renewal discovery
            </h1>
            <p className="mt-6 text-base leading-7 text-muted-foreground">
              Completed supplier agreements from Docusign Agreement Manager, screened for
              renewal dates inside the next {DEFAULT_REVIEW_WINDOW_DAYS} days.
            </p>

            <div className="mt-8 rounded-2xl border bg-card px-5 py-5">
              <label className="grid gap-2 text-sm font-semibold text-muted-foreground">
                Source
                <select
                  className="h-12 rounded-xl border border-border bg-card px-4 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={source}
                  onChange={event => {
                    setSource(event.target.value as DiscoverySource);
                    resetRun();
                  }}
                >
                  <option value="docusign_mcp">Docusign MCP</option>
                  <option value="fixture">Demo fixture</option>
                </select>
              </label>

              <label className="mt-4 grid gap-2 text-sm font-semibold text-muted-foreground">
                As of date
                <Input
                  className="h-12 rounded-xl border-border bg-card px-4 font-data text-base text-foreground"
                  type="date"
                  value={asOfDate}
                  onChange={event => {
                    setAsOfDate(event.target.value);
                    resetRun();
                  }}
                />
              </label>

              <Button className="mt-4 h-12 w-full justify-center rounded-lg text-base font-semibold shadow-[0_0.5rem_1rem_rgba(67,56,202,0.18)]" disabled={isLoading} onClick={discoverRenewals}>
                {isLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Search className="size-5" />
                )}
                {result ? 'Re-run discovery' : 'Run discovery'}
              </Button>
              <p className="mt-5 text-center font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                Review window · {DEFAULT_REVIEW_WINDOW_DAYS} days
                {source === 'fixture' ? ' · no Docusign credentials needed' : ''}
              </p>
            </div>
          </div>

        </aside>

        <section className="min-w-0 overflow-y-auto px-6 py-7 sm:px-10 lg:px-12">
          <div className="flex flex-col gap-7">
            <PipelineOverview
              phase={toPipelinePhase(status)}
              activeStage={activeStage}
              entries={entries}
            />

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

            {status !== 'idle' && status !== 'loading' ? (
              <ResultBar result={result} status={status} source={source} />
            ) : null}

            {rows.length > 0 ? <SummaryStrip rows={rows} riskBrief={result?.riskBrief ?? null} /> : null}
            {result?.riskReview ? (
              <RiskReviewPanel
                rows={rows}
                riskBrief={result.riskBrief}
                riskReview={result.riskReview}
              />
            ) : null}

            {rows.length > 0 ? (
              <AgreementList
                rows={rows}
                riskBrief={result?.riskBrief ?? null}
                riskReview={result?.riskReview ?? null}
                selectedAgreementId={selectedAgreementId}
                decisionResults={decisionResults}
                decisionError={decisionError}
                decisionLoadingId={decisionLoadingId}
                onSelect={agreementId => {
                  setDecisionError(null);
                  setSelectedAgreementId(current =>
                    current === agreementId ? null : agreementId,
                  );
                }}
                onSubmitDecision={submitDecision}
              />
            ) : status !== 'idle' && status !== 'loading' ? (
              <EmptyState
                status={status}
                source={source}
                isLoading={isLoading}
                onRun={discoverRenewals}
              />
            ) : null}
          </div>
        </section>
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

function EmptyState({
  status,
  source,
  isLoading,
  onRun,
}: {
  status: UiStatus;
  source: DiscoverySource;
  isLoading: boolean;
  onRun: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-secondary/60">
      <div className="border-b bg-card px-6 py-4">
        <span className="font-data text-xs uppercase tracking-[0.08em] text-muted-foreground">
          {sourceDisplayLabels[source]} · {status === 'idle' ? 'No run recorded yet for this date' : statusLabels[status]}
        </span>
      </div>
      <div className="flex min-h-72 flex-col items-center justify-center gap-5 px-8 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border bg-card">
          {isLoading ? (
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          ) : (
            <Search className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <p className="max-w-xl text-base leading-7 text-muted-foreground">
          {emptyStateMessage(status)}
        </p>
        {status === 'idle' || status === 'empty' ? (
          <Button className="rounded-lg" disabled={isLoading} onClick={onRun}>
            <Search className="size-4" />
            Run discovery
          </Button>
        ) : null}
      </div>
    </section>
  );
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

function ResultBar({
  result,
  status,
  source,
}: {
  result: RenewalReviewWorkflowResult | null;
  status: UiStatus;
  source: DiscoverySource;
}) {
  const sourceLabel = result?.sourceLabel ?? sourceDisplayLabels[source];
  const message =
    status === 'loading'
      ? source === 'fixture'
        ? 'The workflow is loading the bundled sample portfolio.'
        : 'The Intake Agent is querying Agreement Manager through Docusign MCP.'
      : status === 'idle'
        ? 'No run recorded yet for this date.'
        : status === 'error'
          ? null
          : result?.message ?? null;

  if (status === 'error') {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="font-data text-xs uppercase tracking-[0.06em] text-muted-foreground">
          {sourceLabel}
          {result?.selectedTool ? ` · ${formatToolName(result.selectedTool)}` : ''}
        </div>
        {message ? (
          <p className="mt-3 text-sm leading-6 text-foreground">{message}</p>
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
        'w-fit shrink-0 rounded-full border px-3 py-1 font-data text-[0.68rem] font-medium uppercase tracking-[0.04em]',
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
  const portfolioCurrency = normalizeCurrencyCode(valuedRows[0]?.currency);
  const urgentOrBlocked =
    riskBrief?.findings.filter(
      finding => finding.classification === 'urgent' || finding.classification === 'blocked',
    ).length ?? 0;
  const legalReviews =
    riskBrief?.findings.filter(finding => finding.recommendedAction === 'legal_review').length ?? 0;

  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
    <div className="rounded-2xl border bg-card px-5 py-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-3 font-display text-[2.35rem] font-medium leading-none text-foreground">
        {value}
      </dd>
      {detail ? <p className="m-0 mt-2 truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function AgreementList({
  rows,
  riskBrief,
  riskReview,
  selectedAgreementId,
  decisionResults,
  decisionError,
  decisionLoadingId,
  onSelect,
  onSubmitDecision,
}: {
  rows: RenewalAgreementTableRow[];
  riskBrief: RenewalReviewWorkflowResult['riskBrief'];
  riskReview: RenewalReviewWorkflowResult['riskReview'];
  selectedAgreementId: string | null;
  decisionResults: Record<string, RenewalDecisionResult>;
  decisionError: string | null;
  decisionLoadingId: string | null;
  onSelect: (agreementId: string) => void;
  onSubmitDecision: (input: DecisionSubmitInput) => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(7rem,0.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_2rem] gap-3 border-b bg-secondary/70 px-5 py-4 sm:grid">
        <span className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
          Supplier
        </span>
        <span className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
          Status
        </span>
        <span className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
          Renewal date
        </span>
        <span className="font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
          Notice deadline
        </span>
        <span aria-hidden />
      </div>

      {rows.map(row => {
        const finding =
          riskBrief?.findings.find(riskFinding => riskFinding.agreementId === row.agreementId) ??
          null;
        const guidance =
          riskReview?.reviewerGuidance.find(
            reviewerGuidance => reviewerGuidance.agreementId === row.agreementId,
          ) ?? null;
        const expanded = row.agreementId === selectedAgreementId;

        return (
          <div key={row.agreementId} className="border-b last:border-b-0">
            <AgreementSummaryRow
              row={row}
              finding={finding}
              expanded={expanded}
              onSelect={() => onSelect(row.agreementId)}
            />
            {expanded ? (
              <RenewalDetailPanel
                row={row}
                finding={finding}
                guidance={guidance}
                decisionResult={decisionResults[row.agreementId] ?? null}
                decisionError={decisionError}
                decisionPending={row.agreementId === decisionLoadingId}
                onSubmitDecision={onSubmitDecision}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function AgreementSummaryRow({
  row,
  finding,
  expanded,
  onSelect,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding | null;
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
        'grid w-full grid-cols-1 gap-3 px-5 py-4 text-left transition-colors sm:grid-cols-[minmax(0,2fr)_minmax(7rem,0.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_2rem]',
        expanded ? 'bg-accent shadow-[inset_0.25rem_0_0_var(--primary)]' : 'bg-card hover:bg-secondary/50',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center">
          <span className="truncate text-sm font-semibold text-foreground">{row.supplier}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{row.agreementTitle}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
          <MoneyValue value={row.agreementValue} currency={row.currency} />
        </div>
      </div>
      <div className="self-center">
        <span className="mb-1 block font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
          Status
        </span>
        {finding ? <RiskClassification finding={finding} /> : <NotReviewed />}
      </div>
      <div className="self-center">
        <span className="mb-1 block font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
          Renewal date
        </span>
        <DataValue value={row.renewalDate} />
      </div>
      <div className="self-center">
        <span className="mb-1 block font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
          Notice deadline
        </span>
        <DataValue value={row.noticeDeadline} />
      </div>
      <span className="hidden items-center justify-center self-center text-muted-foreground sm:flex">
        <Chevron className="size-4" aria-hidden />
      </span>
    </button>
  );
}

function formatToolName(toolName: string) {
  if (toolName === 'docusign_getAllAgreements') {
    return 'Agreement discovery';
  }

  return toolName;
}
