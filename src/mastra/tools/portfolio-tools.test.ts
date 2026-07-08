import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  renewalAgreementTableRowSchema,
  supplierRenewalAgreementSchema,
  type RenewalAgreementTableRow,
  type SupplierRenewalAgreement,
} from '../domain/schemas';
import {
  classifyRenewalRisk,
  createRenewalRiskBrief,
  mapRenewalRowToAgreement,
  renewalRiskSeverityOrder,
} from './portfolio-tools';

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
  readFileSync(new URL('../../../examples/agreement-demo-fixture.json', import.meta.url), 'utf8'),
) as AgreementFixture;

const completeAutoRenewalRow = renewalAgreementTableRowSchema.parse({
  agreementId: 'row-derived-deadline',
  supplier: 'Derived Deadline Supplier',
  agreementTitle: 'Derived Deadline Agreement',
  renewalDate: '2026-09-29',
  noticePeriodDays: 60,
  noticeDeadline: null,
  daysUntilNoticeDeadline: null,
  agreementValue: 25_000,
  currency: 'USD',
  renewalType: 'auto_renews',
  source: {
    system: 'docusign_mcp',
    toolName: 'docusign_getAllAgreements',
    recordId: 'row-derived-deadline',
    missingFields: ['noticeDeadline'],
  },
} satisfies RenewalAgreementTableRow);

test('documents the renewal risk severity order', () => {
  assert.deepEqual(renewalRiskSeverityOrder, {
    standard: 0,
    needs_review: 1,
    urgent: 2,
    blocked: 3,
  });
});

test('classifies agreement demo fixture examples deterministically', () => {
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
});

test('creates a fixture-backed risk brief', () => {
  const fixtureBrief = createRenewalRiskBrief(
    fixture.examples.map(example => supplierRenewalAgreementSchema.parse(example.agreement)),
    {
      asOfDate: fixture.metadata.asOfDate,
      reviewWindowDays: fixture.metadata.reviewWindowDays,
    },
  );

  assert.equal(fixtureBrief.agreementsReviewed, 6);
  assert.deepEqual(
    fixtureBrief.findings.map(finding => finding.classification),
    ['needs_review', 'urgent', 'blocked', 'standard', 'needs_review', 'urgent'],
  );
});

test('maps discovery rows and derives missing notice deadlines', () => {
  const mappedAgreement = mapRenewalRowToAgreement(completeAutoRenewalRow);

  assert.equal(mappedAgreement.noticeDeadline, '2026-07-31');
  assert.equal(classifyRenewalRisk(mappedAgreement, fixture.metadata.asOfDate).classification, 'urgent');
});

test('treats invalid extracted dates as missing policy inputs', () => {
  const invalidDateRow = renewalAgreementTableRowSchema.parse({
    ...completeAutoRenewalRow,
    agreementId: 'row-invalid-dates',
    renewalDate: 'Not extracted',
    noticeDeadline: 'Pending extraction',
    source: {
      ...completeAutoRenewalRow.source,
      recordId: 'row-invalid-dates',
      missingFields: ['renewalDate', 'noticeDeadline'],
    },
  });

  const mappedAgreement = mapRenewalRowToAgreement(invalidDateRow);
  const finding = classifyRenewalRisk(mappedAgreement, fixture.metadata.asOfDate);

  assert.equal(finding.daysUntilNoticeDeadline, null);
  assert.equal(finding.classification, 'needs_review');
});

test('routes missing agreement value to review when renewal risk is present', () => {
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

  const finding = classifyRenewalRisk(
    mapRenewalRowToAgreement(missingValueRow),
    fixture.metadata.asOfDate,
  );

  assert.equal(finding.classification, 'needs_review');
  assert.equal(finding.recommendedAction, 'owner_review');
  assert.ok(finding.extractedSignals.includes('Agreement value was not extracted.'));
});

test('routes missing notice terms to legal review', () => {
  const missingNoticeRow = renewalAgreementTableRowSchema.parse({
    ...completeAutoRenewalRow,
    agreementId: 'row-missing-notice',
    agreementValue: 75_000,
    renewalDate: null,
    noticePeriodDays: null,
    noticeDeadline: null,
    source: {
      ...completeAutoRenewalRow.source,
      recordId: 'row-missing-notice',
      missingFields: [
        'renewalDate',
        'noticePeriodDays',
        'noticeDeadline',
      ],
    },
  });

  const finding = classifyRenewalRisk(
    mapRenewalRowToAgreement(missingNoticeRow),
    fixture.metadata.asOfDate,
  );

  assert.equal(finding.classification, 'needs_review');
  assert.equal(finding.recommendedAction, 'legal_review');
  assert.ok(finding.extractedSignals.includes('Renewal notice terms were not extracted.'));
});
