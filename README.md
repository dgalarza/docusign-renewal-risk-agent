# Docusign Renewal Risk Agent

Mastra demo application for a Docusign supplier-renewal risk workflow.

Working concept:

> Docusign Agreement Manager knows what is in completed supplier agreements. A renewal-risk agent turns extracted agreement intelligence into a governed workflow before auto-renewals quietly create avoidable spend.

## Demo Shape

The project starts from completed supplier agreements, not draft agreement intake.

1. Completed supplier agreements live in Docusign Agreement Manager.
2. Docusign CLI defines and tests custom extraction fields for renewal-risk analysis.
3. Agreement Manager extracts renewal terms and related structured fields.
4. A custom agent finds supplier agreements renewing inside the review window.
5. The workflow creates a deterministic policy brief, then invokes the
   risk-review agent for judgment about review priority.
6. A human reviewer approves the follow-up action.
7. The preview prepares or starts a Docusign Workflow Builder follow-up through
   the Docusign MCP workflow tools.

## Docusign Surface Roles

| Surface | Role |
| --- | --- |
| Agreement Manager | Source of completed agreements and extracted renewal terms. |
| Docusign CLI | Defines, tests, and promotes custom extraction fields. |
| MCP | Gives external agents access to Docusign agreement data and supported actions. |
| Agreement Manager API | Deterministic API access to agreement records and extracted fields. |
| Workflow Builder | Runs the approved follow-up after human review: owner review, legal review, renegotiation, cancellation notice, or missed-deadline escalation. |
| Mastra | Custom agent and workflow layer for the demo. |

## Repository Layout

```text
docs/         Concept, architecture, and Docusign surface notes.
examples/     Sample completed supplier agreement portfolio and fixture.
scripts/      Docusign OAuth helper, MCP inspector/runner, agreement PDF builder.
docusign-cli/ Docusign CLI workspace that provisions the Agreement Manager
              custom agreement type and extraction fields in the sandbox — see
              docusign-cli/renewal-risk/README.md.
src/app/      Next.js preview app and API routes (discovery, stream, decisions).
src/mastra/   Domain schemas, agents, tools, MCP client, and workflows.
```

## Reading Path

To learn the codebase, read in this order:

1. `docs/concept.md` — the problem and the risk policy.
2. `docs/architecture.md` — the workflow shape and agent roles.
3. `docs/docusign-surfaces.md` — how each Docusign surface fits.
4. `src/mastra/domain/schemas.ts` — the single data contract everything shares.
5. `src/mastra/mcp/docusign-mcp-client.ts` and `src/mastra/agents/intake-agent.ts`
   — how Docusign MCP tools reach a Mastra agent.
6. `src/mastra/tools/portfolio-tools.ts` — the deterministic policy engine.
7. `src/mastra/workflows/renewal-discovery-workflow.ts` — orchestration, the
   policy/judgment split, and the streaming bridge.
8. `src/app/api/renewals/decisions/route.ts` and
   `src/mastra/tools/workflow-builder-tools.ts` — human approval and the
   Workflow Builder handoff.
9. `docs/agreement-manager-field-mapping.md` plus `docusign-cli/` — the
   extraction-field contract and the Docusign CLI workspace that provisions it.

## Getting Started

```shell
npm install
npm test
```

`npm test` runs the TypeScript typecheck and the deterministic policy-engine
test (`npm run test:policy`). The policy test validates
`examples/agreement-demo-fixture.json` with `asOfDate=2026-07-01` plus focused
missing-field and row-normalization cases.

The two agents run on an OpenAI model, so live discovery and the agent
judgment layer need `OPENAI_API_KEY` in `.env`. The fixture paths below work
without it — the deterministic policy engine needs no model, and the
risk-review step falls back to a deterministic judgment when the agent is
unavailable.

## Local Risk Review Fixture

Run the discovery flow against the demo fixture without Docusign MCP:

