# Decisions — ticket #10

## HIGH-IMPACT
- `job_runs` schema shaped as `bigint GENERATED ALWAYS AS IDENTITY` PK, `job_name text`,
  `status text`, `message text`, `details jsonb`, `started_at`/`finished_at timestamptz`,
  `created_at timestamptz DEFAULT now()` **because** it mirrors the columns the ticket names
  exactly (job name, started/finished timestamps, status, short message, `details jsonb` for
  row counts) and matches #9's idempotent-migration/RLS pattern (anon-role select-only policy;
  writes only via the secret key, which bypasses RLS) so later ingest jobs can reuse this table
  with no schema change. (Tier 2)
- Added `tsx` as a devDependency **because** scripts are TypeScript so they share types with
  `src/lib/` as the projection work lands, and `tsx` runs them directly with no build step in
  the Action — pre-approved in the ticket text. (Tier 2)

## ROUTINE
- Cron set to `45 17 * * *` (17:45 UTC = 01:45 SGT the following day) because
  FPL-Core-Insights refreshes at 07:30 and 17:30 UTC, so anchoring the daily job shortly after
  the later refresh gives the freshest data to the ingest jobs that land on this trigger next,
  with 15 minutes of buffer after the refresh. (Tier 3)
- Missing-table detection matches both `PGRST205` (PostgREST's schema-cache-miss code, what a
  real hosted Supabase project returns) and Postgres's own `42P01`, because the ticket's stated
  failure path is "if `job_runs` does not exist" and either code can legitimately mean that
  depending on how the request reaches Postgres — matching only one would be needlessly
  fragile. (Tier 3)
- `tsconfig.scripts.json` uses `module`/`moduleResolution: nodenext`, mirroring the existing
  `tsconfig.node.json` pattern for non-Vite Node code in this repo rather than the bundler-mode
  settings `tsconfig.app.json` uses. (Tier 3)
