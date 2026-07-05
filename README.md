# Docusign Renewal Risk Agent

Mastra demo application for a Docusign supplier-renewal risk workflow.

Working concept:

> Docusign Agreement Manager knows what is in completed supplier agreements. A renewal-risk agent turns extracted agreement intelligence into a governed workflow before auto-renewals quietly create avoidable spend.

## Demo Shape

The project starts from completed supplier agreements, not draft agreement intake.

1. Completed supplier agreements live in Docusign Agreement Manager.
2. IAM Toolkit defines and tests custom extraction fields for renewal-risk analysis.
3. Agreement Manager extracts renewal terms and related structured fields.
4. A custom agent finds supplier agreements renewing in the next 90 days.
5. A risk-review agent classifies renewal exposure.
6. A human reviewer approves the follow-up action.
7. Workflow Builder routes the approved follow-up.

## Docusign Surface Roles

| Surface | Role |
| --- | --- |
| Agreement Manager | Source of completed agreements and extracted renewal terms. |
| IAM Toolkit | Defines, tests, and promotes custom extraction fields. |
| MCP | Gives external agents access to Docusign agreement data and supported actions. |
| Agreement Manager API | Deterministic API access to agreement records and extracted fields. |
| Workflow Builder | Runs renewal-review, legal-review, cancellation, or amendment follow-up after human approval. |
| Mastra | Custom agent and workflow layer for the demo. |

## Repository Layout

```text
docs/       Concept, architecture, and Docusign surface notes.
examples/   Sample completed supplier agreement portfolio.
src/app/    Lightweight Next.js preview app and API route.
src/mastra/ Domain schemas, agents, tools, and workflows.
```

## Getting Started

```shell
npm install
npm test
```

`npm test` runs the TypeScript typecheck and the deterministic policy-engine
test (`npm run test:policy`). The policy test validates
`examples/agreement-demo-fixture.json` with `asOfDate=2026-07-01` plus focused
missing-field and row-normalization cases.

## Docusign MCP Renewal Discovery

The preview path calls Docusign MCP and labels the table source as
`Docusign MCP`. There is no fixture fallback; MCP errors and missing Docusign
fields are shown directly.

The expected Agreement Manager field contract is documented in
`docs/agreement-manager-field-mapping.md`. Use that document when configuring
IAM Toolkit custom fields or diagnosing `Not extracted` values in the preview.

1. Copy `.env.example` to `.env` and fill in the local Docusign sandbox values.
   Do not commit `.env`, access tokens, refresh tokens, client secrets, or
   account-specific credentials.
2. Run `npm run auth:docusign` to complete the Docusign OAuth flow and paste the
   returned token values into `.env`.
3. Run `npm run inspect:mcp` to verify MCP tool discovery.
4. Run `npm run inspect:mcp discover 2026-07-05` to run the Intake Agent
   workflow. The agent receives Docusign MCP tools through Mastra
   `MCPClient.listTools()` and calls Agreement Manager before rows are
   normalized for the preview table.
5. Run `npm run dev` to start the Mastra API and Studio on
   `http://127.0.0.1:4111/`.
6. Run `npm run preview:app` and open `http://localhost:4173/`.
   The Next.js preview page waits for the Run discovery button, then streams
   the Mastra workflow configured by `MASTRA_API_URL` before rendering the
   returned table contract.

## Live Run Progress

The preview page shows incremental workflow progress in a run ledger while
discovery executes:

1. The browser opens an `EventSource` to `GET /api/renewals/stream`.
2. That route calls the Mastra server's
   `POST /api/workflows/renewalDiscoveryWorkflow/stream` endpoint and reads the
   record-separated workflow chunk stream (`workflow-start`,
   `workflow-step-output`, `workflow-step-result`, ...).
3. Inside the workflow step, the Intake Agent's `onChunk` callback forwards
   each Docusign MCP `tool-call` / `tool-result` through the step `writer`, so
   individual MCP calls surface as `workflow-step-output` chunks.
4. The route translates chunks into `progress` server-sent events and closes
   with a final `result` (or `failure`) event.

`GET /api/renewals` remains as the non-streaming JSON path over
`start-async`.
