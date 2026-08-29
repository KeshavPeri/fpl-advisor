# Ticket #154 — Read position and defensive-contribution counters from feature_history

## HIGH-IMPACT

- **Tier 2 — changed the population every backtest figure is computed over, because the
  ticket's own instructions require it be logged that way.** Position resolution now reads
  `feature_history.element_type` first (falling back to the live `players` join only when
  null), instead of relying solely on the live `players` table. That live-only join dropped
  any player no longer in the current season's roster — 4,175 of 18,246 rows (23%) in the
  29 Aug 2026 16:30 UTC run — as `unresolvedPlayerCode`, before any other test was applied.
  Separately, the defensive-contribution hit-rate estimate now uses the real stored
  `prior_defcon_qualifying_matches` / `prior_defcon_hits` counters instead of a single
  synthetic averaged match; under the old construction, `estimateDefconHitRate`'s shrinkage
  denominator (`n + SHRINKAGE_K` with `SHRINKAGE_K = 5` and `n` always 0 or 1) meant a
  player's own evidence could never carry more than 1/6 weight, however much real history he
  had — this is the mechanism behind the flat-by-history-bucket error shape ticket #140
  reported and could not explain, and it closes `docs/projection-model-backlog.md`'s G10 open
  question (the level explanation was correct; the level defect was in this harness, not in
  `defconRate.ts` or the projection model). **Because both changes move the measured
  population and the defcon estimate itself, backtest reports from before this ticket are not
  comparable to reports after it.**

## ROUTINE

- Kept the fix entirely inside `scripts/run-backtest.ts` / `scripts/run-backtest.test.ts`
  rather than taking the ticket's permitted additive-helper route into
  `src/lib/projection/defconRate.ts`. The real qualifying/hit counts are turned into an
  arithmetically exact synthetic-matches array (`hits` guaranteed-hit matches at a stat level
  comfortably over any position's CBIT threshold, plus `qualifyingMatches - hits`
  guaranteed-miss matches, all at 90 minutes to clear the qualifying gate) and fed through the
  existing, unmodified `estimateDefconHitRate`. This reproduces the shrinkage formula exactly
  with no duplicated logic and no change to `defconRate.ts`'s exports, so the companion ticket
  (#155, also importing that module in this same batch) is unaffected.
- New counters (`PositionResolutionCounts`, `DefconSourceCounts`) are incremented once per row
  in the same loop that already computes the exclusion partition, before any `continue`, so
  they cannot drift out of the existing `measured + exclusions = rows read` reconciliation
  invariant — no new invariant was introduced, the existing one was reused.
- A row with null defcon counters (written before ticket #146's migration) falls back
  unchanged to the pre-existing single-averaged-match construction, and is counted separately
  via the new `averagedFallback` counter rather than being excluded or throwing.
