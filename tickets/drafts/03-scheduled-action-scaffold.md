## Context

Feature-list item 3. Depends on the Supabase reference schema ticket filed immediately before this
one (#9), and on Keshav having applied that migration in the Supabase dashboard.

`.github/` currently contains only `ISSUE_TEMPLATE/` — **there is no workflow of any kind in this
repo.** Every scheduled job in `feature-list.md` items 4, 5, 12, 15 and 22 rides on machinery that
does not exist yet. This ticket builds that machinery and proves it end to end with a heartbeat row
and no business logic, so that when the FPL ingest fails next week it is obvious whether the job or
the pipeline broke.

## Scope

**In scope:**

- `.github/workflows/scheduled-jobs.yml` — a scheduled workflow with both a `schedule:` cron trigger
  and a `workflow_dispatch:` manual trigger, running on `ubuntu-latest` with Node 22.
- `scripts/heartbeat.ts` — connects to Supabase with the secret key and inserts one row into a
  `job_runs` table recording job name, started/finished timestamps, status and a short message.
- A migration under `supabase/migrations/` creating `job_runs`, in the same idempotent style as
  #9.
- `tsx` added as a devDependency, and a `tsconfig.scripts.json` referenced from the root
  `tsconfig.json`, so `npm run build` type-checks `scripts/` as well as `src/`.
- Secrets read from the environment as `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. If either is
  unset, the script exits non-zero with a message naming both variables and makes no network call.
- If `job_runs` does not exist in the target database, the script exits non-zero with a message
  naming the missing table and the migration file that creates it.

**Explicitly out of scope:**

- No FPL fetching, no CSV ingest, no projections, no solver, no notifications. Heartbeat only. The
  entire point of this ticket is that it has no business logic to blame when something breaks.
- **Creates no GitHub secret, no Supabase setting, no account, no API key.** All of those are Tier 1
  and owner-only. This ticket consumes secrets that Keshav has set; it never sets them.
- Does not apply any migration to live Supabase.
- **Adds no new stored personal data.** `job_runs` records job telemetry only — no player data, no
  squad data, nothing about Keshav.
- No changes under `src/`. The app UI is untouched.
- Does not modify the overnight pipeline routine, `CLAUDE.md`, `escalation.md`, any file in
  `.claude/`, or anything in the `app-factory` repo.

## Definition of done

- [ ] `npm run build` passes clean, and it type-checks `scripts/` — introducing a deliberate type
      error in `scripts/heartbeat.ts` makes `npm run build` fail.
- [ ] `npm run lint` passes clean.
- [ ] `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/scheduled-jobs.yml'))"`
      exits 0.
- [ ] The workflow declares both `schedule:` and `workflow_dispatch:` triggers.
- [ ] The workflow pins `node-version: '22'`.
- [ ] The cron line carries an adjacent comment stating the Asia/Singapore local time it corresponds
      to. GitHub cron is UTC and Singapore is UTC+8, so a Singapore-evening schedule crosses the
      date line — getting this wrong shifts every run by a day, silently.
- [ ] Running `npx tsx scripts/heartbeat.ts` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` unset
      exits non-zero and prints a message containing both variable names.
- [ ] Running it against a database with no `job_runs` table exits non-zero and prints a message
      naming `job_runs`.
- [ ] Running it against a local Postgres with the migration applied inserts exactly one row, and a
      second run inserts a second row (heartbeats accumulate; they are not upserted).
- [ ] The `job_runs` migration applies twice against an empty local Postgres, both times exit 0, the
      second time creating nothing new.
- [ ] No literal credential anywhere: the strings `sb_secret_`, `sb_publishable_` and any literal
      `*.supabase.co` host appear in no file this ticket adds or changes, outside of comments.
- [ ] The script never reads a `VITE_`-prefixed variable. `VITE_` appears nowhere in `scripts/`.
- [ ] Scope constraint: the only files added or changed are under `.github/workflows/`, `scripts/`,
      `supabase/migrations/`, plus `package.json`, `package-lock.json`, `tsconfig.json` and the new
      `tsconfig.scripts.json`. Nothing under `src/`, `.claude/` or `public/` changes.
- [ ] The workflow runs green in GitHub Actions and writes one `job_runs` row. *(Owner-level — the
      workflow does not exist on the default branch until this PR merges, so expect CANNOT VERIFY.
      Keshav triggers it via workflow_dispatch after merging.)*

## Notes for the Analyst / Builder

**Read this first — it is the most likely way this ticket fails.**

The overnight routine pushes its branch using a GitHub App credential, and **GitHub Apps cannot
create or update any file under `.github/workflows/` unless the App has the `workflows` permission.**
Whether this pipeline's App has it is unproven. If your push is rejected with a message about
workflow permissions:

- **Stop and report it as a blocker.** Do not rename the file. Do not move it outside
  `.github/workflows/`. Do not commit it as `.txt` for someone to rename later. Do not disable the
  push and mark the item done.
- Everything else in this ticket — the heartbeat script, the migration, the tsconfig wiring — can
  still be committed and is still useful. Commit that work, then report exactly which file the push
  refused and quote the error.
- Keshav will commit the workflow file to `main` himself and the ticket re-runs against it.

Other pre-answers:

- **Secret names are fixed: `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.** Do not invent alternatives
  and do not add a fallback chain of candidate names — a script that silently accepts three spellings
  is a script that fails in a way nobody can diagnose from a phone. If the secrets turn out to be
  named differently in the repo settings, that is a one-line fix Keshav makes; it is not something to
  guess around.
- Supabase's current secret-key format is `sb_secret_...`, which replaces the legacy `service_role`
  JWT. Same role, new format — consistent with the publishable-key note already in
  `src/lib/supabase.ts`. Either format works with `@supabase/supabase-js`; do not "modernise" or
  reformat whatever value arrives in the environment.
- **Adding `tsx` as a devDependency is a Tier 2 library decision, already made here.** Because:
  scripts are TypeScript so they share types with `src/lib/` as the projection work lands, and `tsx`
  runs them directly with no build step in the Action. Log it with the because; do not escalate.
- The GitHub Actions runner has unrestricted network access. The routine's own cloud session does
  not — it uses an allowlist covering `fantasy.premierleague.com`, `*.vercel.app`, `vercel.com` and
  `*.supabase.co`. If a local test fetch fails with `403` and `x-deny-reason: host_not_allowed`, that
  is an environment allowlist gap and an owner action, not something to code around.
- Choose a defensible cron and say why in `decisions.md`. The FPL API updates continuously and
  FPL-Core-Insights refreshes at 07:30 and 17:30 UTC, so a daily run shortly after the later refresh
  is the obvious anchor for the ingest jobs that land next. Tier 3.
- Keep `job_runs` deliberately boring: job name, status, started, finished, message, and a
  `details jsonb` column for row counts. Later jobs write to the same table rather than inventing
  their own.
