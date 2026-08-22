import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RenewalDecisionResult } from '../domain/schemas';
import * as decisionTrail from './decision-trail';
import { appendDecision, listDecisions, readDecisionTrail } from './decision-trail';

const makeResult = (overrides: Partial<RenewalDecisionResult['decision']> = {}): RenewalDecisionResult => ({
  decision: {
    agreementId: 'demo-clearview-005',
    decision: 'approved',
    selectedAction: 'legal_review',
    reviewer: 'Demo Reviewer',
    notes: 'Please review missing renewal notice terms.',
    decidedAt: '2026-07-06T03:30:00.000Z',
    ...overrides,
  },
  followUpPlan: {
    agreementId: 'demo-clearview-005',
    action: 'legal_review',
    status: 'planned',
    surface: 'Workflow Builder',
    details: 'Legal review planned.',
  },
  workflowBuilder: {
    workflowId: 'wf-123',
    accountId: 'acct-1',
    workflowName: 'Renewal follow-up',
    status: 'triggered',
    details: 'Instance started.',
    triggerPayload: { supplier: 'Clearview Inventory Platform LLC', approvedAction: 'legal_review' },
    requirements: null,
    instanceId: 'inst-1',
    instanceUrl: 'https://example.test/instances/inst-1',
    errors: [],
  },
});

const tempDirectory = () => mkdtemp(join(tmpdir(), 'decision-trail-'));

test('appends decisions as rows and lists them back newest first', async () => {
  const directory = await tempDirectory();

  const firstId = await appendDecision(makeResult(), {
    supplier: 'Clearview Inventory Platform LLC',
    recommendedAction: 'legal_review',
  }, { directory });
  const secondId = await appendDecision(
    makeResult({ decision: 'rejected', reviewer: 'Second Reviewer', notes: '' }),
    { supplier: 'Clearview Inventory Platform LLC', recommendedAction: 'legal_review' },
    { directory },
  );

  assert.equal(secondId, firstId + 1);

  const rows = await listDecisions(10, { directory });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, secondId);
  assert.equal(rows[0].decision, 'rejected');
  assert.equal(rows[0].reviewer, 'Second Reviewer');
  assert.equal(rows[0].reviewerNotes, null);
  assert.equal(rows[1].id, firstId);
  assert.equal(rows[1].decision, 'approved');
  assert.equal(rows[1].agreementId, 'demo-clearview-005');
  assert.equal(rows[1].supplier, 'Clearview Inventory Platform LLC');
  assert.equal(rows[1].recommendedAction, 'legal_review');
  assert.equal(rows[1].selectedAction, 'legal_review');
  assert.equal(rows[1].followUpStatus, 'planned');
  assert.equal(rows[1].workflowBuilderStatus, 'triggered');
  assert.equal(rows[1].workflowInstanceId, 'inst-1');
  assert.equal(rows[1].workflowInstanceUrl, 'https://example.test/instances/inst-1');
  assert.deepEqual(rows[1].record, makeResult());

  const dbStats = await stat(join(directory, decisionTrail.DECISION_TRAIL_DB_FILENAME));
  assert.ok(dbStats.size > 0);
});

test('module is append-only: exposes no update or delete helpers', () => {
  const exported = Object.keys(decisionTrail);
  assert.deepEqual(exported.sort(), [
    'DECISION_TRAIL_DB_FILENAME',
    'LEGACY_DECISION_TRAIL_JSONL_FILENAME',
    'appendDecision',
    'countDecisions',
    'listDecisions',
    'readDecisionTrail',
  ]);
  for (const name of exported) {
    assert.doesNotMatch(name, /update|delete|remove|clear|reset/i);
  }
});

test('imports a legacy JSONL trail once on first open and leaves the file untouched', async () => {
  const directory = await tempDirectory();
  const jsonlPath = join(directory, decisionTrail.LEGACY_DECISION_TRAIL_JSONL_FILENAME);
  const legacy = makeResult({ reviewer: 'Legacy Reviewer', decidedAt: '2026-06-01T00:00:00.000Z' });
  const jsonl = `${JSON.stringify(legacy)}\n`;
  await writeFile(jsonlPath, jsonl, 'utf8');

  const imported = await listDecisions(10, { directory });
  assert.equal(imported.length, 1);
  assert.equal(imported[0].reviewer, 'Legacy Reviewer');
  assert.equal(imported[0].supplier, 'Clearview Inventory Platform LLC', 'falls back to trigger payload supplier');
  assert.equal(imported[0].recommendedAction, null);
  assert.deepEqual(imported[0].record, legacy);

  await appendDecision(makeResult(), {}, { directory });
  const afterAppend = await listDecisions(10, { directory });
  assert.equal(afterAppend.length, 2, 'legacy import is not repeated');

  assert.equal(await readFile(jsonlPath, 'utf8'), jsonl);
});

test('readDecisionTrail returns the newest rows plus the total count (GET /api/renewals/decisions shape)', async () => {
  const directory = await tempDirectory();

  const empty = await readDecisionTrail(2, { directory });
  assert.deepEqual(empty, { decisions: [], total: 0, limit: 2 });

  for (const reviewer of ['First', 'Second', 'Third']) {
    await appendDecision(makeResult({ reviewer }), { supplier: 'Clearview' }, { directory });
  }

  const snapshot = await readDecisionTrail(2, { directory });
  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.limit, 2);
  assert.deepEqual(
    snapshot.decisions.map(row => row.reviewer),
    ['Third', 'Second'],
    'newest first, capped at limit',
  );
});
