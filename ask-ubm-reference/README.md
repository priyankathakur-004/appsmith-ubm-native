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

## How the notes are used

The page cannot read files from this folder while it runs, so the rules in
these notes are copied into the page, `AskActions` in Ask UBM:

- each table's `about`, `cols` and `notes` in `_tables` (the topic notes'
  fields, phrase mappings, patterns and decisions);
- the rules list in `_sqlPrompt` (`general.md`).

These files stay the source: change a note here first, then copy the change
into the page. The SQL examples are for people checking answers; they are not
sent to the AI.

## Writing a note

- Each section heading is the same in every note, so a section can be picked
  out on its own.
- Every SQL example must pass the page's SQL check: one SELECT (or WITH …
  SELECT) on the Ask UBM tables, with no comments and no semicolon. They are
  written against the Ask UBM tables, which are already limited to one
  customer, so they never filter by customer.
- Where UBM gave no official rule, the note states the rule we chose under
  **Decisions**. These have been shared with the client, who can ask for any
  of them to change.
