# Ticket #203 — decisions

## HIGH-IMPACT

- **Tier 2.** `training_features` stores computed rates/shares (`xg_rate_per90`, `xa_rate_per90`,
  `season_avg_minutes`), unlike `feature_history`'s raw-totals-only discipline. **Because** the
  ticket's own wording asks for "rates" and a "season share," and these are deliberately plain and
  unshrunk — computed directly from `feature_history`'s raw totals rather than by importing
  `src/lib/projection/rates.ts`'s shrinkage. Baking `baseline-v1`'s shrinkage constant and
  position-prior construction into the training substrate would tie every future learned-model
  attempt to `baseline-v1`'s own current tuning, making a "learned" model largely a re-weighting of
  `baseline-v1` rather than one that sees raw signal and finds its own weighting.
- **Tier 2.** Team-strength and fixture-schedule figures reuse `scripts/run-backtest.ts`'s exported
  pure functions (`buildTeamMatchRecords`, `computeTeamStrengthAsOf`, `buildClubFixtureSchedule`,
  `lookupClubFixtureSchedule`) unmodified, rather than reimplementing them. **Because** those
  functions are already reviewed and tested at the 15,000+-row scale this job operates at (tickets
  #175/#193); a second hand-written implementation of the same point-in-time logic is a second thing
  that could silently drift with no test to catch it. Import-only — `scripts/run-backtest.ts` itself
  is untouched.
- **Tier 2.** `opponent_team_codes` is keyed to the row's *own* gameweek (schedule identity), not
  "strictly before." **Because** G14 already established that fixture identity (who you play) is
  legitimately known in advance and is not the same kind of information as a match result — this is
  deliberate, not an accidental relaxation of the strictly-before rule that governs every other
  column in the table. **Correction (caught by QA, 4 Sep 2026):** an earlier version of this entry
  also grouped `team_strength_*` under this same schedule-keyed exception. That was wrong —
  `computeTeamStrengthAsOf` filters strictly on `gameweek < beforeGameweek`, so team-strength is in
  fact computed strictly-before the row's own gameweek, the same as every other non-schedule column.
  Only `opponent_team_codes` (fixture identity, not a match result) is the exception. The migration's
  own `COMMENT ON COLUMN` text for the team-strength columns was correct throughout; only this log
  entry had the error, and the underlying code and tests were never affected.

## ROUTINE

- Table/script named `training_features` / `build-training-features.ts`, mirroring the existing
  `feature_history` / `build-feature-history.ts` naming convention.
- `prior_matches` included as a stored column beyond the ticket's literal column list, since it is
  free from `feature_history` and directly useful for evidence-volume bucketing later (matches G10's
  own precedent for a similar "how much history backs this" column).
- `TRAINING_FEATURES_SEASON` given its own env var rather than sharing `FEATURE_HISTORY_SEASON`,
  matching the established per-job convention of one env var per job.
- **Dropped columns, confirmed not ingested anywhere in this repo (no new ingest added, per the
  ticket's own exit clause):** total shots, chances created, big chances missed, touches in the
  opposition box. `public.player_match_stats` only carries `shots_on_target` among the
  shots/chances/touches candidates named in the ticket — confirmed against every migration through
  `20260902090000`, `scripts/ingest-core-insights.ts`'s own `MATCH_STATS_REQUIRED_COLUMNS`/
  `MatchStatRow`, and `tickets/drafts/58-complete-match-stats-and-dense-history.md`'s own explicit
  list of never-ingested source columns.
