-- gameweek_live_stats: real per-gameweek bonus/BPS/minutes/total_points from the FPL API's own
-- event/{gw}/live/ endpoint — ticket #224.
--
-- ============================================================================
-- Why this table exists.
-- ============================================================================
-- docs/model-review-2026-09-02.md §1h and docs/projection-model-backlog.md's G3 both name the
-- bonus allocator (src/lib/projection/bonus.ts, ticket #78) as the one component in this model
-- with no validating instrument anywhere: player_match_stats carries neither `bonus` nor `bps`
-- (verified directly against the source CSV header, ticket #127 — permanent, not an ingest gap
-- a re-ingest closes). This table is the first place actual bonus and BPS enter this database at
-- all. Nothing here changes the allocator, the backtest, the calibration report, the solver, or
-- the app — see scripts/ingest-gameweek-live-stats.ts and scripts/bonus-validation-report.ts for
-- the jobs that populate and read it.
--
-- ============================================================================
-- Source and its one hard limitation.
-- ============================================================================
-- GET {FPL_API_BASE_URL}/event/{gw}/live/ — fetched by hand on 11 September 2026 and confirmed
-- to return `{"elements":[{"id","stats":{...},"explain","modified"}]}`, 654 elements, `stats`
-- carrying (among others) `bonus`, `bps`, `minutes` and `total_points` verbatim. Public,
-- unauthenticated, like every other FPL endpoint this app uses — no credential, no `my-team/`,
-- product-brief.md §6a's rule holds.
--
-- THIS ENDPOINT SERVES THE CURRENT SEASON ONLY. Bonus can be validated on 2026/27 gameweeks
-- played so far and no further back, ever — there is no equivalent endpoint for a past season.
-- That is why gameweek_id below carries a real foreign key to public.gameweeks (the CURRENT
-- season's own reference table, always freshly ingested by scripts/ingest-fpl.ts) rather than the
-- plain, un-keyed integer public.feature_history/public.player_match_stats use for a
-- cross-season row — same reasoning public.player_projections' migration already gives for the
-- same choice.
--
-- ============================================================================
-- Keying: player_code, never a bare element id.
-- ============================================================================
-- event/{gw}/live/'s `elements[].id` is this season's own FPL element id (the same id
-- public.players.id already uses this season). It is mapped to public.players.code by
-- scripts/ingest-gameweek-live-stats.ts BEFORE any row reaches this table — an id that does not
-- resolve against public.players is counted and excluded, never guessed nor stored as a bare
-- element id (see that script's own header). player_code has no FK of its own: public.players.code
-- carries no unique constraint to reference, same as public.player_projections.player_code and
-- public.squad_picks.player_code before it.
--
-- ============================================================================
-- Only finished, past-lockdown gameweeks are ever written here.
-- ============================================================================
-- A live gameweek's bonus is provisional until lockdown (09:00 UK the morning after the final
-- match) — product-brief.md §6d, the same rule scripts/settle-predictions.ts already honours via
-- scripts/lib/lockdown.ts. scripts/ingest-gameweek-live-stats.ts reuses that exact rule (imported
-- from scripts/settle-predictions.ts's own decideGameweekEligibility, not re-derived) rather than
-- writing a second version of it. This migration creates structure only and enforces nothing
-- about eligibility itself — that discipline lives in the ingest script, matching every other
-- ingest/table split in this repo (e.g. player_projections vs project-points.ts).
--
-- bonus/bps/minutes/total_points are all integer, NOT NULL, no default — an element that is
-- missing one of these on an otherwise well-formed payload is excluded from the write entirely
-- (never guessed as 0), see the ingest script's own header for the "no fake zero" reasoning this
-- repo already applies to prediction_log's actual_points.
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
-- gameweek_live_stats
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gameweek_live_stats (
  gameweek_id   integer NOT NULL REFERENCES public.gameweeks (id),
  player_code   integer NOT NULL,
  bonus         integer NOT NULL,
  bps           integer NOT NULL,
  minutes       integer NOT NULL,
  total_points  integer NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gameweek_id, player_code)
);

COMMENT ON TABLE public.gameweek_live_stats IS
  'Real per-gameweek bonus/BPS/minutes/total_points from the FPL API''s event/{gw}/live/ '
  'endpoint (ticket #224) — the first stored, per-player validating instrument for the bonus '
  'allocator (src/lib/projection/bonus.ts, G3). One row per (gameweek, player_code), written '
  'ONLY for finished, past-lockdown gameweeks by scripts/ingest-gameweek-live-stats.ts. '
  'CURRENT SEASON ONLY — the source endpoint has no equivalent for a past season, and never '
  'will; see scripts/bonus-validation-report.ts for the comparison this table exists to feed.';

COMMENT ON COLUMN public.gameweek_live_stats.gameweek_id IS
  'FK to public.gameweeks, the current season''s own reference table — safe because this table, '
  'like player_projections, only ever stores rows for the currently-ingested season (never a '
  'past one; the source endpoint cannot serve one).';

COMMENT ON COLUMN public.gameweek_live_stats.player_code IS
  'The stable cross-season player identifier (public.players.code), resolved from the source '
  'element id by scripts/ingest-gameweek-live-stats.ts BEFORE this row is written — never a bare '
  'FPL element id. No FK: public.players.code carries no unique constraint to reference, same as '
  'public.player_projections.player_code before it.';

COMMENT ON COLUMN public.gameweek_live_stats.bonus IS
  'The real, awarded 3/2/1 bonus for this player-gameweek, verbatim from stats.bonus.';

COMMENT ON COLUMN public.gameweek_live_stats.bps IS
  'The raw Bonus Points System score bonus is derived from, verbatim from stats.bps — signed '
  '(cards and other negative-BPS actions can take it below zero). Stored alongside bonus because '
  'src/lib/projection/bonus.ts models a SHARE OF BPS, not bonus directly — a future ticket may '
  'find the more informative comparison is against this column rather than bonus itself; see '
  'docs/projection-model-backlog.md''s G3 entry.';

COMMENT ON COLUMN public.gameweek_live_stats.minutes IS
  'Minutes played this gameweek, verbatim from stats.minutes — carried alongside bonus/bps '
  'mainly as a sanity/diagnostic field (e.g. distinguishing a real appearance from a blank).';

COMMENT ON COLUMN public.gameweek_live_stats.total_points IS
  'This player''s real total FPL points for the gameweek, verbatim from stats.total_points — not '
  'currently compared against anything (prediction_log/settle-predictions.ts already tracks '
  'total-points accuracy from the same live/ endpoint); stored for completeness and for any '
  'future cross-check between the two ingests.';

CREATE INDEX IF NOT EXISTS idx_gameweek_live_stats_player_code ON public.gameweek_live_stats (player_code);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job/projection table (#9/#10/
-- #33/#73). Writes come from the scheduled/hand-run job using the Supabase secret key, which
-- bypasses RLS entirely — there is deliberately no insert/update/delete policy for anon.
-- ============================================================================

ALTER TABLE public.gameweek_live_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gameweek_live_stats_select_anon" ON public.gameweek_live_stats;
CREATE POLICY "gameweek_live_stats_select_anon" ON public.gameweek_live_stats FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/table_grants migration for the
-- full "because"). Granted here, in the same file that creates the table, per the pattern in
-- every migration since #12. DELETE is deliberately withheld — this job upserts and never
-- deletes, matching every other ingest table in this repo.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.gameweek_live_stats TO anon;
GRANT SELECT, INSERT, UPDATE ON public.gameweek_live_stats TO service_role;

COMMIT;
