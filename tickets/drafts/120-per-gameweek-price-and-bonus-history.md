## Problem

The repo has no per-gameweek price history, and its per-gameweek bonus/BPS
history covers three gameweeks of this season only.

That blocks two things:

1. **The season replay.** The recommendation layer — transfers, captaincy,
   the solver's actual output — has never been measured against anything.
   Only the projection has. A replay needs each player's price AT each
   gameweek, and `player_match_stats` carries no price column at all.
2. **Bonus validation at scale.** `gameweek_live_stats` (#224) serves the
   CURRENT season only, so `scripts/bonus-validation-report.ts` has three
   gameweeks, and #241 fitted `ALPHA` on gameweek 2 with gameweek 3 held out.
   That is a one-parameter fit on ~1,270 player-gameweeks.

### The data already exists

`data/<season>/playerstats.csv` in FPL-Core-Insights, verified 17 Sept 2026:

| Season | rows | columns present |
|---|---|---|
| 2025-2026 | 29,979 | `id`, `now_cost`, `bonus`, `bps`, `ep_next`, `gw`, `starts` |
| 2026-2027 | 2,584 | same |

One row per player per gameweek, both seasons, already on the host the ingest
job reads from.

**This corrects `docs/projection-model-backlog.md`'s G3 entry**, which states
that validating the bonus allocator is impossible because `player_match_stats`
carries neither bonus nor BPS. Ticket #224 partly disproved it for the current
season; this disproves it for a complete past one. A full 2025-2026 season of
real per-gameweek bonus and BPS is roughly 380 gameweek-club observations
against the three #241 had.

## The work

New table `public.player_gameweek_history`, one row per
(`season`, `gameweek`, `player_code`): `now_cost`, `bonus`, `bps`, `starts`,
`ep_next`. RLS read-only for `anon`; `SELECT, INSERT, UPDATE` for
`service_role`, no `DELETE`, `GRANT` in the same file.

`scripts/ingest-core-insights.ts` reads `playerstats.csv` for the season it is
already ingesting and upserts these rows.

- `playerstats.csv`'s `id` is that season's own FPL element id, **not** a
  stable key. Resolve it to `player_code` through that same season's own
  `players.csv`, exactly as this job already does for `player_match_stats`.
  `deltas.md` D9: `code` is the stable cross-season key. A row whose `id` does
  not resolve is skipped and counted by reason in `job_runs.details` — never
  guessed.
- Report `playerStatsRowsRead`, `playerStatsRowsWritten` and
  `playerStatsRowsUnresolved` in the console summary AND `job_runs.details`.
  The two whole-season defects this repo has hit were both invisible because a
  job reported nothing about what it had dropped.
- `now_cost` is FPL's integer tenths-of-a-million. Store it verbatim, do not
  divide. State that in the column comment.

**Substrate only. No model file changes, no projection changes, nothing
user-visible.** The replay and the re-fit are separate tickets.

## Falsification gate

None — no causal claim about a measured number.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: an `id` that resolves; one that does not (skipped and counted);
  both seasons ingest into distinct `season` values; a re-run is idempotent.
- Hand-run against live data for both seasons after the migration is applied.
  **Row counts must reconcile**: rows written plus rows unresolved equals rows
  read, for each season. Paste both runs' summary lines into the PR body.
- Record the migration in `supabase/README.md` in the existing format.
- Correct G3 in `docs/projection-model-backlog.md`: leave the historical
  reasoning, mark it superseded, name #224 and this ticket as what replaced it.

## Out of scope

- The season replay itself.
- Re-fitting `ALPHA` in `src/lib/projection/bonus.ts`. It now can and should
  be re-fitted on a full season — that is the immediate next ticket and needs
  this table to exist first. Do not touch `bonus.ts`.
- `scripts/bonus-validation-report.ts` — leave it reading
  `gameweek_live_stats`; pointing it at this table is the re-fit ticket's job.
- `src/lib/projection/expectedPoints.ts`, `teamStrength.ts`, `fixture.ts`,
  `scripts/project-points.ts`, `scripts/preflight-check.ts`,
  `scripts/team-strength-diagnostic.ts` — #238 and #244 own all of these.

## Files

- `supabase/migrations/<date>_player_gameweek_history.sql` (new)
- `supabase/README.md`
- `scripts/ingest-core-insights.ts`
- `scripts/ingest-core-insights.test.ts`
- `docs/projection-model-backlog.md`
