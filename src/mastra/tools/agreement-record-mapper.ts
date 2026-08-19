import type { RenewalType } from '../domain/schemas';

// Field-mapping contract lives in docs/agreement-manager-field-mapping.md.
// This module is the single source of truth for turning a raw Agreement
// Manager record (from docusign_getAgreementDetails / docusign_getAllAgreements)
// into normalized renewal fields. It is pure and side-effect free so it can be
// unit tested without an MCP connection; the workflow decides when to call it.

export const DEFAULT_BUYER_PARTY_NAME = 'Example Buyer Operations Co.';

// custom_provisions.c_RenewalType is checked first (it is the extraction
// field Docusign CLI is configured to fill), then provisions.renewal_type as
// a fallback for records extracted before that custom field existed.
const RENEWAL_TYPE_MAP: Record<string, RenewalType> = {
  'auto-renews': 'auto_renews',
  auto_renew: 'auto_renews',
  'manual renewal': 'manual_renewal',
  manual: 'manual_renewal',
  evergreen: 'evergreen',
  'no renewal': 'none',
  none: 'none',
};

// Only PnD is observed in the sandbox (P30D, P45D, ...); other ISO-8601
// duration units are left unmapped rather than guessed at.
const ISO_DURATION_DAYS_PATTERN = /^P(\d+)D$/;

export type AgreementRecordParty = {
  id?: string;
  name_in_agreement?: string;
};

export type AgreementRecordProvisions = {
  renewal_type?: string | null;
  renewal_notice_period?: string | null;
  // Deliberately unused for noticeDeadline: it is a raw extraction field, not
  // the deterministic renewalDate-minus-noticePeriodDays derivation the demo
  // relies on. See docs/agreement-manager-field-mapping.md.
  renewal_notice_date?: string | null;
  renewal_date?: string | null;
  expiration_date?: string | null;
  total_value?: number | null;
  annual_value?: number | null;
  annual_agreement_value?: number | null;
  currency?: string | null;
  currency_code?: string | null;
  annual_agreement_value_currency_code?: string | null;
  [key: string]: unknown;
};

export type AgreementRecordCustomProvisions = {
  c_RenewalType?: string | null;
  c_RenewalDate?: string | null;
  c_NoticePeriodDays?: number | null;
  c_NoticeDeadline?: string | null;
  c_AgreementValue?: number | null;
  c_Currency?: string | null;
  c_SupplierName?: string | null;
  [key: string]: unknown;
};

export type AgreementRecord = {
  title?: string | null;
  parties?: AgreementRecordParty[] | null;
  provisions?: AgreementRecordProvisions | null;
  custom_provisions?: AgreementRecordCustomProvisions | null;
};

export type ReconciledAgreementFields = {
  renewalType: RenewalType;
  renewalDate: string | null;
  noticePeriodDays: number | null;
  agreementValue: number | null;
  currency: string | null;
  supplier: string | null;
  agreementTitle: string | null;
  // The ONLY acceptable source for this field. Never derived from
  // provisions.renewal_notice_date (a raw extraction field for the *current*
  // term's notice date, not the demo's renewalDate-minus-noticePeriodDays
  // deadline) and never from provisions.expiration_date. When Agreement
  // Manager has not extracted a direct deadline, this is null so the
  // deterministic derivation in portfolio-tools.ts applies.
  noticeDeadline: string | null;
};

export const mapAgreementRecordToReconciledFields = (
  record: AgreementRecord,
  options: { buyerPartyName?: string } = {},
): ReconciledAgreementFields => {
  const buyerPartyName = options.buyerPartyName ?? DEFAULT_BUYER_PARTY_NAME;
  const provisions = record.provisions ?? {};
  const customProvisions = record.custom_provisions ?? {};

  return {
    renewalType: mapRenewalType(customProvisions.c_RenewalType, provisions.renewal_type),
    renewalDate:
      normalizeDateOnly(customProvisions.c_RenewalDate) ?? normalizeDateOnly(provisions.renewal_date),
    noticePeriodDays:
      normalizeNumber(customProvisions.c_NoticePeriodDays) ??
      parseIsoDurationDays(provisions.renewal_notice_period),
    agreementValue:
      normalizeNumber(customProvisions.c_AgreementValue) ??
      normalizeNumber(provisions.total_value) ??
      normalizeNumber(provisions.annual_value) ??
      normalizeNumber(provisions.annual_agreement_value),
    currency:
      normalizeString(customProvisions.c_Currency) ??
      normalizeString(provisions.currency) ??
      normalizeString(provisions.currency_code) ??
      normalizeString(provisions.annual_agreement_value_currency_code),
    supplier:
      normalizeString(customProvisions.c_SupplierName) ??
      pickCounterpartyName(record.parties, buyerPartyName),
    agreementTitle: normalizeString(record.title),
    noticeDeadline: normalizeDateOnly(customProvisions.c_NoticeDeadline),
  };
};

const mapRenewalType = (
  customRenewalType: string | null | undefined,
  provisionsRenewalType: string | null | undefined,
): RenewalType =>
  lookupRenewalType(customRenewalType) ?? lookupRenewalType(provisionsRenewalType) ?? 'not_extracted';

const lookupRenewalType = (value: string | null | undefined): RenewalType | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return RENEWAL_TYPE_MAP[value.toLowerCase().trim()];
};

const parseIsoDurationDays = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ISO_DURATION_DAYS_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
};

const normalizeDateOnly = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
};

const NOT_EXTRACTED_SENTINEL = 'not extracted';

const normalizeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Defensive: a raw Agreement Manager field should never literally contain the
// UI sentinel text "Not extracted", but if one ever does (or an upstream
// normalization bug leaks it back in), treat it as no value rather than a
// real string.
const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.toLowerCase() === NOT_EXTRACTED_SENTINEL) {
    return null;
  }

  return trimmed;
};

const pickCounterpartyName = (
  parties: AgreementRecordParty[] | null | undefined,
  buyerPartyName: string,
): string | null => {
  if (!Array.isArray(parties)) {
    return null;
  }

  const counterparty = parties.find(
    party => normalizeString(party?.name_in_agreement) && party.name_in_agreement !== buyerPartyName,
  );

  return counterparty ? normalizeString(counterparty.name_in_agreement) : null;
};
