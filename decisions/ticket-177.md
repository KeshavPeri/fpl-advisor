# Ticket #177 — Build position priors from every historical row, not just survivors

## HIGH-IMPACT

- **Tier 2 — changed the priors every projection and therefore every recommendation rests on.**
  `scripts/project-points.ts`'s position-prior loop (and the defensive-contribution position
  prior built from the same loop) now resolves a row's position from
  `player_match_stats.element_type` first, falling back to the live `players` roster join only
  when `element_type` is null — instead of dropping any row outright whose `player_code` was
  absent from the live roster. **Because** ticket #168 measured the resulting bias directly, by
  reconstruction against FPL-Core-Insights with the same Premier-League-only filter #148/#162
  used: of 95 forward player_codes with 2025/26 Premier League minutes, the 44 dropped from the
  current roster since then had **higher xA/90 (0.0728)** but **lower xG/90 (0.2768)** than the
  51 retained — survivorship bias shaped exactly right to explain why goals calibrate cleanly
  (near 1.04x on the calibration report) while forward assists land at **0.67x**. #168 also ruled
  out the position-prior and population-dilution hypotheses it was originally asked to test
  (position-prior forward xA/90 0.0586 vs. established-forward median 0.0538; fringe players
  carrying only 4.3% of the prior's minutes-weighted total), isolating the current-roster join
  itself as the cause. **This is the fifth instance of "fixing the instance is not fixing the
  class"** (`LEARNINGS-second-build-wave.md` §4, §12) — historical data joined to a live-roster
  table, previously fixed for the FK (#22), for teams (#32), for backtest position (#154), and
  now here. A repo-wide sweep for remaining instances of this pattern is worth doing and is
  explicitly out of this ticket's scope.

## ROUTINE

- Split prior-building from projection-eligibility into two separate constructs in the same
  file: `buildPositionPriorMatches` (new, drives the priors from every resolvable
  `player_match_stats` row) versus the untouched per-player projection loop (still gated on
  `playerRows`, the live roster, via `matchesByPlayerCode`). `codeToPlayer` is retained solely
  as the fallback map inside `buildPositionPriorMatches` for a null `element_type` and is not
  consulted anywhere in the projection loop — verified by QA independently, not just asserted by
  a test, since this was the item most likely to leak survivor-only bias into the solver's
  player pool if done carelessly.
- Two skip counters kept distinct rather than merged into one "skipped" total:
  `priorRowsSkippedNoPosition` (no `element_type` and no roster entry — the population this
  ticket newly triages) versus `priorRowsSkippedNoPlayerCode` (no join key at all, a pre-existing
  #22-era gap unrelated to this ticket). Keeping them separate makes the arithmetic
  reconciliation (`contributing + skippedNoPosition + skippedNoPlayerCode = rows read`) legible
  without conflating two different failure populations.
- Naming (`PriorPositionSource`, `PriorPositionResolution`, `PositionPriorCounters`) mirrors
  `scripts/run-backtest.ts`'s existing `PositionResolutionSource`/`PositionResolution` from
  ticket #154 rather than inventing new vocabulary for what is the same fix shape applied to a
  different table.
- Builder checked explicitly for a third use of `codeToPlayer` beyond the prior-building call and
  the (untouched, pre-existing) projection-loop gate, per the ticket's request to flag rather
  than change one if found. None turned up — `codeToPlayer` has exactly one use site in `main()`
  after this change.
