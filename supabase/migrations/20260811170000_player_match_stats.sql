-- player_match_stats: per-player, per-match defensive and attacking stats
-- from the FPL-Core-Insights source.
--
-- Ticket #12. Raw inputs to defensive-contribution (defcon) modelling:
-- tackles, interceptions, blocks, clearances, recoveries, plus xG/xA/xGOT
-- and a few adjacent counting stats. This migration creates structure only
-- and adds one column to an existing table (teams.elo) — it writes no data.
-- scripts/ingest-core-insights.ts is the job that populates both.
--
-- Idempotent by construction, matching the #9/#10 migrations' style: every
-- CREATE TABLE / CREATE INDEX / ADD COLUMN is IF NOT EXISTS, and the policy
-- is dropped-then-recreated. Running this file twice against the same
-- database is safe and creates nothing new the second time.
--
-- Keyed on (player_id, match_id), per the ticket. match_id is the source's
-- own text slug (e.g. "25-26-prem-manchester-united-vs-arsenal"), not an
-- integer — there is no separate numeric match id in the source.
--
-- NO foreign key from player_match_stats.player_id to players.id. Verified
-- against real fetched data (see the ticket #12 Builder report for the
-- method): FPL element ids are NOT stable across season boundaries. Cross-
-- referencing the source's stable `player_code` against live bootstrap-static
-- showed ~99% name-match agreement on `code`, but only ~1% agreement on `id`
-- for the same players (453 of 458 sampled players changed id between the
-- 2025-2026 season and the about-to-start 2026-2027 season). players.id
-- reflects whichever season's bootstrap-static was last ingested, so a
-- historical season's player_match_stats rows will generally NOT resolve
-- against a live players table keyed by a different season's ids. A hard FK
-- would either reject most historical rows or force this job to silently
-- drop them — both worse than storing the id honestly and letting a
-- consumer join on whatever basis (season-matched ingest, or player_code if
-- that is added to players later) is appropriate for its own use. This is a
-- Tier 2 decision, logged in the Builder's ticket #12 report.
--
-- goals_prevented is numeric, not integer — the source reports it as a
-- decimal (shot-stopping value above/below expectation), unlike the counting
-- stats around it.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and
-- its local dev CLI) provisions `anon`/`service_role` automatically, but a
-- bare Postgres install used for migration testing does not.
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
-- teams.elo — ClubElo rating, sourced from FPL-Core-Insights' teams.csv.
-- Added here rather than in a standalone migration because this ticket is
-- what first populates it; #9 (which created public.teams) predates this
-- source and has no elo column.
-- ============================================================================

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS elo numeric;

COMMENT ON COLUMN public.teams.elo IS
  'ClubElo rating, from FPL-Core-Insights teams.csv. Populated by '
  'scripts/ingest-core-insights.ts (ticket #12). Null until that job has run '
  'at least once for a season whose teams.csv carries elo.';

-- ============================================================================
-- player_match_stats
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_match_stats (
  player_id                integer NOT NULL,          -- FPL element id AS OF THE INGESTED SEASON — see note above, no FK
  match_id                 text NOT NULL,               -- source's own slug, e.g. "25-26-prem-arsenal-vs-chelsea"
  season                   text NOT NULL,               -- e.g. "2025-2026", the configured ingest season
  gameweek                 integer NOT NULL,            -- 1-38, the "GW{n}" directory this row came from
  minutes_played           integer,
  goals                    integer,
  assists                  integer,
  xg                       numeric,
  xa                       numeric,
  xgot                     numeric,
  shots_on_target          integer,
  tackles                  integer,
  tackles_won              integer,
  interceptions            integer,
  recoveries                integer,
  blocks                   integer,
  clearances                integer,
  headed_clearances        integer,
  saves                    integer,
  goals_conceded            integer,
  goals_prevented          numeric,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, match_id)
);

COMMENT ON TABLE public.player_match_stats IS
  'Per-player, per-match stats from FPL-Core-Insights, keyed on '
  '(player_id, match_id). Raw inputs to defensive-contribution modelling '
  '(ticket #12) — nothing here is derived. No FK to players.id; see file '
  'header comment. Rows accumulate across seasons and are never deleted.';

CREATE INDEX IF NOT EXISTS idx_player_match_stats_player_id ON public.player_match_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_season_gameweek ON public.player_match_stats (season, gameweek);

-- ============================================================================
-- Row Level Security — read-only for the anon role, same pattern as #9/#10.
--
-- Writes come from the scheduled Action using the Supabase secret key,
-- which bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on this table.
-- ============================================================================

ALTER TABLE public.player_match_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_match_stats_select_anon" ON public.player_match_stats;
CREATE POLICY "player_match_stats_select_anon" ON public.player_match_stats FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are separate gates (see the #10/table_grants
-- migration for the full "because"; the short version is that a policy
-- without a grant yields "permission denied for table", not a filtered
-- result). Granted here, in the same file that creates the table, per the
-- pattern in 20260811160000_table_grants.sql. DELETE is deliberately
-- withheld — this job upserts and never deletes.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.player_match_stats TO anon;
GRANT SELECT, INSERT, UPDATE ON public.player_match_stats TO service_role;

COMMIT;
