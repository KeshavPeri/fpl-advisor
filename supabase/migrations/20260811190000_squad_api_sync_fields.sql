-- Squad API sync — ticket #14. Two independent additions to the #13 schema:
--
--   1. Four new columns on `squads` for entry-level facts the API sync reads
--      from `entry/{id}/` and `entry/{id}/history/` that have no existing
--      home: total transfers made, overall points, overall rank, and chips
--      used. Bank and squad value already have columns from #13 and are not
--      touched here.
--
--   2. Explicit GRANTs of SELECT, INSERT, UPDATE, DELETE on `squads` and
--      `squad_picks` to `service_role`. #13 granted those two tables to
--      `anon` only (the browser, for manual entry); the scheduled sync job
--      in #14 runs as `service_role` and needs to write the same tables.
--      `service_role` currently has at most what
--      `20260811160000_table_grants.sql`'s `ALTER DEFAULT PRIVILEGES` gives
--      it automatically on tables created after that migration ran — SELECT,
--      INSERT, UPDATE, but explicitly *not* DELETE (that migration withholds
--      DELETE deliberately for every table it covers by default). This sync
--      job never deletes a row (it reconciles and either writes a fresh set
--      or leaves the existing set untouched — see scripts/sync-squad.ts), so
--      DELETE is not functionally required today, but the ticket's own DoD
--      requires it explicitly granted here rather than left to inference
--      from a migration this file doesn't own, per deltas.md D8: relying on
--      `ALTER DEFAULT PRIVILEGES` for a load-bearing privilege is exactly
--      the failure that migration's own comment warns against reproducing.
--      Granting it now also means a future ticket that needs `squad_picks`
--      DELETE from `service_role` (replacing a gameweek's picks as a set,
--      the same pattern #13's manual-entry screen already uses from `anon`)
--      doesn't silently fail on a missing privilege it never occurred to
--      anyone to add.
--
-- Idempotent by construction, matching every migration since #9: ADD COLUMN
-- uses IF NOT EXISTS, and GRANT is safe to re-run.

BEGIN;

-- ============================================================================
-- Roles — same guard as every prior migration; a bare Postgres install used
-- for migration testing provisions neither role automatically.
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
-- squads — entry-level API sync columns
--
-- total_transfers / overall_points / overall_rank are nullable: they are
-- only ever known once an api_sync row has actually run (they have no
-- meaning for a manual-entry row, and NULL — "not yet synced" — is a
-- genuinely different fact from 0, so no default is written in their place).
-- chips_used defaults to an empty JSON array rather than NULL so callers
-- never have to null-check it separately from "no chips used yet".
-- ============================================================================

ALTER TABLE public.squads
  ADD COLUMN IF NOT EXISTS total_transfers integer CHECK (total_transfers IS NULL OR total_transfers >= 0),
  ADD COLUMN IF NOT EXISTS overall_points  integer CHECK (overall_points  IS NULL OR overall_points  >= 0),
  ADD COLUMN IF NOT EXISTS overall_rank    integer CHECK (overall_rank    IS NULL OR overall_rank    >= 1),
  ADD COLUMN IF NOT EXISTS chips_used      jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.squads.total_transfers IS
  'entry/{id}/''s last_deadline_total_transfers as of this gameweek''s deadline. '
  'NULL until an api_sync row has run for this gameweek.';

COMMENT ON COLUMN public.squads.overall_points IS
  'entry/{id}/''s summary_overall_points as of this gameweek. NULL until synced.';

COMMENT ON COLUMN public.squads.overall_rank IS
  'entry/{id}/''s summary_overall_rank as of this gameweek. NULL until synced.';

COMMENT ON COLUMN public.squads.chips_used IS
  'entry/{id}/history/''s chips array (name, event, time), as of the last '
  'api_sync run for this gameweek. Raw state only — chip strategy is a later '
  'wave, per product-brief.md §2.';

-- ============================================================================
-- GRANTs — see file header for the "because".
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.squads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.squad_picks TO service_role;

COMMIT;
