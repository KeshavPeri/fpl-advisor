-- mini_league_standings: Keshav's real mini-league (classic league 848654), display only —
-- ticket #271, feature-list item 33.
--
-- ============================================================================
-- Why this table exists — and the one hard boundary on how it may be used.
-- ============================================================================
-- product-brief.md §1: "Maximise Keshav's own expected FPL points. Not relative performance
-- against his ~20-person mini-league" — and, explicitly: "mini-league standings may be
-- *displayed*. They must never enter the optimiser's objective." product-brief.md §5
-- pre-approves storing them: "Mini-league standings, which include the display names and team
-- names of the other ~20 managers in his league... is public via the FPL API, it is stored only
-- to display standings, and it is never used in any recommendation." This is display data. No
-- solver input, no projection input, and no recommendation logic may ever read this table —
-- src/lib/scoring/ and src/lib/projection/ must stay exactly as untouched by this table as they
-- are by every other display-only table in this schema.
--
-- Structure only — this migration writes no data. scripts/ingest-mini-league.ts is the job that
-- populates it, reading the public, unauthenticated leagues-classic/{id}/standings/ endpoint
-- (product-brief.md §6a already lists this endpoint among the ones the app uses).
--
-- ============================================================================
-- Source: GET https://fantasy.premierleague.com/api/leagues-classic/{leagueId}/standings/
--         ?page_standings={n}
-- ============================================================================
-- Paginated via standings.has_next; each page's standings.results carries one row per manager
-- in the league. Columns read, straight off the API's own field names: entry, entry_name,
-- player_name, rank, last_rank, total, event_total. Not independently verified against a live
-- response by this migration's own ticket (no network access from this session) — the shape is
-- FPL's long-documented classic-league standings response and matches the ticket's own field
-- list; if any field turns out renamed or reshaped, scripts/ingest-mini-league.ts's parsing will
-- fail loudly (a record job_runs failure row), not silently write wrong data.
--
-- gameweek_id is not the standings response's own field — the endpoint does not return one.
-- scripts/ingest-mini-league.ts resolves it separately, from bootstrap-static/'s own
-- events[].finished, as the highest id among finished events (the latest completed gameweek —
-- classic-league standings only ever reflect completed gameweeks, never a live/in-progress one,
-- per product-brief.md §3's "no live in-play... live mini-league updates" out-of-scope note).
--
-- ============================================================================
-- Keying: entry_id, the manager's own FPL entry id — not a stable identifier across mini-leagues,
-- but the only one this endpoint offers, and the one already used everywhere else in this schema
-- (squads/squad_picks' own entry, via FPL_ENTRY_ID/VITE_FPL_ENTRY_ID) to mean "one manager's FPL
-- account".
-- ============================================================================
--
-- No FK from entry_id to anything — a mini-league's other ~19 managers have no other row anywhere
-- in this schema; only the PK's own gameweek_id carries a real FK, to public.gameweeks, safe
-- because standings are only ever ingested for a completed gameweek that already exists there.
--
-- Idempotent by construction, matching every migration since #9: CREATE TABLE / CREATE INDEX are
-- IF NOT EXISTS, the policy is dropped-then-recreated, GRANTs are safe to re-run. Running this
-- file twice against the same database is safe and creates nothing new the second time.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and its local dev CLI)
-- provisions anon/service_role automatically, a bare Postgres install used for migration testing
-- does not.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ============================================================================
-- mini_league_standings
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mini_league_standings (
  league_id   integer NOT NULL,                                  -- config/mini-league.json's leagueId (848654) — not a secret
  gameweek_id integer NOT NULL REFERENCES public.gameweeks (id), -- the latest FINISHED gameweek as of ingest, see header
  entry_id    integer NOT NULL,                                  -- the manager's FPL entry id ("entry" in the API response)
  entry_name  text,                                               -- the manager's team name
  player_name text,                                               -- the manager's own display name
  rank        integer,                                            -- this gameweek's standing in the league
  last_rank   integer,                                            -- the previous gameweek's standing, verbatim from the API
  total       integer,                                            -- cumulative league points to date
  event_total integer,                                            -- this gameweek's own points
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, gameweek_id, entry_id)
);

COMMENT ON TABLE public.mini_league_standings IS
  'Keshav''s real mini-league standings (classic league 848654), DISPLAY ONLY — ticket #271, '
  'feature-list item 33. product-brief.md §1: standings may be displayed but must NEVER enter '
  'the optimiser''s objective or any recommendation. No FK on entry_id — the other ~20 managers '
  'in this league have no other row anywhere in this schema. Populated by '
  'scripts/ingest-mini-league.ts, one full replace of the league''s rows per finished gameweek '
  '(upsert on the primary key, never a delete).';

COMMENT ON COLUMN public.mini_league_standings.league_id IS
  'config/mini-league.json''s leagueId (848654) — not a secret, a public classic-league id. '
  'Stored explicitly (rather than assumed as a single global constant) so a future second league '
  'costs a config change, not a schema change.';

COMMENT ON COLUMN public.mini_league_standings.gameweek_id IS
  'The latest FINISHED gameweek as of this ingest run (bootstrap-static/''s events[].finished, '
  'highest id) — NOT a field the standings/ endpoint itself returns. Real FK to public.gameweeks: '
  'safe because this column is only ever set to a gameweek that has already finished and '
  'therefore already exists there (unlike public.gameweek_live_stats'' same real-FK reasoning, '
  'for the same reason).';

COMMENT ON COLUMN public.mini_league_standings.last_rank IS
  'Verbatim from the API''s own "last_rank" field. Unlike squads.overall_rank '
  '(scripts/sync-squad.ts''s coerceOverallRank), this column is NOT coerced or sentinel-checked — '
  'this ticket could not verify live what value a manager''s first-ever league gameweek reports '
  '(no network access from this session). If a 0-as-"no previous rank" sentinel is later '
  'confirmed, treat that as a follow-up ticket, not an assumption baked in here.';

CREATE INDEX IF NOT EXISTS idx_mini_league_standings_league_gameweek
  ON public.mini_league_standings (league_id, gameweek_id);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job/ingest table (#9/#10/#12/
-- #224/#248). Writes come from the scheduled/hand-run job using the Supabase secret key, which
-- bypasses RLS entirely — there is deliberately no insert/update/delete policy for anon.
-- ============================================================================

ALTER TABLE public.mini_league_standings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mini_league_standings_select_anon" ON public.mini_league_standings;
CREATE POLICY "mini_league_standings_select_anon" ON public.mini_league_standings FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/table_grants migration for the
-- full "because"). Granted here, in the same file that creates the table, per the pattern in
-- every migration since #12. DELETE is deliberately withheld — this job upserts and never
-- deletes, matching every other ingest table in this repo.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.mini_league_standings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.mini_league_standings TO service_role;

COMMIT;
