import {
  type RenewalRiskBrief,
  type RenewalRiskFinding,
  type SupplierRenewalAgreement,
} from '../domain/schemas';

const HIGH_VALUE_THRESHOLD = 50_000;
const URGENT_NOTICE_WINDOW_DAYS = 30;

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

  if (agreement.renewalType === 'auto_renews') {
    extractedSignals.push('Agreement auto-renews.');
  }

  if (agreement.agreementValue >= HIGH_VALUE_THRESHOLD) {
    extractedSignals.push(`Agreement value is at or above ${HIGH_VALUE_THRESHOLD} ${agreement.currency}.`);
  }

  if (daysUntilNoticeDeadline !== null && daysUntilNoticeDeadline < 0) {
    extractedSignals.push('Notice deadline has already passed.');
    return {
      agreementId: agreement.agreementId,
      supplierName: agreement.supplierName,
      classification: 'blocked',
      recommendedAction: 'escalate_missed_deadline',
      rationale:
        'The cancellation or renewal notice deadline has already passed. Escalate to procurement and legal before accepting any renewal action.',
      daysUntilNoticeDeadline,
      extractedSignals,
    };
  }

  if (agreement.noticeDeadline === null || agreement.noticePeriodDays === null) {
    extractedSignals.push('Renewal notice terms were not extracted.');
    return {
      agreementId: agreement.agreementId,
      supplierName: agreement.supplierName,
      classification: 'needs_review',
      recommendedAction: 'legal_review',
      rationale:
        'The agreement appears to have renewal exposure, but notice terms are missing from extracted data. Route to legal or procurement for confirmation.',
      daysUntilNoticeDeadline,
      extractedSignals,
    };
  }

  if (
    daysUntilNoticeDeadline !== null &&
    daysUntilNoticeDeadline <= URGENT_NOTICE_WINDOW_DAYS &&
    agreement.renewalType === 'auto_renews'
  ) {
    extractedSignals.push(`Notice deadline is within ${URGENT_NOTICE_WINDOW_DAYS} days.`);
    return {
      agreementId: agreement.agreementId,
      supplierName: agreement.supplierName,
      classification: 'urgent',
      recommendedAction: 'owner_review',
      rationale:
        'The agreement auto-renews and the notice deadline is close. Confirm owner intent before the cancellation window closes.',
      daysUntilNoticeDeadline,
      extractedSignals,
    };
  }

  if (agreement.hasTerminationForConvenience === false && agreement.agreementValue >= HIGH_VALUE_THRESHOLD) {
    extractedSignals.push('Termination for convenience was not extracted.');
    return {
      agreementId: agreement.agreementId,
      supplierName: agreement.supplierName,
      classification: 'needs_review',
      recommendedAction: 'legal_review',
      rationale:
        'The agreement is high value and lacks extracted termination-for-convenience rights. Legal should review before renewal.',
      daysUntilNoticeDeadline,
      extractedSignals,
    };
  }

  return {
    agreementId: agreement.agreementId,
    supplierName: agreement.supplierName,
    classification: 'standard',
    recommendedAction: 'no_action',
    rationale:
      'Renewal terms are extracted, the notice deadline is not urgent, and no high-risk renewal signal was found.',
    daysUntilNoticeDeadline,
    extractedSignals,
  };
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
  return daysUntilRenewal >= 0 && daysUntilRenewal <= reviewWindowDays;
};

const dateDiffDays = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
};
