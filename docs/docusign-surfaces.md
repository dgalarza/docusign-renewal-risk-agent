# Docusign Surfaces

## Agreement Manager

Agreement Manager is the source of completed supplier agreements and extracted agreement intelligence. This demo should not position Agreement Manager as the place where unsigned draft agreements first land for approval.

## IAM Toolkit

IAM Toolkit belongs in the setup and extraction workflow. It defines and tests custom agreement types and fields such as `renewal_type`, `notice_deadline`, and `has_termination_for_convenience`.

## MCP

MCP is the agent-facing access layer. It lets an external agent reason over Docusign agreement data and take supported Docusign actions without building every API call directly into the prompt layer.

## Agreement Manager API

Agreement Manager API is the deterministic application integration surface for agreement records and extracted fields. Production code should use it where exact search, filtering, pagination, and typed business logic matter.

## Workflow Builder

Workflow Builder runs follow-up only after human approval. Example follow-up actions include renewal review, legal review, cancellation notice, amendment workflow, or owner assignment.

