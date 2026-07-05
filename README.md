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
src/        Domain schemas and workflow helper functions.
```

## Getting Started

```shell
npm install
npm test
```

The first implementation target is a local end-to-end workflow over the sample portfolio. Live Docusign MCP/API calls should be added after the local domain model and preview are stable.

