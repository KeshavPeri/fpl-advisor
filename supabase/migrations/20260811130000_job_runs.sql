-- job_runs: telemetry for the scheduled GitHub Action.
--
-- Ticket #10. This is the nightly write path's heartbeat table, proven end
-- to end with no business logic yet: scripts/heartbeat.ts inserts one row
-- here every time the scheduled workflow runs, so future job failures are
-- diagnosable from this table alone. Later ingest/projection jobs (#11+)
-- write to this same table — one row per job run, never upserted, so runs
-- accumulate and the history is the audit log.
--
-- Idempotent by construction, matching the #9 reference-schema migration's
-- style: every CREATE TABLE / CREATE INDEX is IF NOT EXISTS. Running this
-- file twice against the same database is safe and creates nothing new the
-- second time.
--
-- All timestamps are timestamptz. started_at/finished_at are set by the
-- caller (heartbeat.ts and later job scripts), not defaulted here, so a
-- crashed job that never reaches its finished_at write is visible as a row
-- with finished_at still null.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and
-- its local dev CLI) provisions `anon` automatically, but a bare Postgres
-- install does not, so the RLS policy below (TO anon) would fail on first
-- apply without this no-op guard.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

-- ============================================================================
-- job_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.job_runs (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name                 text NOT NULL,               -- e.g. 'heartbeat', later 'ingest-bootstrap'
  status                   text NOT NULL,               -- e.g. 'success', 'failure'
  message                  text,                        -- short human-readable summary
  details                  jsonb,                        -- structured extras: row counts, etc.
  started_at               timestamptz NOT NULL,
  finished_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_runs IS
  'One row per scheduled-job run (heartbeat, ingest, etc). Rows accumulate — '
  'never upserted — so this table is the run history and audit log.';

CREATE INDEX IF NOT EXISTS idx_job_runs_job_name ON public.job_runs (job_name);
CREATE INDEX IF NOT EXISTS idx_job_runs_started_at ON public.job_runs (started_at);

-- ============================================================================
-- Row Level Security — read-only for the anon role, same pattern as #9.
--
-- Writes come from the scheduled Action using the Supabase secret key,
-- which bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on this table.
-- ============================================================================

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_runs_select_anon" ON public.job_runs;
CREATE POLICY "job_runs_select_anon" ON public.job_runs FOR SELECT TO anon USING (true);

COMMIT;
