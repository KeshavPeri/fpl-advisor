# Ticket #119 — Use price as a weak prior for players with no Premier League history

## HIGH-IMPACT

This ticket is Tier 2 per its own classification — it changes the projection model every
recommendation rests on.

- **The price adjustment was applied by swapping in an adjusted position-prior object at the two
  `computePlayerRates`/`computeTwoStagePlayerRates` call sites in `project-points.ts`, rather than
  adding a new parameter to either function.** Because the ticket's scope explicitly forbids
  changing `computePlayerRates` or `computeTwoStagePlayerRates` — the adjustment must happen to
  the position prior *before* it enters stage one, not inside either shrinkage stage — swapping
  the prior object at the call site is the only place the adjustment can live without touching
  functions the ticket rules out of scope, and it keeps the no-op guarantee (a player with any
  minutes is unaffected) true by construction: those call sites already only reach the prior
  fallback path for players with zero minutes at both levels.
- **The scale bounds (`[0.6, 1.8]`) and the median-not-mean choice are implemented exactly as
  pre-specified in the ticket, with no independent recalibration.** Because the ticket states
  plainly that any different number "is a measurement question and it belongs to the backtest, not
  to this ticket," and the backtest (item 32) does not exist yet, changing the bounds now would be
  inventing a calibration this ticket is explicitly not authorised to make.
- **`docs/projection-model-backlog.md` G2 is marked ADDRESSED only for the xG/xA half**, with
  minutes, defensive volume, and the absence of any calibration behind the bounds stated as still
  open. Because closing G2 outright would misrepresent a deliberate partial fix (price adjusts
  only attacking-rate inputs, per the ticket's "why xG/xA only" note) as a complete one, and the
  next reader of the backlog needs to know the minutes model is a separate, still-open ticket.

## ROUTINE

- Counters were named `playersPriceAdjustedPrior`/`ScaledUp`/`ScaledDown`, matching the existing
  `playersWith*` naming convention already established in the same file by #113, rather than
  introducing a new naming pattern (e.g. `priceAdjustedCount`).
- The median is computed with a plain sorted-array `Math.floor(n/2)` implementation rather than
  pulling in a stats library, since it is a five-line function and the codebase has no existing
  statistics dependency to reuse.
- `now_cost` was added to `project-points.ts`'s existing `players` Supabase select string — an
  anticipated consequence of the ticket's own requirement that position medians come from the live
  table with no hardcoded literal, not a scope deviation.
