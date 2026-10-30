# Bill errors (`bill_errors`, `error_bills`)

## Use it for

Validation errors UBM raised on bills: how many, which kinds, which vendors,
accounts, bills or locations have the most, and how many are open or
resolved.

## Where the data comes from

The Error Explorer's data:

- `bill_management_v2.bill_errors`: the errors.
- `bill_records`: the bill's statement date, vendor code and account.
- `bill_validation_definitions`: the error's name and processing stage.
- `providers_pretty_name` and `customers_vendors_pretty_name`: vendor display
  names, as on the Analytics page.
- For `error_bills`: `bill_metas_bill_records` (the UBM bill id), and
  `bill_items_virtual_accounts` with `locations` (the location).

## One row is

- `bill_errors`: one error. A bill can have many.
- `error_bills`: one bill that has errors. Join them on `bill_ref`.

## Fields

`bill_errors`

| Field | Type | Meaning |
|---|---|---|
| `error_id` | integer | Error id |
| `code` | integer | Validation check code, for example 3004 |
| `error_name` | text | What the check found, for example Duplicate bill |
| `category` | text | Component that raised it, for example Bill Validator, Bill Analyser |
| `severity` | integer | 10 to 80; higher is more serious |
| `stage` | text | Processing stage the check belongs to, for example `integrity_check`, `data_audit_1` |
| `status` | text | `open` or `resolved` |
| `raised_at` | timestamp | When the error was raised |
| `bill_ref` | integer | The bill the error is on |
| `invoice_date` | timestamp | Statement date of the bill |
| `vendor` | text | Utility company |
| `account` | text | Utility account number |
| `utility` | text | Utility type in capitals (may be empty) |
| `meter` | text | Meter serial (may be empty) |
| `message` | text | The error message, with specifics such as amounts or day counts |

`error_bills`

| Field | Type | Meaning |
|---|---|---|
| `bill_ref` | integer | Matches `bill_errors.bill_ref` |
| `bill_id` | integer | UBM bill id |
| `location_id`, `location_name` | | The bill's location (may be empty) |

## Rules already applied

- Errors raised in the last 24 months only.
- Current bills only: errors on bills that were deleted or replaced are left
  out. Counting them would show tens of thousands of "open" errors that no
  longer matter.
- Each bill's location is the first location its lines map to, so location
  totals are close but not exact.

## What people say → what to use

| They say | Use |
|---|---|
| errors, exceptions, issues, validation problems | `bill_errors` |
| how many errors | `COUNT(*)`, open and resolved together, plus the open count |
| how many bills have errors, affected bills | `COUNT(DISTINCT bill_ref)` |
| kind of error, error type, check | `code` and `error_name` together: one code can mean different checks |
| open, unresolved, outstanding | `status = 'open'` |
| fixed, cleared, resolved | `status = 'resolved'` |
| serious, critical, high severity | a `severity` threshold; show the number, there are no official labels |
| by location, which bill | join `error_bills` on `bill_ref` |

## Patterns

- An error type is `code` + `error_name`: group by both.
- Severity values seen are 10, 20, 30, 40, 60 and 80. Show the number; do not
  invent labels such as "critical".
- Show stages in plain words: `INITCAP(REPLACE(stage, '_', ' '))`.
- The table is large: always aggregate, and filter dates with a range on
  `raised_at`.
- To rank individual bills, group by `bill_ref` (always filled) and show
  `bill_id` beside it.

## Examples

Most common open error types:

```sql
SELECT code, error_name, COUNT(*) AS errors, COUNT(DISTINCT bill_ref) AS bills
FROM bill_errors
WHERE status = 'open'
GROUP BY code, error_name
ORDER BY errors DESC NULLS LAST
LIMIT 10
```

Vendors with the most bill errors in 2026, open and resolved:

```sql
SELECT vendor,
       COUNT(*) AS errors,
       COUNT(*) FILTER (WHERE status = 'open') AS open_errors,
       COUNT(DISTINCT bill_ref) AS bills_with_errors
FROM bill_errors
WHERE raised_at >= '2026-01-01' AND raised_at < '2027-01-01'
GROUP BY vendor
ORDER BY errors DESC NULLS LAST
LIMIT 10
```

Locations with the most bills that have open errors:

```sql
SELECT b.location_name, COUNT(DISTINCT e.bill_ref) AS bills_with_open_errors
FROM bill_errors e
JOIN error_bills b ON b.bill_ref = e.bill_ref
WHERE e.status = 'open'
GROUP BY b.location_name
ORDER BY bills_with_open_errors DESC NULLS LAST
LIMIT 10
```

## Pitfalls

- Counting errors when the question asks about bills, or the other way round.
- Grouping by `code` alone: two checks can share a code.
- Joining `error_bills` when no bill id or location is needed: it adds work
  and nothing else.
- Questions about errors more than 24 months old: they are not in this table.

## Decisions

- Severity is shown as its number (higher is more serious). There are no
  named levels.
- Stages are shown in plain words by turning the code into a title:
  `INITCAP(REPLACE(stage, '_', ' '))`, so `data_audit_1` reads Data Audit 1.
- "How many errors" counts open and resolved errors together, and always
  shows how many of them are still open.
