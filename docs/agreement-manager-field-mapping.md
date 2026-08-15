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
| `currency` | `currency` | string | Yes | Extracted commercial term or metadata | `USD` | Use `USD` only when the account/demo default is known; otherwise add `currency` to `source.missingFields`. |
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

1. Install Docusign CLI from the `@docusign/agreement-cli` npm package.
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
