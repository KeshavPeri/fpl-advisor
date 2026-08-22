## Context

**A silent failure that hid a total chain outage for a full day, found while diagnosing the
21 August preflight run.**

`.github/workflows/solver-run.yml` gates its solve, store, generate-recommendations and send steps
on `steps.build-input.outputs.squad_found == 'true'`. When `scripts/build-solver-input.ts` finds no
`squads` row for the target gameweek it logs a line, writes `squad_found=false`, and calls
`process.exit(0)`. Every gated step is then skipped and **the workflow finishes green having
produced nothing** — no solve, no recommendation, no notification, and **no `job_runs` row at all**,
so the failure is invisible in the database as well as in GitHub.

That is exactly what happened. A separate defect in `scripts/sync-squad.ts` (fixed by its own
ticket) left gameweek 2 with no `squads` row. `Solver run` showed a tick in the Actions list. The
only visible symptom anywhere was the preflight check, which is not read every day, and the fact
that no Telegram message arrived — which is indistinguishable from "nothing changed".

**The guard itself is right; the reporting is wrong.** Skipping a solve when there is no squad to
solve is correct behaviour. Reporting success for it is not.

### Why the "normal state" comment is now false

The code's own comment reads: *"This is a normal pre-GW1 state, not a failure: enter the squad
manually (#13) or wait for the post-deadline API sync (#14)."* **That was true when it was written
and is not true any more.** A `squads` row now exists per gameweek and is written by
`scripts/sync-squad.ts`, which runs in `scheduled-jobs.yml` at 17:45 UTC — 35 minutes before
`solver-run.yml` at 18:20 UTC. Mid-season, `squad_found=false` at solve time means the squad sync
failed or never ran. It is a failure, and a comment stating the old convention is the second-order
effect `deltas.md` D10 names explicitly.

`product-brief.md` §6c already states the required behaviour for this class: *"the run fails
loudly. Telegram sends a failure notice."* and, for a squad that does not reconcile, *"the app must
say the registered squad doesn't reconcile and prompt Keshav to re-check it, rather than showing a
generic error."* Neither happens today.

Depends on nothing unmerged.

## Scope

**In scope:**

- **`scripts/build-solver-input.ts`: a missing `squads` row becomes a failure, not a benign exit.**
  It writes a `job_runs` row with `status: 'failure'` whose message names the gameweek and says the
  squad is missing, still writes `squad_found=false` so the downstream gating is unchanged, and
  exits non-zero.
- **The same treatment for a `squad_picks` count other than exactly 15** for that gameweek, if it is
  not already handled that way — a partial squad is the same class of problem and produces the same
  silence. Check the existing behaviour before changing it; if it already fails loudly, leave it and
  say so in the decisions log.
- **`.github/workflows/solver-run.yml`: the Telegram step is no longer gated on `squad_found`.**
  It becomes `if: always()`, matching the reason already written in its own comment — a failure
  notice is required on exactly the paths that produce no recommendation. `scripts/send-telegram.ts`
  already classifies "no recommendation for this gameweek" and composes the right message; that is
  the mechanism this ticket is connecting, not one it builds.
- **The stale comment corrected** in `scripts/build-solver-input.ts`, so it states the current rule
  rather than the pre-GW1 one.
- Unit tests for the new failure path.

**Explicitly out of scope:**

- **No change to the `squad_found` output mechanism or to which steps are gated on it**, beyond the
  Telegram step named above. The gating is correct.
- **No change to `scripts/send-telegram.ts`, `scripts/notification-schedule.ts` or
  `src/lib/notification/`.** This ticket changes when that script is invoked, never what it does.
- **No change to `scripts/sync-squad.ts`.** The cause of the missing row is fixed by its own,
  already-merged ticket; this ticket is about what happens the *next* time something empties the
  squad for a different reason.
- **No retry, no fallback squad, no "use last gameweek's squad".** Solving against a stale squad
  would produce a confident wrong answer, which `product-brief.md` §6a forbids: no recommendation
  beats a wrong one.
- **No new database table and no migration.** `job_runs` already exists and already carries
  `status`, `message` and `details`.
- No change to any other workflow file, schedule or cron.

## Definition of done

- [ ] With no `squads` row for the target gameweek, `scripts/build-solver-input.ts` writes a
      `job_runs` row with `status = 'failure'` and exits with a non-zero code. Asserted by a unit
      test.
- [ ] That row's `message` names the gameweek id and states that no squad is stored for it, in words
      a person reading it on a phone can act on — per `design-reference.md`'s interface-writing rule
      that errors say what happened and what to do.
- [ ] `squad_found=false` is still written to `$GITHUB_OUTPUT` on that path, so the downstream step
      gating behaves exactly as before. Asserted by a unit test.
- [ ] `.github/workflows/solver-run.yml`'s Telegram step condition is `if: always()` with no
      `squad_found` clause. Grep-checkable.
- [ ] The `squad_picks`-count path either already fails loudly or now does, and which of the two was
      the case is recorded in `decisions/ticket-<number>.md`.
- [ ] The stale "normal pre-GW1 state" comment no longer appears in
      `scripts/build-solver-input.ts` — grep-checkable: the string `pre-GW1` does not appear in that
      file.
- [ ] No file under `supabase/migrations/` is added or modified, and no workflow file other than
      `solver-run.yml` is touched. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the exit code and the `job_runs` write, not
      that GitHub Actions marks the run red, and `api.telegram.org` is unreachable from a cloud run
      so no test proves a notice arrives. The human check after merge is to dispatch `Solver run`
      once with the squad present and confirm it is still green end to end — the far more likely
      regression here is breaking the **happy** path, not the failure one.

## Notes for the Analyst / Builder

**The one thing to get right, stated as a *because*.** A workflow that reports success while
producing nothing is worse than one that fails, **because** the tick is read as evidence and stops
anyone looking further. `LEARNINGS-second-build-wave.md` §2 records five defects of this exact
shape, every one found by a person reading a number rather than by a test. This ticket removes one
of the remaining places the system can lie about its own health.

**Do not make this a warning or a soft signal.** There is no threshold to tune and no partial
success to represent. Either a squad exists to solve against or the run has nothing to do and should
say so in red.

**Why the Telegram step is un-gated rather than given its own new message.** `send-telegram.ts`
already distinguishes `current` / `stale` / `infeasible` / `no_recommendation` and composes the
right text for each; the missing-squad case lands in one of those paths. Adding a fifth kind would
duplicate logic that already exists. If the Builder finds the resulting message unclear for this
specific case, **report that as an observation rather than changing `send-telegram.ts`** — that
file is owned by another ticket that may be running in the same batch.

**Another ticket may be running in this batch that owns `scripts/send-telegram.ts`,
`scripts/notification-schedule.ts` and `src/lib/notification/message.ts`.** This ticket touches none
of them, and the two changes are independent: one changes when the send script runs, the other
changes what it suppresses. Do not edit those files.

**A third ticket in this batch owns `scripts/preflight-check.ts`.** Also untouched here.

**`solver-run.yml` is already on the default branch**, so it can be dispatched immediately after
merge. Unlike a brand-new workflow file, proving it runs is a real post-merge check rather than an
unsatisfiable definition-of-done item.

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `.github/workflows/solver-run.yml`
- `decisions/ticket-<this issue number>.md`

No migration file is added or modified. No other workflow file is touched. Nothing under `src/`
changes. `scripts/send-telegram.ts` and `scripts/sync-squad.ts` are not modified.
