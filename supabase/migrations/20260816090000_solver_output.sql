-- Solver output storage — ticket #41 (feature-list item 12, the second half).
--
-- #29 proved the solver's toolchain installs cleanly in a GitHub Action at the
-- pinned commit. This migration is where its output lands: two tables.
--
--   solver_runs   — one row per *execution* of the solver-run workflow, append-
--                   only, same audit-log shape as job_runs (#10): gameweek,
--                   solver's own reported status string, objective value,
--                   horizon used, wall-clock seconds, the full config as jsonb
--                   (so a run can be reproduced or diffed later), created_at.
--                   Never updated in place — a re-run of the same gameweek adds
--                   a new row, it does not overwrite the last one. This is
--                   deliberately NOT keyed on gameweek_id: "Run now" (product-
--                   brief.md §2) can solve the same gameweek more than once in
--                   a day, and losing the earlier attempt's status/objective
--                   would erase exactly the evidence item 13 needs to compare
--                   runs. A bigint identity primary key, matching job_runs.
--
--   solver_picks  — one row per player per gameweek per solution *for the
--                   latest run of a given gameweek*. Unlike solver_runs, this
--                   table IS upserted in place (primary key: solution_index,
--                   gameweek_id, player_id) — its job is "the current best
--                   plan", not a history of every attempt; solver_runs is
--                   already the history. solution_index exists from the start
--                   (ticket #41's own DoD) even though this ticket only ever
--                   writes 0 — every row comes from num_iterations=1 — so item
--                   13 can raise num_iterations later without a second
--                   migration.
--
-- Neither table is written by this migration — see scripts/build-solver-
-- input.ts (reads squads/squad_picks, writes the solver's input files) and
-- scripts/store-solver-output.ts (parses the solver's results CSV and its
-- stdout log, writes here).
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX are IF NOT EXISTS, policies are dropped-then-recreated,
-- GRANTs are safe to re-run. Running this file twice against the same
-- database is safe and creates nothing new the second time.
--
-- player_id has a real FK into players (current-season FPL element ids, same
-- reasoning as player_projections' migration: the solver's own bootstrap-
-- static/ fetch and this app's players table are both current-season, always
-- freshly ingested before this job runs, so a real FK catches a mapping bug
-- loudly rather than writing an orphan row). player_code is a denormalized,
-- unenforced second identifier, same pattern as squad_picks.player_code and
-- player_projections.player_code — resolved by joining the solver's element
-- id against players.code at write time in store-solver-output.ts, not by a
-- database constraint (players.code has no unique constraint to reference).
-- gameweek_id has a real FK into gameweeks for the same reason.

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
-- solver_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.solver_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gameweek_id       integer NOT NULL REFERENCES public.gameweeks (id),
  solver_status     text NOT NULL,      -- the solver's own reported status string verbatim, e.g. 'Optimal', 'Time limit reached', 'Infeasible' — never rewritten to 'optimal' by this app, so a non-optimal run cannot be mistaken for a proven one by reading a different column.
  objective_value   numeric,             -- HiGHS's own "Primal bound"; null if no incumbent was found at all.
  horizon           integer NOT NULL,   -- gameweeks actually solved over, derived from the emitted CSV (see scripts/build-solver-input.ts) — 5 or fewer, never the solver's shipped default of 8.
  pool_size         integer,             -- players surviving prep_data's xmin_lb/ev filters, per "Filtered player pool from X to Y players" in the solver's own log. Reported every run so xmin_lb (150, see decisions/ticket-41.md) can be tuned from evidence.
  seconds_taken     numeric,             -- HiGHS's own reported wall-clock solve time, not this job's total step time.
  config            jsonb NOT NULL,     -- the full config this run passed to the solver (comprehensive_settings.json's shape, our overrides applied) — reproducibility and diffing.
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.solver_runs IS
  'One row per execution of the solver-run workflow (ticket #41), append-only '
  'like job_runs — a re-run of the same gameweek adds a new row rather than '
  'overwriting the last one. solver_status is never normalized to "optimal"; '
  'it is the solver''s own string, verbatim, so a timed-out or infeasible run '
  'is always distinguishable from a proven optimum by reading this one column.';

COMMENT ON COLUMN public.solver_runs.solver_status IS
  'Verbatim from the HiGHS "Solving report" Status line the solver prints to '
  'stdout, e.g. "Optimal", "Time limit reached", "Infeasible". Not an enum: '
  'the solver is a pinned third-party dependency and its exact wording is the '
  'ground truth, not this app''s guess at one.';

CREATE INDEX IF NOT EXISTS idx_solver_runs_gameweek_id ON public.solver_runs (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_solver_runs_created_at ON public.solver_runs (created_at);

-- ============================================================================
-- solver_picks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.solver_picks (
  solution_index    smallint NOT NULL DEFAULT 0,  -- always 0 while item 41 keeps num_iterations at 1; item 13 raises num_iterations and starts writing >0 here without a further migration.
  gameweek_id       integer NOT NULL REFERENCES public.gameweeks (id),
  player_id         integer NOT NULL REFERENCES public.players (id),
  player_code       integer,                       -- denormalized copy of players.code, same pattern as squad_picks.player_code / player_projections.player_code — no FK (players.code has no unique constraint to reference).
  is_lineup         boolean NOT NULL,
  bench_order       smallint CHECK (bench_order IS NULL OR bench_order BETWEEN 1 AND 4),  -- NULL for lineup players; 1-4 for bench, same convention as squad_picks.bench_order (the solver's own 0-3 bench slot is shifted by +1 when written).
  is_captain        boolean NOT NULL DEFAULT false,
  is_vice_captain   boolean NOT NULL DEFAULT false,
  is_transfer_in    boolean NOT NULL DEFAULT false,
  is_transfer_out   boolean NOT NULL DEFAULT false,
  expected_points   numeric NOT NULL,              -- the solver's own per-player "xP" for that gameweek, not multiplied by captaincy.
  run_id            bigint REFERENCES public.solver_runs (id) ON DELETE SET NULL,  -- which solver_runs row most recently wrote this pick row. Nullable and ON DELETE SET NULL because solver_picks is "latest state", not history — losing the backlink on a pruned solver_runs row must not delete the pick.
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (solution_index, gameweek_id, player_id)
);

COMMENT ON TABLE public.solver_picks IS
  'One row per player per gameweek per solution, upserted in place — this '
  'table holds the latest solve''s picks for each gameweek, not a run '
  'history (solver_runs is the history). solution_index exists from the '
  'start (ticket #41) though this ticket only ever writes 0.';

COMMENT ON COLUMN public.solver_picks.bench_order IS
  'NULL for lineup players. 1-4 for bench (one of the four is the reserve '
  'goalkeeper), same convention as squad_picks.bench_order — mapped from the '
  'solver''s own 0-3 "bench" column by adding 1.';

CREATE INDEX IF NOT EXISTS idx_solver_picks_gameweek_id ON public.solver_picks (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_solver_picks_player_id ON public.solver_picks (player_id);
CREATE INDEX IF NOT EXISTS idx_solver_picks_run_id ON public.solver_picks (run_id);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job-output
-- table since #10/#33. Writes come from the scheduled Action using the
-- Supabase secret key (service_role), which bypasses RLS entirely. There is
-- deliberately no insert/update/delete policy for anon on either table.
-- ============================================================================

ALTER TABLE public.solver_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "solver_runs_select_anon" ON public.solver_runs;
CREATE POLICY "solver_runs_select_anon" ON public.solver_runs FOR SELECT TO anon USING (true);

ALTER TABLE public.solver_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "solver_picks_select_anon" ON public.solver_picks;
CREATE POLICY "solver_picks_select_anon" ON public.solver_picks FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the tables,
-- per the pattern in 20260811170000_player_match_stats.sql and
-- 20260815120000_player_projections.sql. DELETE is deliberately withheld on
-- both tables — scripts/store-solver-output.ts upserts and never deletes
-- (DoD: `.delete(` does not appear in either new script).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.solver_runs TO anon;
GRANT SELECT, INSERT, UPDATE ON public.solver_runs TO service_role;

GRANT SELECT ON public.solver_picks TO anon;
GRANT SELECT, INSERT, UPDATE ON public.solver_picks TO service_role;

COMMIT;
