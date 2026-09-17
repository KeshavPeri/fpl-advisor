-- player_gameweek_history: per-gameweek price, bonus and BPS history — ticket #248.
--
-- ============================================================================
-- Why this table exists.
-- ============================================================================
-- Two gaps this closes, both recorded in docs/projection-model-backlog.md:
--   - G19 (ticket #223) says a full season replay of the recommendation layer needs a per-
--     gameweek price history, and that nothing in this database has ever stored one:
--     public.players.now_cost holds exactly one number, the CURRENT price, overwritten every
--     ingest (scripts/ingest-fpl.ts). G19 also says this history "does not exist in
--     FPL-Core-Insights" — that claim is corrected, not restated, by this ticket (see the
--     docs/projection-model-backlog.md edit alongside this migration): it does exist, in a
--     different file from the one G19 checked.
--   - G3 (tickets #78/#127/#224/#237) says the bonus allocator (src/lib/projection/bonus.ts) can
--     only be validated against the CURRENT season, via public.gameweek_live_stats sourced from
--     the FPL API's event/{gw}/live/ endpoint — "there is no equivalent for a past season, and
--     never will be" (ticket #224's migration header, restated in G3). This table is that
--     equivalent, for a full past season, at scale.
--
-- Structure only — this migration writes no data. scripts/ingest-core-insights.ts is the job
-- that populates it. Nothing here changes src/lib/projection/, the solver, the backtest, the
-- calibration report, scripts/bonus-validation-report.ts, or the app — this is substrate.
--
-- ============================================================================
-- Source, verified directly on 17 Sept 2026 (both seasons fetched and inspected row-by-row —
-- not assumed from the ticket text, which turned out to be wrong about one column's units; see
-- the now_cost comment below).
-- ============================================================================
-- data/<season>/playerstats.csv in FPL-Core-Insights (github.com/olbauday/FPL-Core-Insights) — a
-- DIFFERENT file from data/<season>/By Gameweek/GW{n}/playermatchstats.csv, which
-- scripts/ingest-core-insights.ts already reads for public.player_match_stats. playerstats.csv
-- lives at the season ROOT (one file, every gameweek), one row per player per gameweek:
-- 29,978 data rows for 2025-2026, 2,583 for 2026-2027, as of this ticket. Columns read: id,
-- now_cost, bonus, bps, ep_next, gw, starts.
--
-- bonus/bps/starts ARE CUMULATIVE SEASON-TO-DATE TOTALS, not this gameweek's own award — verified
-- by tracing one player's rows across consecutive gameweeks: starts rises by exactly 1 per
-- gameweek for a nailed starter, bonus and bps rise monotonically (bps can move by ±1 between
-- gameweeks — a small post-hoc correction FPL itself sometimes applies). This is the same
-- season-cumulative semantics FPL's own bootstrap-static top-level element.bonus/element.bps/
-- element.starts fields have; this table is a per-gameweek SNAPSHOT of those totals, not a
-- per-gameweek delta. A consumer wanting a single gameweek's own bonus/bps must difference
-- consecutive rows for the same player_code — not attempted by this ticket or its job.
--
-- ============================================================================
-- Keying: player_code, never the source's own "id" column.
-- ============================================================================
-- playerstats.csv's own "id" is that season's own FPL element id — NOT a stable cross-season key
-- (see 20260811180000_player_match_stats_player_code.sql's header: 453 of 458 players changed
-- element id between the 2025-2026 and 2026-2027 seasons). scripts/ingest-core-insights.ts
-- resolves it to player_code through that SAME season's own players.csv, reusing the identical
-- playerCodeByPlayerId map player_match_stats.player_code already uses — no second fetch, no
-- second map. A row whose id does not resolve is skipped and counted by reason
-- (job_runs.details.playerStatsRowsUnresolvedByReason), never guessed.
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
-- player_gameweek_history
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_gameweek_history (
  season      text NOT NULL,               -- e.g. "2025-2026" — the ingested season this row belongs to
  gameweek    integer NOT NULL,            -- 1-38, playerstats.csv's own "gw" column
  player_code integer NOT NULL,            -- stable cross-season identifier — never the per-season element id, see header
  now_cost    numeric NOT NULL,            -- see column comment — NOT the same units as public.players.now_cost
  bonus       integer NOT NULL,            -- cumulative season-to-date as of this gameweek — see header and column comment
  bps         integer NOT NULL,            -- cumulative season-to-date as of this gameweek — see header and column comment
  starts      integer NOT NULL,            -- cumulative season-to-date as of this gameweek — see header and column comment
  ep_next     numeric,                     -- FPL's own next-gameweek points estimate; nullable, the one column genuinely observed blank in the source
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, gameweek, player_code)
);

