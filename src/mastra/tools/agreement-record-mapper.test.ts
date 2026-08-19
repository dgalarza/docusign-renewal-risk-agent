import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BUYER_PARTY_NAME,
  mapAgreementRecordToReconciledFields,
  type AgreementRecord,
} from './agreement-record-mapper';

const buyerParty = { id: 'buyer', name_in_agreement: DEFAULT_BUYER_PARTY_NAME };

test('maps custom_provisions.c_RenewalType "Auto-renews" to auto_renews', () => {
  const record: AgreementRecord = {
    title: 'CloudForge Analytics Inc. - Analytics Platform Subscription Agreement',
    parties: [buyerParty, { id: 'supplier', name_in_agreement: 'CloudForge Analytics Inc.' }],
    provisions: { renewal_type: 'AUTO_RENEW' },
    custom_provisions: { c_RenewalType: 'Auto-renews' },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.renewalType, 'auto_renews');
});

test('falls back to provisions.renewal_type AUTO_RENEW when custom_provisions is missing it', () => {
  const record: AgreementRecord = {
    provisions: { renewal_type: 'AUTO_RENEW' },
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.renewalType, 'auto_renews');
});

test('maps "Manual renewal" to manual_renewal', () => {
  const record: AgreementRecord = {
    provisions: { renewal_type: 'FIXED_TERM' },
    custom_provisions: { c_RenewalType: 'Manual renewal' },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  // custom_provisions wins even when provisions.renewal_type has an
  // unmapped value like FIXED_TERM.
  assert.equal(result.renewalType, 'manual_renewal');
});

test('falls back to not_extracted when neither field maps to a known renewal type', () => {
  const record: AgreementRecord = {
    provisions: { renewal_type: 'FIXED_TERM' },
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.renewalType, 'not_extracted');
});

test('parses ISO-8601 P30D duration into 30 notice period days', () => {
  const record: AgreementRecord = {
    provisions: { renewal_notice_period: 'P30D' },
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.noticePeriodDays, 30);
});

test('prefers custom_provisions.c_NoticePeriodDays over the ISO duration fallback', () => {
  const record: AgreementRecord = {
    provisions: { renewal_notice_period: 'P45D' },
    custom_provisions: { c_NoticePeriodDays: 30 },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.noticePeriodDays, 30);
});

test('picks the counterparty (non-buyer) party name as supplier', () => {
  const record: AgreementRecord = {
    parties: [buyerParty, { id: 'supplier', name_in_agreement: 'Brightline Office Supplies LLC' }],
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.supplier, 'Brightline Office Supplies LLC');
});

test('prefers custom_provisions.c_SupplierName over the party list', () => {
  const record: AgreementRecord = {
    parties: [buyerParty, { id: 'supplier', name_in_agreement: 'Brightline Office Supplies LLC' }],
    custom_provisions: { c_SupplierName: 'Brightline Supplies (extracted)' },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.supplier, 'Brightline Supplies (extracted)');
});

test('never maps provisions.renewal_notice_date onto a reconciled field', () => {
  const record: AgreementRecord = {
    provisions: {
      renewal_notice_date: '2026-07-15T00:00:00',
      expiration_date: '2026-08-14T00:00:00',
    },
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  // renewalDate must come from c_RenewalDate / provisions.renewal_date only,
  // never from renewal_notice_date or expiration_date.
  assert.equal(result.renewalDate, null);
  assert.deepEqual(Object.keys(result), [
    'renewalType',
    'renewalDate',
    'noticePeriodDays',
    'agreementValue',
    'currency',
    'supplier',
    'agreementTitle',
  ]);
  assert.ok(!('noticeDeadline' in result));
});

test('uses c_RenewalDate over provisions.renewal_date and never expiration_date', () => {
  const record: AgreementRecord = {
    provisions: {
      renewal_date: '2099-01-01',
      expiration_date: '2026-08-14T00:00:00',
    },
    custom_provisions: { c_RenewalDate: '2026-08-15' },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.renewalDate, '2026-08-15');
});

test('falls back to provisions.annual_agreement_value and its currency code when custom_provisions omits them', () => {
  const record: AgreementRecord = {
    provisions: {
      renewal_type: 'AUTO_RENEW',
      annual_agreement_value: 64000,
      annual_agreement_value_currency_code: 'USD',
    },
    custom_provisions: {},
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.agreementValue, 64000);
  assert.equal(result.currency, 'USD');
});

test('never invents a currency when no source field provides one', () => {
  const record: AgreementRecord = {
    provisions: {},
    custom_provisions: { c_AgreementValue: 125000 },
  };

  const result = mapAgreementRecordToReconciledFields(record);

  assert.equal(result.agreementValue, 125000);
  assert.equal(result.currency, null);
});
