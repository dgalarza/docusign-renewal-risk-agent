import type {
  FollowUpAction,
  RenewalAgreementTableRow,
  RenewalDecisionResult,
  RenewalRiskAgentGuidance,
  RenewalRiskFinding,
} from '@/mastra/domain/schemas';
import { cn, normalizeCurrencyCode } from '@/lib/utils';

export const FOLLOW_UP_ACTIONS = [
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

export function formatActionLabel(action: FollowUpAction) {
  return followUpActionLabels[action];
}

export function workflowBuilderStatusLabel(
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

export function formatSuggestedReviewer(
  reviewer: RenewalRiskAgentGuidance['suggestedReviewer'],
) {
  const labels: Record<typeof reviewer, string> = {
    procurement_owner: 'Procurement owner',
    legal: 'Legal',
    executive_escalation: 'Executive escalation',
    none: 'No reviewer',
  };

  return labels[reviewer];
}

export function RiskClassification({ finding }: { finding: RenewalRiskFinding }) {
  const labels: Record<RenewalRiskFinding['classification'], string> = {
    standard: 'Standard',
    needs_review: 'Needs review',
    urgent: 'Urgent',
    blocked: 'Blocked',
  };
  const borderColors: Record<RenewalRiskFinding['classification'], string> = {
    standard: 'var(--live)',
    needs_review: 'var(--caution)',
    urgent: 'var(--urgent)',
    blocked: 'var(--urgent)',
  };

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium',
        finding.classification === 'standard' && 'bg-live-wash text-live',
        finding.classification === 'needs_review' && 'bg-caution-wash text-caution',
        finding.classification === 'urgent' && 'bg-urgent-wash text-urgent',
        finding.classification === 'blocked' && 'bg-urgent-wash text-urgent',
      )}
      style={{ borderColor: borderColors[finding.classification] }}
      title={finding.rationale}
    >
      {labels[finding.classification]}
    </span>
  );
}

export function NotReviewed() {
  return (
    <span
      className="inline-flex items-center rounded-full border bg-accent px-2.5 py-1 text-xs font-medium text-muted-foreground"
      style={{ borderColor: 'var(--muted-foreground)' }}
    >
      Not reviewed
    </span>
  );
}

export function DataValue({ value }: { value: string | null }) {
  if (!value) {
    return <NotExtracted />;
  }

  return <span className="whitespace-nowrap tabular-nums">{value}</span>;
}

export function NoticeDeadlineValue({
  value,
  derived,
}: {
  value: string | null;
  derived?: boolean;
}) {
  if (!value) {
    return <NotExtracted />;
  }

  return (
    <span className="whitespace-nowrap tabular-nums">
      {value}
      {derived ? (
        <span className="ml-1 font-data text-[0.68rem] normal-case text-muted-foreground">
          · derived
        </span>
      ) : null}
    </span>
  );
}

export function MoneyValue({ value, currency }: { value: number | null; currency: string }) {
  if (typeof value !== 'number') {
    return <NotExtracted />;
  }

  return (
    <span className="whitespace-nowrap tabular-nums">
      {new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: normalizeCurrencyCode(currency),
        maximumFractionDigits: 0,
      }).format(value)}
    </span>
  );
}

export function NoticePeriodValue({ noticePeriodDays }: { noticePeriodDays: number | null }) {
  if (noticePeriodDays === null) {
    return <NotExtracted />;
  }

  return (
    <span className="whitespace-nowrap tabular-nums">
      {noticePeriodDays} days
    </span>
  );
}

export function DaysToNotice({ days }: { days: number | null }) {
  if (typeof days !== 'number') {
    return <NotExtracted />;
  }

  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        days <= 14 && 'text-urgent',
        days > 14 && days <= 30 && 'text-caution',
      )}
    >
      {formatDayCount(days)}
    </span>
  );
}

export function RenewalTypeLabel({ value }: { value: RenewalAgreementTableRow['renewalType'] }) {
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

  return <span className="whitespace-nowrap">{labels[value]}</span>;
}

export function NotExtracted() {
  return <span>Not extracted</span>;
}

export function formatDayCount(days: number) {
  if (days < 0) {
    return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`;
  }

  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
