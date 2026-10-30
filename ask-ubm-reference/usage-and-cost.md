# Usage and cost (`monthly_usage`)

## Use it for

Usage (consumption), total cost or spend, cost and usage trends, all-in rates
($ per kWh, per therm…), comparisons between locations, vendors, utilities,
states or building types, per-square-foot figures, and weather (degree days).

Not for: what a bill's charges are made of (use `line_items`), late bills or
bill errors.

## Where the data comes from

- `bill_management_v2.reports_customer_monthly_usage`, UBM's monthly usage
  report, limited to the customer.
- `bill_management_v2.locations` for the site's city, state, building type and
  floor area.

## One row is

One location + account + meter + utility + bill type + calendar month. Bills
are prorated into calendar months, so a bill running 15 March – 14 April is
split between March and April.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `month` | date | First day of the calendar month |
| `utility` | text | Utility type in capitals: `ELECTRIC`, `NATURALGAS`, `WATER`, … |
| `bill_type` | text | `Full Service`, `Distribution Only` or `Supply Only` |
| `location_id` | integer | Site id |
| `location_name` | text | Site name |
| `city`, `state` | text | Site city and two-letter US state |
| `building_type` | text | For example Office, Retail, Warehouse |
| `square_feet` | numeric | Site floor area |
| `account` | text | Utility account number |
| `meter` | text | Meter serial number |
| `vendor` | text | Utility company (may be empty) |
| `consumption` | numeric | Usage for the month, in `consumption_unit`, counted once (see rules) |
| `consumption_unit` | text | Unit of `consumption`: kWh, therms, gallons, … |
| `cost` | numeric | Total charges for the month, in US dollars |
| `cdd`, `hdd` | numeric | Cooling and heating degree days for the month |

## Rules already applied

- **Third-party supply is counted once.** When a site buys supply from a
  third party, it gets a Distribution Only bill from the utility and a Supply
  Only bill from the supplier, and both carry the same kWh. A Supply Only row
  therefore shows `consumption` 0 when the same location, utility and month
  has a delivery bill. Its `cost` is always kept: it is a separate charge.
- Usage is prorated to calendar months.

## What people say → what to use

| They say | Use |
|---|---|
| usage, consumption, kWh, therms, gallons, how much we used | `SUM(consumption)` grouped by `utility`, `consumption_unit` |
| cost, spend, bill amount, how much we paid | `SUM(cost)` |
| rate, price, $/kWh, unit cost, all-in rate | `SUM(cost) / NULLIF(SUM(consumption), 0)`, per utility and unit |
| electricity, power | `UPPER(utility) = 'ELECTRIC'` |
| gas, natural gas | `UPPER(utility) = 'NATURALGAS'` |
| site, building, facility, store, property | `location_name` / `location_id` |
| utility company, provider, supplier | `vendor` |
| per square foot, EUI-style, intensity | divide by `square_feet`, sites of at least 500 sq ft only |
| weather, degree days, hot / cold months | `cdd`, `hdd` |
| delivery vs supply | `bill_type` |

## Patterns

**Rates** are a ratio of totals, never an average of row rates:
`ROUND(SUM(cost) / NULLIF(SUM(consumption), 0), 4)`, grouped by utility and
unit.

**Per square foot**: only sites with `square_feet >= 500` (smaller values are
placeholders), and return how many sites were left out in a separate column.

**Trends**: group by `month`, order by `month`.

## Examples

Total cost by month for 2025:

```sql
SELECT month, ROUND(SUM(cost), 2) AS total_cost
FROM monthly_usage
WHERE month >= '2025-01-01' AND month < '2026-01-01'
GROUP BY month
ORDER BY month
```

Top 5 locations by electric usage in 2025:

```sql
SELECT location_name, consumption_unit, ROUND(SUM(consumption)) AS total_usage
FROM monthly_usage
WHERE UPPER(utility) = 'ELECTRIC' AND month >= '2025-01-01' AND month < '2026-01-01'
GROUP BY location_name, consumption_unit
HAVING SUM(consumption) IS NOT NULL
ORDER BY total_usage DESC NULLS LAST
LIMIT 5
```

All-in electric rate by vendor in 2025:

```sql
SELECT vendor, consumption_unit,
       ROUND(SUM(cost), 2) AS total_cost,
       ROUND(SUM(consumption)) AS total_usage,
       ROUND(SUM(cost) / NULLIF(SUM(consumption), 0), 4) AS cost_per_unit
FROM monthly_usage
WHERE UPPER(utility) = 'ELECTRIC' AND month >= '2025-01-01' AND month < '2026-01-01'
GROUP BY vendor, consumption_unit
ORDER BY cost_per_unit DESC NULLS LAST
```

Electric cost per square foot by location in 2025:

```sql
WITH site AS (
    SELECT location_id, location_name, MAX(square_feet) AS square_feet, SUM(cost) AS cost
    FROM monthly_usage
    WHERE UPPER(utility) = 'ELECTRIC' AND month >= '2025-01-01' AND month < '2026-01-01'
    GROUP BY location_id, location_name
)
SELECT location_name, ROUND(cost / square_feet, 2) AS cost_per_sq_ft,
       (SELECT COUNT(*) FROM site WHERE COALESCE(square_feet, 0) < 500) AS sites_left_out
FROM site
WHERE square_feet >= 500
ORDER BY cost_per_sq_ft DESC NULLS LAST
LIMIT 20
```

## Pitfalls

- Adding kWh and therms together. Always group usage by utility and unit.
- Averaging rates row by row. Divide total cost by total usage instead.
- Adding `consumption` of Supply Only rows on top of delivery rows: not
  needed, the table already counts it once.
- Adding up `cdd` or `hdd` across meters or accounts of one site: each row
  carries the site's degree days for the month, so a sum counts them once per
  meter.
- Comparing months here with invoice months in `line_items`: these are
  calendar months after proration, those are invoice dates.

## To confirm

- Which utilities, if any, should be left out of "total cost" (for example
  sewer or waste, if they appear)?
- Should "usage" questions about electricity also report demand (kW)? Demand
  is only in `line_items`.
- Degree days: are `cdd` and `hdd` the same for every meter of a site? The
  pitfall above assumes so.
