# Ticket #113 — Two-stage shrinkage: this season, shrunk toward (last season, shrunk toward the position average)

## HIGH-IMPACT

This whole ticket is Tier 2 per its own classification — it changes the projection model every
recommendation rests on. All four decisions below are logged HIGH-IMPACT accordingly.

- **New `computeTwoStagePlayerRates`/`estimateTwoStageDefconHitRate` functions were added
  alongside the existing single-stage `computePlayerRates`/`estimateDefconHitRate`, left
  untouched, rather than changing the single-stage functions' signatures in place.** Because
  `src/lib/projection/expectedPoints.ts` calls the single-stage functions directly and is
  explicitly out of scope for this ticket, `project-points.ts` instead feeds
  `projectPlayerFixture` the stage-1 "personal prior" result in place of the raw position prior —
  which makes `expectedPoints.ts`'s own arithmetic reproduce stage 2 exactly by construction, with
  zero edits to that file.
- **Position-level priors (`ratePriorByPosition`, `defconPriorByPosition`) are still computed from
  all ingested `player_match_stats` rows regardless of season, unchanged from before this ticket —
  they are not split by season.** Because the ticket specifies the per-player two-stage rule, not
  a season split of the population-wide prior, and early in the season current-season rows are a
  rounding error against a full season of historical rows, so the effect on the position prior is
  negligible. This is the minimal-diff reading of the ticket's scope. **Explicitly flagged as not
  resolved by this ticket** in the updated `docs/projection-model-backlog.md` G6 entry, in case a
  future ticket wants to revisit it once the current season has enough weight to matter.
- **`CURRENT_SEASON = '2026-2027'` is a literal constant in `project-points.ts`, not read from an
  environment variable.** Because `project-points.ts` never runs the ingest itself — the season
  boundary here is a modelling decision (which season counts as "current" for shrinkage purposes),
  not a deployment parameter that varies by environment. `CORE_INSIGHTS_SEASON` (the ingest's own
  env-driven parameter) is unrelated and untouched.
- **The old `job_runs.details` counters `playersWithHistoricalMatches`/
  `playersWithNoHistoricalMatches` were replaced outright, not kept alongside the new three-bucket
  scheme (`playersWithCurrentSeasonRows`, `playersWithHistoricalOnlyRows`,
  `playersWithNeitherSeasonRows`).** Because their meaning changed under this ticket — "historical"
  no longer means "any match ever," it now specifically means "non-current-season" — and keeping
  both the old and new counters side by side in `job_runs.details` would actively confuse a reader
  trying to reconcile them, rather than clarify anything.

## ROUTINE

None beyond the above — every decision of substance on this ticket touches the projection model
directly and is logged HIGH-IMPACT per the ticket's own Tier 2 classification.
