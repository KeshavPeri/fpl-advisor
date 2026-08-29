# Ticket #147 — Measure ranking skill in the backtest

## HIGH-IMPACT

- **Ranking skill is a Tier 2 slice in its own right, per the ticket text — it extends the measurement
  all remaining model work will be judged by.** Logging the decisions below under that classification
  rather than treating them as routine plumbing, because each one shapes what "the model has ranking
  skill" is later taken to mean.

- **Season-aggregate Spearman pools every measured row across the whole season; season-aggregate top-N
  overlap instead sums each gameweek's own overlap/N, because a "top 10 of the season" pooled across
  ~8,500 rows is not a coherent selection** — the app only ever compares players within one gameweek, so
  a season-level top-10 has no product meaning. Pooling for the season Spearman figure mirrors exactly
  how the existing `overall` MAE figure already pools every row, so that half follows established
  precedent rather than inventing a new one.

- **Per-position top-N overlap sums across every gameweek for that position without the 50-row
  `MIN_BUCKET_SAMPLE_SIZE` gate the by-gameweek table uses, while per-position Spearman pools the whole
  season (mirroring the existing by-position MAE table), because a per-gameweek goalkeeper population is
  routinely under 50 by construction** (roughly 20 starting keepers per gameweek) — gating there would
  silently zero out goalkeepers' top-N figures every week rather than reporting an honestly smaller
  sample. `topNOverlap` already caps N at the true population size, so a thin gameweek contributes a
  smaller N, never a wrong one.

- **Sanity bounds are checked on the season aggregate and each position, not on every individual
  gameweek, mirroring `checkSanityBounds`'s existing overall-plus-by-position shape** rather than
  inventing a new checking granularity for this slice.

- **Top-N selection uses a stable sort with ties broken by original row order — deliberately different
  from Spearman's average-rank tie rule — because selecting "the top 10" must land on exactly 10 rows**,
  and average ranks cannot resolve a tie sitting exactly on the boundary. Documented in both the file
  header and the function's own comment, per the ticket's instruction to decide the tie rule explicitly
  rather than let a default answer it.

## ROUTINE

- No new decisions beyond the HIGH-IMPACT set above — the ticket's remaining choices (Spearman formula,
  clamp on the correlation bounds, "too small to read" threshold at 50) were pinned by the ticket text
  itself and involved no independent judgment call.
