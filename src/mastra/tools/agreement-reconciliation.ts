import type { RenewalAgreementTableRow, RenewalType } from '../domain/schemas';
import { docusignMcpClient } from '../mcp/docusign-mcp-client';
import { executeMcpTool, parseMcpTextPayload } from '../mcp/mcp-tool-utils';
import {
  DEFAULT_BUYER_PARTY_NAME,
  mapAgreementRecordToReconciledFields,
  type AgreementRecord,
  type ReconciledAgreementFields,
} from './agreement-record-mapper';

const GET_AGREEMENT_DETAILS_TOOL = 'docusign_getAgreementDetails';
const GET_USER_INFO_TOOL = 'docusign_getUserInfo';
const MAX_RECONCILIATION_CALLS = 25;
const NOT_EXTRACTED_TEXT = 'Not extracted';

const TRACKED_FIELDS = [
  'renewalType',
  'renewalDate',
  'noticePeriodDays',
  'noticeDeadline',
  'agreementValue',
  'currency',
  'supplier',
  'agreementTitle',
] as const;

export type ReconciliationOutcome = {
  rows: RenewalAgreementTableRow[];
  reconciledRowCount: number;
  filledRowCount: number;
  correctedRowCount: number;
};

// Deterministic backstop for Intake Agent nondeterminism. For every row the
// agent returned, fetch the Agreement Manager record directly (outside any
// agent, same pattern as workflow-builder-tools.ts) and reconcile: the
// record always wins when it has a value (the agent's value is only kept
// when the record has none). This runs after the Intake Agent, never in
// fixture mode, and is bounded so a large discovery result can't fan out
// into an unbounded number of MCP calls.
export const reconcileRowsAgainstAgreementManager = async ({
  rows,
  asOfDate,
  accountId,
  onRowError,
}: {
  rows: RenewalAgreementTableRow[];
  asOfDate: string;
  accountId?: string;
  onRowError?: (agreementId: string, error: unknown) => void;
}): Promise<ReconciliationOutcome> => {
  const candidateRows = rows.filter(row => row.agreementId).slice(0, MAX_RECONCILIATION_CALLS);

  if (candidateRows.length === 0) {
    return { rows, reconciledRowCount: 0, filledRowCount: 0, correctedRowCount: 0 };
  }

  try {
    const { tools } = await docusignMcpClient.listToolsWithErrors();
    const detailsTool = tools[GET_AGREEMENT_DETAILS_TOOL];

    if (!detailsTool) {
      return { rows, reconciledRowCount: 0, filledRowCount: 0, correctedRowCount: 0 };
    }

    const resolvedAccountId = accountId ?? (await resolveDefaultAccountId(tools[GET_USER_INFO_TOOL]));

    if (!resolvedAccountId) {
      return { rows, reconciledRowCount: 0, filledRowCount: 0, correctedRowCount: 0 };
    }

    const reconciledById = new Map<string, RenewalAgreementTableRow>();
    let filledRowCount = 0;
    let correctedRowCount = 0;

    for (const row of candidateRows) {
      try {
        const response = await executeMcpTool(detailsTool, {
          accountId: resolvedAccountId,
          agreementId: row.agreementId,
        });
        const record = parseMcpTextPayload(response) as AgreementRecord | null;

        if (!record) {
          continue;
        }

        const outcome = reconcileRow(row, record, asOfDate);

        if (!outcome) {
          continue;
        }

        reconciledById.set(row.agreementId, outcome.row);

        if (outcome.overriddenFields.length > 0) {
          correctedRowCount += 1;
        } else {
          filledRowCount += 1;
        }
      } catch (error) {
        onRowError?.(row.agreementId, error);
      }
    }

    const nextRows = rows.map(row => reconciledById.get(row.agreementId) ?? row);

    return {
      rows: nextRows,
      reconciledRowCount: reconciledById.size,
      filledRowCount,
      correctedRowCount,
    };
  } finally {
    await docusignMcpClient.disconnect();
  }
};

