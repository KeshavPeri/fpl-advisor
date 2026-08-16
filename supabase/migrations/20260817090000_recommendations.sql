-- Recommendations: the weekly Plan A / Plan B / Plan C — ticket #47
-- (feature-list item 13, "the loop's last piece of thinking").
--
-- product-brief.md §2 asks for one clear primary decision for a gameweek —
-- including "roll your transfer" — plus a captain, a starting XI and bench
-- order, with Plan B and Plan C, a confidence band, an explicit hit cost
-- when a hit is recommended, and stored reasoning. This migration is where
-- that lands: two tables.
--
--   recommendations         — one row per (gameweek, plan_index): the
--                              transfer in/out for THIS gameweek (or an
--                              explicit roll), captain, vice-captain,
--                              starting XI and bench (as jsonb — this app
--                              has no UI reading these columns yet, so a
--                              richly-typed player-ref array is simpler
--                              than a second child table), hit cost, gross
--                              and net projected gain (both at full
--                              precision AND rounded to a whole number —
--                              product-brief.md §8 forbids decimals in the
--                              recommendation UI), the confidence band, and
--                              which solver_runs row it came from.
--                              plan_index 0/1/2 are Plan A/B/C, ranked by
--                              the solver's own score, best first — NOT the
--                              solver's own solution_index, which is also
--                              stored so the two can be told apart.
--                              Upserted in place, keyed on (gameweek_id,
--                              plan_index): re-running for the same
--                              gameweek replaces that gameweek's plans, it
--                              does not accumulate duplicates.
--
--   recommendation_reasons  — one row per reason line, ordered
--                              (order_index), FK'd to the recommendations
--                              row it explains. Short factual lines, not
--                              generated prose — see
--                              src/lib/recommendation/reasons.ts. Item 21
--                              (the reasoning screen) renders these in
--                              order; item 14 (Telegram) uses the first
--                              line as the headline.
--
-- Neither table is written by this migration — see
-- scripts/generate-recommendations.ts, which reads solver_runs/solver_picks
-- and public.player_match_stats (for the data-coverage check,
-- product-brief.md §8) and writes here.
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX are IF NOT EXISTS, policies are dropped-then-
-- recreated, GRANTs are safe to re-run. Running this file twice against the
-- same database is safe and creates nothing new the second time.
--
-- Real FKs into players/gameweeks/solver_runs, same reasoning as the
-- solver_output migration: every id referenced here is current-season and
-- always freshly ingested/written before this job runs, so a real FK
-- catches a mapping bug loudly instead of writing an orphan row.
--
-- Job upserts, never deletes, on EITHER table — ticket #47's own DoD: "the
-- job upserts and never removes rows... issues no Supabase row-removal call
-- at all." One known, accepted consequence for recommendation_reasons: if a
-- later run produces FEWER reason lines than an earlier one did for the
-- same (gameweek_id, plan_index), the earlier run's extra trailing
-- order_index rows are not cleared — they are stale, not wrong (they were
-- true reasons for a real earlier plan), and a stricter fix would require a
-- DELETE this ticket's DoD explicitly withholds. Recorded here rather than
-- silently working around it.

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
-- recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recommendations (
  gameweek_id                 integer NOT NULL REFERENCES public.gameweeks (id),
  plan_index                  smallint NOT NULL CHECK (plan_index IN (0, 1, 2)),  -- 0 = Plan A, 1 = Plan B, 2 = Plan C — ranked by the solver's own score, best first. NOT the same as solution_index below.
  solution_index               smallint NOT NULL,  -- the solver's OWN iteration index (solver_picks.solution_index) this plan was built from — kept alongside plan_index so the ranked position and the solver's raw index can never be confused for each other.
  solver_run_id                bigint REFERENCES public.solver_runs (id) ON DELETE SET NULL,  -- which solver_runs row this plan's picks came from. Nullable and ON DELETE SET NULL, same pattern as solver_picks.run_id — this table is "the current best plans", not a run history.

  is_roll                      boolean NOT NULL,  -- true when this plan makes no transfer this gameweek — an explicit, positive recommendation ("roll your transfer"), never inferred from null columns.
  transfer_in_player_id        integer REFERENCES public.players (id),
  transfer_in_player_code      integer,            -- denormalized copy of players.code, same pattern as solver_picks.player_code — no FK (players.code has no unique constraint to reference).
  transfer_out_player_id       integer REFERENCES public.players (id),
  transfer_out_player_code     integer,

  captain_player_id            integer NOT NULL REFERENCES public.players (id),
  captain_player_code          integer,
  vice_captain_player_id       integer NOT NULL REFERENCES public.players (id),
  vice_captain_player_code     integer,

  starting_xi                  jsonb NOT NULL,     -- array of {playerId, playerCode}, 11 entries — this gameweek's starting XI. No UI reads this yet (item 17); jsonb keeps this migration to two tables rather than three.
  bench_order                  jsonb NOT NULL,     -- ordered array of {playerId, playerCode}, up to 4 entries, index 0 = first off the bench.

  free_transfers_available     smallint NOT NULL CHECK (free_transfers_available >= 0),  -- from squads.free_transfers for this gameweek — the same figure the solver itself was given via team.json's transfers.limit, not re-read from the solver's own (noisy) `ft` CSV column. See scripts/generate-recommendations.ts's file header.
  transfers_made                smallint NOT NULL CHECK (transfers_made >= 0),            -- derived by counting is_transfer_in picks for this plan's current gameweek, not read from the solver's own (noisy) `transfer_count` CSV column. See file header.
  hit_cost                      smallint NOT NULL CHECK (hit_cost >= 0),                  -- 4 x max(0, transfers_made - free_transfers_available). Tier 3, in-game points only (product-brief.md §4) — no connection to real money.

  gross_points                  numeric NOT NULL,   -- this plan's own total projected score across the whole solve horizon, full precision.
  gross_points_rounded          integer NOT NULL,   -- the same figure, rounded to a whole number — product-brief.md §8 forbids decimals in the recommendation UI. Stored alongside, not computed in the view layer.
  net_points                    numeric NOT NULL,    -- gross_points minus hit_cost, full precision.
  net_points_rounded            integer NOT NULL,    -- rounded net_points, same reasoning as gross_points_rounded.

  confidence_band                text NOT NULL CHECK (confidence_band IN ('clear', 'marginal', 'coin-flip')),  -- derived from the score gap between Plan A and Plan B across the horizon, then floored (never raised) by the data-coverage rule. See src/lib/recommendation/confidence.ts. Thresholds are explicitly provisional — product-brief.md §9 open question 2.

  updated_at                    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gameweek_id, plan_index)
);

