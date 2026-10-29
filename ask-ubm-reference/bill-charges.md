# Bill charges (`line_items`)

## Use it for

What a bill's charges are made of: supply vs delivery, demand charges, taxes,
fees, late fees and penalties, individual bills and their lines, billed
rates, and invoice dates.

Not for: total cost or total usage (use `monthly_usage`). Not every bill has
its lines broken out, so totals here are lower than the real total.

## Where the data comes from

`bill_management_v2.analytics_billing_line_items`, limited to the customer.

## One row is

One line printed on one processed bill.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `bill_id` | integer | UBM bill id |
| `invoice_date` | timestamp | Bill statement date (midnight) |
| `invoice_month` | date | First day of the invoice month |
| `utility` | text | Utility type in capitals, for example `ELECTRIC` |
| `vendor` | text | Utility company |
| `location_id`, `location_name` | | Site |
| `account` | text | Utility account number |
| `category` | text | Charge group. The company's own categories are given with each question |
| `charge_code` | text | Standard code, for example `LATEFEE`, `OTH_PENALTY` |
| `description` | text | Line name as printed on the bill |
| `quantity` | numeric | Billed quantity, in `unit` (may be empty) |
| `unit` | text | Unit of `quantity`, for example `KWH`, `KW`, `THERM` |
| `charge` | numeric | Amount in US dollars |

## Rules already applied

- Only processed bills: bills still moving through UBM's workflow are left
  out.
- Historical bills are left out. They are back-loaded copies that repeat
  charges already on other bills. Setup, live and special bills are all real
  and are kept: a recently onboarded customer's bills are mostly setup bills.

## What people say → what to use

| They say | Use |
|---|---|
| late fee, late payment charge | `charge_code = 'LATEFEE'`. A negative amount is a refunded late fee |
| penalty | `charge_code = 'OTH_PENALTY'` |
| supply, delivery, distribution, taxes, fees | `category`, using the company's own category names |
| demand, kW, peak | lines with `UPPER(unit) = 'KW'` (see Patterns) |
| a specific bill | `bill_id`, or `account` + `invoice_date` |
| meter reading, usage on the bill | category `Usage Information` (charge 0) |

## Patterns

- **Group by the company's categories** for "what makes up my bills". Match
  them case-insensitively.
- **Usage Information lines are readings, not charges.** They carry a
  quantity (for example demand in kW) and a charge of 0. Leave them out of
  dollar totals, and use them for readings.
- **Peak demand**: `MAX(quantity)` of Usage Information lines with
  `UPPER(unit) = 'KW'`, per account or location and month. Demand *charges*
  are lines in a demand category with a dollar `charge`.
- Every answer from this table should say the figures cover bills with line
  detail, which may not include every bill.

## Examples

Late fees by vendor in 2025, with refunds netted off:

```sql
SELECT vendor, COUNT(DISTINCT bill_id) AS bills_with_late_fees, ROUND(SUM(charge), 2) AS late_fees
FROM line_items
WHERE charge_code = 'LATEFEE' AND invoice_date >= '2025-01-01' AND invoice_date < '2026-01-01'
GROUP BY vendor
ORDER BY late_fees DESC NULLS LAST
```

What my 2025 charges are made of, by category:

```sql
SELECT category, ROUND(SUM(charge), 2) AS total_charges
FROM line_items
WHERE invoice_date >= '2025-01-01' AND invoice_date < '2026-01-01'
  AND category NOT ILIKE 'usage information'
GROUP BY category
ORDER BY total_charges DESC NULLS LAST
```

Peak demand by location and invoice month in 2025:

```sql
SELECT location_name, invoice_month, MAX(quantity) AS peak_kw
FROM line_items
WHERE UPPER(unit) = 'KW' AND category ILIKE 'usage information'
  AND invoice_date >= '2025-01-01' AND invoice_date < '2026-01-01'
GROUP BY location_name, invoice_month
ORDER BY location_name, invoice_month
LIMIT 100
```

## Pitfalls

- Using this table for total cost: it misses bills without line detail.
- Counting Usage Information lines as charges, or adding their quantities to
  dollar totals.
- Adding quantities across different units (kWh and kW are different
  things).
- Comparing invoice months with `monthly_usage` months: those are prorated
  calendar months.
- Large customers have many lines: always filter `invoice_date` with a range
  and aggregate.

## To confirm

- The full list of `charge_code` values, and which ones mean "supply",
  "delivery", "taxes" and "fees". Today the AI relies on `category` for these.
- Is every Usage Information line with unit `KW` a demand reading, or do some
  carry other readings in kW?
- Should "late fees" also include penalties (`OTH_PENALTY`)?
