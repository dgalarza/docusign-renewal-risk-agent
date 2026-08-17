# Example Supplier Agreements

These fictional Markdown agreements are safe for Docusign sandbox upload and are designed to exercise the renewal-risk policy cases used by the Supplier Renewal Risk Agent demo.

The Markdown files in this directory are the editable source of truth. Upload-ready PDFs are generated into `examples/agreements/dist/` and should be used for Docusign sandbox upload instead of uploading the Markdown source files.

Use `examples/agreement-demo-fixture.json` as the structured companion fixture. It maps each agreement file to classifier-ready data and expected findings. Expected classifications assume an `asOfDate` of `2026-07-01`, matching the fixture metadata.

| File | Supplier | Scenario | Expected classification | Expected follow-up action | Key extraction signals |
| --- | --- | --- | --- | --- | --- |
| `brightline-office-supplies.md` | Brightline Office Supplies LLC | Auto-renewing agreement over $50k requiring review | `needs_review` | `owner_review` | Annual value is USD 82,000; auto-renews on 2026-10-15; 60-day notice deadline is 2026-08-16. |
| `meridian-catering-services.md` | Meridian Catering Services Inc. | Notice deadline within 30 days | `urgent` | `owner_review` | Auto-renews on 2026-08-19; 30-day notice deadline is 2026-07-20. |
| `cloudforge-analytics.md` | CloudForge Analytics Inc. | High-value auto-renewal with notice deadline within 30 days | `urgent` | `owner_review` | Annual value is USD 125,000; auto-renews on 2026-08-15; 30-day notice deadline is 2026-07-16. |
| `northstar-maintenance-group.md` | Northstar Maintenance Group LLC | Notice deadline already passed | `blocked` | `escalate_missed_deadline` | Auto-renews on 2026-07-20; 45-day notice deadline was 2026-06-05. |
| `atlas-calibration-labs.md` | Atlas Calibration Labs Inc. | High-value manual renewal with complete notice terms | `standard` | `no_action` | Annual value is USD 96,000; manual renewal on 2026-09-30; 45-day notice deadline is 2026-08-16. |
| `clearview-inventory-platform.md` | Clearview Inventory Platform LLC | Missing renewal date and notice period | `needs_review` | `legal_review` | Auto-renewal language refers to the order form, but the renewal date and notice period are not stated in the agreement text. |

## Upload-Ready Files

Upload the generated PDFs from `examples/agreements/dist/`:

- `atlas-calibration-labs.pdf`
- `brightline-office-supplies.pdf`
- `clearview-inventory-platform.pdf`
- `cloudforge-analytics.pdf`
- `meridian-catering-services.pdf`
- `northstar-maintenance-group.pdf`

To regenerate the PDFs after editing agreement Markdown:

```shell
npm run build:agreements
```

## Upload Notes

- Upload each generated PDF as the completed agreement for the named fictional supplier.
- After Agreement Manager extracts fields, compare the extracted values with `examples/agreement-demo-fixture.json`.
- The examples deliberately include obvious renewal clauses so reviewers can tell which policy path each file is meant to test without relying on private data.
