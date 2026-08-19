## Context

**GW1 locks at 01:30 Singapore time on Saturday 22 August 2026.** As of this ticket being written
there are two overnight runs left, and the whole chain — ingest, projection, CSV, solve,
recommendation, notification — is built and has run end to end at least once.

The risk now is not that something is unbuilt. It is that **something quietly stops being true
between now and Friday**, and nobody notices until the notification either fails to arrive or
arrives carrying nonsense.

Every failure this project has actually had was of that shape. A merged migration nobody applied. A
read silently truncated at a thousand rows. Ratings attached to the wrong clubs. Cup matches counted
as league form. In each case every job reported success, because each job only checks its own step.
`LEARNINGS-first-build-wave.md` §6 names the pattern directly: *"Any ticket whose migration is
unapplied will fail in a way that looks like a code bug."*

**Nothing in the system currently answers the question "is the whole chain healthy right now?"** —
and that is the only question that matters for the next 48 hours.

Depends on every merged job and table. This ticket adds no capability; it reads what exists and
reports whether it holds together.

## Scope

**In scope:**

- **`scripts/preflight-check.ts`** — a read-only job that runs a fixed list of assertions across the
  live database and reports each as pass, warn or fail, with a reason.
- **`.github/workflows/preflight-check.yml`** — a new workflow, `workflow_dispatch` plus a schedule.
- A human-readable report written to a file and uploaded as an artifact.
- Every check's result, and one overall verdict, into `job_runs.details`.
- Vitest tests for the pure assertion logic.

**The checks, all of which must be implemented:**

1. **Next gameweek** — a `gameweeks` row is marked `is_next`, and its `deadline_time` is in the
   future. Report the gameweek name and hours remaining.
2. **Squad** — a `squads` row exists for that gameweek with exactly 15 `squad_picks`, 11 of them
   starting, exactly one captain and one vice-captain.
3. **Projections** — `player_projections` covers that gameweek for the current model version, with a
   row count within a stated tolerance of the `players` count, and none of them all-zero.
4. **Recommendation** — a `recommendations` row exists for that gameweek at `plan_index` 0, and its
   `updated_at` is recent relative to the last solver run.
5. **Solver** — the most recent `solver_runs` row is for that gameweek and reports a proven optimum.
   A non-optimal or infeasible status is a **fail**, not a warning.
6. **Team ratings** — count of `teams` rows with a null `elo`, and the count of fixtures in the
   horizon that would fall back to FPL difficulty. Both reported as numbers, neither an automatic
   failure.
7. **Match data** — every `player_match_stats` row carries a `competition`, and no player exceeds 38
   Premier League matches in a season.
8. **Job freshness** — for each of `ingest-fpl`, `ingest-core-insights`, `sync-squad`,
   `project-points`, `emit-projections-csv`, `solver-run` and `generate-recommendations`: the most
   recent `job_runs` row, its status, and its age. **A failed most-recent run, or one older than 36
   hours, is a fail.**
9. **Notifications** — which triggers have already fired for the next gameweek, and whether the ones
   still due are still reachable given the deadline.
10. **Configuration** — which of the required environment variables are set in the running job. Names
    only, never values.

**Explicitly out of scope:**

- **This job never writes to any table except `job_runs`, and never sends anything.** It does not
  repair, re-run, re-trigger or notify. It reports. A check that tries to fix what it finds is a
  check nobody can trust.
- **No Telegram message.** Wiring the verdict into a notification is item 15's job and this is not a
  recommendation. If a failing preflight should page somebody, that is a separate decision.
- **No new database table and no migration.** Everything read already exists.
- **No change to any existing script, workflow, or anything under `src/`.**
- **No secret values in any output.** Names and set/unset only.
- **No fix for anything the check finds.** If a check fails, that is a finding for Keshav, tonight,
  not something to resolve inside this ticket.
