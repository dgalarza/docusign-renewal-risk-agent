# Agreement Manager Field Mapping

This document defines the data contract between Docusign Agreement Manager, the
Docusign MCP discovery path, and the app's normalized renewal-risk schemas.

The demo should treat Agreement Manager as the completed-agreement intelligence
source. The app should normalize extracted facts, derive predictable dates, and
surface missing extraction data instead of inventing values.

## Expected Fields

| Agreement Manager field | Normalized field | Type | Required for demo | Source | Example | Missing behavior |
| --- | --- | --- | --- | --- | --- | --- |
| `supplier_name` | `supplierName` / `supplier` | string | Yes | Extracted party or agreement metadata | `Brightline Office Supplies LLC` | Show `Not extracted`; add `supplier` to `source.missingFields`. |
| `agreement_title` | `agreementTitle` | string | Yes | Agreement metadata | `Workplace Supplies Subscription Agreement` | Show `Not extracted`; add `agreementTitle` to `source.missingFields`. |
| `agreement_value` | `agreementValue` | number | Yes | Extracted commercial term or metadata | `82000` | Use `null`; add `agreementValue` to `source.missingFields`; the `$50k` rule cannot be evaluated. |
| `currency` | `currency` | string or `null` | Yes | Extracted commercial term or metadata | `USD` | Use `null`; add `currency` to `source.missingFields`. Never guess a default currency, and never write the literal string `"Not extracted"` into this field — it is nullable specifically so missing currency doesn't need a text sentinel. |
| `renewal_type` | `renewalType` | enum | Yes | Extracted renewal provision | `auto_renews` | Use `not_extracted`; add `renewalType` to `source.missingFields`. |
| `renewal_date` | `renewalDate` | ISO date string or `null` | Yes | Extracted renewal provision | `2026-10-15` | Use `null`; add `renewalDate` to `source.missingFields`; classify as needs review once policy runs. |
| `notice_period_days` | `noticePeriodDays` | number or `null` | Yes | Extracted renewal provision | `60` | Use `null`; add `noticePeriodDays` to `source.missingFields`; `noticeDeadline` cannot be derived. |
| `notice_deadline` | `noticeDeadline` | ISO date string or `null` | Yes | Derived by app or extracted directly | `2026-08-16` | Derive from `renewalDate - noticePeriodDays` when possible; otherwise use `null` and add `noticeDeadline` to `source.missingFields`. |
| Docusign agreement ID | `agreementId` / `source.recordId` | string | Yes | Docusign source metadata | `demo-brightline-001` | Drop the row only if no stable ID is available. |
| Docusign agreement URL | `source.recordUrl` | string or omitted | No | Docusign source metadata | Docusign agreement URL | Omit when unavailable. |

## Normalization Rules

- `renewalType` must normalize to one of `auto_renews`, `manual_renewal`,
  `evergreen`, `none`, or `not_extracted`.
- `noticeDeadline` should be calculated when `renewalDate` and
  `noticePeriodDays` are present and Agreement Manager does not return a direct
  deadline.
- `daysUntilNoticeDeadline` should be calculated from `asOfDate` and
  `noticeDeadline`; keep it `null` when the deadline is missing.
- `agreementValue` should be a number without currency symbols or commas.

## Missing-Data Semantics

Missing fields are not neutral. They should be displayed as extraction gaps and
kept in `source.missingFields` so the later policy engine can distinguish:

- Missing `renewalDate` or `noticePeriodDays`: renewal risk cannot be timed;
  route to needs review.
- Missing `noticeDeadline`: derive it if possible; otherwise route to needs
  review.
- Missing `agreementValue`: the `$50k` rule cannot be evaluated; route to needs
  review when other renewal risk is present.

## Deterministic Reconciliation Against Agreement Manager

The Intake Agent (an LLM) is nondeterministic: on a given run it may return
`renewalType: "not_extracted"` or a missing `renewalDate` for a row even
though Agreement Manager has the data. To keep the demo's classifications
reliable, the workflow adds a deterministic reconciliation pass after the
Intake Agent step and before risk review (`src/mastra/tools/agreement-reconciliation.ts`).

For every row the Intake Agent returned (bounded to 25 rows per run), the
workflow calls `docusign_getAgreementDetails` directly from the MCP tool map
— outside any agent, the same pattern `workflow-builder-tools.ts` uses for
the Workflow Builder handoff — and reconciles `renewalType`, `renewalDate`,
`noticePeriodDays`, `agreementValue`, `currency`, `supplier`,
`agreementTitle`, and `noticeDeadline` against it.

