# Supplier Renewal Risk Agent — Completion Plan

Source of truth for the concept: [Supplier Renewal Risk Agent Concept](https://app.notion.com/p/Supplier-Renewal-Risk-Agent-Concept-3945a03c4c268184b652e67b7db38c29) (Notion).

## Where things stand

Mapped against the 8-step demo flow in the Notion doc:

| # | Demo flow step | Status |
| --- | --- | --- |
| 1 | Completed agreements centralized in Agreement Manager | ✅ 5 fictional agreements (`examples/agreements/`) with upload-ready PDFs and a classifier fixture |
| 2 | IAM Toolkit defines custom extraction fields | ✅ Documented (`examples/extraction-fields.md`); sandbox setup is manual and needs verification |
| 3 | Agreement Manager extracts renewal terms | ⚠️ Depends on sandbox extraction actually populating the custom fields MCP returns |
| 4 | Intake Agent queries via MCP for renewals in the configured review window | ✅ Built and merged — `renewalDiscoveryWorkflow` → Intake Agent → preview table |
| 5 | Risk Review Agent reviews each agreement against policy | ✅ Workflow-orchestrated: `renewalDiscoveryWorkflow` creates the deterministic `riskBrief`, then invokes the Risk Review Agent for bounded review judgment |
| 6 | Human reviewer approves the recommended action | ✅ Preview checkpoint: approve, override, or reject per agreement |
| 7 | Workflow Builder starts follow-up after approval | ✅ Docusign MCP handoff is wired; live trigger is gated by `DOCUSIGN_WORKFLOW_TRIGGER_ENABLED=true` |
| 8 | Local decision trail recorded | ✅ Local JSONL trail under `.mastra/` |

The preview UI (`src/app/page.tsx`) now shows the orchestration ledger, risk
classification, detail view, decision controls, and Workflow Builder handoff
state.

**Bottom line: the demo path is now wired end to end for discovery → risk review
→ human approval → Workflow Builder handoff. Mastra-native suspend/resume is
still a future polish path, not the current implementation.**

## Decisions (from Notion open questions)

- **Portfolio vs single agreement:** portfolio. Already how the repo is built; keep it.
- **Which follow-up action:** don't pick one — the Risk Review Agent recommends one action per agreement from the existing `followUpActionSchema` enum, and the human approves or overrides. This matches the schemas already in the repo and makes the governance point.

## Phase 1 — Carry full extracted fields through discovery

The original blocking schema gap was that `renewalAgreementTableRowSchema` lacked the renewal timing fields the deterministic policy needs, especially `noticePeriodDays`. The row contract now carries those fields, and the remaining risk is live sandbox extraction quality.

- [x] Extend the discovery row schema so each row carries the policy-relevant fields in `supplierRenewalAgreementSchema`, nullable where Docusign may not return them.
- [x] Update the Intake Agent workflow prompt to request/normalize those fields and list them in `source.missingFields` when absent.
- [x] Add a row → `SupplierRenewalAgreement` mapper (nulls → the "not extracted" conventions the classifier already handles).
- [ ] `npm run inspect:mcp discover <date>` and confirm the new fields come back against the sandbox.

## Phase 2 — Risk Review step in the Mastra workflow

Keep classification deterministic (defensible in the demo narrative: "policy is code, the agent explains"), and use the agent for rationale.

- [x] Create `riskReviewAgent` (`src/mastra/agents/risk-review-agent.ts`) with the procurement policy from `docs/concept.md` in its instructions. Expose `classifyRenewalRisk` and `createRenewalRiskBrief` as Mastra tools (`createTool`) so classifications come from the deterministic policy, while the agent prioritizes and explains the human review path.
- [x] Add a `risk-review` step to `renewalDiscoveryWorkflow` after intake: map rows → agreements, create and validate the deterministic `renewalRiskBriefSchema`, invoke `riskReviewAgent.generate(...)` for a bounded judgment pass, and include structured `riskReview` guidance alongside the discovery rows.
- [x] Validate agent output against the fixture: run with `asOfDate=2026-07-01` and check the five expected classifications in `examples/agreement-demo-fixture.json` (needs_review / urgent / blocked / standard / needs_review).
- [x] Register the agent in `src/mastra/index.ts`.

## Phase 3 — Human approval checkpoint

Current implementation uses a lightweight preview/API checkpoint so the video
can show the governed moment without fighting suspend/resume over HTTP. A
Mastra-native suspend/resume checkpoint remains a later hardening option.

- [x] Add a preview human-approval checkpoint for approve, override, and reject.
- [x] Add `POST /api/renewals/decisions` to validate the selected row/finding and create a `humanDecisionSchema` decision.
- [ ] Optional hardening: move the checkpoint into Mastra workflow suspend/resume once the video path is stable.

## Phase 4 — Follow-up plan + decision trail

- [x] Add follow-up plan creation after approval/override with `createFollowUpPlan`.
- [x] Prepare the Docusign Workflow Builder trigger through MCP, using `docusign_getWorkflowTriggerRequirements` before `docusign_triggerWorkflow`.
- [x] Record the decision trail locally as JSONL under `.mastra/`.
- [ ] Optional hardening: expose the full trail via a small API route.

## Phase 5 — Preview UI: risk, decision, follow-up

Extend `src/app/page.tsx` from a discovery table into the full review surface:

- [x] Add classification to the table and recommended action in the detail panel.
- [x] Row click → detail panel: extracted fields, signals, rationale, recommended action, and agent guidance.
- [x] Per-agreement decision controls: approve recommendation, override action, reject, and reviewer notes.
- [x] Portfolio brief summary above the table.
- [x] After decisions submit: show follow-up plan and Workflow Builder handoff state per agreement.

## Phase 6 — Sandbox verification (the real risk)

Everything above assumes Agreement Manager extraction populates the custom fields and MCP returns them. Verify early — ideally in parallel with Phase 1:

- [ ] Confirm the 5 PDFs from `examples/agreements/dist/` are uploaded as completed agreements in the demo sandbox.
- [ ] Confirm IAM Toolkit custom extraction fields exist and are promoted, matching `examples/extraction-fields.md`.
- [ ] Confirm `docusign_getAllAgreements` (or a details tool) actually returns the custom extracted fields. **If it doesn't**, the fallback per the Notion doc is the Agreement Manager API as the deterministic read surface — add a thin API client the Intake Agent tools can use, keep MCP as the tool layer framing.
- [ ] If extraction quality is poor on some fields, that's fine — the demo narrative includes "missing fields → needs_review"; make sure Clearview (missing renewal date/notice period) demos that path.

## Phase 7 — Docs, end-to-end run, checkpoint

- [ ] Update `README.md` and `docs/` for the full flow (discovery → risk review → human approval → follow-up + trail); refresh the architecture mermaid if step names changed.
- [ ] Full end-to-end run: `npm run dev` + `npm run preview:app`, discover → review → approve → follow-up, against live sandbox data.
- [ ] Write a short demo script/talk track (`docs/demo-script.md`): the "money quietly walks out the door" positioning line, then the 8-step walkthrough with the CloudForge-style urgent example (Meridian is the live equivalent: urgent, notice deadline 2026-07-20).
- [ ] `npm test` (typecheck) clean; commit as the pivot checkpoint per the Notion build plan.

## Suggested order

Phases 1 → 2 are sequential. Phase 6 (sandbox verification) should start immediately in parallel since it's the biggest unknown. Phases 3 → 4 → 5 build on 2. Phase 7 last.

## Risks

1. **MCP may not expose custom extracted fields** — the whole risk classification depends on renewal terms coming back from Docusign. Mitigation in Phase 6 (Agreement Manager API fallback).
2. **Suspend/resume over the Mastra HTTP API** may be awkward from the Next.js preview — time-boxed fallback in Phase 3.
3. **Date sensitivity** — fixture expectations assume `asOfDate=2026-07-01`; Northstar's "blocked" scenario stops being in the 90-day window as real dates drift. Keep the as-of date input in the UI (already there) and pin the demo date in the talk track, or regenerate agreement dates before recording.
