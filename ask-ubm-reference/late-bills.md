# Late bills (`late_bills`)

## Use it for

Bills that are late, missing or overdue; when the next bill is expected; how
late an account is; accounts that have stopped billing.

## Where the data comes from

The same data as UBM's Late Bills report:

- `bill_management_v2.reports_new_virtual_accounts`: one row per service
  (billing account + meter + utility) with its status and latest bill date.
- The latest bill per service, from `analytics_bills_items`, `bill_metas`,
  `bill_items` and `bill_records`, for its type, due date, days of service and
  the date the next bill is expected.
- `bill_management_v2.locations` for the building type.

## One row is

One open service: a billing account + service account + meter + utility. An
account with several meters has several rows.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `billing_account` | text | Utility billing account number |
| `service_account` | text | Service account id |
| `meter` | text | Meter id |
| `utility` | text | Utility type in capitals |
| `vendor` | text | Utility company |
| `location_id`, `location_name`, `building_type` | | Site |
| `account_status` | text | `Open` or `Unknown` |
| `last_bill_date` | date | Statement date of the latest bill received |
| `last_bill_type` | text | `live`, `historical`, `setup` or `special` |
| `last_due_date` | date | Due date of the latest bill |
| `days_of_service` | integer | Days the latest bill covered |
| `expected_bill_date` | date | When the next bill was expected |
| `days_late` | integer | Business days since `expected_bill_date`; 0 or less when not yet due |
| `is_late` | boolean | Late by UBM's rule (below) |

## Rules already applied

- Only services with status `Open` or `Unknown` that have a billing account.
- `days_late` counts business days (Monday to Friday) after the expected
  date, as UBM does. Before the expected date it is the calendar days to go,
  as 0 or a negative number.
- **Late** (`is_late`) = the expected date has been reached **and** the latest
  bill is from the last 6 months. Services silent for longer are treated as
  stopped, not late.

## What people say → what to use

| They say | Use |
|---|---|
| late bills, overdue, missing bills | `WHERE is_late` |
| how many late accounts | `COUNT(DISTINCT billing_account) WHERE is_late`, as the report counts |
| how late, days overdue | `days_late` |
| due soon, expected next week | `expected_bill_date` range, `NOT is_late` |
| stopped billing, no bill for months | `last_bill_date < CURRENT_DATE - INTERVAL '6 months'` |

## Examples

How many accounts have late bills, by vendor:

```sql
SELECT vendor, COUNT(DISTINCT billing_account) AS late_accounts
FROM late_bills
WHERE is_late
GROUP BY vendor
ORDER BY late_accounts DESC NULLS LAST
```

The 10 most overdue accounts:

```sql
SELECT billing_account, vendor, location_name, utility, expected_bill_date, MAX(days_late) AS days_late
FROM late_bills
WHERE is_late
GROUP BY billing_account, vendor, location_name, utility, expected_bill_date
ORDER BY days_late DESC NULLS LAST
LIMIT 10
```

Bills expected in the next 14 days:

```sql
SELECT billing_account, vendor, location_name, utility, expected_bill_date
FROM late_bills
WHERE expected_bill_date >= CURRENT_DATE AND expected_bill_date < CURRENT_DATE + 14
ORDER BY expected_bill_date
LIMIT 100
```

## Pitfalls

- Counting rows instead of accounts: an account with three meters is three
  rows. The report's "late accounts" is `COUNT(DISTINCT billing_account)`.
- Treating `days_late` as calendar days: it is business days once overdue.
- Treating every service with an old last bill as late: without a bill in the
  last 6 months it is not counted as late.

## Decisions

- Services with status `Open` and `Unknown` are both included, as in UBM's
  Late Bills report.
- A service with no bill for more than 6 months has stopped billing and is
  not counted as late, for every customer.
