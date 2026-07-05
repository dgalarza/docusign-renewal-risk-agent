import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renewalAgreementTableRowSchema,
  supplierRenewalAgreementSchema,
  type RenewalAgreementTableRow,
  type SupplierRenewalAgreement,
} from '../src/mastra/domain/schemas';
import {
  classifyRenewalRisk,
  createRenewalRiskBrief,
  mapRenewalRowToAgreement,
  renewalRiskSeverityOrder,
} from '../src/mastra/tools/portfolio-tools';

type AgreementFixture = {
  metadata: {
    asOfDate: string;
    reviewWindowDays: number;
  };
  examples: Array<{
    agreement: SupplierRenewalAgreement;
    expectedFinding: {
      classification: string;
      recommendedAction: string;
      daysUntilNoticeDeadline: number | null;
      keyExtractionSignals: string[];
    };
  }>;
};

const fixture = JSON.parse(
  readFileSync(new URL('../examples/agreement-demo-fixture.json', import.meta.url), 'utf8'),
) as AgreementFixture;

assert.deepEqual(renewalRiskSeverityOrder, {
  standard: 0,
  needs_review: 1,
  urgent: 2,
  blocked: 3,
});

for (const example of fixture.examples) {
  const agreement = supplierRenewalAgreementSchema.parse(example.agreement);
  const finding = classifyRenewalRisk(agreement, fixture.metadata.asOfDate);

  assert.equal(finding.classification, example.expectedFinding.classification, agreement.agreementId);
  assert.equal(finding.recommendedAction, example.expectedFinding.recommendedAction, agreement.agreementId);
  assert.equal(
    finding.daysUntilNoticeDeadline,
    example.expectedFinding.daysUntilNoticeDeadline,
    agreement.agreementId,
  );

  for (const signal of example.expectedFinding.keyExtractionSignals) {
    assert.ok(
      finding.extractedSignals.includes(signal),
      `${agreement.agreementId} missing expected signal: ${signal}`,
    );
  }
}

const fixtureBrief = createRenewalRiskBrief(
  fixture.examples.map(example => supplierRenewalAgreementSchema.parse(example.agreement)),
  {
    asOfDate: fixture.metadata.asOfDate,
    reviewWindowDays: fixture.metadata.reviewWindowDays,
  },
);

assert.equal(fixtureBrief.agreementsReviewed, 5);
assert.deepEqual(
  fixtureBrief.findings.map(finding => finding.classification),
  ['needs_review', 'urgent', 'blocked', 'needs_review', 'needs_review'],
);

const completeAutoRenewalRow = renewalAgreementTableRowSchema.parse({
  agreementId: 'row-derived-deadline',
  supplier: 'Derived Deadline Supplier',
  agreementTitle: 'Derived Deadline Agreement',
  agreementStatus: 'completed',
  renewalDate: '2026-09-29',
  noticePeriodDays: 60,
  noticeDeadline: null,
  daysUntilNoticeDeadline: null,
  agreementValue: 25_000,
  currency: 'USD',
  renewalType: 'auto_renews',
  hasTerminationForConvenience: true,
  terminationFee: 'None after current term',
  businessOwner: 'Procurement Ops',
  source: {
    system: 'docusign_mcp',
    toolName: 'docusign_getAllAgreements',
    recordId: 'row-derived-deadline',
    missingFields: ['noticeDeadline'],
  },
} satisfies RenewalAgreementTableRow);

const mappedAgreement = mapRenewalRowToAgreement(completeAutoRenewalRow);
assert.equal(mappedAgreement.noticeDeadline, '2026-07-31');
assert.equal(classifyRenewalRisk(mappedAgreement, fixture.metadata.asOfDate).classification, 'urgent');

const missingValueRow = renewalAgreementTableRowSchema.parse({
  ...completeAutoRenewalRow,
  agreementId: 'row-missing-value',
  agreementValue: null,
  noticeDeadline: '2026-09-01',
  source: {
    ...completeAutoRenewalRow.source,
    recordId: 'row-missing-value',
    missingFields: ['agreementValue'],
  },
});

const missingValueFinding = classifyRenewalRisk(
  mapRenewalRowToAgreement(missingValueRow),
  fixture.metadata.asOfDate,
);
assert.equal(missingValueFinding.classification, 'needs_review');
assert.equal(missingValueFinding.recommendedAction, 'owner_review');
assert.ok(missingValueFinding.extractedSignals.includes('Agreement value was not extracted.'));

const missingNoticeAndTerminationRow = renewalAgreementTableRowSchema.parse({
  ...completeAutoRenewalRow,
  agreementId: 'row-missing-notice-and-termination',
  agreementValue: 75_000,
  renewalDate: null,
  noticePeriodDays: null,
  noticeDeadline: null,
  hasTerminationForConvenience: null,
  terminationFee: 'Not extracted',
  source: {
    ...completeAutoRenewalRow.source,
    recordId: 'row-missing-notice-and-termination',
    missingFields: [
      'renewalDate',
      'noticePeriodDays',
      'noticeDeadline',
      'hasTerminationForConvenience',
      'terminationFee',
    ],
  },
});

const missingNoticeFinding = classifyRenewalRisk(
  mapRenewalRowToAgreement(missingNoticeAndTerminationRow),
  fixture.metadata.asOfDate,
);
assert.equal(missingNoticeFinding.classification, 'needs_review');
assert.equal(missingNoticeFinding.recommendedAction, 'legal_review');
assert.ok(missingNoticeFinding.extractedSignals.includes('Renewal notice terms were not extracted.'));

const noTerminationForConvenienceRow = renewalAgreementTableRowSchema.parse({
  ...completeAutoRenewalRow,
  agreementId: 'row-no-termination-for-convenience',
  agreementValue: 12_000,
  renewalDate: '2026-10-01',
  noticePeriodDays: 60,
  noticeDeadline: '2026-08-02',
  hasTerminationForConvenience: false,
  source: {
    ...completeAutoRenewalRow.source,
    recordId: 'row-no-termination-for-convenience',
    missingFields: [],
  },
});

const noTerminationFinding = classifyRenewalRisk(
  mapRenewalRowToAgreement(noTerminationForConvenienceRow),
  fixture.metadata.asOfDate,
);
assert.equal(noTerminationFinding.classification, 'needs_review');
assert.equal(noTerminationFinding.recommendedAction, 'legal_review');
assert.ok(noTerminationFinding.extractedSignals.includes('Termination for convenience was not extracted.'));

console.log('Policy engine verification passed.');
