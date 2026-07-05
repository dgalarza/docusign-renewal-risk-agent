'use client';

import { AlertCircle, Database, Loader2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RenewalAgreementTableRow, RenewalDiscoveryResult } from '@/mastra/domain/schemas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

type UiStatus = RenewalDiscoveryResult['status'] | 'idle' | 'loading';

const DEFAULT_REVIEW_WINDOW_DAYS = 90;

const statusLabels: Record<UiStatus, string> = {
  idle: 'Ready',
  loading: 'Loading',
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
  const [result, setResult] = useState<RenewalDiscoveryResult | null>(null);
  const [status, setStatus] = useState<UiStatus>('idle');

  const rows = result?.rows ?? [];
  const isLoading = status === 'loading';

  async function discoverRenewals() {
    setStatus('loading');
    setResult(null);

    const query = new URLSearchParams({
      asOfDate,
      reviewWindowDays: String(DEFAULT_REVIEW_WINDOW_DAYS),
    });
    window.history.replaceState({}, '', `/?${query.toString()}`);

    try {
      const response = await fetch(`/api/renewals?${query.toString()}`);
      const payload = (await response.json()) as RenewalDiscoveryResult;

      if (!response.ok) {
        throw new Error(payload.message ?? `Request failed with HTTP ${response.status}`);
      }

      setResult(payload);
      setStatus(payload.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

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
      });
      setStatus('error');
    }
  }

  return (
    <main className="min-h-screen">
      <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase text-primary">
              Intake Agent workflow
            </p>
            <h1 className="text-3xl font-semibold leading-tight text-foreground">
              Docusign renewal discovery
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid gap-2 text-sm font-medium text-muted-foreground">
              As of date
              <Input
                type="date"
                value={asOfDate}
                onChange={event => {
                  setAsOfDate(event.target.value);
                  setResult(null);
                  setStatus('idle');
                }}
              />
            </label>

            <Button className="sm:mb-0" disabled={isLoading} onClick={discoverRenewals}>
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Discover
            </Button>
          </div>
        </header>

        <StatusPanel
          result={result}
          status={status}
          isLoading={isLoading}
        />

        <section className="overflow-hidden rounded-md border bg-card">
          <Table className="min-w-[1120px]">
            <TableHeader className="bg-secondary">
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Agreement title</TableHead>
                <TableHead>Renewal date</TableHead>
                <TableHead>Notice deadline</TableHead>
                <TableHead>Days until notice</TableHead>
                <TableHead>Agreement value</TableHead>
                <TableHead>Renewal type</TableHead>
                <TableHead>Business owner</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? (
                rows.map(row => <AgreementRow key={row.agreementId} row={row} />)
              ) : (
                <TableRow>
                  <TableCell className="h-28 text-center text-muted-foreground" colSpan={9}>
                    {isLoading
                      ? 'Waiting for the Intake Agent workflow...'
                      : 'No renewal agreements to display.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </section>
    </main>
  );
}

function StatusPanel({
  result,
  status,
  isLoading,
}: {
  result: RenewalDiscoveryResult | null;
  status: UiStatus;
  isLoading: boolean;
}) {
  const variant = getAlertVariant(status);
  const sourceLabel = result?.sourceLabel ?? 'Docusign MCP';
  const selectedTool = result?.selectedTool ? `Selected tool: ${result.selectedTool}.` : '';
  const toolCount = result?.availableTools.length
    ? `Available MCP tools: ${result.availableTools.length}.`
    : '';
  const errors = result?.errors.length ? `Errors: ${result.errors.join(' | ')}` : '';
  const message = isLoading
    ? 'Dispatching the Mastra renewal discovery workflow to the Intake Agent.'
    : result?.message ??
      'Docusign MCP selected. No data has been loaded yet.';

  return (
    <Alert variant={variant}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <AlertTitle className="flex items-center gap-2">
            {status === 'error' ? <AlertCircle className="size-4" /> : <Database className="size-4" />}
            {sourceLabel}
          </AlertTitle>
          <AlertDescription>
            {[message, selectedTool, toolCount, errors].filter(Boolean).join(' ')}
          </AlertDescription>
        </div>
        <Badge
          className="w-fit shrink-0"
          variant={
            status === 'error'
              ? 'destructive'
              : status === 'missing_fields'
                ? 'warning'
                : status === 'live'
                  ? 'success'
                  : 'outline'
          }
        >
          {statusLabels[status]}
        </Badge>
      </div>
    </Alert>
  );
}

function AgreementRow({ row }: { row: RenewalAgreementTableRow }) {
  const missing = row.source.missingFields;

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{row.supplier}</TableCell>
      <TableCell>{row.agreementTitle}</TableCell>
      <TableCell>{formatDate(row.renewalDate)}</TableCell>
      <TableCell>{formatDate(row.noticeDeadline)}</TableCell>
      <TableCell>{row.daysUntilNoticeDeadline ?? <Muted>Not extracted</Muted>}</TableCell>
      <TableCell>{formatMoney(row.agreementValue, row.currency)}</TableCell>
      <TableCell>{formatRenewalType(row.renewalType)}</TableCell>
      <TableCell>{row.businessOwner}</TableCell>
      <TableCell>
        <div className="space-y-1">
          <div>Docusign MCP</div>
          <div className="text-xs text-muted-foreground">{row.source.recordId ?? row.agreementId}</div>
          {missing.length > 0 ? (
            <div className="text-xs text-amber-800">Missing: {missing.join(', ')}</div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function getAlertVariant(status: UiStatus) {
  if (status === 'error') {
    return 'destructive';
  }

  if (status === 'missing_fields') {
    return 'warning';
  }

  if (status === 'live') {
    return 'success';
  }

  return 'default';
}

function formatDate(value: string | null) {
  return value ? value : <Muted>Not extracted</Muted>;
}

function formatMoney(value: number | null, currency: string) {
  if (typeof value !== 'number') {
    return <Muted>Not extracted</Muted>;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRenewalType(value: RenewalAgreementTableRow['renewalType']) {
  const labels: Record<RenewalAgreementTableRow['renewalType'], string> = {
    auto_renews: 'Auto-renews',
    manual_renewal: 'Manual renewal',
    evergreen: 'Evergreen',
    none: 'None',
    not_extracted: 'Not extracted',
  };

  return (
    <span className={cn(value === 'not_extracted' && 'text-muted-foreground')}>
      {labels[value]}
    </span>
  );
}