```shell
npm run inspect:mcp fixture 2026-07-01 120
```

The command emits the same workflow result shape as the live path:

- `rows`: normalized renewal agreement table rows.
- `riskBrief`: deterministic policy output with `generatedAt`,
  `reviewWindowDays`, `agreementsReviewed`, and per-agreement `findings`.
- each finding includes `classification`, `recommendedAction`, `rationale`,
  `daysUntilNoticeDeadline`, and `extractedSignals`.
- `riskReview`: Risk Review Agent judgment with the portfolio readout,
  priority agreement order, and reviewer guidance. The CLI fixture command
  skips the agent and reports `riskReview: null`; fixture runs through the
  preview UI (below) include it.

The preview UI has the same credential-free path: start the servers
(`npm run dev` and `npm run preview:app`), switch the **Source** selector to
**Demo fixture** (or open `http://localhost:4173/?source=fixture`), and run
discovery. The full flow — risk review, human approval, and Workflow Builder
handoff states — works against the bundled portfolio with no Docusign
credentials.

## Docusign MCP Renewal Discovery

The preview path calls Docusign MCP and labels the table source as
`Docusign MCP`. MCP errors and missing Docusign fields are shown directly; the
fixture mode above is a local/demo command for repeatable risk-review runs.
The preview UI sends a 120-day review window (`DEFAULT_REVIEW_WINDOW_DAYS` in
`src/app/page.tsx`); the `inspect:mcp fixture` and `inspect:mcp discover` CLI
commands default to 90 days unless you pass a third argument. Both keep the
Risk Review Agent focused on the top findings so the local demo stays legible.

The expected Agreement Manager field contract is documented in
`docs/agreement-manager-field-mapping.md`. Use that document when configuring
Docusign CLI custom fields or diagnosing `Not extracted` values in the preview.

Install Docusign CLI from the `@docusign/cli` npm package
(`npm install -g @docusign/cli`) and authenticate its local session with
`ds auth login`, which uses PKCE. That CLI authentication is separate from the
app's Docusign MCP OAuth helper: `npm run auth:docusign`.

**Sandbox setup.** The live path only returns rows if the sandbox Agreement
Manager contains the demo agreements. From `docusign-cli/renewal-risk/`, run
`ds agm ingest --directory agreement-manager/files/train` to ingest the six
demo PDFs (see `docusign-cli/renewal-risk/agreement-manager/README.md`). The
Intake Agent queries Agreement Manager with `status: COMPLETE` and
`review_status: PENDING`, so any agreement marked Reviewed in the Agreement
Manager UI is excluded from the demo run.

1. Copy `.env.example` to `.env` and fill in the local Docusign sandbox values.
   Do not commit `.env`, access tokens, refresh tokens, client secrets, or
   account-specific credentials.
2. Run `npm run auth:docusign` to complete the Docusign OAuth flow and paste the
   returned token values into `.env`.
3. Run `npm run inspect:mcp` to verify MCP tool discovery.
4. Run `npm run inspect:mcp discover 2026-07-05 90` to run the workflow. The
   workflow invokes the Intake Agent, which receives Docusign MCP tools through
   Mastra `MCPClient.listToolsWithErrors()` and calls Agreement Manager before rows are
   normalized for the preview table. The workflow then creates a deterministic
   renewal-risk policy brief and invokes the Risk Review Agent to add
   reviewer-facing judgment for the top findings without changing policy
   classifications.
5. Run `npm run dev` to start the Mastra API and Studio on
   `http://127.0.0.1:4111/`.
6. Run `npm run preview:app` and open `http://localhost:4173/`.
   The Next.js preview page waits for the Run discovery button, then streams
   the Mastra workflow configured by `MASTRA_API_URL` before rendering the
   returned table contract.

## Human Approval and Workflow Builder

After discovery and risk review, select an agreement row to approve the
recommended action, override it, or reject follow-up. The preview posts the
human decision to `POST /api/renewals/decisions`, which:

