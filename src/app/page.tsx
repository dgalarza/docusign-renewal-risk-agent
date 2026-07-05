'use client';

import { AlertCircle, Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  RenewalAgreementTableRow,
  RenewalReviewWorkflowResult,
  RenewalRiskFinding,
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
import { cn } from '@/lib/utils';

type UiStatus = RenewalReviewWorkflowResult['status'] | 'idle' | 'loading';

const DEFAULT_REVIEW_WINDOW_DAYS = 90;

const statusLabels: Record<UiStatus, string> = {
  idle: 'Ready',
  loading: 'Running',
  live: 'Live',
  empty: 'Empty',
  missing_fields: 'Missing fields',
  error: 'Error',
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
  const entryIdRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  const rows = result?.rows ?? [];
  const isLoading = status === 'loading';

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
      });
      setStatus('error');
      pushEntry('error', 'Run failed', message);
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

          <section className="overflow-x-auto rounded-lg border bg-card">
            <Table className="min-w-[1480px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Supplier</TableHead>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Renewal date</TableHead>
                  <TableHead>Notice period</TableHead>
                  <TableHead>Notice deadline</TableHead>
                  <TableHead className="text-right">Days to notice</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Renewal type</TableHead>
                  <TableHead>Termination right</TableHead>
                  <TableHead>Termination fee</TableHead>
                  <TableHead>Business owner</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Recommended action</TableHead>
                  <TableHead>Source record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? (
                  rows.map(row => (
                    <AgreementRow
                      key={row.agreementId}
                      row={row}
                      finding={result?.riskBrief?.findings.find(
                        riskFinding => riskFinding.agreementId === row.agreementId,
                      ) ?? null}
                    />
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="h-32 text-center text-sm text-muted-foreground" colSpan={15}>
                      {emptyStateMessage(status)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
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

function AgreementRow({
  row,
  finding,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding | null;
}) {
  const missing = row.source.missingFields;

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{row.supplier}</TableCell>
      <TableCell className="text-muted-foreground">{row.agreementTitle}</TableCell>
      <TableCell>
        <StatusValue status={row.agreementStatus} />
      </TableCell>
      <TableCell>
        <DataValue value={row.renewalDate} />
      </TableCell>
      <TableCell>
        <NoticePeriodValue noticePeriodDays={row.noticePeriodDays} />
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
        <TerminationRightValue value={row.hasTerminationForConvenience} />
      </TableCell>
      <TableCell>
        <ExtractedText value={row.terminationFee} />
      </TableCell>
      <TableCell>{row.businessOwner}</TableCell>
      <TableCell>
        {finding ? <RiskClassification finding={finding} /> : <NotExtracted />}
      </TableCell>
      <TableCell>
        {finding ? <ActionValue action={finding.recommendedAction} /> : <NotExtracted />}
      </TableCell>
      <TableCell>
        <div className="space-y-1.5">
          <div className="max-w-40 truncate font-data text-xs text-muted-foreground">
            {row.source.recordId ?? row.agreementId}
          </div>
          {missing.length > 0 ? <MissingFieldsChip fields={missing} /> : null}
        </div>
      </TableCell>
    </TableRow>
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
  const labels: Record<RenewalRiskFinding['recommendedAction'], string> = {
    no_action: 'No action',
    owner_review: 'Owner review',
    legal_review: 'Legal review',
    renegotiate: 'Renegotiate',
    prepare_cancellation_notice: 'Prepare cancellation',
    escalate_missed_deadline: 'Escalate missed deadline',
  };

  return <span className="whitespace-nowrap">{labels[action]}</span>;
}

function StatusValue({ status }: { status: RenewalAgreementTableRow['agreementStatus'] }) {
  if (!status) {
    return <NotExtracted />;
  }

  return status === 'uploaded_historical' ? 'Uploaded historical' : 'Completed';
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

function TerminationRightValue({ value }: { value: boolean | null }) {
  if (value === null) {
    return <NotExtracted />;
  }

  return value ? 'Yes' : 'No';
}

function ExtractedText({ value }: { value: string }) {
  return value === 'Not extracted' ? <NotExtracted /> : value;
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
