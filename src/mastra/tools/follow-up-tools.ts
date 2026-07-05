import type { FollowUpPlan, HumanDecision, RenewalRiskFinding } from '../domain/schemas';

export const createFollowUpPlan = (
  finding: RenewalRiskFinding,
  decision: HumanDecision,
): FollowUpPlan => {
  if (decision.decision !== 'approved') {
    return {
      agreementId: finding.agreementId,
      action: finding.recommendedAction,
      status: 'skipped',
      surface: 'Workflow Builder',
      details: `Follow-up skipped because ${decision.reviewer} marked the recommendation as ${decision.decision}.`,
    };
  }

  return {
    agreementId: finding.agreementId,
    action: finding.recommendedAction,
    status: 'planned',
    surface: 'Workflow Builder',
    details:
      'Production path should start the configured Docusign Workflow Builder follow-up for this approved renewal-risk action.',
  };
};

