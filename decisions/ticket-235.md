# Ticket #235 — Build current-season team strength from fixtures, not slug-derived opponents

## HIGH-IMPACT

- **Merged `project-points.ts`'s two separate `fixtures` reads (the
  horizon-filtered difficulty read and the finished-only `leagueBaselineGoals`
  read) into one unfiltered read.** Chose to merge because team strength needs
  the whole season's finished results, not just the projection horizon, so
  satisfying the ticket's "add the four columns to that SAME select... no
  additional Supabase round trip" instruction required dropping the
  `.in('event_id', horizonGwIds)` filter rather than keeping two reads. Net
  effect is one fewer round trip than before, not one more. Mirrored in
  `team-strength-diagnostic.ts` for the same reason and for its own stated
  reuse-not-reimplementation principle. This is a data-access-shape decision
  (Tier 2 test: later code assuming a horizon-filtered read would need to
  re-filter client-side) — flagging it as HIGH-IMPACT rather than routine
  because it changes what a shared query returns, not just an internal detail.

## ROUTINE

- **"Last season's fixtures cannot leak in" implemented as a fixture-identity
  guarantee, not a season-column filter.** `public.fixtures` has no `season`
  column and holds only the current season by ingest convention
  (`decisions/ticket-140.md`), so there is no literal season field to guard
  against inside the new pure function. Implemented and tested the analogous
  guarantee instead: fixture identity (`matchId`, the fixture id) is what
  distinguishes matches, so a reverse fixture or a hypothetical stale row
  between the same two clubs never collapses into one record. **This is a
  judgment call about the ticket author's intent** — if a literal
  season-column guard was meant, that is not implementable against the actual
  schema and would need a different mechanism (e.g. filtering by valid
  gameweek ids from the `gameweeks` table). Worth a second look once the
  falsification gate runs.
- Removed the now-unused `match_id` / `team_code` / `opponent_team_code` /
  `team_goals_conceded` columns from `project-points.ts`'s `player_match_stats`
  select, since nothing reads them once team-strength construction moved to
  `fixtures`.
- "Clubs meeting `MIN_TEAM_PRIOR_MATCHES`" evaluated as of the horizon's first
  gameweek (`horizonGameweeks[0].id`) — the same point in time the first
  fixture context in the per-player loop actually queries. Documented in a
  code comment as the natural anchor.

## Note: local `main` was stale in the Builder's worktree

Flagging per the Builder's own report, not a decision: the worktree's local
`main` was 9 commits behind `origin/main` (missing #229/#234's already-merged
work) until an explicit `git fetch origin`. Worth knowing for future batches
that a fresh worktree's local `main` isn't fetched automatically — not
something this ticket needed to fix, just recording it so it isn't
rediscovered at cost next time.

## Falsification gate — NOT YET EVALUATED

`scripts/team-strength-diagnostic.ts` is extended and its own 45 tests pass
against constructed data, including a reproduction of #229's exact vacuous-pass
scenario (proving the new `allRowsIdentical` check catches it) and 35 tests on
`buildTeamMatchRecordsFromFixtures` covering every stated behaviour. But **it
has never been run against live data**: this session has no Supabase
credentials, the same environment-wide gap recorded in
`decisions/ticket-229.md` and confirmed independently across all three
tickets in tonight's batch.

Per the ticket's own text — "Stop and report — do not merge — unless all
three hold" — **this PR must not be merged until someone with production
Supabase credentials runs `npx tsx scripts/team-strength-diagnostic.ts`**,
confirms (1) at least one fixture resolves to source `team-strength`, (2) at
least one point-in-time `expectedScore` diverges from frozen-elo by more than
0.01, and (3) every club has at least 3 matches, and checks the stated
prediction that Chelsea ranks above Man Utd on `teamStrengthRate`. If that
prediction fails, it also bears on the fixture-identity judgment call above
and is worth re-examining together with the report. This is flagged in the
PR body.
