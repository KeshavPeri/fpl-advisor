## Context

**G5 in `docs/projection-model-backlog.md`, and it is now live rather than theoretical.**

The projection model needs one league-wide number: the average goals a team scores in a match. It
drives expected goals conceded and, through that, every clean-sheet and goals-conceded figure for
every defender and goalkeeper in the app.

Before the season had results there was nothing to compute it from, so
`src/lib/projection/fixture.ts` carries a placeholder — `LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45` —
and `scripts/project-points.ts` uses it whenever **fewer than 20 finished fixtures** exist. The job
already records which path it took, in `job_runs.details` as `leagueBaselineGoalsSource`, either
`"fallback"` or the computed value.

**Nothing checks it.** The backlog states the risk in one sentence: *"If a `project-points` run in
October still reports `fallback`, the finished fixtures are not being ingested and that is a real
failure wearing a normal-looking hat."*

**Why now.** Gameweeks 1 and 2 have been played, so roughly 20 fixtures are finished and the switch
to the real figure should be happening about now. This is the moment a silent failure would begin,
and it is exactly the class `LEARNINGS-second-build-wave.md` §6 built the preflight check for:
**every component reports success and the chain is quietly wrong.**

Depends on the preflight check (merged, #69, narrowed by #89). Nothing unmerged.

## Scope

**In scope:**

- **A new assertion in `scripts/preflight-check.ts`**, sitting alongside the existing ten, that
  reads the most recent successful `project-points` `job_runs` row and checks
  `leagueBaselineGoalsSource`.
- **The verdict rule:**
  - **PASS** when the source is a computed value, and that value is within a plausible range.
  - **PASS** when the source is `"fallback"` **and** fewer than 20 finished fixtures exist — the
    correct, expected state before the season has results.
  - **FAIL** when the source is `"fallback"` **and** 20 or more finished fixtures exist. That is the
    silent failure this ticket exists to catch, and the reason must say plainly that finished
    fixtures are not reaching the projection job.
  - **FAIL** when no recent successful `project-points` row exists to read — per the check file's
    own governing rule, unable-to-evaluate is a failure, not a pass.
- **A bounds check on the computed value.** A real league average sits somewhere near 1.2 to 1.9
  goals per team per match; a figure outside **1.0 to 2.5** is arithmetically implausible and must
  **FAIL** with the number quoted, even though the job reported success. See Notes.
- **The reason string carries the numbers** — the source, the value if computed, and the finished-
  fixture count — on a pass as well as a failure, matching how every other check in that file
  reports.

**Explicitly out of scope:**

- **No change to `scripts/project-points.ts`**, to `src/lib/projection/fixture.ts`, or to
  `LEAGUE_BASELINE_GOALS_PER_TEAM` itself. The job's behaviour is correct; nothing was watching it.
- **No change to the 20-fixture threshold.** It lives in `project-points.ts` and this check reads
  the same rule rather than redefining it.
- **No change to any of the existing ten checks**, their thresholds, verdicts, reasons, positions or
  identifiers.
- **No change to the report structure, the artefact, the workflow, the schedule or the exit code.**
- **No migration, no UI, nothing under `src/` or `supabase/`.**
- **No auto-repair.** The check reports; it never re-runs a job or writes a value.

## Definition of done

- [ ] The new check appears in the preflight report with its own identifier and title, and the
      existing ten are untouched — their identifiers, positions and titles unchanged.
      Grep-checkable against the existing test file.
- [ ] **FAIL** when `leagueBaselineGoalsSource` is `"fallback"` and finished fixtures are 20 or
      more, with a reason naming both numbers. Named test.
- [ ] **PASS** when the source is `"fallback"` and finished fixtures are fewer than 20. Named test.
- [ ] Both sides of the boundary are tested: exactly 19 finished fixtures passes on fallback,
      exactly 20 fails. Named tests.
- [ ] **PASS** when the source is a computed value inside the plausible range, with the value quoted
      in the reason. Named test.
- [ ] **FAIL** when the computed value is below 1.0 or above 2.5, with the value quoted. Named tests
      at both ends and at both boundaries.
- [ ] **FAIL** when no recent successful `project-points` `job_runs` row can be found. Named test.
- [ ] The reason states the numbers on a pass as well as a failure. Named test asserting the passing
      reason contains the value.
- [ ] Every Supabase read in the new check paginates and is filtered in the database, matching how
      the other checks in that file read.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file
      under `scripts/` other than `preflight-check.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run on constructed `job_runs` rows. Whether the
      live job is *currently* on the fallback is exactly the question this check exists to answer
      and cannot be answered from code. The human check after merge is dispatching
      `Preflight check` and reading the new line: **right now, with two gameweeks played, it should
      report a computed value rather than the fallback.** If it still says fallback, this ticket has
      done its job on its first run and there is a real bug behind it.

## Notes for the Analyst / Builder

**Why a bounds check and not just a source check, stated as its *because*.** A computed number is
not automatically a correct one. **Because** `LEARNINGS-second-build-wave.md` §2 records five
defects found by a person looking at a figure and finding it implausible — a 1,000, a 54, a 95%, a
280, a 101 — and none of them by a test, **every derived figure with a known real-world limit gets a
bound.** Premier League scoring has sat between roughly 1.2 and 1.9 goals per team per match for
decades; 1.0 to 2.5 is generous enough never to fire on a real season and tight enough to catch a
unit error, a double count, or a division by the wrong denominator.

**Do not re-derive the threshold.** The 20-finished-fixture rule belongs to `project-points.ts`.
Read the recorded source and the fixture count; do not reimplement the decision, or the two copies
will drift and the check will start disagreeing with the job it is checking.

**A check that cries wolf is worse than no check.** #89 exists because one assertion failed for a
non-reason and taught the reader to ignore the whole report. **The fallback is legitimately correct
before the season has results** — the pass case matters as much as the fail case here.

**Keep the count visible on a pass.** The number moving is itself information: a league average
drifting week to week as fixtures accumulate is normal, and a figure that stops moving is not. A
number that only appears on failure is a number nobody watches.

**This is Tier 3** — it adds a read-only assertion to an existing read-only check. It stores nothing
and changes no behaviour anywhere in the chain.

**Two other tickets may be running in this batch.** One owns
`.github/workflows/scheduled-jobs.yml`, `scripts/project-points.ts`, `src/lib/projection/` and
`docs/projection-model-backlog.md`; the other adds `.github/workflows/solver-chip-probe.yml` and
owns `scripts/build-solver-input.ts` and `docs/solver-notes.md`. **This ticket must not modify
`scripts/project-points.ts`** even though it reads what that job records, and must not touch either
docs file.

## Scope constraint

Nothing outside the following files changes:

- `scripts/preflight-check.ts`, `scripts/preflight-check.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `src/` or `supabase/`
changes. `scripts/project-points.ts`, `scripts/build-solver-input.ts`,
`src/lib/projection/fixture.ts`, `docs/projection-model-backlog.md` and `docs/solver-notes.md` are
not modified.