- No new npm dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` is added, changed or deleted.
- [ ] No existing file in `scripts/` or `.github/workflows/` is modified.
- [ ] No new entry in `package.json`.

**The checks**

- [ ] All ten checks above are implemented, each with its own named identifier appearing in the
      report and in `job_runs.details`.
- [ ] Each check returns **pass, warn or fail** with a one-line human reason. A check that cannot be
      evaluated — a missing table, an empty result — returns **fail with the reason**, never pass.
- [ ] **The overall verdict is the worst individual result**, and it appears once, at the top of the
      report and as a single named field in `job_runs.details`.
- [ ] The assertion logic is pure and unit-tested — it takes the queried values as arguments and
      returns verdicts, so every pass, warn and fail path has a named test with no database.
- [ ] There is a named test for each check's **fail** path, not only its pass path.

**Output**

- [ ] The report names, for each check: the identifier, the verdict, the reason, and the actual
      values behind it. A verdict with no number behind it is not useful.
- [ ] The report opens with the gameweek name, the deadline in **Singapore time** (`Sat 22 Aug,
      01:30`, per `product-brief.md` §8) and the hours remaining.
- [ ] The report is written to a path from an environment variable with a stated default and uploaded
      as a named workflow artifact.
- [ ] `job_runs` gets one row per execution, `job_name = 'preflight-check'`, never upserted.
- [ ] **The job's own exit code reflects the verdict** — non-zero on an overall fail — so a red
      workflow run is itself the signal, without anyone opening the artifact.

**Safety**

- [ ] The job issues no `insert`, `upsert`, `update` or row-removal call against any table other than
      `job_runs`. Verifiable by search.
- [ ] It makes no network request other than to Supabase. The strings `fantasy.premierleague.com`,
      `api.telegram.org` and `raw.githubusercontent.com` appear nowhere in the file.
- [ ] It reads exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, plus the report path. It reports on
      the presence of other variables without reading their values into any output.
- [ ] **No environment variable value appears in the report, the log, or `job_runs`.** Only names and
      whether each is set. Verifiable by test.
- [ ] Every Supabase read uses the shared pagination helper and asserts its row count against an
      independent count.

**Scheduling**

- [ ] `workflow_dispatch` works and runs the full check immediately.
- [ ] A schedule is added, at least daily, with the cron stated in UTC and a comment deriving it.
      Singapore is UTC+8 with no daylight saving, so a Singapore small-hours time is the previous day
      in UTC — getting this wrong shifts every run by a day, silently (`deltas.md` D2).
- [ ] The workflow declares a `timeout-minutes`.
- [ ] Scope constraint: only `scripts/preflight-check.ts`, its test file, a new shared assertions
      module under `scripts/` if one is needed, `.github/workflows/preflight-check.yml`, and this
      ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`,
      `supabase/` changes; no existing file in `scripts/` or `.github/workflows/` changes;
      `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **This job's only job is to be trusted.** That means two things: it never repairs anything, and it
  never returns pass when it could not evaluate. A check that silently passes on a missing table is
  worse than no check, because it converts an unknown into a false reassurance — which is precisely
  the failure mode every incident in this project has shared.
- **Fail versus warn, decided here.** *Fail:* anything that would make Friday's notification wrong or
  absent — no next gameweek, no squad or a malformed one, no projections, no recommendation, a
  non-optimal solve, a job that failed or has not run in 36 hours. *Warn:* anything that degrades
  quality without breaking the chain — teams with a null rating, fixtures using the FDR fallback, a
  projection count slightly under the player count. Tier 3, decided here; if a specific check is
  genuinely ambiguous, choose fail and say why in the decisions log. **An over-sensitive check gets
  investigated; an under-sensitive one gets trusted and is wrong.**
- **A non-optimal solve is a fail, not a warn, and that is deliberate.** `product-brief.md` §6c says a
  timed-out solution "is usable but must be labelled", which is item 13's job at presentation time.
  For a preflight two days from a deadline, it is a thing to look at tonight rather than discover on
  Friday.
- **36 hours is the staleness threshold, and it is a judgement.** The nightly workflow runs daily, so
  a healthy job is always under about 25 hours old; 36 leaves room for a delayed cron without going
  green on a job that has genuinely stopped. One named constant, one comment.
- **Do not read a secret's value for any reason.** Checking `TELEGRAM_BOT_TOKEN` is set means
  checking the variable is non-empty — never its length, never a prefix, never a masked form. A
  report that leaks a fragment of a credential into a workflow artifact is a Tier 1 incident, and
  artifacts are downloadable.
- **The elo and fallback counts are reported, not judged.** As of writing, three promoted clubs may
  have no ClubElo rating and their fixtures should be using FPL's difficulty scale instead. That is
  known, expected, and correctly a warn — the number simply needs to be visible so a change in it is
  noticed.
- **Two other tickets may be running in this batch.** One owns the verdict card and
  `src/lib/verdict/`; another may own the recommendation scripts. This ticket adds new files only and
  modifies no existing one, so it cannot collide with either.
- **What a substitute cannot catch.** Pure tests prove every verdict rule against fixtures. They
  cannot prove the live chain is actually healthy — that is the whole point of the job, and it only
  means anything when run against the real database. **Run it manually the moment it merges. If it
  comes back green two days before the deadline, that is the most useful single output this
  repository has produced; if it comes back red, that is more useful still.**
