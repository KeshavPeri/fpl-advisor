## Problem

The transfer decision has never been measured, and it is the decision the
user complains about most. His gameweek 4 note was half about captaincy — now
covered by the captaincy scorecard — and half about a transfer: the app said
Tavernier for Wirtz when the obvious move was Bruno for Palmer.

Everything measured so far stops at the projection. The backtest scores
projected points against actual points. Nothing scores whether the TRANSFER
the solver chose was worth making.

This was impossible until now because `player_match_stats` carries no price,
so a past-season squad could not be priced and no alternative transfer could
be costed. `public.player_gameweek_history` now carries `now_cost` per player
per gameweek for both seasons, which removes that blocker.

## The work

New read-only script `scripts/transfer-scorecard.ts`, writing to
`./out/transfer-scorecard.md`. Changes no model file, no recommendation, no
solver configuration.

For every gameweek with a `notifications.plan_snapshot` (#233) and settled
actuals in `prediction_log`:

- **The issued transfer** — player out, player in, hit cost — from the
  snapshot, never from the mutable `recommendations` table.
Note also that `bonus`, `bps` and `starts` in `player_gameweek_history` are
season-cumulative-to-date, not per-gameweek (#248). This ticket does not read
them, but do not assume otherwise if you reach for them.

- **Realised gain over the following gameweek**: the incoming player's actual
  points minus the outgoing player's actual points, minus the hit cost.
  Report the per-gameweek value and the pooled mean.
- **Realised gain over the following five gameweeks**, same arithmetic summed
  across the horizon the solver actually optimises over. A transfer judged on
  one week is judged on noise.
- **The roll baseline**: what the score would have been had no transfer been
  made. A transfer that gains less than rolling is a transfer that should not
  have happened, and the count of those is the headline number.
- **The affordable ceiling**: the best single transfer available under that
  gameweek's real prices and the squad's real bank, scored in hindsight. This
  is a ceiling nobody could hit, and it must be labelled that way in the
  report — its use is showing how much of the available gain the solver
  captured, not setting a target.

Price every alternative at that gameweek's own `now_cost` from
`player_gameweek_history`. **`now_cost` there is DECIMAL MILLIONS (e.g.
`5.8`), not integer tenths** — verified by #248 against a live
`bootstrap-static/` fetch the same day. `public.players.now_cost` and
FPL's own API use integer tenths, so the two are NOT interchangeable and
mixing them silently misprices every squad by a factor of ten. Assert the
unit with a named test.

Never read a current price for a past gameweek. That lookahead is the exact
class of leak that cost four tickets on the fixture term.

Pool from the underlying gameweek rows, never a mean of per-gameweek means.
Print the sample size beside every figure. There are at most four gameweeks
of snapshots, so state the limitation in the report itself, in the same shape
`bonus-validation-report.ts` states its own.

## Falsification gate

None — read-only instrument, no claim that a number will move.

Its success condition is that it runs against live data and produces a pooled
realised gain and a roll-baseline comparison. If no gameweek has both a
snapshot and settled actuals, **stop and report that** rather than shipping a
report that prints nothing.

## Definition of done — offline only

Everything here must be doable with no credentials and no network.

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: a roll (no transfer) is scored as a roll, not as a zero-point
  transfer; the hit cost is subtracted exactly once; a gameweek with no
  snapshot is excluded and named; the affordable ceiling respects both bank
  and the 3-per-club limit; prices come from the transfer's own gameweek;
  `now_cost` is treated as decimal millions and never as integer tenths.

## Post-merge owner check (does not block this PR)

Keshav runs the script against live data and pastes the report. **Do not put
this in the Definition of Done and do not block on it.** If the script cannot
produce figures because no gameweek yet has both a snapshot and settled
actuals, that is the expected early-season state, not a failure — the report
must say so clearly and exit 0.

## Out of scope

- Changing the solver, its objective, its horizon, or
  `scripts/generate-recommendations.ts`. This ticket measures. Acting on what
  it finds needs the number to exist first.
- `scripts/recommendation-scorecard.ts` — it has its own sections and its own
  ticket history; this is a separate report.
- `src/lib/projection/*`, `scripts/project-points.ts`,
  `scripts/preflight-check.ts`, `scripts/team-strength-diagnostic.ts`,
  `scripts/bonus-validation-report.ts`, `scripts/ingest-core-insights.ts`.

## Files

- `scripts/transfer-scorecard.ts` (new)
- `scripts/transfer-scorecard.test.ts` (new)
