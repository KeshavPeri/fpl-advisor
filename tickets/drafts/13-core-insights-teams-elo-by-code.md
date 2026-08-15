## Context

Not on `feature-list.md` — a defect fix, filed ahead of item 10 because item 10 reads the column
this bug corrupts.

`scripts/ingest-core-insights.ts` upserts full team rows into `public.teams` with
`onConflict: 'id'`, using the **2025-2026** season file (`DEFAULT_SEASON = '2025-2026'`, and
`CORE_INSIGHTS_SEASON` is not set in `.github/workflows/scheduled-jobs.yml`). `scripts/ingest-fpl.ts`
then upserts the same table, also on `id`, from the **2026/27** `bootstrap-static/`.

**FPL team ids are not stable across seasons — the same failure already proven for player ids in
#12/#22, one level up.** Verified live on 15 Aug 2026 by fetching both season files from the source:

```
https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026/teams.csv
https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/teams.csv
```

**Only 5 of 20 team ids refer to the same club in both seasons.** Examples, `id` → club:

| `id` | 2025-2026 | 2026-2027 |
|---|---|---|
| 3 | Burnley (code 90) | Bournemouth (code 91) |
| 12 | Liverpool (code 14) | Ipswich Town (code 40) |
| 13 | Man City (code 43) | Leeds (code 2) |
| 17 | Sunderland (code 56) | Nott'm Forest (code 17) |

`teams.code` **is** stable: all 17 clubs present in both files carry the same `code`, and the same
`elo` value against that `code`, in both.

**The live consequence.** `ingest-core-insights` runs before `ingest-fpl` in the same workflow, so
`name`, `short_name` and the `strength_*` columns end up correct (the FPL ingest overwrites them
last). But `elo` is written **only** by the core-insights job and is never overwritten, because
`bootstrap-static/` has no elo field. So after every nightly run, `public.teams.elo` is almost
certainly attached to the wrong club for **15 of 20 teams** — Bournemouth carrying Burnley's rating,
and so on. Nothing reads `teams.elo` yet, which is why this has been silent. Item 10 makes it the
fixture-difficulty input for every projection in the app.

Depends on #12 (`teams.elo` column) and #11 (the FPL ingest that owns team identity) — both merged.

## Scope

**In scope:**

- Change `scripts/ingest-core-insights.ts` so the team write is an **elo-only update, matched on
  `code`**: build a `code → elo` map from the season's `teams.csv`, read `id, code` from
  `public.teams`, and update `elo` on the rows whose `code` matches.
- The job no longer inserts team rows and no longer writes `name`, `short_name`, `code`,
  `pulse_id` or any `strength_*` column. `scripts/ingest-fpl.ts` is the sole owner of team identity.
- A team `code` present in the CSV but absent from `public.teams` (a club relegated out of the
  current season) is **skipped, not inserted**, and counted.
- A team row in `public.teams` whose `code` is absent from the CSV is left untouched, and counted.
- Both counts, plus the number of rows actually updated, go into the run's `job_runs.details` and
  into its message string.
- Update the file-header comment block to record why the match is on `code` and not `id`, with the
  verification date and the two source URLs above.

**Explicitly out of scope:**

- **No change to `CORE_INSIGHTS_SEASON` or `DEFAULT_SEASON`.** Ingesting 2025-2026 is correct and
  deliberate: `player_match_stats` needs a played season, and 2026/27 has no matches yet. This
  ticket does not touch which season is ingested.
- No change to `player_match_stats` — its rows, its columns, its upsert, its `player_code`
  handling, and its `(player_id, match_id)` key all stay exactly as they are.
- **No new migration, no schema change, no unique constraint on `teams.code`.** The fix is a
  read-then-update in the job, not an upsert conflict target — so no constraint is required.
  Do not add one.
- No backfill or repair script for the existing wrong `elo` values. The corrected job overwrites
  them on its next run; a separate repair path would be dead code the day after it merged.
