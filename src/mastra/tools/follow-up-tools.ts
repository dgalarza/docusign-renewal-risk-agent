import type { FollowUpPlan, HumanDecision, RenewalRiskFinding } from '../domain/schemas';

export const createFollowUpPlan = (
  finding: RenewalRiskFinding,
  decision: HumanDecision,
): FollowUpPlan => {
  if (decision.decision === 'rejected' || decision.selectedAction === 'no_action') {
    return {
      agreementId: finding.agreementId,
      action: decision.selectedAction,
      status: 'skipped',
      surface: 'Workflow Builder',
      details: `Workflow Builder follow-up skipped because ${decision.reviewer} marked the recommendation as ${decision.decision}.`,
    };
  }

  return {
    agreementId: finding.agreementId,
    action: decision.selectedAction,
    status: 'planned',
    surface: 'Workflow Builder',
    details:
      `Docusign Workflow Builder should start the approved ${decision.selectedAction} follow-up for this renewal-risk action.`,
  };
};
