-- chip_advisories: the chip-timing advisory from a second, chip-enabled
-- solve -- ticket #126 (feature-list item 27), unblocked by the chip probe
-- (#114).
--
-- WHY THIS TABLE EXISTS, AND WHY IT NEVER FEEDS THE RECOMMENDATION.
-- The chip probe (#114) found the solver always wants to play a chip
-- immediately: across a rolling five-gameweek horizon, a chip held is a
-- chip the optimiser never sees the value of holding, so it burns one at
-- the first opportunity every single night. That timing is not advice
-- about the season -- it is advice about the next five weeks, and it will
-- always say "now" (see docs/solver-notes.md's "Dispatch-only chip probe"
-- section and this ticket's own Context). So the solver's chip CHOICE never
-- reaches `recommendations` or `solver_picks` -- `chip_limits` stays all
-- zero on the production solve (unchanged since #41). Instead,
-- .github/workflows/solver-run.yml runs a SECOND, chip-enabled solve
-- alongside the normal one, and this table stores the DIFFERENCE between
-- them: what playing a given chip in a given gameweek would be worth across
-- the horizon, and what it cost to find out (the chip-free baseline it is
-- compared against). A number with its limitation stated is useful; a chip
-- recommendation presented as a decision would be product-brief.md §6a's
-- exact prohibition -- no recommendation beats a wrong one.
--
-- ONE ROW PER (gameweek, solution_index, chip_code) -- not one row per
-- (gameweek, solution_index). The solver can play more than one chip in the
-- same solution (the probe's own example: "TC2, BB4" -- Triple Captain in
-- gameweek 2 AND Bench Boost in gameweek 4, together, in every one of the
-- three solutions observed) -- so a single (gameweek_id, solution_index)
-- pair can legitimately produce more than one row, one per chip played.
-- chip_enabled_objective and delta are necessarily IDENTICAL across those
-- rows (they describe the whole solution, not one chip's isolated
-- contribution -- the solve cannot isolate that), which is expected, not a
-- duplication bug.
--
-- APPEND-ONLY, matching solver_runs' own shape (see the #41/solver_output
-- migration's header) -- NOT keyed on gameweek_id/solution_index/chip_code
-- as a primary key, deliberately: "Run now" can solve the same gameweek
-- more than once in a day, and a later run must not silently overwrite an
-- earlier advisory. A bigint identity primary key, matching solver_runs.
--
-- solver_run_id IS THE COMPARISON'S ANCHOR. chip_free_objective is always
-- read from THIS SPECIFIC solver_runs row's own chip-free solve -- never
-- from "the latest run" queried independently at read time, and never
-- mixed across two different nights' solves. This is the exact trap
-- solver_picks hit in #72 (accumulating rows across runs with no run_id
-- filter produced a projected score of roughly double) --
-- scripts/store-chip-advisory.ts's buildChipAdvisoryRows() takes one
-- resolved solver_run_id and one already-parsed chip-free solution set as
-- plain parameters, so there is no code path for a value from a different
-- run to reach a row here. See that script's own header.
--
-- chip_gameweek_id HAS A REAL FK to public.gameweeks, unlike
-- feature_history's plain gameweek number (see that migration's header for
-- why THAT table's gameweek column is deliberately not an FK): this
-- gameweek id is always a currently-ingested, real absolute FPL gameweek id
-- from THIS SEASON'S live data (parsed from "TC2" -- see
-- scripts/lib/solver-output.ts), the same convention solver_picks.gameweek_id
-- already uses, not a cross-season historical figure.
--
-- delta IS A GENERATED COLUMN, not application-computed and inserted: this
-- makes "the stored delta equals chip-enabled objective minus chip-free
-- objective" true by construction, provable from the schema alone, not
-- something scripts/store-chip-advisory.ts could get wrong or drift from.
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX IF NOT EXISTS, policy dropped then recreated.
-- Running this file twice against the same database is safe and creates
-- nothing new the second time.

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
-- chip_advisories
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chip_advisories (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gameweek_id               integer NOT NULL REFERENCES public.gameweeks (id),  -- the TARGET gameweek this solve was run for -- same anchor as solver_runs.gameweek_id, NOT the chip's own played gameweek (see chip_gameweek_id below).
  solution_index            smallint NOT NULL,  -- the Results table's own "iter" -- matches solver_picks.solution_index's convention.
  chip_code                 text NOT NULL,      -- verbatim from the solver's own Results table (e.g. "TC", "BB") -- never normalized to an enum, same "solver's own string is ground truth" reasoning as solver_runs.solver_status. Only TC/BB have ever been observed (item 28 is Wildcard/Free Hit, out of scope here).
  chip_gameweek_id          integer NOT NULL REFERENCES public.gameweeks (id),  -- the horizon gameweek this chip would be played in, e.g. 2 for "TC2". May differ from gameweek_id -- a chip playable later in the horizon has chip_gameweek_id > gameweek_id.
  chip_enabled_objective    numeric NOT NULL,   -- this solution's own score, from the CHIP-ENABLED solve's Results table.
  chip_free_objective       numeric NOT NULL,   -- the SAME solution_index's score, from the CHIP-FREE (normal) solve named by solver_run_id below -- never a different run's, see the file header.
  delta                     numeric GENERATED ALWAYS AS (chip_enabled_objective - chip_free_objective) STORED,  -- provably chip_enabled_objective - chip_free_objective by construction, not application-computed.
  solver_run_id             bigint NOT NULL REFERENCES public.solver_runs (id),  -- the normal (chip-free) run this advisory is compared against -- the comparison's anchor, see the file header.
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chip_advisories IS
  'The difference between a chip-enabled solve and the normal (chip-free) solve '
  'it is compared against -- ticket #126. One row per (gameweek_id, '
  'solution_index, chip_code); a solution playing more than one chip together '
  '(e.g. "TC2, BB4") produces one row per chip, sharing the same '
  'chip_enabled_objective/delta. Append-only, matching solver_runs -- a re-run '
  'adds new rows rather than overwriting. Never read by '
  'recommendations/solver_picks/the Telegram message -- surfaced only on the '
  'chips screen as an advisory, never a "play this chip" instruction '
  '(product-brief.md §6a).';

COMMENT ON COLUMN public.chip_advisories.chip_code IS
  'Verbatim from the solver''s own Results table chip column, e.g. "TC", "BB". '
  'Not an enum -- see solver_runs.solver_status for the same "third-party '
  'output is ground truth" reasoning. Only TC/BB observed; WC/FH are item 28.';

COMMENT ON COLUMN public.chip_advisories.chip_free_objective IS
  'The SAME solution_index''s score from the chip-free run named by '
  'solver_run_id -- always read from that one specific run, never queried '
  'independently at write time. See scripts/store-chip-advisory.ts and the '
  'file header''s note on the #72 solver_picks cross-run trap.';

CREATE INDEX IF NOT EXISTS idx_chip_advisories_gameweek_id ON public.chip_advisories (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_chip_advisories_solver_run_id ON public.chip_advisories (solver_run_id);

-- ============================================================================
-- Row Level Security -- read-only for anon, same pattern as solver_runs/
-- solver_picks (#41). Writes come from the scheduled Action using the
-- Supabase secret key (service_role), which bypasses RLS entirely. There is
-- deliberately no insert/update/delete policy for anon.
-- ============================================================================

ALTER TABLE public.chip_advisories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chip_advisories_select_anon" ON public.chip_advisories;
CREATE POLICY "chip_advisories_select_anon" ON public.chip_advisories FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs -- RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the table,
-- per the pattern every migration since #12 follows. DELETE is deliberately
-- withheld -- scripts/store-chip-advisory.ts only ever inserts
-- (DoD: `.delete(` does not appear in it).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.chip_advisories TO anon;
GRANT SELECT, INSERT, UPDATE ON public.chip_advisories TO service_role;

COMMIT;
