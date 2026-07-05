# Architecture

```mermaid
flowchart LR
  A["Completed Supplier Agreements"] --> B["Docusign Agreement Manager"]
  B --> C["Extracted Renewal Terms"]
  C --> D["MCP or Agreement Manager API"]
  D --> E["Renewal Intake Agent"]
  E --> F["Renewal Risk Brief"]
  F --> G["Renewal Risk Agent"]
  G --> H["Human Approval"]
  H --> I["Workflow Builder Follow-Up"]
  H --> J["Decision Trail"]
```

## Agent Roles

### Renewal Intake Agent

- Pulls completed supplier agreements from Agreement Manager.
- Filters for agreements renewing in the next 90 days.
- Normalizes extracted renewal terms into consistent discovery rows.

### Renewal Risk Agent

- Reviews each agreement against the procurement renewal policy.
- Classifies renewal risk through deterministic policy tools.
- Explains the reasoning.
- Recommends one follow-up action per agreement.
- Produces a structured portfolio-level renewal-risk brief.

### Human Reviewer

- Confirms whether to approve renewal, start renegotiation, send cancellation notice, route to legal, or mark no action needed.
- Keeps the process governed and auditable.
