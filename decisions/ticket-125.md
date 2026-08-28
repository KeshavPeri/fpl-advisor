# Ticket #125 — Complete the match-stats table and make the feature history usable

## HIGH-IMPACT

- **`team_goals_conceded` is nullable with no default, never backfilled with 0.** Because a row
  ingested before this column existed genuinely has no value — collapsing that into a real zero
  would be indistinguishable from "this team actually conceded nothing," corrupting every future
  consumer of the column. The ingest job re-stamps every row on every run (same mechanism that
  back-stamped `competition` in #54), so no separate backfill script is needed.
- **Bonus and BPS confirmed absent from the FPL-Core-Insights source**, verified directly against
  `data/2025-2026/By Gameweek/GW1/playermatchstats.csv`. This permanently rules out validating the
  bonus-points projection (#78) against per-match actuals from this source. Recorded in the new
  migration's file header per the ticket's instruction — not acted on, and not to be
  re-investigated.
- **Dense-row range is keyed on `lastGameweekInData` computed from all input rows, not per-player.**
  Because a player who stops appearing mid-season (injury, drop, loan) must still get
  carried-forward rows through the season's actual extent, so a backtest at a later gameweek can
  still ask "what was knowable about him."

## ROUTINE

- Exported `toMatchStatRow` from `ingest-core-insights.ts` (previously private) so its null-vs-zero
  handling is directly unit-testable, matching the existing `buildEloByCode`/`planTeamEloUpdates`
  precedent.
- Added `lastGameweekInData` to `BuildFeatureHistoryResult` and `job_runs.details` — useful
  reporting exposed by the dense-row change, consistent with existing counters.
- Fixed a pre-existing, unrelated stale assertion in `build-feature-history.test.ts` (a
  `supabase/README.md` describe block asserting the `20260827090000_feature_history.sql` migration
  row still said "not yet applied," when it had already been marked applied by an earlier, unrelated
  commit). This was failing on `origin/main` independent of this ticket's changes; fixed minimally,
  within this ticket's own owned test file, so `npm test` is green.
