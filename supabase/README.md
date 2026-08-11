# Applying a Supabase migration — for Keshav

This repo does not run migrations automatically. `supabase/migrations/` holds
plain SQL files that an agent writes but never applies — applying anything to
the live Supabase project touches live data, which is an owner-only action
(Tier 1, `escalation.md`). Every migration file in this folder is idempotent:
running one twice is safe, so if you're ever unsure whether one already went
in, re-run it and check the notices.

## Steps

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and select
   the `fpl-advisor` project.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open the migration file you want to apply from `supabase/migrations/` in
   this repo (they're timestamp-prefixed — apply them in filename order if
   you're catching up on more than one) and paste its full contents into the
   query editor.
5. Click **Run** (or press **Cmd/Ctrl + Enter**).

## How to tell it worked

- The editor prints `Success. No rows returned` after **Run** — that's the
  first signal.
- Go to **Table Editor** in the left sidebar. The tables the migration
  creates should now be listed (for the reference-schema migration:
  `teams`, `players`, `fixtures`, `gameweeks`).
- Click into one of the new tables and check the **RLS** toggle at the top —
  it should show as **Enabled**. Click **Policies** for that table — it
  should list exactly one policy, applying to `SELECT` for the `anon` role.
- If instead the editor shows a red error box, nothing was committed for that
  statement — read the error, it names the exact line. Re-running a
  migration file that partly failed is safe (every statement in it is
  guarded with `IF NOT EXISTS` / `DROP ... IF EXISTS`), so fix the underlying
  issue and click **Run** again rather than trying to hand-patch around it.

## Migrations applied so far

Newest last. Apply in filename order.

| File | What it does | Applied to live? |
|---|---|---|
| `20260811100000_reference_schema.sql` | Creates `teams`, `players`, `fixtures`, `gameweeks` with read-only RLS for `anon`. No data. | **Yes — 11 Aug 2026.** Ticket #9. |
| `20260811130000_job_runs.sql` | Creates `job_runs` (job telemetry: name, status, started/finished, message, `details jsonb`) with read-only RLS for `anon`. Written by the Action's secret key, which bypasses RLS. | **Yes — 11 Aug 2026.** Ticket #10. |
| `20260811160000_table_grants.sql` | Grants `SELECT` to `anon` and `SELECT, INSERT, UPDATE` to `service_role` on all five tables, plus default privileges for future ones. **Fixes `permission denied for table job_runs`.** | Not yet — apply this or every job fails on write. |

Update this table by hand after you apply a migration, so the next person
(or the next overnight run reading this file) knows what state the live
database is actually in.

**Every migration that creates a table must also GRANT on it.** RLS and GRANTs are independent
gates and a query must pass both. A policy without a grant produces `permission denied for
table X`; a grant without a policy produces `new row violates row-level security policy`. The
first one cost a failed run on 11 Aug 2026. Read the error text — it tells you which gate closed.

**A migration file on `main` does not mean it has been applied.** Nothing in this repo can
apply one — that is owner-only (Tier 1). If a job fails with a missing-table error, check this
table first: the most likely cause is a merged migration that nobody ran.
