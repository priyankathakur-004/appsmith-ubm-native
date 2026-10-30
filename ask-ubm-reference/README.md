# Ask UBM reference notes

One note per topic, describing how a question about that topic maps to the
Ask UBM tables, their fields and UBM's business rules. They are written for
the AI that turns questions into SQL, and for the people who check its
answers.

| File | Topic | Ask UBM tables |
|---|---|---|
| [general.md](general.md) | Rules for every question | all |
| [usage-and-cost.md](usage-and-cost.md) | Monthly usage, total cost, rates, per square foot, weather | `monthly_usage` |
| [bill-charges.md](bill-charges.md) | Kinds of charge on bills: supply, delivery, demand, taxes, fees, late fees | `line_items` |
| [late-bills.md](late-bills.md) | Bills expected but not yet received | `late_bills` |
| [bill-errors.md](bill-errors.md) | Validation errors UBM raised on bills | `bill_errors`, `error_bills` |

## How the notes will be used

Today the AI gets a short description of each table (the `about` and `cols`
in `AskActions._tables`). The plan is to replace that with these notes:

1. For each question, pick the topic or topics it is about.
2. Give the AI `general.md` plus only those topic notes, so prompts stay small.
3. Show the rules that were applied in the answer's "How this was calculated"
   panel.

The page cannot read files from this folder while it runs, so the text will
be copied into the page (or a table in UBM_Appsmith_DB) when it is wired in.
These files stay the source: change them here first.

## Writing a note

- Each section heading is the same in every note, so a section can be picked
  out on its own.
- Every SQL example must pass the page's SQL check: one SELECT (or WITH …
  SELECT) on the Ask UBM tables, with no comments and no semicolon. They are
  written against the Ask UBM tables, which are already limited to one
  customer, so they never filter by customer.
- Anything not yet confirmed with the client is listed under **To confirm**,
  not stated as a rule.
