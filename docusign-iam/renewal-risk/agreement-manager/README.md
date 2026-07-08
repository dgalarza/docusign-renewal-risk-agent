# Agreement Manager IAM Setup

This directory contains the Docusign IAM Toolkit setup for the renewal-risk demo.
It defines the `Supplier Renewal Agreement` custom agreement type, the demo
extraction fields, and the fictional PDFs used for training and testing.

## Versioned Files

- `configs/agreement-manager-manifest.json` defines the custom agreement type,
  extraction fields, dropdown values, and training document references.
- `files/train/*.pdf` are fictional supplier agreements used as training docs.
- `files/test/*.pdf` are the same fictional agreements staged for validation.
- `tests/testing.csv` is the ground-truth extraction template for the test docs.

Generated catalog snapshots, upload tracking IDs, auth state, and tool-specific
scaffold files are intentionally ignored by git.

## Commands

Run commands from `docusign-iam/renewal-risk`.

```bash
ds agm validate
ds agm upload
ds agm get catalog
ds agm test generate-test-template --output agreement-manager/tests/testing.csv
ds agm test run
```

Use `ds agm get catalog` after upload to confirm the custom agreement type and
fields exist in the active sandbox. Do not commit the generated
`custom-catalog.json`, `standard-catalog.json`, or upload tracking files.

## Notes

The custom agreement type extracts only what the app's policy engine consumes:
supplier name, agreement value, currency, renewal type, renewal date, notice
period, and notice deadline. Business owner and termination-rights fields are
intentionally out of scope for this demo — the app does not read them, so they
are not defined here.