- validates the selected row, policy finding, and human decision;
- creates a deterministic `followUpPlan`;
- appends one row to the local, append-only SQLite decision trail at
  `.mastra/renewal-decision-trail.db` (see [Decision trail](#decision-trail));
- calls `docusign_getWorkflowTriggerRequirements` to prepare the Workflow
  Builder handoff when `DOCUSIGN_WORKFLOW_ID` and `DOCUSIGN_ACCOUNT_ID` are
  configured;
- calls `docusign_triggerWorkflow` for approved or overridden follow-up actions.

Rejected decisions and `no_action` overrides skip Workflow Builder.

### Decision trail

Every decision is recorded in an append-only SQLite database at
`.mastra/renewal-decision-trail.db` — one row per decision in the
`renewal_decisions` table, with columns for the human decision (reviewer,
approved/edited/rejected, recommended vs. selected action, notes), the
follow-up plan status, and the Workflow Builder handoff (status, instance ID
and URL), plus the full `RenewalDecisionResult` verbatim in `record_json`.
The app only ever inserts rows; nothing in the code updates or deletes them.
Inspect it with the `sqlite3` CLI:

```bash
sqlite3 -header -column .mastra/renewal-decision-trail.db 'SELECT id, decided_at, agreement_id, supplier, reviewer, decision, recommended_action, selected_action, workflow_builder_status FROM renewal_decisions ORDER BY id DESC LIMIT 10;'
```

If an older `.mastra/renewal-decision-trail.jsonl` file exists, its lines are
imported into the table the first time the database is opened (only when the
table is empty); the JSONL file is left in place.

### Workflow Builder Setup

The handoff triggers one configured Workflow Builder workflow and passes the
approved action as data. In the Docusign sandbox:

1. Create a Workflow Builder workflow whose trigger declares these inputs
   (the exact names the trigger payload sends): `startDate`,
   `workflowBuilder`, `workflowPreparer`, `agreementId`, `supplier`,
   `classification`, `approvedAction`, `noticeDeadline`, `reviewerNotes`.
2. Publish the workflow — unpublished workflows cannot be triggered.
3. Put its ID in `DOCUSIGN_WORKFLOW_ID` and the account in
   `DOCUSIGN_ACCOUNT_ID`. `DOCUSIGN_WORKFLOW_REVIEWER_EMAIL` and
   `DOCUSIGN_WORKFLOW_PREPARER_EMAIL` override the emails passed as
   `workflowBuilder` / `workflowPreparer`.

Handoff statuses in the decision result: `not_configured` (env vars missing),
`triggered` (instance started; the response includes the instance ID/URL),
`failed` (requirements or trigger call failed; see `errors`, with the built
trigger payload included for inspection), and `skipped` (rejected or
`no_action` decisions).

## Live Run Progress

The preview page shows incremental workflow progress in a run ledger while
discovery executes:

1. The browser opens an `EventSource` to `GET /api/renewals/stream`.
2. That route calls the Mastra server's
   `POST /api/workflows/renewalDiscoveryWorkflow/stream` endpoint and reads the
   record-separated workflow chunk stream (`workflow-start`,
   `workflow-step-output`, `workflow-step-result`, ...).
3. Inside the intake workflow step, the Intake Agent's `onChunk` callback forwards
   each Docusign MCP `tool-call` / `tool-result` through the step `writer`, so
   individual MCP calls surface as `workflow-step-output` chunks.
4. The risk-review step maps discovery rows into policy-ready agreements,
   creates the deterministic `riskBrief`, and invokes the Risk Review Agent for
   a bounded, validated `riskReview` judgment layer over the top findings.
5. The preview human-approval panel appends approval and Workflow Builder
   handoff events to the run ledger after a decision.
6. The route translates chunks into `progress` server-sent events and closes
   with a final `result` (or `failure`) event.

`GET /api/renewals` remains as the non-streaming JSON path over
`start-async`.
