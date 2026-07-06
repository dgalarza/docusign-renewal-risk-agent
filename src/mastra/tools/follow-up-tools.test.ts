import assert from 'node:assert/strict';
import test from 'node:test';
import type { HumanDecision, RenewalRiskFinding } from '../domain/schemas';
import { createFollowUpPlan } from './follow-up-tools';
import { createWorkflowBuilderHandoff } from './workflow-builder-tools';

const finding: RenewalRiskFinding = {
  agreementId: 'demo-clearview-005',
  supplierName: 'Clearview Inventory Platform LLC',
  classification: 'needs_review',
  recommendedAction: 'legal_review',
  rationale: 'Notice terms are missing.',
  daysUntilNoticeDeadline: null,
  extractedSignals: ['Renewal notice terms were not extracted.'],
};

const approvedDecision: HumanDecision = {
  agreementId: finding.agreementId,
  decision: 'approved',
  selectedAction: 'legal_review',
  reviewer: 'Demo Reviewer',
  notes: 'Please review missing renewal notice terms.',
  decidedAt: '2026-07-06T03:30:00.000Z',
};

test('creates planned Workflow Builder follow-up for approved action', () => {
  const plan = createFollowUpPlan(finding, approvedDecision);

  assert.equal(plan.agreementId, finding.agreementId);
  assert.equal(plan.action, 'legal_review');
  assert.equal(plan.status, 'planned');
  assert.equal(plan.surface, 'Workflow Builder');
});

test('uses the human override action for edited decisions', () => {
  const plan = createFollowUpPlan(finding, {
    ...approvedDecision,
    decision: 'edited',
    selectedAction: 'owner_review',
  });

  assert.equal(plan.action, 'owner_review');
  assert.equal(plan.status, 'planned');
});

test('skips Workflow Builder follow-up for rejected decisions', () => {
  const plan = createFollowUpPlan(finding, {
    ...approvedDecision,
    decision: 'rejected',
    selectedAction: 'no_action',
  });

  assert.equal(plan.action, 'no_action');
  assert.equal(plan.status, 'skipped');
});

test('reports Workflow Builder as not configured without env', async () => {
  const originalWorkflowId = process.env.DOCUSIGN_WORKFLOW_ID;
  const originalAccountId = process.env.DOCUSIGN_ACCOUNT_ID;
  delete process.env.DOCUSIGN_WORKFLOW_ID;
  delete process.env.DOCUSIGN_ACCOUNT_ID;

  try {
    const plan = createFollowUpPlan(finding, approvedDecision);
    const handoff = await createWorkflowBuilderHandoff({
      row: {
        agreementId: finding.agreementId,
        supplier: finding.supplierName,
        agreementTitle: 'Inventory Analytics Subscription Agreement',
        renewalDate: null,
        noticePeriodDays: null,
        noticeDeadline: null,
        daysUntilNoticeDeadline: null,
        agreementValue: 64_000,
        currency: 'USD',
        renewalType: 'auto_renews',
        source: {
          system: 'fixture',
          recordId: finding.agreementId,
          missingFields: ['renewalDate', 'noticePeriodDays', 'noticeDeadline'],
        },
      },
      finding,
      decision: approvedDecision,
      followUpPlan: plan,
    });

    assert.equal(handoff.status, 'not_configured');
    assert.equal(handoff.triggerPayload, null);
  } finally {
    process.env.DOCUSIGN_WORKFLOW_ID = originalWorkflowId;
    process.env.DOCUSIGN_ACCOUNT_ID = originalAccountId;
  }
});
