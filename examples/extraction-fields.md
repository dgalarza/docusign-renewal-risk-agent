# Renewal Risk Extraction Fields

These fields represent the Agreement Manager data contract for the demo. See
`docs/agreement-manager-field-mapping.md` for normalized schema mapping,
derivation rules, missing-data behavior, and Docusign CLI setup notes.

| Field | Type | Purpose | Demo source |
| --- | --- | --- | --- |
| `supplier_name` | string | Counterparty/vendor name. | Extracted party or agreement metadata. |
| `agreement_title` | string | Human-readable agreement title. | Agreement metadata. |
| `agreement_value` | number | Current annual or renewal value. | Extracted commercial term or metadata. |
| `currency` | string | Agreement currency. | Extracted commercial term or metadata. |
| `renewal_type` | enum | Auto-renewal, manual renewal, evergreen, or none. | Extracted renewal provision. |
| `renewal_date` | date | Next renewal date. | Extracted renewal provision. |
| `notice_period_days` | number | Required days of notice to cancel or change renewal. | Extracted renewal provision. |
| `notice_deadline` | date | Last date to act before renewal. | Derived from `renewal_date - notice_period_days` unless directly extracted. |
