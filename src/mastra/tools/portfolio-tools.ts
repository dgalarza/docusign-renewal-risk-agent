import {
  type RenewalAgreementTableRow,
  type RenewalRiskBrief,
  type RenewalRiskClassification,
  type RenewalRiskFinding,
  type FollowUpAction,
  type SupplierRenewalAgreement,
} from '../domain/schemas';

const HIGH_VALUE_THRESHOLD = 50_000;
const URGENT_NOTICE_WINDOW_DAYS = 30;

export const renewalRiskSeverityOrder = {
  standard: 0,
  needs_review: 1,
  urgent: 2,
  blocked: 3,
} as const satisfies Record<RenewalRiskClassification, number>;

export const createRenewalRiskBrief = (
  agreements: SupplierRenewalAgreement[],
  options: {
    asOfDate: string;
    reviewWindowDays: number;
  },
): RenewalRiskBrief => {
  const findings = agreements
    .filter(agreement => isInReviewWindow(agreement, options.asOfDate, options.reviewWindowDays))
    .map(agreement => classifyRenewalRisk(agreement, options.asOfDate));

  return {
    generatedAt: new Date().toISOString(),
    reviewWindowDays: options.reviewWindowDays,
    agreementsReviewed: findings.length,
    findings,
  };
};

export const classifyRenewalRisk = (
  agreement: SupplierRenewalAgreement,
  asOfDate: string,
): RenewalRiskFinding => {
  const daysUntilNoticeDeadline = agreement.noticeDeadline
    ? dateDiffDays(asOfDate, agreement.noticeDeadline)
    : null;
  const extractedSignals: string[] = [];
  const candidateFindings: PolicyCandidate[] = [];
  const isAutoRenewing = agreement.renewalType === 'auto_renews' || agreement.renewalType === 'evergreen';
  const isHighValue = agreement.agreementValue !== null && agreement.agreementValue >= HIGH_VALUE_THRESHOLD;
  const renewalRiskPresent = isAutoRenewing || agreement.renewalType === 'not_extracted' || agreement.renewalDate !== null;

  if (isAutoRenewing) {
    extractedSignals.push('Agreement auto-renews.');
  }

  if (isHighValue) {
    extractedSignals.push(`Agreement value is at or above ${HIGH_VALUE_THRESHOLD} ${agreement.currency}.`);
  }

  if (agreement.agreementValue === null && renewalRiskPresent) {
    extractedSignals.push('Agreement value was not extracted.');
    candidateFindings.push({
      classification: 'needs_review',
      recommendedAction: 'owner_review',
      rationale:
        'The agreement has renewal exposure, but agreement value is missing from extracted data. Procurement should confirm value before applying renewal policy.',
    });
  }

  if (daysUntilNoticeDeadline !== null && daysUntilNoticeDeadline < 0) {
    extractedSignals.push('Notice deadline has already passed.');
    candidateFindings.push({
      classification: 'blocked',
      recommendedAction: 'escalate_missed_deadline',
      rationale:
        'The cancellation or renewal notice deadline has already passed. Escalate to procurement and legal before accepting any renewal action.',
    });
  }

  if (agreement.renewalDate === null || agreement.noticeDeadline === null || agreement.noticePeriodDays === null) {
    extractedSignals.push('Renewal notice terms were not extracted.');
    candidateFindings.push({
      classification: 'needs_review',
      recommendedAction: 'legal_review',
      rationale:
        'The agreement appears to have renewal exposure, but notice terms are missing from extracted data. Route to legal or procurement for confirmation.',
    });
  }

  if (
    daysUntilNoticeDeadline !== null &&
    daysUntilNoticeDeadline <= URGENT_NOTICE_WINDOW_DAYS &&
    isAutoRenewing
  ) {
    extractedSignals.push(`Notice deadline is within ${URGENT_NOTICE_WINDOW_DAYS} days.`);
    candidateFindings.push({
      classification: 'urgent',
      recommendedAction: 'owner_review',
      rationale:
        'The agreement auto-renews and the notice deadline is close. Confirm owner intent before the cancellation window closes.',
    });
  }

  if (isAutoRenewing && isHighValue) {
    candidateFindings.push({
      classification: 'needs_review',
      recommendedAction: 'owner_review',
      rationale:
        'The agreement auto-renews above the high-value threshold. Procurement should review renewal intent before the next term starts.',
    });
  }

  const selectedFinding = selectHighestSeverity(candidateFindings);

  return {
    agreementId: agreement.agreementId,
    supplierName: agreement.supplierName,
    classification: selectedFinding.classification,
    recommendedAction: selectedFinding.recommendedAction,
    rationale: selectedFinding.rationale,
    daysUntilNoticeDeadline,
    extractedSignals,
  };
};

