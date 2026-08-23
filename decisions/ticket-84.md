# Ticket #84 — Add the commit action

## HIGH-IMPACT

- **A separate `recommendation_decisions` table, not a column on `recommendations`, and the row
  carries a full `snapshot` rather than only a foreign key.** Because `recommendations` is
  upserted every solver run and #60 added a `DELETE` grant on it so a re-run can remove orphaned
  plans — a commit recorded on that table could be destroyed by the next nightly run. A decision
  is a historical fact about what Keshav did and must outlive the recommendation it refers to,
  which is also why the row stores a `snapshot` of what was actually accepted rather than only
  pointing at a recommendation row that may later be replaced. Pre-specified by the ticket itself;
  implemented as specified.
- **No foreign key from `recommendation_decisions` to `recommendations`, only to `gameweeks`.**
  Because an FK to `recommendations` would either block the solver's own cleanup deletes or force
  `ON DELETE SET NULL`/cascade semantics that contradict the point above — a decision must survive
  the recommendation row being replaced. This follows directly from the first decision, not a
  separate ticket-authored instruction, so it's logged as its own line.
- **`kind text CHECK (kind IN ('commit', 'override'))` added now, though only `'commit'` is
  written by this ticket.** Because item 20 (override registration) will record into the same
  ledger later, and adding the column and its CHECK constraint now costs nothing while saving a
  second migration and a second manual-apply step. Pre-specified by the ticket itself.

## ROUTINE

- **Commit targets the recommendation's own `gameweek_id`**, not the home screen's current target
  gameweek. The two differ only when the card is showing a stale plan; committing the stale plan
  actually on screen is the more literal reading of "commits the recommendation it belongs to."
- **`solver_run_id` is read via a second, separate bounded query** against `recommendations`
  rather than threading it through the existing `VerdictRecommendationData` type, because
  `src/lib/verdict/` is out of scope for this ticket's diff and that type doesn't expose the
  column.
- **A commit-context read failure renders inline error text directly**, not routed through
  `derive.ts` — matches `VerdictCard`'s own existing top-level error-state pattern; the `derive.ts`
  purity/testing requirement in the DoD is specifically about *write* failures, which is where the
  derived-view logic lives.
