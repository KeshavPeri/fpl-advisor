-- DELETE on public.recommendations for service_role.
--
-- Ticket #60. Re-running generate-recommendations for a gameweek that
-- previously produced three distinct plans and now produces one must remove
-- the orphaned plan_index 1 and 2 rows, or a stale Plan B from an older solve
-- stays readable as current — which product-brief.md §6a forbids outright.
--
-- WHY THIS DOES NOT CONTRADICT 20260811160000_table_grants.sql's deliberate
-- withholding of DELETE. That rule protects INGESTED SOURCE data, where a bad
-- delete costs a full re-ingest; its own comment says so ("every ingest job in
-- feature-list.md upserts and none deletes"). public.recommendations is
-- DERIVED output, fully regenerable from solver_picks by re-running one job.
-- The worst case of a wrong delete here is running that job again.
--
-- Precedent in this repo: 20260811180000_squad_state.sql grants DELETE on
-- squads/squad_picks for exactly this reason — replacing a set is the normal
-- write path there, and it is here too.
--
-- Scoped to this one table. public.recommendation_reasons is deliberately NOT
-- granted: its rows follow via ON DELETE CASCADE, which Postgres performs as
-- the table owner rather than as the invoking role.
--
-- Two conditions on how the privilege is used, stated here because a grant
-- outlives the ticket that asked for it:
--   1. The job upserts the new plans FIRST, then deletes. There must never be
--      a window in which the gameweek has no Plan A.
--   2. It deletes only rows for the gameweek just written, at plan indices at
--      or above the new plan count. Never a bare delete, never across
--      gameweeks.
--
-- Tier 1 decision (destructive operation on live data, escalation.md),
-- escalated by the Analyst on ticket #60 and approved by the owner
-- 20 Aug 2026.
--
-- Idempotent: GRANT is safe to re-run.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT DELETE ON public.recommendations TO service_role;

COMMIT;
