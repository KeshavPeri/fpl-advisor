-- player_projections: the baseline v1 projection model's output.
--
-- Ticket #33. One row per (gameweek, player, model_version), overwritten by
-- each daily run of scripts/project-points.ts. model_version exists so a
-- future ticket can write a replacement model (e.g. a retrained OpenFPL,
-- per product-brief.md §6d) alongside 'baseline-v1' rather than over it.
--
-- This migration creates structure only and writes no data — see
-- scripts/project-points.ts for the job that populates it.
--
-- Idempotent by construction, matching every prior migration's style:
-- CREATE TABLE / CREATE INDEX are IF NOT EXISTS, policies are
-- dropped-then-recreated, GRANTs and ALTER DEFAULT PRIVILEGES are safe to
-- re-run. Running this file twice against the same database is safe and
-- creates nothing new the second time.
--
-- player_id and gameweek_id DO have foreign keys here, unlike
-- player_match_stats.player_id (see that migration's header). The
-- difference: player_match_stats stores a *historical* season's rows keyed
-- on that season's element ids, which do not resolve against a
-- currently-ingested players table. This table stores projections for the
-- *current* season's players against the *current* season's gameweeks —
-- both always freshly ingested by scripts/ingest-fpl.ts before this job
-- runs — so a real FK is safe and catches a mapping bug loudly instead of
-- silently writing an orphan row. player_code is carried alongside as a
-- second, denormalized identifier (same pattern as squad_picks.player_code)
-- so a consumer can still resolve a projection if a player is ever
-- re-keyed mid-season; it has no FK of its own, matching the
-- squad_picks.player_code precedent.

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
-- player_projections
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_projections (
  gameweek_id       integer NOT NULL REFERENCES public.gameweeks (id),
  player_id         integer NOT NULL REFERENCES public.players (id),
  model_version     text NOT NULL,
  player_code       integer,
  expected_points   numeric NOT NULL,
  expected_minutes  numeric NOT NULL,
  components        jsonb NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gameweek_id, player_id, model_version)
);

COMMENT ON TABLE public.player_projections IS
  'Baseline v1 projection model output (ticket #33) — one row per '
  '(gameweek, player, model_version), overwritten by each daily run. '
  'See scripts/project-points.ts and product-brief.md §6d.';

COMMENT ON COLUMN public.player_projections.model_version IS
  'Written from the single named MODEL_VERSION constant in '
  'scripts/project-points.ts (currently ''baseline-v1''). Part of the '
  'primary key so a future model can be written alongside this one rather '
  'than overwriting it.';

COMMENT ON COLUMN public.player_projections.player_code IS
  'Denormalized copy of players.code at projection time, same pattern as '
  'squad_picks.player_code — no FK (players.code has no unique constraint '
  'to reference), a convenience for a consumer that only has the code.';

COMMENT ON COLUMN public.player_projections.components IS
  'Every one of the five model inputs (minutes probability, xG/xA rates, '
  'ClubElo fixture difficulty, clean-sheet probability, defensive-'
  'contribution hit rate) and every individual point component, by name. '
  'Feeds item 13''s reasoning screen and item 23''s accuracy tracker. See '
  'src/lib/projection/expectedPoints.ts''s FixtureModelInputs/'
  'FixtureProjectionComponents shapes for what scripts/project-points.ts '
  'writes here.';

CREATE INDEX IF NOT EXISTS idx_player_projections_gameweek_id ON public.player_projections (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_player_projections_player_id ON public.player_projections (player_id);

-- ============================================================================
-- Row Level Security — read-only for the anon role, same pattern as every
-- reference/job table (#9/#10/#12).
--
-- Writes come from the scheduled Action using the Supabase secret key,
-- which bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on this table.
-- ============================================================================

ALTER TABLE public.player_projections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_projections_select_anon" ON public.player_projections;
CREATE POLICY "player_projections_select_anon" ON public.player_projections FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the table,
-- per the pattern in 20260811170000_player_match_stats.sql. DELETE is
-- deliberately withheld — this job upserts and never deletes (DoD:
-- `.delete(` does not appear in scripts/project-points.ts).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.player_projections TO anon;
GRANT SELECT, INSERT, UPDATE ON public.player_projections TO service_role;

COMMIT;
