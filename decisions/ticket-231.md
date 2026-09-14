# Ticket #231 — Freeze the issued recommendation at send time

## HIGH-IMPACT

- **Included `hitCost` in `plan_snapshot`, beyond the ticket's literal
  "at minimum" field list.** Chose to include it because the scorecard's
  existing `PlanRecord`/`scoreGameweek` machinery requires a hit cost to
  compute net points from actuals, and reusing that machinery unmodified
  (rather than writing a second scoring path) is the ticket's own stated
  intent — "this ticket only changes where the scorecard gets its input."

- **When several `notifications` rows exist for one gameweek,
  `pickLatestSnapshotByGameweek` takes the most recently `sent_at` row
  (any outcome, sent or failed).** Chose most-recent-by-send-time because a
  daily refresh or a 24h/10h re-run can change the plan mid-week, and the
  most recent send is the frozen record closest to what Keshav actually saw
  before the deadline — the honest target for "what was issued."

- **A snapshot whose player `code` no longer resolves against the current
  `players` table excludes that gameweek as `reconstructionFailed`, rather
  than silently falling back to `recommendations`.** Chose fail-closed
  because silently downgrading would hide exactly the kind of drift this
  column exists to catch, matching the scorecard's existing "exclude, never
  partially or silently score" discipline for decision reconstruction.

## ROUTINE

- Mapped the ticket's "expected points figure" to `net_points` (full
  precision, i.e. after hit cost), stored alongside `confidence_band`
  verbatim — Tier 3, a naming/shape convention with no scope impact.
