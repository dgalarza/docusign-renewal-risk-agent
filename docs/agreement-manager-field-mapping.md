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
| `agreement_status` | `agreementStatus` | enum | Yes | Agreement metadata | `completed` | Default only when MCP status clearly indicates completed; otherwise add `agreementStatus` to `source.missingFields`. |
| `agreement_value` | `agreementValue` | number | Yes | Extracted commercial term or metadata | `82000` | Use `null`; add `agreementValue` to `source.missingFields`; the `$50k` rule cannot be evaluated. |
| `currency` | `currency` | string | Yes | Extracted commercial term or metadata | `USD` | Use `USD` only when the account/demo default is known; otherwise add `currency` to `source.missingFields`. |
| `renewal_type` | `renewalType` | enum | Yes | Extracted renewal provision | `auto_renews` | Use `not_extracted`; add `renewalType` to `source.missingFields`. |
| `renewal_date` | `renewalDate` | ISO date string or `null` | Yes | Extracted renewal provision | `2026-10-15` | Use `null`; add `renewalDate` to `source.missingFields`; classify as needs review once policy runs. |
| `notice_period_days` | `noticePeriodDays` | number or `null` | Yes | Extracted renewal/termination provision | `60` | Use `null`; add `noticePeriodDays` to `source.missingFields`; `noticeDeadline` cannot be derived. |
| `notice_deadline` | `noticeDeadline` | ISO date string or `null` | Yes | Derived by app or extracted directly | `2026-08-16` | Derive from `renewalDate - noticePeriodDays` when possible; otherwise use `null` and add `noticeDeadline` to `source.missingFields`. |
| `has_termination_for_convenience` | `hasTerminationForConvenience` | boolean or `null` | Yes | Extracted termination provision | `false` | Use `null`; add `hasTerminationForConvenience` to `source.missingFields`; policy should route for legal review. |
| `termination_fee` | `terminationFee` | string | No | Extracted termination provision | `None after current term` | Use `Not extracted`; add `terminationFee` to `source.missingFields` only when the field is expected for the record. |
| `business_owner` | `businessOwner` | string | No | Docusign metadata, custom field, or ingest metadata | `Procurement Ops` | Show `Unassigned` or `Not provided`; do not treat as an extraction failure. |
| Docusign agreement ID | `agreementId` / `source.recordId` | string | Yes | Docusign source metadata | `demo-brightline-001` | Drop the row only if no stable ID is available. |
| Docusign agreement URL | `source.recordUrl` | string or omitted | No | Docusign source metadata | Docusign agreement URL | Omit when unavailable. |

## Normalization Rules

- `agreementStatus` should normalize to `completed` for completed Agreement
  Manager records and `uploaded_historical` for historical/imported records.
- `renewalType` must normalize to one of `auto_renews`, `manual_renewal`,
  `evergreen`, `none`, or `not_extracted`.
- `noticeDeadline` should be calculated when `renewalDate` and
  `noticePeriodDays` are present and Agreement Manager does not return a direct
  deadline.
- `daysUntilNoticeDeadline` should be calculated from `asOfDate` and
  `noticeDeadline`; keep it `null` when the deadline is missing.
- `agreementValue` should be a number without currency symbols or commas.
- `terminationFee` can remain a short text summary because the first policy pass
  only needs to know whether termination for convenience exists.

## Missing-Data Semantics

Missing fields are not neutral. They should be displayed as extraction gaps and
kept in `source.missingFields` so the later policy engine can distinguish:

- Missing `renewalDate` or `noticePeriodDays`: renewal risk cannot be timed;
  route to needs review.
- Missing `noticeDeadline`: derive it if possible; otherwise route to needs
  review.
- Missing `agreementValue`: the `$50k` rule cannot be evaluated; route to needs
  review when other renewal risk is present.
- Missing `hasTerminationForConvenience`: legal-review path, because the buyer's
  exit right is unknown.
- Missing `businessOwner`: do not block risk review. Route follow-up to a
  configured workflow owner, review queue, or fixed demo recipient until owner
  resolution is added.

## IAM Toolkit Setup Notes

Docusign's IAM Toolkit is the setup surface for Agreement Manager custom
fields, custom agreement types, field mappings, AI training sets, and extraction
testing. For this demo, use it to make the field names above real Agreement
Manager fields and to validate extraction quality before relying on MCP output.

Suggested sandbox workflow:

1. Install and authenticate the Docusign Agreement CLI.
2. Retrieve the current Agreement Manager catalog with `ds agm get catalog`.
3. Add the renewal-risk fields to the Agreement Manager manifest.
4. Map the fields to the supplier agreement type used for the demo.
5. Upload the package with `ds agm upload`.
6. Run `ds agm get catalog` again and confirm the field names exist.
7. Add the generated agreement PDFs as test agreements.
8. Generate and fill the extraction test template with ground-truth values.
9. Run the extraction test and compare results against
   `examples/agreement-demo-fixture.json`.

For fields that do not naturally live in the agreement text, such as
`business_owner`, supply metadata during ingestion or configure the field as a
metadata/custom field instead of expecting AI extraction from the PDF. The demo
should not require this field for classification; Workflow Builder routing can
use a separate configured owner or review queue.

References:

- Docusign IAM Toolkit overview: https://developers.docusign.com/iam-toolkit/
- Configure agreement types and fields: https://developers.docusign.com/iam-toolkit/command-line/configure-agreement-types-and-fields/
- Test agreement customizations: https://developers.docusign.com/iam-toolkit/command-line/test-agreement-customizations/
- Bulk ingest agreements with metadata: https://developers.docusign.com/iam-toolkit/command-line/bulk-ingest-agreements/
