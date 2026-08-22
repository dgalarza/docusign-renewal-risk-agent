import { createClient, type Client } from '@libsql/client';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renewalDecisionResultSchema, type RenewalDecisionResult } from '../domain/schemas';

/**
 * Append-only decision trail. Every human approval checkpoint decision is
 * written as exactly one row in a local SQLite database; the module exposes
 * no update or delete path on purpose — the trail is the audit record.
 *
 * Columns mirror the three parts of a RenewalDecisionResult (the human
 * decision, the follow-up plan, the Workflow Builder handoff) and the full
 * result is kept verbatim in `record_json`.
 */

export const DECISION_TRAIL_DB_FILENAME = 'renewal-decision-trail.db';
export const LEGACY_DECISION_TRAIL_JSONL_FILENAME = 'renewal-decision-trail.jsonl';

export interface DecisionContext {
  /** Supplier name from the selected table row. */
  supplier?: string | null;
  /** The policy finding's recommended action, before any human override. */
  recommendedAction?: string | null;
}

export interface DecisionTrailRow {
  id: number;
  decidedAt: string;
  agreementId: string;
  supplier: string | null;
  reviewer: string;
  decision: RenewalDecisionResult['decision']['decision'];
  recommendedAction: string | null;
  selectedAction: string;
  reviewerNotes: string | null;
  followUpStatus: string | null;
  workflowBuilderStatus: string | null;
  workflowInstanceId: string | null;
  workflowInstanceUrl: string | null;
  record: RenewalDecisionResult;
}

export interface DecisionTrailOptions {
  /** Directory holding the database (and any legacy JSONL). Defaults to `.mastra/`. */
  directory?: string;
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS renewal_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decided_at TEXT NOT NULL,
  agreement_id TEXT NOT NULL,
  supplier TEXT,
  reviewer TEXT NOT NULL,
  decision TEXT NOT NULL,
  recommended_action TEXT,
  selected_action TEXT,
  reviewer_notes TEXT,
  follow_up_status TEXT,
  workflow_builder_status TEXT,
  workflow_instance_id TEXT,
  workflow_instance_url TEXT,
  record_json TEXT NOT NULL
)`;

const CREATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS renewal_decisions_agreement_id ON renewal_decisions (agreement_id)';

const INSERT_SQL = `
INSERT INTO renewal_decisions (
  decided_at, agreement_id, supplier, reviewer, decision, recommended_action,
  selected_action, reviewer_notes, follow_up_status, workflow_builder_status,
  workflow_instance_id, workflow_instance_url, record_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const defaultDirectory = () => resolve(process.cwd(), '.mastra');

const clients = new Map<string, Promise<Client>>();

/**
 * Opens (and on first open, initializes) the database for a directory. The
 * client is cached per directory so the Next.js route reuses one connection.
 */
const getClient = (directory: string): Promise<Client> => {
  const dbPath = resolve(directory, DECISION_TRAIL_DB_FILENAME);
  let pending = clients.get(dbPath);
  if (!pending) {
    pending = openDatabase(directory, dbPath).catch((error) => {
      clients.delete(dbPath);
      throw error;
    });
    clients.set(dbPath, pending);
  }
  return pending;
};

const openDatabase = async (directory: string, dbPath: string): Promise<Client> => {
  await mkdir(dirname(dbPath), { recursive: true });
  const client = createClient({ url: pathToFileURL(dbPath).href });
  await client.execute(CREATE_TABLE_SQL);
  await client.execute(CREATE_INDEX_SQL);
  await importLegacyJsonl(client, resolve(directory, LEGACY_DECISION_TRAIL_JSONL_FILENAME));
  return client;
};

/**
 * One-time migration from the previous JSONL trail. Runs only when the table
 * is empty, so re-opening the database never duplicates rows. The JSONL file
 * is read, never modified or removed.
 */
const importLegacyJsonl = async (client: Client, jsonlPath: string) => {
  if (!existsSync(jsonlPath)) {
    return;
  }

  const existing = await client.execute('SELECT COUNT(*) AS count FROM renewal_decisions');
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const lines = (await readFile(jsonlPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const parsed = renewalDecisionResultSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      continue;
    }
    await client.execute({ sql: INSERT_SQL, args: toInsertArgs(parsed.data, {}) });
  }
};

const toInsertArgs = (result: RenewalDecisionResult, context: DecisionContext) => {
  const payloadSupplier = result.workflowBuilder.triggerPayload?.supplier;
  const supplier =
    context.supplier ?? (typeof payloadSupplier === 'string' ? payloadSupplier : null);

  return [
    result.decision.decidedAt,
    result.decision.agreementId,
    supplier,
    result.decision.reviewer,
    result.decision.decision,
    context.recommendedAction ?? null,
    result.decision.selectedAction,
    result.decision.notes || null,
    result.followUpPlan.status,
    result.workflowBuilder.status,
    result.workflowBuilder.instanceId,
    result.workflowBuilder.instanceUrl,
    JSON.stringify(result),
  ];
};

/** Appends one decision to the trail and returns the new row id. */
export const appendDecision = async (
  result: RenewalDecisionResult,
  context: DecisionContext = {},
  options: DecisionTrailOptions = {},
): Promise<number> => {
  const client = await getClient(options.directory ?? defaultDirectory());
  const inserted = await client.execute({ sql: INSERT_SQL, args: toInsertArgs(result, context) });
  return Number(inserted.lastInsertRowid);
};

/** Lists the most recent decisions, newest first. Intended for tests and inspection. */
export const listDecisions = async (
  limit = 50,
  options: DecisionTrailOptions = {},
): Promise<DecisionTrailRow[]> => {
  const client = await getClient(options.directory ?? defaultDirectory());
  const selected = await client.execute({
    sql: 'SELECT * FROM renewal_decisions ORDER BY id DESC LIMIT ?',
    args: [limit],
  });

  return selected.rows.map((row) => ({
    id: Number(row.id),
    decidedAt: String(row.decided_at),
    agreementId: String(row.agreement_id),
    supplier: (row.supplier as string | null) ?? null,
    reviewer: String(row.reviewer),
    decision: String(row.decision) as DecisionTrailRow['decision'],
    recommendedAction: (row.recommended_action as string | null) ?? null,
    selectedAction: String(row.selected_action),
    reviewerNotes: (row.reviewer_notes as string | null) ?? null,
    followUpStatus: (row.follow_up_status as string | null) ?? null,
    workflowBuilderStatus: (row.workflow_builder_status as string | null) ?? null,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    workflowInstanceUrl: (row.workflow_instance_url as string | null) ?? null,
    record: renewalDecisionResultSchema.parse(JSON.parse(String(row.record_json))),
  }));
};
