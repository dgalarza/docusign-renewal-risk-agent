# Supplier Renewal Risk Agent — Completion Plan

Source of truth for the concept: [Supplier Renewal Risk Agent Concept](https://app.notion.com/p/Supplier-Renewal-Risk-Agent-Concept-3945a03c4c268184b652e67b7db38c29) (Notion).

## Where things stand

Mapped against the 8-step demo flow in the Notion doc:

| # | Demo flow step | Status |
| --- | --- | --- |
| 1 | Completed agreements centralized in Agreement Manager | ✅ 5 fictional agreements (`examples/agreements/`) with upload-ready PDFs and a classifier fixture |
| 2 | IAM Toolkit defines custom extraction fields | ✅ Documented (`examples/extraction-fields.md`); sandbox setup is manual and needs verification |
| 3 | Agreement Manager extracts renewal terms | ⚠️ Depends on sandbox extraction actually populating the custom fields MCP returns |
| 4 | Intake Agent queries via MCP for renewals in next 90 days | ✅ Built and merged — `renewalDiscoveryWorkflow` → Intake Agent → preview table |
| 5 | Risk Review Agent classifies each agreement against policy | ❌ Classifier exists as pure functions (`portfolio-tools.ts`) but is not wired into any agent or workflow step |
| 6 | Human reviewer approves the recommended action | ❌ `humanDecisionSchema` exists; no checkpoint, no UI |
| 7 | Workflow Builder starts follow-up after approval | ❌ `createFollowUpPlan` exists as a pure function; not wired |
| 8 | Local decision trail recorded | ❌ Schema only |

The preview UI (`src/app/page.tsx`) shows only the discovery table — no risk classification, detail view, decision controls, or follow-up output.

**Bottom line: discovery (steps 1–4) is done; the risk-review → human-approval → follow-up half of the demo (steps 5–8) is unbuilt.**

## Decisions (from Notion open questions)

- **Portfolio vs single agreement:** portfolio. Already how the repo is built; keep it.
- **Which follow-up action:** don't pick one — the Risk Review Agent recommends one action per agreement from the existing `followUpActionSchema` enum, and the human approves or overrides. This matches the schemas already in the repo and makes the governance point.

## Phase 1 — Carry full extracted fields through discovery

The original blocking schema gap was that `renewalAgreementTableRowSchema` lacked `noticePeriodDays`, `hasTerminationForConvenience`, `terminationFee`, and `agreementStatus` — all of which `classifyRenewalRisk` needs. The row contract now carries those fields, and the remaining risk is live sandbox extraction quality.

- [x] Extend the discovery row schema (or attach a nested `extracted` object) so each row carries every field in `supplierRenewalAgreementSchema`, nullable where Docusign may not return them.
- [x] Update the Intake Agent workflow prompt to request/normalize those fields and list them in `source.missingFields` when absent.
- [x] Add a row → `SupplierRenewalAgreement` mapper (nulls → the "not extracted" conventions the classifier already handles).
- [ ] `npm run inspect:mcp discover <date>` and confirm the new fields come back against the sandbox.

## Phase 2 — Risk Review step in the Mastra workflow

Keep classification deterministic (defensible in the demo narrative: "policy is code, the agent explains"), and use the agent for rationale.

- [ ] Create `riskReviewAgent` (`src/mastra/agents/risk-review-agent.ts`) with the procurement policy from `docs/concept.md` in its instructions. Expose `classifyRenewalRisk` as a Mastra tool (`createTool`) so classifications come from the deterministic policy, and the agent writes the per-agreement rationale and the portfolio-level brief summary.
- [ ] Add a `risk-review` step to `renewalDiscoveryWorkflow` after intake: map rows → agreements → `createRenewalRiskBrief`, then have the agent produce rationale text. Output: `renewalRiskBriefSchema` alongside the discovery rows.
- [ ] Validate agent output against the fixture: run with `asOfDate=2026-07-01` and check the five expected classifications in `examples/agreement-demo-fixture.json` (needs_review / urgent / blocked / needs_review / needs_review).
- [ ] Register the agent in `src/mastra/index.ts`.

## Phase 3 — Human approval checkpoint

Use Mastra workflow suspend/resume — it demos "governed workflow" natively and shows up in Mastra Studio.

- [ ] Add a `human-approval` step that suspends with the risk brief as suspend payload and resumes with an array of `humanDecisionSchema` decisions.
- [ ] Extend `/api/renewals` (or add `/api/renewals/decide`) to resume the suspended run via the Mastra API (`resume-async`), passing the run ID back to the client from the initial response.
- [ ] Fallback if suspend/resume over the HTTP API fights back: split into two workflows (discover+classify, then approve+follow-up) with the run state held client-side. Don't burn more than a couple hours on the suspend path before switching.

## Phase 4 — Follow-up plan + decision trail

- [ ] Add a `follow-up` step after approval: `createFollowUpPlan` per approved/overridden finding; output `followUpPlanSchema[]`. Details text should name the Workflow Builder workflow that would start ("Docusign Follow-Up Actions" language, per the Notion pivot — no "Audit Targets" anywhere).
- [ ] Record the decision trail locally: append `{ finding, decision, followUpPlan, timestamps }` to the existing LibSQL store or a `decision-trail.json` — simplest thing that supports the "auditable" claim on camera.
- [ ] Expose the trail via a small API route so the UI can show it.

## Phase 5 — Preview UI: risk, decision, follow-up

Extend `src/app/page.tsx` from a discovery table into the full review surface:

- [ ] Add classification and recommended-action columns to the table (badge colors: standard / needs_review=warning / urgent / blocked=destructive).
- [ ] Row click → detail panel: all extracted fields, extracted signals, rationale, recommended action — matching the "Example Output" list in the Notion doc.
- [ ] Per-agreement decision controls: approve recommendation, override action (select from the follow-up enum), reject; reviewer name + notes.
- [ ] Portfolio brief summary above the table (counts by classification, total value at risk).
- [ ] After decisions submit: show follow-up plan per agreement and the decision-trail entries.

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