export const mapRenewalRowToAgreement = (
  row: RenewalAgreementTableRow,
): SupplierRenewalAgreement => ({
  agreementId: row.agreementId,
  supplierName: row.supplier,
  agreementTitle: row.agreementTitle,
  agreementValue: row.agreementValue,
  currency: row.currency,
  renewalType: row.renewalType,
  renewalDate: normalizeIsoDate(row.renewalDate),
  noticePeriodDays: row.noticePeriodDays,
  noticeDeadline:
    normalizeIsoDate(row.noticeDeadline) ??
    deriveNoticeDeadline(row.renewalDate, row.noticePeriodDays),
});

export const mapRenewalRowsToAgreements = (
  rows: RenewalAgreementTableRow[],
): SupplierRenewalAgreement[] => rows.map(mapRenewalRowToAgreement);

// The row schema mirrors what the source system returned; noticeDeadline may
// be derived in code above (deriveNoticeDeadline) when extraction didn't
// produce it directly. This backfills that derived value onto the row itself
// so the UI can show it, instead of showing "Not extracted" while the policy
// finding for the same row already relies on it.
export const enrichRowsWithDerivedNoticeDeadlines = (
  rows: RenewalAgreementTableRow[],
  agreements: SupplierRenewalAgreement[],
  riskBrief: RenewalRiskBrief,
): RenewalAgreementTableRow[] => {
  const agreementsById = new Map(agreements.map(agreement => [agreement.agreementId, agreement]));
  const findingsById = new Map(riskBrief.findings.map(finding => [finding.agreementId, finding]));

  return rows.map(row => {
    if (row.noticeDeadline !== null) {
      return row;
    }

    const derivedNoticeDeadline = agreementsById.get(row.agreementId)?.noticeDeadline ?? null;
    if (derivedNoticeDeadline === null) {
      return row;
    }

    return {
      ...row,
      noticeDeadline: derivedNoticeDeadline,
      daysUntilNoticeDeadline:
        findingsById.get(row.agreementId)?.daysUntilNoticeDeadline ?? row.daysUntilNoticeDeadline,
      noticeDeadlineDerived: true,
    };
  });
};

const isInReviewWindow = (
  agreement: SupplierRenewalAgreement,
  asOfDate: string,
  reviewWindowDays: number,
) => {
  if (!agreement.renewalDate) {
    return true;
  }

  const daysUntilRenewal = dateDiffDays(asOfDate, agreement.renewalDate);
  if (daysUntilRenewal === null) {
    return true;
  }

  return daysUntilRenewal >= 0 && daysUntilRenewal <= reviewWindowDays;
};

const dateDiffDays = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const diff = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);

  return Number.isFinite(diff) ? diff : null;
};

const deriveNoticeDeadline = (
  renewalDate: string | null,
  noticePeriodDays: number | null,
): string | null => {
  const normalizedRenewalDate = normalizeIsoDate(renewalDate);

  if (!normalizedRenewalDate || noticePeriodDays === null) {
    return null;
  }

  const deadline = new Date(`${normalizedRenewalDate}T00:00:00.000Z`);
  deadline.setUTCDate(deadline.getUTCDate() - noticePeriodDays);
  return deadline.toISOString().slice(0, 10);
};

const normalizeIsoDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
};

type PolicyCandidate = {
  classification: RenewalRiskClassification;
  recommendedAction: FollowUpAction;
  rationale: string;
};

const standardFinding = {
  classification: 'standard',
  recommendedAction: 'no_action',
  rationale:
    'Renewal terms are extracted, the notice deadline is not urgent, and no high-risk renewal signal was found.',
} as const satisfies PolicyCandidate;

const selectHighestSeverity = (candidates: PolicyCandidate[]): PolicyCandidate => {
  return candidates.reduce<PolicyCandidate>((highest, candidate) => {
    const highestSeverity = renewalRiskSeverityOrder[highest.classification];
    const candidateSeverity = renewalRiskSeverityOrder[candidate.classification];

    if (candidateSeverity > highestSeverity) {
      return candidate;
    }

    if (
      candidateSeverity === highestSeverity &&
      highest.recommendedAction !== 'legal_review' &&
      candidate.recommendedAction === 'legal_review'
    ) {
      return candidate;
    }

    return highest;
  }, standardFinding);
};
