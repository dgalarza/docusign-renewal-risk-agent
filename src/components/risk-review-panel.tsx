import type {
  FollowUpAction,
  RenewalAgreementTableRow,
  RenewalReviewWorkflowResult,
  RenewalRiskAgentGuidance,
  RenewalRiskFinding,
} from '@/mastra/domain/schemas';
import {
  formatSuggestedReviewer,
  RiskClassification,
} from '@/components/renewal-values';
import { normalizeCurrencyCode } from '@/lib/utils';

export function RiskReviewPanel({
  rows,
  riskBrief,
  riskReview,
}: {
  rows: RenewalAgreementTableRow[];
  riskBrief: RenewalReviewWorkflowResult['riskBrief'];
  riskReview: NonNullable<RenewalReviewWorkflowResult['riskReview']>;
}) {
  const supplierByAgreementId = new Map(rows.map(row => [row.agreementId, row.supplier]));
  const rowByAgreementId = new Map(rows.map(row => [row.agreementId, row]));
  const findingByAgreementId = new Map(
    riskBrief?.findings.map(finding => [finding.agreementId, finding]) ?? [],
  );
  const guidanceByAgreementId = new Map(
    riskReview.reviewerGuidance.map(guidance => [guidance.agreementId, guidance]),
  );
  const priorityGuidance = riskReview.priorityAgreementIds
    .map(agreementId => guidanceByAgreementId.get(agreementId))
    .filter(guidance => guidance !== undefined);
  const displayedGuidance =
    priorityGuidance.length > 0 ? priorityGuidance.slice(0, 3) : riskReview.reviewerGuidance.slice(0, 3);

  return (
    <section className="rounded-2xl border bg-card px-6 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1fr)]">
        <div className="flex flex-col justify-between gap-5">
          <div>
            <p className="font-data text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              Review summary
            </p>
            <h2 className="mt-3 text-lg font-semibold leading-7 text-foreground">
              {riskReview.portfolioJudgment}
            </h2>
          </div>
          {displayedGuidance.length > 0 ? (
            <ul className="grid gap-2 text-sm leading-6 text-foreground">
              {displayedGuidance.map(guidance => {
                const row = rowByAgreementId.get(guidance.agreementId);
                const finding = findingByAgreementId.get(guidance.agreementId);

                return (
                  <li key={guidance.agreementId}>
                    {formatPriorityActionSummary({ guidance, finding, row })}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <div className="border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="font-data text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Recommended next actions
          </p>
          <div className="mt-4 grid gap-3">
            {displayedGuidance.map(guidance => {
              const finding = findingByAgreementId.get(guidance.agreementId);

              return (
                <div key={guidance.agreementId} className="rounded-xl border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {supplierByAgreementId.get(guidance.agreementId) ?? guidance.agreementId}
                    </span>
                    {finding ? <RiskClassification finding={finding} /> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {guidance.reasonForPriority || guidance.judgment}
                  </p>
                  <p className="mt-2 font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                    {formatSuggestedReviewer(guidance.suggestedReviewer)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatPriorityActionSummary({
  guidance,
  finding,
  row,
}: {
  guidance: RenewalRiskAgentGuidance;
  finding: RenewalRiskFinding | undefined;
  row: RenewalAgreementTableRow | undefined;
}) {
  const supplier = row?.supplier ?? finding?.supplierName ?? guidance.agreementId;
  const reason = formatPriorityReason({ guidance, finding, row });
  const action = formatPriorityAction(finding?.recommendedAction);

  return `${supplier} — ${reason} → ${action}`;
}

function formatPriorityReason({
  guidance,
  finding,
  row,
}: {
  guidance: RenewalRiskAgentGuidance;
  finding: RenewalRiskFinding | undefined;
  row: RenewalAgreementTableRow | undefined;
}) {
  const parts: string[] = [];
  const daysUntilNotice = finding?.daysUntilNoticeDeadline ?? row?.daysUntilNoticeDeadline;

  if (typeof daysUntilNotice === 'number') {
    parts.push(formatNoticeTiming(daysUntilNotice));
  }

  if (typeof row?.agreementValue === 'number') {
    parts.push(formatCompactMoney(row.agreementValue, row.currency));
  }

  if (row?.renewalType === 'auto_renews') {
    parts.push('auto-renew');
  }

  if (row?.source.missingFields.length) {
    parts.push('missing fields');
  }

  return parts.length > 0 ? parts.join(', ') : guidance.reasonForPriority || guidance.judgment;
}

function formatNoticeTiming(daysUntilNotice: number) {
  const absoluteDays = Math.abs(daysUntilNotice);
  const unit = absoluteDays === 1 ? 'day' : 'days';

  if (daysUntilNotice < 0) {
    return `${absoluteDays} ${unit} overdue`;
  }

  if (daysUntilNotice === 0) {
    return 'due today';
  }

  return `${daysUntilNotice} ${unit} to notice`;
}

function formatCompactMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizeCurrencyCode(currency),
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(value)
    .replace('K', 'k');
}

function formatPriorityAction(action: FollowUpAction | undefined) {
  const labels: Record<FollowUpAction, string> = {
    no_action: 'no action',
    owner_review: 'owner review',
    legal_review: 'send to legal',
    renegotiate: 'renegotiate',
    prepare_cancellation_notice: 'prepare cancellation',
    escalate_missed_deadline: 'escalate now',
  };

  return action ? labels[action] : 'review';
}
