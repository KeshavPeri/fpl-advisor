# Ticket #224 — Validate the bonus allocator — ingest real bonus and BPS from event/{gw}/live/

## HIGH-IMPACT

- **`gameweek_live_stats` keyed on `(gameweek_id, player_code)`, with a real foreign key on
  `gameweek_id` to `public.gameweeks`.** Chose this shape, rather than a looser or unkeyed table,
  because the brief's whole reason for building this ingest is to compare stored actuals against
  `player_projections` per player per gameweek — a real FK plus the same `player_code` join key
  every other cross-table join in this repo uses (`deltas.md` D9) is what makes that comparison
  reliable rather than best-effort. Matches the existing `player_projections` precedent, and is
  safe to commit to because, like `player_projections`, this table is inherently scoped to the
  current season forever — `event/{gw}/live/` has no past-season equivalent, so there is no future
  ticket this shape could block.

## ROUTINE

- Reused `decideGameweekEligibility` and `fetchLiveJson` directly from `scripts/settle-predictions.ts`
  rather than duplicating the finished-gameweek/lockdown rule — the ticket's own notes explicitly
  asked for this ("reuse that rule, do not invent a second one"). This is the one deliberate
  exception to the repo's usual "scripts duplicate small helpers" convention, and is narrower than
  it looks: only the eligibility rule and the live-JSON fetch helper are shared, not the calling
  script's own logic.
- **"Top 20 projected players" in the bonus comparison read as top 20 by `expected_points`** for
  that gameweek — the overall ranking the allocator's bonus term actually moves, per the ticket's
  own framing — rather than top 20 by projected bonus specifically. The ticket text didn't pin the
  ranking key down; flagged here for Keshav to confirm on review rather than assumed silently.
- Signed-error convention set to `actual − projected` (positive = under-projects), matching the
  existing convention in `prediction_log.error` / `settle-predictions.ts`, for consistency across
  the app's error-reporting surfaces.
- `bps` is ingested and stored per the DoD but not compared in the report — no persisted
  "projected BPS" figure exists anywhere in the repo to compare it against (`expectedBps` is
  computed and discarded inside `project-points.ts`). Documented as future work in the script
  header and the backlog rather than built now, since persisting a new projected-BPS figure is
  outside this ticket's stated scope.
- No hardcoded "N gameweeks needed for confidence" number invented — the report states the
  three-gameweek limitation qualitatively (accumulates weekly, current-season-only, print sample
  size beside every figure) rather than asserting an unfounded threshold, consistent with the
  product's anti-false-precision stance (product-brief.md §8).
