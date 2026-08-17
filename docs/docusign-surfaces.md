# Docusign Surfaces

## Agreement Manager

Agreement Manager is the source of completed supplier agreements and extracted agreement intelligence. This demo should not position Agreement Manager as the place where unsigned draft agreements first land for approval.

## Docusign CLI

Docusign CLI belongs in the setup and extraction workflow. It defines and tests custom agreement types and fields such as `renewal_type`, `renewal_date`, `notice_period_days`, and `notice_deadline`. Install it from the `@docusign/cli` npm package (`npm install -g @docusign/cli`) and authenticate with `ds auth login`, which uses PKCE. CLI authentication is separate from the app's `npm run auth:docusign` Docusign MCP OAuth helper.

## MCP

MCP is the agent-facing access layer. It lets an external agent reason over Docusign agreement data and take supported Docusign actions without building every API call directly into the prompt layer.

## Agreement Manager API

Agreement Manager API is the deterministic application integration surface for agreement records and extracted fields. Production code should use it where exact search, filtering, pagination, and typed business logic matter.

## Workflow Builder

Workflow Builder runs follow-up only after human approval. The demo's follow-up actions (`followUpActionSchema` in `src/mastra/domain/schemas.ts`) are owner review, legal review, renegotiation, cancellation-notice preparation, and missed-deadline escalation; `no_action` and rejected decisions skip Workflow Builder.