type FieldChange<T> = { value: T; type: 'fill' | 'override' } | null;

// Record wins whenever it has a value; the agent's value survives only when
// the record has none for that field.
const resolveField = <T>(
  current: T,
  mapped: T | null,
  isMissing: (value: T) => boolean,
): FieldChange<T> => {
  if (mapped === null || current === mapped) {
    return null;
  }

  return { value: mapped, type: isMissing(current) ? 'fill' : 'override' };
};

const isMissingText = (value: string) => value.trim().length === 0 || value === NOT_EXTRACTED_TEXT;

export type ReconcileRowOutcome = {
  row: RenewalAgreementTableRow;
  filledFields: string[];
  overriddenFields: string[];
} | null;

// Exported for direct unit testing (no MCP connection needed): the record
// vs. row merge is the semantically interesting part of reconciliation, and
// the batching/MCP-fetch logic around it in
// reconcileRowsAgainstAgreementManager is thin enough to not need its own
// mocked-MCP test coverage.
export const reconcileRow = (
  row: RenewalAgreementTableRow,
  record: AgreementRecord,
  asOfDate: string,
): ReconcileRowOutcome => {
  const mapped = mapAgreementRecordToReconciledFields(record, {
    buyerPartyName: DEFAULT_BUYER_PARTY_NAME,
  });
  const filledFields: string[] = [];
  const overriddenFields: string[] = [];
  const next: RenewalAgreementTableRow = { ...row };

  const track = (field: string, type: 'fill' | 'override') => {
    (type === 'fill' ? filledFields : overriddenFields).push(field);
  };

  const renewalTypeChange = resolveField<RenewalType | null>(
    row.renewalType,
    mapped.renewalType === 'not_extracted' ? null : mapped.renewalType,
    value => value === 'not_extracted',
  );
  if (renewalTypeChange) {
    next.renewalType = renewalTypeChange.value as RenewalType;
    track('renewalType', renewalTypeChange.type);
  }

  applySimpleField('renewalDate', row.renewalDate, mapped.renewalDate, value => value === null, next, track);
  applySimpleField(
    'noticePeriodDays',
    row.noticePeriodDays,
    mapped.noticePeriodDays,
    value => value === null,
    next,
    track,
  );
  applySimpleField(
    'agreementValue',
    row.agreementValue,
    mapped.agreementValue,
    value => value === null,
    next,
    track,
  );
  applySimpleField('supplier', row.supplier, mapped.supplier, isMissingText, next, track);
  applySimpleField('agreementTitle', row.agreementTitle, mapped.agreementTitle, isMissingText, next, track);

  reconcileCurrency(row, mapped, next, track);
  reconcileNoticeDeadline(row, mapped, next, asOfDate, track);

  if (filledFields.length === 0 && overriddenFields.length === 0) {
    return null;
  }

  const untouchedMissing = row.source.missingFields.filter(
    field => !TRACKED_FIELDS.includes(field as (typeof TRACKED_FIELDS)[number]),
  );
  const stillMissing = TRACKED_FIELDS.filter(field => isFieldMissing(field, next));

  return {
    row: {
      ...next,
      source: {
        ...row.source,
        missingFields: [...untouchedMissing, ...stillMissing],
        reconciledFields: [...(row.source.reconciledFields ?? []), ...filledFields],
        overriddenFields: [...(row.source.overriddenFields ?? []), ...overriddenFields],
      },
    },
    filledFields,
    overriddenFields,
  };
};

const applySimpleField = <T>(
  field: (typeof TRACKED_FIELDS)[number],
  current: T,
  mapped: T | null,
  isMissing: (value: T) => boolean,
  next: RenewalAgreementTableRow,
  track: (field: string, type: 'fill' | 'override') => void,
) => {
  const change = resolveField(current, mapped, isMissing);

  if (change) {
    (next as unknown as Record<string, unknown>)[field] = change.value;
    track(field, change.type);
  }
};

