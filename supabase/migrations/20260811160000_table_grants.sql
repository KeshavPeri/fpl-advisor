-- ============================================================================
-- Table privileges for anon and service_role
--
-- WHY THIS EXISTS. The reference-schema (#9) and job_runs (#10) migrations
-- create tables and enable Row Level Security with a SELECT policy for anon,
-- but neither issues a GRANT. RLS and GRANTs are two independent gates and a
-- row must pass both: RLS decides *which rows* a role may touch, GRANTs decide
-- *whether the role may touch the table at all*. Without a GRANT the table is
-- unreachable no matter what the policy says — and the secret key's
-- service_role bypasses RLS but does NOT bypass GRANTs.
--
-- Symptom this fixes, observed 11 Aug 2026 on the first workflow_dispatch run:
--   heartbeat: insert into job_runs failed: permission denied for table job_runs
--
-- How to tell the two apart in future:
--   "permission denied for table X"                  -> missing GRANT (this file)
--   "new row violates row-level security policy"     -> missing or wrong POLICY
--
-- Idempotent: GRANT and ALTER DEFAULT PRIVILEGES are both safe to re-run.
-- ============================================================================

-- Supabase provides these roles. A bare local Postgres used for migration
-- testing does not, so guard both — same pattern as #9.
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

GRANT USAGE ON SCHEMA public TO anon, service_role;

-- anon is the browser's publishable key. Read-only, and RLS narrows it further.
GRANT SELECT ON
  public.teams,
  public.players,
  public.fixtures,
  public.gameweeks,
  public.job_runs
TO anon;

-- service_role is the Action's secret key: the only writer.
-- DELETE is deliberately withheld. Every ingest job in feature-list.md upserts
-- and none deletes, and "no deletion of existing rows" is an explicit
-- out-of-scope line in tickets #11 and #12. Withholding the privilege makes
-- that a database guarantee rather than a promise in a ticket. A future ticket
-- that genuinely needs DELETE (squad picks being replaced, say) should grant it
-- on its own tables, in its own migration, with the reason written down.
GRANT SELECT, INSERT, UPDATE ON
  public.teams,
  public.players,
  public.fixtures,
  public.gameweeks,
  public.job_runs
TO service_role;

-- Cover tables created later by whoever runs migrations in the SQL editor, so
-- this class of failure does not recur on every new table. Note this only
-- applies to objects created by the role that executes this statement — an
-- explicit GRANT in each migration is still required and still the contract.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO service_role;
