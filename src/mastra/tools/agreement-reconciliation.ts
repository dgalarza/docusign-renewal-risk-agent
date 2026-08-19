import type { RenewalAgreementTableRow } from '../domain/schemas';
import { docusignMcpClient } from '../mcp/docusign-mcp-client';
import { executeMcpTool, parseMcpTextPayload } from '../mcp/mcp-tool-utils';
import {
  DEFAULT_BUYER_PARTY_NAME,
  mapAgreementRecordToReconciledFields,
  type AgreementRecord,
} from './agreement-record-mapper';

const GET_AGREEMENT_DETAILS_TOOL = 'docusign_getAgreementDetails';
const GET_USER_INFO_TOOL = 'docusign_getUserInfo';
const MAX_RECONCILIATION_CALLS = 25;
const NOT_EXTRACTED_TEXT = 'Not extracted';

// The reconciliation fields the mapper can fill. noticeDeadline is
// deliberately excluded: it is derived downstream from renewalDate and
// noticePeriodDays, never taken from the record directly.
const RECONCILABLE_TEXT_FIELDS = ['supplier', 'agreementTitle'] as const;

export type ReconciliationOutcome = {
  rows: RenewalAgreementTableRow[];
  reconciledRowCount: number;
};

// Deterministic backstop for Intake Agent nondeterminism: for every row the
// agent returned, fetch the Agreement Manager record directly (outside any
// agent, same pattern as workflow-builder-tools.ts) and fill in any
// null/not_extracted field the mapper can resolve. This runs after the
// Intake Agent, never in fixture mode, and is bounded so a large discovery
// result can't fan out into an unbounded number of MCP calls.
export const reconcileRowsAgainstAgreementManager = async ({
  rows,
  accountId,
  onRowError,
}: {
  rows: RenewalAgreementTableRow[];
  accountId?: string;
  onRowError?: (agreementId: string, error: unknown) => void;
}): Promise<ReconciliationOutcome> => {
  const candidateRows = rows.filter(row => row.agreementId).slice(0, MAX_RECONCILIATION_CALLS);

  if (candidateRows.length === 0) {
    return { rows, reconciledRowCount: 0 };
  }

  try {
    const { tools } = await docusignMcpClient.listToolsWithErrors();
    const detailsTool = tools[GET_AGREEMENT_DETAILS_TOOL];

    if (!detailsTool) {
      return { rows, reconciledRowCount: 0 };
    }

    const resolvedAccountId = accountId ?? (await resolveDefaultAccountId(tools[GET_USER_INFO_TOOL]));

    if (!resolvedAccountId) {
      return { rows, reconciledRowCount: 0 };
    }

    const reconciledById = new Map<string, RenewalAgreementTableRow>();

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

        const reconciledRow = reconcileRow(row, record);

        if (reconciledRow) {
          reconciledById.set(row.agreementId, reconciledRow);
        }
      } catch (error) {
        onRowError?.(row.agreementId, error);
      }
    }

    const nextRows = rows.map(row => reconciledById.get(row.agreementId) ?? row);

    return { rows: nextRows, reconciledRowCount: reconciledById.size };
  } finally {
    await docusignMcpClient.disconnect();
  }
};

const reconcileRow = (
  row: RenewalAgreementTableRow,
  record: AgreementRecord,
): RenewalAgreementTableRow | null => {
  const mapped = mapAgreementRecordToReconciledFields(record, {
    buyerPartyName: DEFAULT_BUYER_PARTY_NAME,
  });
  const reconciledFields: string[] = [];
  const next: RenewalAgreementTableRow = { ...row };

  if (row.renewalType === 'not_extracted' && mapped.renewalType !== 'not_extracted') {
    next.renewalType = mapped.renewalType;
    reconciledFields.push('renewalType');
  }

  if (row.renewalDate === null && mapped.renewalDate !== null) {
    next.renewalDate = mapped.renewalDate;
    reconciledFields.push('renewalDate');
  }

  if (row.noticePeriodDays === null && mapped.noticePeriodDays !== null) {
    next.noticePeriodDays = mapped.noticePeriodDays;
    reconciledFields.push('noticePeriodDays');
  }

  if (row.agreementValue === null && mapped.agreementValue !== null) {
    next.agreementValue = mapped.agreementValue;
    reconciledFields.push('agreementValue');
  }

  if (isMissingText(row.currency) && mapped.currency !== null) {
    next.currency = mapped.currency;
    reconciledFields.push('currency');
  }

  for (const field of RECONCILABLE_TEXT_FIELDS) {
    const mappedValue = mapped[field];

    if (isMissingText(row[field]) && mappedValue !== null) {
      (next as Record<string, unknown>)[field] = mappedValue;
      reconciledFields.push(field);
    }
  }

  if (reconciledFields.length === 0) {
    return null;
  }

  return {
    ...next,
    source: {
      ...row.source,
      missingFields: row.source.missingFields.filter(field => !reconciledFields.includes(field)),
      reconciledFields: [...(row.source.reconciledFields ?? []), ...reconciledFields],
    },
  };
};

const isMissingText = (value: string) => value.trim().length === 0 || value === NOT_EXTRACTED_TEXT;

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