// Currency gets one extra defensive rule on top of record-wins: the literal
// sentinel string "Not extracted" must never persist as a currency value now
// that the field is nullable — coerce it to null even when the record has no
// currency of its own, since the demo must never guess a currency code.
const reconcileCurrency = (
  row: RenewalAgreementTableRow,
  mapped: ReconciledAgreementFields,
  next: RenewalAgreementTableRow,
  track: (field: string, type: 'fill' | 'override') => void,
) => {
  const currentMissing = row.currency === null || row.currency === NOT_EXTRACTED_TEXT;

  if (mapped.currency !== null) {
    if (row.currency !== mapped.currency) {
      next.currency = mapped.currency;
      track('currency', currentMissing ? 'fill' : 'override');
    }
    return;
  }

  if (row.currency === NOT_EXTRACTED_TEXT) {
    next.currency = null;
    track('currency', 'override');
  }
};

// noticeDeadline has only one acceptable source: custom_provisions.c_NoticeDeadline.
// If the record doesn't have it, the field is forced back to null — even if
// the agent supplied a value — so the deterministic renewalDate-minus-
// noticePeriodDays derivation downstream is what renders, never a raw
// extraction field like provisions.renewal_notice_date or an agent guess.
const reconcileNoticeDeadline = (
  row: RenewalAgreementTableRow,
  mapped: ReconciledAgreementFields,
  next: RenewalAgreementTableRow,
  asOfDate: string,
  track: (field: string, type: 'fill' | 'override') => void,
) => {
  if (mapped.noticeDeadline !== null) {
    if (row.noticeDeadline !== mapped.noticeDeadline) {
      next.noticeDeadline = mapped.noticeDeadline;
      next.daysUntilNoticeDeadline = dateDiffDays(asOfDate, mapped.noticeDeadline);
      next.noticeDeadlineDerived = false;
      track('noticeDeadline', row.noticeDeadline === null ? 'fill' : 'override');
    }
    return;
  }

  if (row.noticeDeadline !== null) {
    next.noticeDeadline = null;
    next.daysUntilNoticeDeadline = null;
    next.noticeDeadlineDerived = false;
    track('noticeDeadline', 'override');
  }
};

const isFieldMissing = (
  field: (typeof TRACKED_FIELDS)[number],
  row: RenewalAgreementTableRow,
): boolean => {
  switch (field) {
    case 'renewalType':
      return row.renewalType === 'not_extracted';
    case 'renewalDate':
      return row.renewalDate === null;
    case 'noticePeriodDays':
      return row.noticePeriodDays === null;
    case 'agreementValue':
      return row.agreementValue === null;
    case 'currency':
      return row.currency === null;
    case 'supplier':
      return isMissingText(row.supplier);
    case 'agreementTitle':
      return isMissingText(row.agreementTitle);
    case 'noticeDeadline':
      // Still derivable downstream from renewalDate - noticePeriodDays, so a
      // null noticeDeadline here isn't necessarily a real extraction gap.
      return row.noticeDeadline === null && (row.renewalDate === null || row.noticePeriodDays === null);
    default:
      return false;
  }
};

const dateDiffDays = (fromDate: string, toDate: string): number | null => {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const diff = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);

  return Number.isFinite(diff) ? diff : null;
};

const resolveDefaultAccountId = async (userInfoTool: unknown): Promise<string | null> => {
  if (!userInfoTool) {
    return null;
  }

  try {
    const response = await executeMcpTool(userInfoTool, {});
    const payload = parseMcpTextPayload(response) as
      | { accounts?: Array<{ account_id?: string; is_default?: boolean }> }
      | null;

    if (!payload?.accounts?.length) {
      return null;
    }

    const defaultAccount = payload.accounts.find(account => account.is_default) ?? payload.accounts[0];
    return defaultAccount?.account_id ?? null;
  } catch {
    return null;
  }
};
