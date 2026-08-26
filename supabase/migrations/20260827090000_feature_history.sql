-- feature_history: lookahead-free, point-in-time cumulative match totals.
--
-- Ticket #121 (feature-list item 29, first slice). This table creates
-- structure only and writes no data — scripts/build-feature-history.ts is
-- the job that populates it, run by hand, on demand, for one season at a
-- time. This migration is applied to no environment automatically; see
-- supabase/README.md.
--
-- WHY THIS TABLE EXISTS. To ask "would this model have recommended well in
-- a past gameweek?", a backtest needs to know what could have been known
-- before that gameweek's deadline -- not what is known now. Reading
-- public.player_match_stats directly for a past gameweek is contaminated by
-- every later match in the same season (lookahead): any rate computed that
-- way reports a model better than it actually would have been. This table
-- stores, for every player and every gameweek of an ingested season, the
-- CUMULATIVE TOTALS of that player's Premier League matches STRICTLY BEFORE
-- that gameweek -- nothing from the gameweek itself, nothing from later.
--
-- RAW TOTALS, NEVER RATES (Tier 2, logged HIGH-IMPACT on this ticket). The
-- per-90 rate model has changed three times this month alone (CBI and
-- recoveries added, a two-stage shrink introduced, the position prior
-- possibly changing again elsewhere in the same batch this ticket shipped
-- in). Storing a rate would freeze one version of that model into a table
-- meant to outlive all of them. A raw prior-match total is a fact about
-- football that never changes -- any past or future version of the rate
-- model can be applied to it afterwards. This is also why this migration
-- adds no foreign key to any projection- or rate-related table: this table
-- has no consumer yet, deliberately (see the ticket's scope).
--
-- KEYED ON THE STABLE CROSS-SEASON PLAYER IDENTIFIER, NEVER THE ELEMENT ID
-- THAT RESETS EVERY SEASON. 453 of 458 players changed FPL element id
-- between the 2025-2026 and 2026-2027 seasons (see the #12/#22 migrations'
-- header comments) -- a table whose whole purpose is to be read across
-- season boundaries must not key on an identifier that does not survive
-- one. This table's primary key is (season, gameweek_id, code), joined
-- against public.player_match_stats on its own stable per-player code
-- column, exactly as every other cross-season join in this repo already
-- does (see e.g. scripts/project-points.ts's header, "THE JOIN").
--
-- gameweek_id IS THE PLAIN GAMEWEEK NUMBER (1-38 within a season), matching
-- public.player_match_stats' own gameweek column -- it is NOT a foreign key
-- to public.gameweeks.id. public.gameweeks holds only the currently
-- ingested FPL season's events (overwritten every season by
-- scripts/ingest-fpl.ts) and its ids are themselves season-specific FPL
-- event ids, so an FK here would break the instant this table is asked to
-- hold more than one season -- which is the entire point of carrying
-- `season` in the primary key. The column is named gameweek_id, not
-- gameweek, only to match this ticket's specified schema; readers should
-- not infer a foreign-key relationship from the name.
--
-- PREMIER LEAGUE ONLY. Every total here counts only matches whose
-- public.player_match_stats.competition = 'prem' -- about 18% of that
-- table's rows are cup or European fixtures, which score no FPL points and
-- carry a 34% higher xG per 90 than league form (ticket #54). Every column
-- here is a totals-of-Premier-League-matches figure and nothing else.
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX IF NOT EXISTS, policy dropped then recreated. Running
-- this file twice against the same database is safe and creates nothing new
-- the second time.

BEGIN;

-- ============================================================================
-- Roles -- see the #9 migration for why this guard exists: real Supabase
-- (and its local dev CLI) provisions `anon`/`service_role` automatically,
-- but a bare Postgres install used for migration testing does not.
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
-- feature_history
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_history (
  season                       text NOT NULL,               -- e.g. "2025-2026" -- the ingested season this row's totals belong to
  gameweek_id                  integer NOT NULL,            -- the plain gameweek number, 1-38 -- NOT an FK, see header
  player_code                  integer NOT NULL,            -- the stable cross-season identifier -- never the per-season element id, see header

  -- Cumulative totals of this player's Premier League matches STRICTLY
  -- BEFORE gameweek_id within this season. Always a real, non-null number --
  -- a player's very first ingested gameweek carries prior_matches = 0 and
  -- every other total at zero, never null and never a missing row.
  prior_matches                 integer NOT NULL DEFAULT 0,
  prior_minutes                 integer NOT NULL DEFAULT 0,
  prior_xg                      numeric NOT NULL DEFAULT 0,
  prior_xa                      numeric NOT NULL DEFAULT 0,
  prior_saves                   integer NOT NULL DEFAULT 0,
  prior_clearances              integer NOT NULL DEFAULT 0,
  prior_blocks                  integer NOT NULL DEFAULT 0,
  prior_interceptions           integer NOT NULL DEFAULT 0,
  prior_tackles                 integer NOT NULL DEFAULT 0,
  prior_recoveries              integer NOT NULL DEFAULT 0,
  prior_team_goals_conceded     integer NOT NULL DEFAULT 0,

  computed_at                   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (season, gameweek_id, player_code)
);

COMMENT ON TABLE public.feature_history IS
  'Point-in-time, lookahead-free cumulative Premier League match totals, one '
  'row per (season, gameweek_id, player_code). Every prior_* column counts '
  'only that player''s matches STRICTLY BEFORE gameweek_id in that season -- '
  'never that gameweek''s own match, never a later one. Raw totals only, no '
  'rates -- see ticket #121. No consumer reads this table yet, deliberately.';

CREATE INDEX IF NOT EXISTS idx_feature_history_player_code ON public.feature_history (player_code);
CREATE INDEX IF NOT EXISTS idx_feature_history_season_gameweek ON public.feature_history (season, gameweek_id);

-- ============================================================================
-- Row Level Security -- read-only for the anon role, same pattern as #12.
--
-- Writes come from a hand-run job using the Supabase secret key, which
-- bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on this table.
-- ============================================================================

ALTER TABLE public.feature_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feature_history_select_anon" ON public.feature_history;
CREATE POLICY "feature_history_select_anon" ON public.feature_history FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs -- RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the table,
-- per the pattern in 20260811170000_player_match_stats.sql. DELETE is
-- deliberately withheld -- this job upserts and never deletes.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.feature_history TO anon;
GRANT SELECT, INSERT, UPDATE ON public.feature_history TO service_role;

COMMIT;
