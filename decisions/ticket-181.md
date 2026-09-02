# Ticket #181 — Store each player's last-five-match minutes in feature_history

## HIGH-IMPACT

- **Stored `prior_recent_minutes` as a raw `integer[]` of actual per-match minutes, never a
  rate or an averaged value, and as a single array column rather than five fixed columns.**
  Because: `estimateMinutes(recentMinutes: readonly number[], availability)` in
  `src/lib/projection/minutes.ts` already takes exactly this shape, and `RECENT_MATCH_COUNT`
  is defined once, in code, in that same module. A schema-side fixed-width alternative (five
  separate columns) would duplicate that constant into a second place — the schema — that can
  silently drift from the code if the window length is ever changed. This is the substrate a
  follow-up ticket will make the backtest consume in place of its current single-averaged-match
  reconstruction; per the ticket's own framing, this is what future model judgement's fairness
  rests on.

## ROUTINE

- Counter names (`rowsWithRecentMinutes`, `rowsWithFullRecentMinutesWindow`,
  `rowsWithShortRecentMinutesWindow`, `rowsWithEmptyRecentMinutesWindow`) follow the existing
  `rowsWith*` naming convention already used for `rowsWithElementType`/`rowsWithDefconCounters`/
  `rowsWithTeamCode`.
- Migration filename `20260902090000_feature_history_recent_minutes.sql` — today's date,
  matching the file's own timestamp convention used by prior migrations in this repo.
- Column comment distinguishes "qualifying" (counts as a contributing row at all, i.e. any
  Premier League appearance including a substitute cameo) from `defconRate.ts`'s unrelated
  60-minute `isQualifyingMatch()` threshold — traced `scripts/project-points.ts`'s own live
  recent-minutes construction to confirm cameos must count, since the ticket's phrase "most
  recent qualifying Premier League matches" was ambiguous against that existing term.
- Added a defensive `isMissingColumn(error, 'prior_recent_minutes')` branch in the upsert error
  handling, matching the existing pattern for `element_type`/`team_code`, for a clear failure
  message if the job is run before the migration is applied. Not explicitly required by the
  DoD; a minor robustness addition within the ticket's own files.

## Note

This column has no consumer yet — the next batch's ticket makes `scripts/run-backtest.ts`
read it. Two other tickets landed in this same batch (#182: fixture multiplier damping; #183:
five-gameweek backtest ranking section). Neither touches `supabase/migrations/`,
`scripts/build-feature-history.ts`, or `supabase/README.md`. Migration is not yet applied to
live Supabase — that is Keshav's post-merge step, along with re-running
`build-feature-history.ts`.