**The record wins.** This is not a fill-only backstop: whenever the
Agreement Manager record has a value for a field, that value replaces
whatever the Intake Agent returned, even if the agent's value looked valid.
The agent's value is kept only when the record has no value for that field.
This matters because the Intake Agent is an LLM and has been observed
returning plausible-looking but wrong data, not just `null`/`"not_extracted"`
— for example, computing `noticeDeadline` from
`provisions.renewal_notice_date` (the current term's notice date, not the
deadline the demo needs) instead of leaving it for the deterministic
derivation, or writing the literal string `"Not extracted"` into `currency`
instead of using `null`.

`noticeDeadline` gets the strictest rule: the *only* acceptable source is a
direct `custom_provisions.c_NoticeDeadline` field. If the record doesn't have
one, `noticeDeadline` is forced to `null` regardless of what the agent
returned — never derived from `provisions.renewal_notice_date` or
`provisions.expiration_date` by the reconciliation step itself. That null
then flows into the existing deterministic derivation
(`renewalDate` minus `noticePeriodDays`) later in the workflow, which is
what should render with the "· derived" badge in the UI.

The mapping itself lives in `src/mastra/tools/agreement-record-mapper.ts`, a
pure, unit-tested function that reads `custom_provisions` (the `c_`-prefixed
extraction fields) first and falls back to `provisions` — the same
precedence documented above. It also defensively coerces a literal
`"Not extracted"` string found in a raw record field to `null`/no-value, so
that sentinel can never leak into a field it reconciles.

Reconciled rows record which fields changed and how in
`row.source.reconciledFields` (the agent had no value; the record filled it)
and `row.source.overriddenFields` (the agent had a value; the record
disagreed and won), and those fields are removed from
`row.source.missingFields` when the record supplied a real value. The run
ledger shows one summary event per run breaking down both counts, e.g.
"Reconciled 8 rows against Agreement Manager records: 3 filled, 5
corrected", so the correction is visible in the UI, not just in the data. If
a `docusign_getAgreementDetails` call fails for a row, that row is left as
the Intake Agent returned it and the run continues — reconciliation is a
backstop, not a hard dependency. Fixture-mode runs never call MCP and are
unaffected by this step.

## Docusign CLI Setup Notes

Docusign CLI is the setup surface for Agreement Manager custom
fields, custom agreement types, field mappings, AI training sets, and extraction
testing. For this demo, use it to make the field names above real Agreement
Manager fields and to validate extraction quality before relying on MCP output.

This repo ships a concrete Docusign CLI workspace at
`docusign-cli/renewal-risk/` — the Agreement Manager manifest defines the
custom agreement type and extraction fields (as `C_`-prefixed field keys such
as `C_SupplierName` and `C_RenewalDate` that map to the snake_case names
above), with training/test PDFs and a ground-truth testing CSV. Start from
`docusign-cli/renewal-risk/README.md` instead of building the manifest by
hand.

Suggested sandbox workflow:

1. Install Docusign CLI from the `@docusign/cli` npm package
   (`npm install -g @docusign/cli`).
2. Authenticate the CLI with `ds auth login`, which uses PKCE.
3. Retrieve the current Agreement Manager catalog with `ds agm get catalog`.
4. Add the renewal-risk fields to the Agreement Manager manifest.
5. Map the fields to the supplier agreement type used for the demo.
6. Upload the package with `ds agm upload`.
7. Run `ds agm get catalog` again and confirm the field names exist.
8. Add the generated agreement PDFs as test agreements.
9. Generate and fill the extraction test template with ground-truth values.
10. Run the extraction test and compare results against
    `examples/agreement-demo-fixture.json`.

The CLI's `ds auth login` session is separate from the app's Docusign MCP OAuth
helper, `npm run auth:docusign`.

The demo intentionally excludes ownership and termination-right extraction from
the policy pass because those fields are not consistently available from the
sandbox MCP path. Workflow Builder routing can use a configured owner or review
queue outside this extraction contract.

References:

- Docusign CLI overview: https://developers.docusign.com/docusign-cli/?utm_campaign=AWA_FY27Q2&utm_medium=influencer-program&utm_source=Damian
- Configure agreement types and fields: https://developers.docusign.com/docusign-cli/configure-agreement-types-and-fields/?utm_campaign=AWA_FY27Q2&utm_medium=influencer-program&utm_source=Damian
- Test agreement customizations: https://developers.docusign.com/docusign-cli/test-agreement-customizations/?utm_campaign=AWA_FY27Q2&utm_medium=influencer-program&utm_source=Damian
- Bulk ingest agreements with metadata: https://developers.docusign.com/docusign-cli/bulk-ingest-agreements/?utm_campaign=AWA_FY27Q2&utm_medium=influencer-program&utm_source=Damian
