# General rules (every question)

## Scope

- Every Ask UBM table is already limited to one company: the customer picked
  on the page. Never filter by customer, and never try to read other tables.
- "My", "our", "we" and "us" in a question mean this company's data.
- The company's months, location count, utilities with their units, and the
  charge categories on its bills are given with each question. Use those
  values; do not guess others.

## Picking the table

| The question is about… | Use |
|---|---|
| Usage, consumption, total cost, spend, rates, trends, per square foot, weather | `monthly_usage` |
| What a bill's charges are made of: supply vs delivery, demand, taxes, fees, late fees, penalties, a single bill, invoice dates | `line_items` |
| Bills that are late, missing or overdue, or when a bill is expected | `late_bills` |
| Bill errors, validation problems, exceptions, open or resolved issues | `bill_errors` (plus `error_bills` for bill ids or locations) |

Total cost always comes from `monthly_usage`, never from `line_items`: not
every bill has its lines broken out.

## Dates

- "This year" and "last year" are calendar years. "Last 12 months" means the
  12 full months before the current month.
- Filter dates with ranges, for example `month >= '2025-01-01' AND month <
  '2026-01-01'`. Never put `EXTRACT`, `date_trunc` or a cast on the column in
  `WHERE`: it stops the database using its indexes and large customers time
  out.
- Month columns hold the first day of the month.

## Text values

- Compare text case-insensitively: `UPPER(utility) = 'ELECTRIC'`,
  `location_name ILIKE '%cherry creek%'`. Units, utilities, names and
  categories vary in case and spelling between customers and vendors.
- Utilities are stored in capitals, for example `ELECTRIC`, `NATURALGAS`,
  `WATER`.

## Adding things up

- Never add usage or quantities across different utilities or units: group by
  utility and unit whenever usage is summed. Dollars can be added across
  utilities.
- Round dollars to 2 decimals and usage to whole numbers.
- Divide with `NULLIF(…, 0)` so an empty month gives an empty value, not an
  error.

## The result

- One statement: `SELECT`, or `WITH … SELECT`. No semicolon, no comments.
- Name every output column in readable snake_case (`total_cost`, not `sum`).
- Sort sensibly and return at most 100 rows. For a top or bottom N, return
  exactly N rows, add `NULLS LAST`, and leave out rows where the ranked number
  is empty.
- Each row of a result should be one kind of thing. Do not mix vendor totals
  and account rows in one result: the chart cannot draw it.
- If the tables cannot answer the question, return exactly
  `SELECT 'not available in this data' AS answer`.

## To confirm

- "Last 12 months": the 12 full months before the current month (used above),
  or including the current, part-billed month?
- Fiscal years: does any customer report on a year that does not start in
  January?