COMMENT ON TABLE public.recommendations IS
  'One row per (gameweek, plan_index) — the weekly Plan A/B/C (ticket #47, '
  'feature-list item 13), upserted in place. plan_index 0/1/2 = Plan A/B/C, '
  'ranked by the solver''s own score, best first. A re-run for the same '
  'gameweek replaces that gameweek''s plans; it never accumulates '
  'duplicates or deletes a row.';

COMMENT ON COLUMN public.recommendations.is_roll IS
  'True when this plan''s recommendation for this gameweek is to make no '
  'transfer. Stored as an explicit, positive fact — never inferred from '
  'transfer_in/transfer_out being null. design-reference.md: this reads as '
  'a confident answer, not as the app having nothing to say.';

COMMENT ON COLUMN public.recommendations.free_transfers_available IS
  'Read from squads.free_transfers for this gameweek (the same figure the '
  'solver itself was given), not from the solver''s own results CSV — that '
  'CSV''s `ft` column is not persisted anywhere in this app and arrives '
  'with binary floating-point noise (see ticket #47''s Context section). '
  'See scripts/generate-recommendations.ts''s file header for the full '
  '"because".';

COMMENT ON COLUMN public.recommendations.transfers_made IS
  'Derived by counting solver_picks rows flagged is_transfer_in for this '
  'plan''s current gameweek — an exact integer count, not read from the '
  'solver''s own noisy `transfer_count` CSV column (also not persisted). '
  'Routed through src/lib/recommendation/rounding.ts''s roundSolverCount '
  'regardless, as a defensive no-op, so the guard exists the day a raw '
  'solver count IS wired in directly.';

CREATE INDEX IF NOT EXISTS idx_recommendations_gameweek_id ON public.recommendations (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_solver_run_id ON public.recommendations (solver_run_id);

-- ============================================================================
-- recommendation_reasons
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recommendation_reasons (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gameweek_id     integer NOT NULL,
  plan_index      smallint NOT NULL,
  order_index     smallint NOT NULL CHECK (order_index >= 0),
  reason          text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (gameweek_id, plan_index) REFERENCES public.recommendations (gameweek_id, plan_index) ON DELETE CASCADE,
  UNIQUE (gameweek_id, plan_index, order_index)
);

COMMENT ON TABLE public.recommendation_reasons IS
  'One row per reason line, ordered by order_index, for the recommendation '
  'at (gameweek_id, plan_index) — short factual lines '
  '(src/lib/recommendation/reasons.ts), never generated prose. Item 21 (the '
  'reasoning screen) renders these in order; item 14 (Telegram) uses the '
  'first line as the headline. Upserted on (gameweek_id, plan_index, '
  'order_index) — see file header for the one known consequence of never '
  'deleting a row here.';

CREATE INDEX IF NOT EXISTS idx_recommendation_reasons_gameweek_plan
  ON public.recommendation_reasons (gameweek_id, plan_index);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job-output
-- table since #10/#33/#41. Writes come from the scheduled Action using the
-- Supabase secret key (service_role), which bypasses RLS entirely. There is
-- deliberately no insert/update/delete policy for anon on either table.
-- ============================================================================

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendations_select_anon" ON public.recommendations;
CREATE POLICY "recommendations_select_anon" ON public.recommendations FOR SELECT TO anon USING (true);

ALTER TABLE public.recommendation_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendation_reasons_select_anon" ON public.recommendation_reasons;
CREATE POLICY "recommendation_reasons_select_anon" ON public.recommendation_reasons FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the tables,
-- per the pattern in every migration since #12. DELETE is deliberately
-- withheld on both tables — scripts/generate-recommendations.ts upserts and
-- never deletes (DoD: `.delete(` does not appear in that script).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.recommendations TO anon;
GRANT SELECT, INSERT, UPDATE ON public.recommendations TO service_role;

GRANT SELECT ON public.recommendation_reasons TO anon;
GRANT SELECT, INSERT, UPDATE ON public.recommendation_reasons TO service_role;

COMMIT;
