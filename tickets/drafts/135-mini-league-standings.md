## Why

Feature item 33. Keshav wants to see where he stands in his real mini-league (~20 managers, classic
league **848654**) without opening the FPL app. **Display only:** brief §1 says standings "may be
*displayed*. They must never enter the optimiser's objective". Nothing here touches the solver,
projections or recommendations.

**Storing this is pre-approved and is not a Tier 1 stop.** Brief §7 lists "Mini-league standings,
which include the display names and team names of the other ~20 managers" as data the app
stores, only for display. It uses public, unauthenticated FPL endpoints, with no login and no
credential.

## Build

- `config/mini-league.json` (new): `{"leagueId": 848654}`. Not a secret.
- `supabase/migrations/<timestamp>_mini_league_standings.sql` (new, idempotent, same style as
  `20260917100000_player_gameweek_history.sql`). Table `public.mini_league_standings`:
  `league_id integer, gameweek_id integer REFERENCES public.gameweeks(id), entry_id integer,
  entry_name text, player_name text, rank integer, last_rank integer, total integer,
  event_total integer, fetched_at timestamptz DEFAULT now()`, PK `(league_id, gameweek_id,
  entry_id)`. RLS on. `SELECT` for `anon` (policy + grant), `SELECT, INSERT, UPDATE` for
  `service_role`, no `DELETE`. Pick a timestamp later than every existing migration.
- `scripts/ingest-mini-league.ts` (new) + `.test.ts`: GET
  `https://fantasy.premierleague.com/api/leagues-classic/{leagueId}/standings/?page_standings={n}`,
  following `standings.has_next` pages. Take `entry, entry_name, player_name, rank, last_rank,
  total, event_total` from `standings.results`. `gameweek_id` = the latest finished event (from
  `bootstrap-static` `events[].finished`, highest id). Upsert on the PK. One `job_runs` row
  (`job_name='ingest-mini-league'`) with the row count. Same env and style as `scripts/ingest-fpl.ts`.
  If the league fetch fails, record a failure row and exit non-zero — don't write partial pages.
- `.github/workflows/scheduled-jobs.yml`: a step "Ingest mini-league" after "Sync squad from FPL",
  `continue-on-error: true` (standings must never stop the projection path).
- `src/lib/miniLeague/api.ts`, `types.ts`, `derive.ts` + `derive.test.ts` (new): read the latest
  gameweek's rows for the league, ordered by rank. `derive` returns Keshav's row (match
  `entry_id` to `VITE_FPL_ENTRY_ID` via the existing `src/lib/squad/env.ts`), the rows directly
  above and below him, the leader, points gap to the leader and to the next place up, and
  rank movement (`last_rank − rank`).
- `src/components/MiniLeagueCard.tsx` + `.css` (new), used once in `src/screens/HomeScreen.tsx`
  below the accuracy card. The card shows rank of N, movement arrow, gap to leader, gap to the
  place above, and a compact 3–5 row table (leader, above, him highlighted, below). Loading,
  empty ("Standings appear after the first gameweek is ingested") and error states like
  `AccuracyCard`. Match existing components and tokens — no new visual direction.
- `supabase/README.md`: add the migration's row, marked **NOT YET APPLIED**.
- `feature-list.md`: item 33 → built (display only).

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Tests: pagination across two pages from fixture JSON; `gameweek_id` = highest finished event;
  `derive` for Keshav in 1st, middle and last place, and when his entry isn't in the league.
- The migration is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS), as the other files are.

## Post-merge owner check (does not block this PR)

Keshav applies the migration (orchestrator gives the exact steps). The orchestrator then triggers
`scheduled-jobs.yml` and checks the card. **Not a gate.**

## Files

New: `config/mini-league.json`, `supabase/migrations/<timestamp>_mini_league_standings.sql`,
`scripts/ingest-mini-league.ts` + `.test.ts`, `src/lib/miniLeague/{api,types,derive}.ts`,
`src/lib/miniLeague/derive.test.ts`, `src/components/MiniLeagueCard.tsx` + `.css`.
Edit: `.github/workflows/scheduled-jobs.yml`, `src/screens/HomeScreen.tsx`, `supabase/README.md`,
`feature-list.md`. Nothing under `model/` or `src/lib/accuracy/`.
