# Decisions — ticket #22

## HIGH-IMPACT

- **Added `player_match_stats.player_code integer`, nullable, no FK, because `code` is the
  cross-season join key and `id` is not.** Verified again on real data during this ticket: a
  full ingest of the 2025-2026 `FPL-Core-Insights` season (15,340 rows) matched 100% of rows to
  a `player_code` via that season's `players.csv`; a controlled test with one player deliberately
  removed from `players.csv` confirmed the row is still written, with `player_code` left null and
  the count reported in that run's `job_runs` row (1 of 299), rather than the row being dropped.
  `player_id` remains the primary key and upsert-conflict target, unchanged — it is still correct
  *within* a season, per #12's own finding that FPL element ids are not stable *across* a season
  boundary (453 of 458 sampled players changed id between 2025/26 and 2026/27, only 5 kept it).
  This is the ticket's own pre-approved Tier 2 data-structure decision (see ticket #22 body); no
  fresh escalation was needed or made.

## ROUTINE

- **No new GRANT added in the migration.** `GRANT SELECT ON public.player_match_stats TO anon`
  and `GRANT SELECT, INSERT, UPDATE ... TO service_role` already exist from the #12 migration and
  are table-level privileges, not column-level ones — they cover a newly added column
  automatically. There is no new database object here (no new table, no new role-facing surface)
  for a role to be denied access to, so nothing to grant. Stated in the migration file's own
  header comment as well, per the ticket's request to record the "because" if no grant was
  needed.
- **`player_code` is looked up via a plain `player_id -> player_code` `Map` built once per run**
  from the same `players.csv` already fetched for the existing player-id-alignment log line, not
  a second fetch or a per-row query. Entries whose `player_code` field fails to parse as an
  integer are simply not added to the map (same handling as any other malformed numeric field
  elsewhere in this script) — in practice this was zero rows against real 2025-2026 data.
- **The "rows without a matching player_code" count is accumulated across all gameweeks in a run**
  and reported once, in both the console summary message and `job_runs.details.matchRowsWithoutPlayerCode`,
  rather than per-gameweek — matches the shape of every other run-level count already in
  `job_runs.details` (`teamsUpdated`, `gameweeksFound`, `matchRowsWritten`).
