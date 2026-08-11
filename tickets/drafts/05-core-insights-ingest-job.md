## Context

Feature-list item 5. Depends on the Supabase reference schema (#9) and the scheduled Action
scaffold (#10).

`product-brief.md` §6b names FPL-Core-Insights as the source of per-player, per-match clearances,
blocks, interceptions, tackles and recoveries — the raw inputs to defensive-contribution modelling —
plus xG, xA and ClubElo team ratings. It is CSV over plain HTTPS and needs no credential. This job
gets that data into Supabase so item 9 can compute defcon hit rates from it.

## Scope

**In scope:**

- `scripts/ingest-core-insights.ts`: fetch CSVs from
  `https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/{season}/...`, parse, and
  upsert into a new `player_match_stats` table.
- A migration under `supabase/migrations/` creating `player_match_stats`, keyed on
  (`player_id`, `match_id`), in the same idempotent style as #9.
- Update `teams.elo` from the source's `teams.csv` (ClubElo ratings).
- The season directory is read from configuration with a sensible default — not hardcoded in
  several places.
- **Handle the current season's directory not existing yet** (see notes — it does not, as of today).
- A `job_runs` row per execution with row counts and the season directory used.
- A step added to `.github/workflows/scheduled-jobs.yml`.

**Explicitly out of scope:**

- No modelling. Defensive-contribution hit rates are item 9; the projection model is item 10. This
  job stores raw per-match statistics and nothing derived.
- No implementation of the brief's degraded-mode fallback to the FPL API's own
  `defensive_contribution` field. That fallback is a **consumer** decision and belongs with the
  projection model. This ticket's job is to record honestly that the source was unavailable or
  stale, so the consumer can act on it.
- No `git clone` of the source repository. Fetch individual files over HTTPS.
- No new stored personal data — this is per-match football statistics.
- No credential, key or account of any kind. The source is public.
- No `src/` changes, no UI.
- No deletion of existing rows.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] The `player_match_stats` migration applies twice against an empty local Postgres, both runs
      exit 0, the second creating nothing new.
- [ ] Run against season `2025-2026`, the script populates `player_match_stats` with a non-zero row
      count, and the stored rows include non-null `tackles`, `interceptions`, `blocks`, `clearances`,
      `recoveries`, `xg` and `xa` for at least one player.
- [ ] Re-running against the same season leaves the row count unchanged.
- [ ] **Run against season `2026-2027`, whose directory does not exist yet, the script exits ZERO,
      writes no rows, and writes a `job_runs` row whose message states the season directory was not
      found.** A not-yet-published season is a normal state, not a failure — this job will run every
      day between now and 21 August against a directory that isn't there, and it must not page
      anybody.
- [ ] A genuine failure — an unreachable host, or a file that exists but does not parse — exits
      non-zero and writes a failed `job_runs` row naming the file.
- [ ] `teams.elo` is populated for all 20 teams after a `2025-2026` run.
- [ ] The `player_match_stats` migration **GRANTs** `SELECT` to `anon` and
      `SELECT, INSERT, UPDATE` to `service_role` on the new table, in the same file that creates
      it. RLS and GRANTs are separate gates: a policy without a grant yields `permission denied
      for table`, which is what broke the first heartbeat run on 11 Aug 2026. See
      `supabase/migrations/20260811160000_table_grants.sql` for the pattern to copy.
- [ ] The season identifier appears exactly once as a configurable default in the script, not
      repeated across URL strings.
- [ ] No credential, key, token or `Authorization` header appears anywhere in the script.
- [ ] The workflow still parses as valid YAML and the new step runs after the FPL ingest step.
- [ ] **The workflow contains BOTH ingest steps after the merge.** #11 edits the same file in the
      same wave, appending its own step at the same point. Your branch will not see #11's step and
      #11's will not see yours, so one of the two merges will conflict — resolve by keeping both,
      never by taking one side wholesale. A workflow missing a step is a job that silently never
      runs and produces no data and no error.
- [ ] Scope constraint: only `scripts/`, `supabase/migrations/` and
      `.github/workflows/scheduled-jobs.yml` change.

## Notes for the Analyst / Builder

**Verified live 11 Aug 2026 — read this before writing any URL.**

- `https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026/players.csv`
  returns a CSV whose header row is exactly
  `player_code,player_id,first_name,second_name,web_name,team_code,position`.
- **`data/2026-2027/` does not exist yet.** The 2026/27 season starts 21 August 2026 and the source
  has not published that directory. Build and verify everything against `2025-2026`; the DoD item
  above exists precisely so the job behaves correctly for the ten days before the real directory
  appears.
- **Season-root `playermatchstats.csv` returns 404 — do not assume it exists.** Per-match rows live
  under `data/{season}/By Gameweek/GW{x}/playermatchstats.csv`. Note the **space** in
  `By Gameweek`, which must be percent-encoded as `%20` in the URL. Season root holds the aggregate
  files: `players.csv`, `teams.csv`, `playerstats.csv`, `gameweek_summaries.csv`.
- `playermatchstats.csv` columns include: `player_id`, `match_id`, `minutes_played`, `goals`,
  `assists`, `xg`, `xa`, `xgot`, `shots_on_target`, `tackles`, `tackles_won`, `interceptions`,
  **`recoveries`**, `blocks`, `clearances`, `headed_clearances`, `saves`, `goals_conceded`,
  `goals_prevented`. `recoveries` is present — it is the column the CBIRT threshold for midfielders
  and forwards depends on, and its absence would have blocked item 9.
- `teams.csv` carries an `elo` column sourced from ClubElo.
- **Refresh times are 07:30 and 17:30 UTC.** `product-brief.md` §6b says 05:00 and 17:00; the source
  README says 07:30 and 17:30. Trust the source. Do not build a schedule that assumes the earlier
  time, and do not edit the brief — flag the discrepancy in the handback and Keshav will correct it.
- **Network allowlist.** The GitHub Actions runner reaches `raw.githubusercontent.com` freely. The
  routine's own cloud session uses an allowlist covering `fantasy.premierleague.com`, `*.vercel.app`,
  `vercel.com` and `*.supabase.co` plus the default list. If a local test fetch fails with `403` and
  `x-deny-reason: host_not_allowed`, report it as an owner action — Keshav adds the host to the
  App Factory environment. Do not route around it, and do not mark the ingest items verified from
  reading code because the fetch was blocked.
- Player ids in this source are aligned to official FPL element ids, so `player_match_stats.player_id`
  can reference `players.id`. Verify that on real data rather than assuming it — if the alignment is
  imperfect, record what you observed rather than silently dropping unmatched rows.
- **#11 edits `.github/workflows/scheduled-jobs.yml` in the same wave as you.** Both branches fork
  from the same `main`, so neither can see the other's step — the same structural collision that
  hit `decisions.md` on 11 Aug (`deltas.md` D6b). Append your step at the end of the job and keep
  the diff minimal, so the conflict is one obvious hunk rather than a tangle.
- Adding a CSV parsing library is a **Tier 2** choice. Proceed and log it with the because; do not
  hand-roll a parser that breaks on a quoted comma.
