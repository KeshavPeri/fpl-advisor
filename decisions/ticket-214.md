# Ticket #214 — decisions log

## HIGH-IMPACT

None.

## ROUTINE

- **Three-way verdict arithmetic.** With four splits, "majority of splits" is implemented as:
  strict majority of wins → `ship`; strict majority of losses → `do-not-ship`; an exact 2-2 tie →
  `too-close-to-call` (never guessed either way); no comparable split → `insufficient-data`.
  Because the ticket names all three verdict labels but does not define the tie boundary, and a
  2-2 split is exactly the case the ticket's own notes describe as "an edge that flips depending
  which half of the splits you look at is not evidence" — i.e. the natural trigger for
  too-close-to-call.
- **Job exit/status convention.** Kept the existing repo convention (the backtest's
  oracle-ceiling check, #208's own gate): `job_runs` status is `failure` and the process exits 1
  if any position's verdict is `do-not-ship`; `too-close-to-call` and `insufficient-data` do not
  fail the job. Because this matches every other measurement job in this repo, and a clear loss
  is a real, actionable finding rather than a transient state that should merely warn.
- **Split-skipping instead of hard-abort.** If one of the four train/eval cutoffs produces an
  empty train or eval fold, that split is skipped and recorded in `skippedCutoffs`; only if all
  four are empty does the job fail outright. Because the ticket wants repeated-split evidence,
  and one bad split should not discard the other three's readings.
- **Dropped a redundant self-test call.** Removed a second, standalone call to
  `computeGenericConstantBaselineSpearman` that duplicated an assertion already made inside
  `summarizeBaselines`/`summarizeFiveGameweekBaselines` (both throw internally if their
  constant-baseline entry is non-null). Because the second call carried no assertion of its own
  and was pure duplication.

## Known limitation, not a decision

This Builder session had no live Supabase project (`SUPABASE_URL`/`SUPABASE_SECRET_KEY` unset),
so the mechanism (splits, gate arithmetic, verdict logic, leakage guard at every cutoff) is
proven against constructed data in the 47 passing tests, but no actual per-position/per-split
Spearman figures have been read from real `training_features`/`feature_history`/
`player_match_stats` rows yet. This matches the same wall recorded for G9, G11, G13 and #208
(G16) in `docs/projection-model-backlog.md` — a live run against real data is the confirming step
and has not happened inside this pipeline run.