- No changes to `.github/workflows/`, `src/`, or `supabase/`. Another ticket is running in the same
  batch and owns `supabase/migrations/` and the workflow file.
- No new dependency.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] `scripts/ingest-core-insights.ts` contains **no** `.from('teams').upsert(` call. Verifiable by
      search.
- [ ] The team write path reads `id, code` from `public.teams` and issues updates keyed on the
      matched row, using `code` as the join. The string `onConflict: 'id'` does not appear anywhere
      in the team code path.
- [ ] The only column the job writes to `public.teams` is `elo` (plus `updated_at`). The strings
      `short_name`, `strength_overall_home`, `strength_attack_home`, `strength_defence_home` and
      `pulse_id` appear nowhere in `scripts/ingest-core-insights.ts` outside `TEAMS_REQUIRED_COLUMNS`
      and comments. Verifiable by search.
- [ ] `TEAMS_REQUIRED_COLUMNS` still requires `code` and `elo` to be present in the CSV, and the job
      still fails loudly with the file name if either is missing — the existing schema-change
      guard is preserved, not weakened.
- [ ] A team `code` in the CSV with no matching row in `public.teams` does not cause a failure, is
      not inserted, and is counted in `job_runs.details` under a named field.
- [ ] A `public.teams` row whose `code` has no entry in the CSV is not modified and is counted in
      `job_runs.details` under a named field.
- [ ] The successful run's `job_runs.message` states the number of teams whose `elo` was updated,
      and both skip counts.
- [ ] A row in the CSV whose `elo` cell is empty or non-numeric is skipped rather than writing
      `null` over an existing rating, and is counted.
- [ ] The `job_runs` row shape is otherwise unchanged: one insert per execution, never upserted,
      `job_name` still `'ingest-core-insights'`, and the `skipped` / `success` / `failure` status
      semantics for a not-yet-published season directory are untouched.
- [ ] The file-header comment records the `id`-instability finding, the 5-of-20 figure, the
      verification date (15 Aug 2026) and both source URLs.
- [ ] Scope constraint: only `scripts/ingest-core-insights.ts` and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`, `supabase/`,
      `.github/` or `tickets/` changes, and `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **This is Tier 2 and it is already decided: team identity is owned by `scripts/ingest-fpl.ts`,
  and the core-insights job contributes `elo` and nothing else.** The original full-row upsert had a
  stated reason — it let ticket #12's tests populate `teams.elo` without depending on ticket #11
  having run first. That reason is now spent: #11 is merged, running nightly, and has populated
  `teams`. The reason it was traded for is worse than the reason against it.
- **Match on `code`, never on `id`.** This is the same rule as `player_match_stats.player_code`,
  and for the same reason. If a future ticket proposes joining any cross-season source to `teams`
  on `id`, that is the bug this ticket fixed.
- **`public.teams.code` has no unique constraint and does not need one.** Do not add a migration
  to create one. Read the table, build the map in TypeScript, update by the matched row. If two
  rows in `public.teams` ever share a `code`, update neither and count it as a conflict — do not
  guess which one is meant.
- **Do not "fix" this by changing the ingested season to 2026-2027.** The 2026/27 directory does
  exist at the source as of 15 Aug 2026, but that season has no played matches, so
  `player_match_stats` would go empty and item 10's defcon and xG rates would have nothing to
  estimate from. The historical season is the point.
- The elo values themselves are identical for a given `code` across both season files, so the
  corrected job produces the same ratings — it just attaches them to the right clubs.
- **What a local substitute cannot catch here.** A test against a stand-in Postgres or a mocked
  Supabase client can prove the join is on `code` and that the update statement is well-formed. It
  cannot prove the live `public.teams` currently holds mismatched ratings, because that depends on
  what the live table contains. Verifying the repair is a human step after merge: run the workflow
  and check that `teams.elo` reads sensibly per club in the Table Editor.
