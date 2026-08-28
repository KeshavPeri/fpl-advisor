# Ticket #132 — Fix two reading instruments — the solver Results parser and the calibration report's clean-sheet source

## HIGH-IMPACT

- **The ticket as a whole is Tier 2** per its own framing — it changes what a decision-supporting
  instrument measures.
- **Column boundaries in the solver log are derived by splitting on whitespace runs of two or more
  spaces, re-derived from each log's own header, rather than any stored character offset.** Because
  the two real logs captured in production have different column widths for the same header names,
  and the ticket explicitly forbids a stored offset constant, deriving boundaries fresh from each
  log's own header is the only approach that survives a third log shape nobody has seen yet.
- **A match row with a null `team_goals_conceded` is kept in the actual-side aggregation — only its
  clean-sheet and goals-conceded contribution and denominator are excluded, not the whole row.**
  Because the DoD's wording ("excluded from the clean-sheet and goals-conceded figures") is scoped
  to those two figures specifically, and a missing team-level goals-conceded value says nothing
  about whether that player scored a goal or made a tackle that gameweek — dropping the whole row
  would discard real, correct signal for the sake of implementation simplicity.
- **`CLEAN_SHEET_RATE_UPPER_BOUND` is set to 60%.** Because the ticket specifies testing at 59% and
  61%, and states the true rate is roughly 28% — 60% is a deliberately generous ceiling, clear of
  both the real rate and the historical bug's ~95%, so it never fires on plausible data but reliably
  catches the recurring defect (this is the third time this exact bug has appeared).

## ROUTINE

- `SolverSolution.playerSold` / `playerBought` typed `string | null` (required, not optional) —
  matches this file's existing no-optional-fields convention.
- `ActualAggregationInput.teamGoalsConcededKnown` made optional, defaulting to `true` when absent —
  mirrors the existing `ProjectedAggregationInput.excludedBonus?` convention in the same file, so
  pre-existing test fixtures needed no changes.
- Error/log wording, the new "Clean-sheet rate, by position" table's columns, and the provenance-line
  phrasing are original compositions in the file's established voice, not quoted from the ticket.
- **Chip timing observed on the 29 August 2026 production run, worth recording per the ticket's own
  instruction:** the chip-free solve's best score is 269.85 and the chip-enabled best is 288.18, a
  delta of +18.33 over the horizon. The chip-enabled solve played BB in gameweek 2 and TC in
  gameweek 3, where the probe two days earlier played TC in gameweek 2 and BB in gameweek 4 on a
  near-identical squad. The timing is unstable between runs; the delta is not — confirming #126's
  design decision to compare chip-enabled against chip-free within the same run, never across runs.
- **2,520 match rows are skipped by the calibration report for an unresolvable `player_code`** — 16%
  of the season, real, unaddressed by this ticket, and worth its own ticket to investigate.