COMMENT ON TABLE public.player_gameweek_history IS
  'Per-gameweek price, bonus and BPS history from FPL-Core-Insights'' playerstats.csv (ticket '
  '#248) — one row per (season, gameweek, player_code), covering FULL PAST SEASONS (unlike '
  'public.gameweek_live_stats, current season only). Substrate for a future season replay '
  '(docs/projection-model-backlog.md G19) and full-scale bonus/BPS validation (G3). Populated '
  'by scripts/ingest-core-insights.ts. Structure only here — no model, solver, backtest or app '
  'code reads this table yet.';

COMMENT ON COLUMN public.player_gameweek_history.now_cost IS
  'Player price at this gameweek, verbatim from playerstats.csv''s own now_cost column. VERIFIED '
  '17 Sept 2026 (both seasons fetched directly, full observed range 3.7-15.5): this source column '
  'is ALREADY expressed in decimal million-pounds (e.g. 5.8 means £5.8m) — it is NOT FPL''s raw '
  'integer-tenths-of-a-million format that public.players.now_cost carries (cross-checked the '
  'same day against a live bootstrap-static/ fetch, which returns the plain integer 58 for the '
  'same £5.8m price, never 5.8). Stored here EXACTLY as the source provides it, no scaling in '
  'either direction. A consumer comparing this column against public.players.now_cost must '
  'convert one side first — they do not share units, despite the identical column name.';

COMMENT ON COLUMN public.player_gameweek_history.player_code IS
  'The stable cross-season player identifier (public.players.code), resolved from '
  'playerstats.csv''s own "id" column (that season''s FPL element id, NOT stable across seasons) '
  'via that same season''s players.csv — the identical mechanism player_match_stats.player_code '
  'already uses. No FK: public.players.code carries no unique constraint to reference, same as '
  'public.player_match_stats.player_code / public.player_projections.player_code before it.';

COMMENT ON COLUMN public.player_gameweek_history.bonus IS
  'CUMULATIVE bonus points awarded season-to-date AS OF this gameweek, verbatim from '
  'playerstats.csv''s own "bonus" column — the same season-cumulative semantics FPL''s own '
  'bootstrap-static top-level element.bonus field has, NOT this single gameweek''s own award. '
  'Verified by tracing one player''s rows across consecutive gameweeks: the value rises '
  'monotonically. A consumer wanting a single gameweek''s own bonus must difference consecutive '
  'rows for the same player_code — not computed by this ticket. Complements '
  'public.gameweek_live_stats (ticket #224), whose "bonus" column IS the single-gameweek award '
  'but only for the current season; see docs/projection-model-backlog.md G3.';

COMMENT ON COLUMN public.player_gameweek_history.bps IS
  'CUMULATIVE Bonus Points System score season-to-date AS OF this gameweek, verbatim from '
  'playerstats.csv''s own "bps" column — same cumulative semantics as bonus above, not this '
  'gameweek''s own BPS. Can occasionally move by a small amount (observed ±1) between '
  'consecutive gameweeks — FPL itself sometimes applies a small post-hoc BPS correction.';

COMMENT ON COLUMN public.player_gameweek_history.starts IS
  'CUMULATIVE number of starts season-to-date AS OF this gameweek, verbatim from '
  'playerstats.csv''s own "starts" column — same cumulative semantics as bonus/bps above, not a '
  'per-gameweek start/bench flag.';

COMMENT ON COLUMN public.player_gameweek_history.ep_next IS
  'FPL''s own published expected-points-next-gameweek estimate at the time this row was '
  'captured, verbatim from playerstats.csv''s own "ep_next" column. Nullable — the source '
  'leaves it blank for a small number of rows (observed once in 29,978 rows for 2025-2026); '
  'never fabricated as 0.';

CREATE INDEX IF NOT EXISTS idx_player_gameweek_history_player_code ON public.player_gameweek_history (player_code);
CREATE INDEX IF NOT EXISTS idx_player_gameweek_history_season_gameweek ON public.player_gameweek_history (season, gameweek);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job/ingest table (#9/#10/#12/
-- #224). Writes come from the scheduled/hand-run job using the Supabase secret key, which
-- bypasses RLS entirely — there is deliberately no insert/update/delete policy for anon.
-- ============================================================================

ALTER TABLE public.player_gameweek_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_gameweek_history_select_anon" ON public.player_gameweek_history;
CREATE POLICY "player_gameweek_history_select_anon" ON public.player_gameweek_history FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/table_grants migration for the
-- full "because"). Granted here, in the same file that creates the table, per the pattern in
-- every migration since #12. DELETE is deliberately withheld — this job upserts and never
-- deletes, matching every other ingest table in this repo.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.player_gameweek_history TO anon;
GRANT SELECT, INSERT, UPDATE ON public.player_gameweek_history TO service_role;

COMMIT;
