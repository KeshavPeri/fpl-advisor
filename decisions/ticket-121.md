# Ticket #121 — Build the point-in-time feature history

## HIGH-IMPACT

This ticket is Tier 2 per its own classification — it creates a table other work will build on,
which is expensive to reverse after ten more tickets.

- **`feature_history` stores raw cumulative prior-match totals, never rates.** Because the rate
  model has changed three times this month (#78 added CBI/recoveries, #113 made it two-stage, and
  #119 — possibly running in the same batch — adjusts the position prior), storing a rate would
  freeze one version of a moving model into a table meant to outlive all of them. A raw
  prior-match total is a fact about football that never changes; any version of the rate model can
  be applied to it afterwards. This is the ticket's central design decision and the reason its
  definition of done is arithmetic rather than modelling.
- **`gameweek_id` is a plain integer matching `player_match_stats.gameweek`, not a foreign key to
  `public.gameweeks`.** Because `public.gameweeks` holds only one season at a time and this table's
  whole purpose is to be read across seasons, an FK relationship would be either wrong (pointing at
  the wrong season's row) or impossible to declare cleanly. Documented in the migration header so a
  future reader does not infer a relationship that isn't there.
- **A row is emitted only for a (player, gameweek) pair where that player has a contributing
  Premier-League match that gameweek — not a dense row for every season gameweek for every
  player.** Because the ticket's own density language and reconciliation tests are stated in terms
  of matches, a dense fill would manufacture rows with no underlying event and complicate the
  "final row + final match = full-season total" reconciliation for players who miss gameweeks
  through rotation or injury.

**Flagged, not a Tier 1 stop, but material to the human check this ticket's own DoD calls for.**
While implementing the `team_goals_conceded` requirement (Notes: use `team_goals_conceded`, never
`goals_conceded`, to avoid the goalkeeper-only-stat bias #54 exists to fix), the Builder found that
`supabase/README.md`'s row for `20260818100000_player_match_stats_competition.sql` (#54) claims that
migration "Adds `competition` (indexed) and `team_goals_conceded` to `player_match_stats`," but the
actual migration file, its full git history, `scripts/ingest-core-insights.ts`'s
`MATCH_STATS_REQUIRED_COLUMNS`, and `scripts/calibration-report.ts`'s own grep guard all confirm
`team_goals_conceded` was never added — a deliberate descope of #54 that the README description was
never corrected for. `player_match_stats.team_goals_conceded` does not exist in the live schema and
no job populates it. `build-feature-history.ts` was built to read the column exactly as this
ticket's Notes specify, and fails loudly with a named error (`isMissingColumn`) if Supabase reports
it missing, rather than silently substituting `goals_conceded` (which would reintroduce the exact
goalkeeper-only bias #54 fixed for clean sheets) or defaulting to zero. Consequence: this ticket's
own "human check after merge" step (run the job for `2025-2026`) will fail with a clear error until
a follow-up ticket adds and backfills `team_goals_conceded`, and `supabase/README.md`'s #54 row
description should be corrected. Both are noted in the end-of-run summary for Keshav.

## ROUTINE

- Every Supabase read is paginated via the existing `scripts/lib/paginate.ts` helper and its count
  independently verified, per the ticket's own requirement and the established convention from
  prior ingest jobs.
- The season parameter is named `FEATURE_HISTORY_SEASON`, trimmed, defaulting to `2025-2026`,
  matching `CORE_INSIGHTS_SEASON`'s existing convention exactly rather than inventing a new naming
  or defaulting pattern.
