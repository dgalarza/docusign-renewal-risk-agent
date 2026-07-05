# Renewal Risk Extraction Fields

These fields represent Agreement Manager extracted data for the demo.

| Field | Type | Purpose |
| --- | --- | --- |
| `supplier_name` | string | Counterparty/vendor name. |
| `agreement_value` | number | Current annual or renewal value. |
| `currency` | string | Agreement currency. |
| `renewal_type` | enum | Auto-renewal, manual renewal, evergreen, or none. |
| `renewal_date` | date | Next renewal date. |
| `notice_period_days` | number | Required days of notice to cancel or change renewal. |
| `notice_deadline` | date | Last date to act before renewal. |
| `has_termination_for_convenience` | boolean | Whether buyer can terminate for convenience. |
| `termination_fee` | string | Extracted early termination fee or penalty. |
| `business_owner` | string | Internal owner responsible for review. |

