import assert from 'node:assert/strict';
import test from 'node:test';
import { renewalAgreementTableRowSchema, type RenewalAgreementTableRow } from '../domain/schemas';
import { reconcileRow } from './agreement-reconciliation';
import type { AgreementRecord } from './agreement-record-mapper';

const ASOF_DATE = '2026-07-01';

const buildRow = (overrides: Partial<RenewalAgreementTableRow> = {}): RenewalAgreementTableRow =>
  renewalAgreementTableRowSchema.parse({
    agreementId: 'agreement-1',
    supplier: 'CloudForge Analytics Inc.',
    agreementTitle: 'CloudForge Analytics Inc. - Analytics Platform Subscription Agreement',
    renewalDate: '2026-08-15',
    noticePeriodDays: 30,
    noticeDeadline: null,
    daysUntilNoticeDeadline: null,
    agreementValue: 125_000,
    currency: null,
    renewalType: 'auto_renews',
    source: {
      system: 'docusign_mcp',
      toolName: 'docusign_getAllAgreements',
      recordId: 'agreement-1',
      missingFields: [],
    },
    noticeDeadlineDerived: false,
    ...overrides,
  } satisfies RenewalAgreementTableRow);

test('discards an agent-derived noticeDeadline sourced from renewal_notice_date when the record has no c_NoticeDeadline', () => {
  const row = buildRow({
    // The agent (incorrectly) computed this from provisions.renewal_notice_date.
    noticeDeadline: '2026-07-15',
    daysUntilNoticeDeadline: 14,
    noticeDeadlineDerived: false,
  });
  const record: AgreementRecord = {
    provisions: {
      renewal_type: 'AUTO_RENEW',
      renewal_notice_period: 'P30D',
      renewal_notice_date: '2026-07-15T00:00:00',
      expiration_date: '2026-08-14T00:00:00',
    },
    custom_provisions: {
      c_RenewalType: 'Auto-renews',
      c_RenewalDate: '2026-08-15',
      c_NoticePeriodDays: 30,
      c_AgreementValue: 125_000,
    },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.noticeDeadline, null);
  assert.equal(outcome.row.daysUntilNoticeDeadline, null);
  assert.equal(outcome.row.noticeDeadlineDerived, false);
  assert.ok(outcome.overriddenFields.includes('noticeDeadline'));
  assert.ok(!outcome.filledFields.includes('noticeDeadline'));
});

test('uses custom_provisions.c_NoticeDeadline when the record has it, and recomputes daysUntilNoticeDeadline', () => {
  const row = buildRow({ noticeDeadline: null, daysUntilNoticeDeadline: null });
  const record: AgreementRecord = {
    custom_provisions: { c_NoticeDeadline: '2026-07-16' },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.noticeDeadline, '2026-07-16');
  assert.equal(outcome.row.daysUntilNoticeDeadline, 15);
  assert.equal(outcome.row.noticeDeadlineDerived, false);
  assert.ok(outcome.filledFields.includes('noticeDeadline'));
});

test('coerces an agent-supplied currency of "Not extracted" to null when the record has no currency', () => {
  const row = buildRow({ currency: 'Not extracted' });
  const record: AgreementRecord = {
    provisions: {},
    custom_provisions: {},
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.currency, null);
  assert.ok(outcome.overriddenFields.includes('currency'));
});

test('fills currency from the record when the agent had none', () => {
  const row = buildRow({ currency: null });
  const record: AgreementRecord = {
    custom_provisions: { c_Currency: 'USD' },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.currency, 'USD');
  assert.ok(outcome.filledFields.includes('currency'));
});

test('record renewalType overrides the agent\'s not_extracted', () => {
  const row = buildRow({ renewalType: 'not_extracted' });
  const record: AgreementRecord = {
    custom_provisions: { c_RenewalType: 'Auto-renews' },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.renewalType, 'auto_renews');
  assert.ok(outcome.filledFields.includes('renewalType'));
  assert.ok(!outcome.overriddenFields.includes('renewalType'));
});

test('record renewalType overrides a differing, already-populated agent value', () => {
  const row = buildRow({ renewalType: 'manual_renewal' });
  const record: AgreementRecord = {
    custom_provisions: { c_RenewalType: 'Auto-renews' },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.ok(outcome);
  assert.equal(outcome.row.renewalType, 'auto_renews');
  assert.ok(outcome.overriddenFields.includes('renewalType'));
  assert.ok(!outcome.filledFields.includes('renewalType'));
});

test('keeps the agent\'s agreementValue when the record has no value for it', () => {
  const row = buildRow({ agreementValue: 125_000 });
  const record: AgreementRecord = {
    provisions: {},
    custom_provisions: {},
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  // No record value for agreementValue, and the agent's value survives untouched.
  assert.equal(outcome, null);
});

test('returns null (no changes) when the row already matches the record', () => {
  const row = buildRow({
    renewalType: 'auto_renews',
    renewalDate: '2026-08-15',
    noticePeriodDays: 30,
    agreementValue: 125_000,
    currency: null,
    supplier: 'CloudForge Analytics Inc.',
    agreementTitle: 'CloudForge Analytics Inc. - Analytics Platform Subscription Agreement',
    noticeDeadline: null,
  });
  const record: AgreementRecord = {
    title: 'CloudForge Analytics Inc. - Analytics Platform Subscription Agreement',
    parties: [
      { name_in_agreement: 'Example Buyer Operations Co.' },
      { name_in_agreement: 'CloudForge Analytics Inc.' },
    ],
    provisions: { renewal_type: 'AUTO_RENEW' },
    custom_provisions: {
      c_RenewalType: 'Auto-renews',
      c_RenewalDate: '2026-08-15',
      c_NoticePeriodDays: 30,
      c_AgreementValue: 125_000,
    },
  };

  const outcome = reconcileRow(row, record, ASOF_DATE);

  assert.equal(outcome, null);
});
