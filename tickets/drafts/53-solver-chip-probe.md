## Context

**A diagnostic ticket whose entire purpose is to remove a guess before feature-list item 27 (chip
recommendation) is written.** It stores nothing, changes no production behaviour, and produces one
artefact: the solver's actual output with chips enabled.

### The blocker it removes

Turning the solver's chip options on is a one-line config change. **Reading back which chip it
decided to play, and in which gameweek, is the unsolved part.** `docs/solver-notes.md` records the
solver's results-CSV columns, derived from source at the pinned commit:

```
week,name,pos,type,team,price,xP,lineup,captain,vicecaptain,transfer_in,transfer_out
```

**There is no chip column.** The chip decision appears only in what the solver prints to stdout,
via the `print_transfer_chip_summary` option we already set to `true`. Nobody has ever read that
output with chips enabled, because `chip_limits` has been `{ bb: 0, wc: 0, fh: 0, tc: 0 }` since
ticket #41.

**Why this must not simply be switched on in the live run.** With chips enabled and no way to read
the decision back, the solver would optimise assuming a chip is played and the app would present the
resulting transfer and captain **without ever saying a chip was involved.** That is a confidently
wrong recommendation, which `product-brief.md` §6a forbids outright: *no recommendation beats a
wrong one.* It would also be invisible — the numbers would look normal.

`HANDOFF-to-orchestrator-chat.md` and `LEARNINGS-first-build-wave.md` §5 both say the same thing:
**verify an external claim at ticket-writing time rather than writing a ticket from a guess.** This
ticket is that verification, made repeatable.

Depends on item 12 (merged, #41). Nothing unmerged.

## Scope

**In scope:**

- **A new `workflow_dispatch`-only workflow, `.github/workflows/solver-chip-probe.yml`**, that
  mirrors the existing `solver-run.yml` up to and including the solve, then stops.
- **It runs the solver with Bench Boost and Triple Captain enabled** — `bb: 1` and `tc: 1` — and
  **Wildcard and Free Hit left at 0.** See Notes for why those two are excluded outright.
- **It stores nothing.** No `solver_runs` row, no `solver_picks`, no `recommendations`, no
  `job_runs` row, no Telegram send. **Read-only against Supabase**, which it touches solely to build
  the projections CSV and `team.json` exactly as the live run does.
- **It uploads three artefacts**: the solver's full stdout log, the results CSV it produced, and the
  exact config JSON it was given. **The stdout log is the point of the ticket.**
- **A `CHIP_PROBE` mechanism in `scripts/build-solver-input.ts`** — a single environment variable
  that, when set, makes `buildSolverConfig` emit `bb: 1, tc: 1` instead of all zeros. **When unset,
  the config it produces is byte-for-byte what it produces today.**
- **`docs/solver-notes.md` gains a short section** stating what this probe is for, that it stores
  nothing, and that item 27 must be written from its output rather than from the results-CSV column
  list.

**Explicitly out of scope:**

- **No parsing of the solver's output.** None. Not a regex, not a "best effort" reader, not a
  `TODO`. **Writing a parser is the next ticket and it must be written from the real output**, which
  does not exist until this one has run.
- **No change to `solver-run.yml`** and no change to what the live run does. The probe is a separate
  file with a separate trigger.
- **No wildcard or free hit.** `wc` and `fh` stay 0 — see Notes.
- **No database write of any kind**, and no change to `scripts/store-solver-output.ts` or
  `scripts/generate-recommendations.ts`.
- **No Telegram send.**
- **No schedule.** `workflow_dispatch` only — this is run deliberately, by a human, when someone
  wants the answer.
- **No migration, no UI, nothing under `src/` or `supabase/`.**

## Definition of done

- [ ] `.github/workflows/solver-chip-probe.yml` exists, has `workflow_dispatch` and **no**
      `schedule` key. Grep-checkable: the string `schedule` does not appear in that file.
- [ ] It uploads the solver stdout log, the results CSV and the config JSON as named artefacts, each
      with `if: always()` so a failed solve still yields the log.
- [ ] **The workflow contains no step that writes to Supabase.** Grep-checkable: `store-solver-
      output`, `generate-recommendations`, `send-telegram` and `snapshot-predictions` appear nowhere
      in that file.
- [ ] With `CHIP_PROBE` unset, `buildSolverConfig` returns exactly what it returns today — a
      full-object equality unit test against the current config, so the production path is provably
      untouched.
- [ ] With `CHIP_PROBE` set, the config carries `chip_limits: { bb: 1, wc: 0, fh: 0, tc: 1 }` and
      **every other key is identical** to the unset case. Full-object equality test.
- [ ] `preseason` is still `false` in both cases. Named test. *(The shipped default is `true` and
      wipes the squad — it must never regress, least of all in a workflow nobody watches.)*
- [ ] `docs/solver-notes.md` records what the probe is for and that item 27 depends on its output.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted, and `solver-run.yml` is not
      modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** **a new `workflow_dispatch` workflow cannot be run until
      its file is on the default branch**, so no run can be demonstrated by this ticket and the
      definition of done deliberately does not ask for one. The human check after merge is
      dispatching `Solver chip probe` once, downloading the stdout log, and reading what the chip
      summary actually prints. **That output is the input to item 27's ticket.**

## Notes for the Analyst / Builder

**Why Wildcard and Free Hit are excluded outright, stated as a *because*.** Both are **full-squad
rebuilds**, and the solver's squad-build path is `preseason`, which `product-brief.md` §3 puts out
of scope until feature-list item 28 and which **wipes the stored squad when enabled**. Bench Boost
and Triple Captain are timing decisions over the squad we already have — a different and far smaller
question. **Because** the probe exists to learn one thing safely, it enables only the two chips that
cannot restructure the squad. Item 28 handles the other two, deliberately, later.

**The output is the deliverable, not the code.** Judge this ticket by whether a human can dispatch
it and read a log that answers "what does the solver say when it decides to play a chip". The
workflow file is a means.

**Do not be tempted to store "just the run" for reference.** A `solver_runs` row from a probe would
be indistinguishable from a real one to every consumer — `scripts/send-telegram.ts` reads the latest
solve to decide what to notify about, and the verdict card reads the newest recommendation. A probe
row would silently become the app's answer.

**`chip_limits` is currently typed as a literal** — `{ bb: 0; wc: 0; fh: 0; tc: 0 }` in
`SolverConfig`. Widening the type is part of this ticket; **widening the runtime default is not.**

**The environment-variable mechanism should follow the precedent already in this file** —
`SOLVER_SECS` is read the same way. Match it rather than inventing a second pattern.

**This is Tier 3.** It adds a diagnostic that stores nothing and changes no production behaviour.
The Tier 2 decision — whether to act on chips at all — belongs to item 27, once we know what the
solver actually tells us.

**Two other tickets may be running in this batch.** One owns
`.github/workflows/scheduled-jobs.yml`, `scripts/project-points.ts` and `src/lib/projection/`; the
other owns `scripts/preflight-check.ts`. This ticket touches neither — in particular, **do not edit
`scheduled-jobs.yml`**; this ticket adds its own workflow file.

## Scope constraint

Nothing outside the following files changes:

- `.github/workflows/solver-chip-probe.yml` (new)
- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `src/` or `supabase/` changes. No other workflow file
is touched — `solver-run.yml`, `scheduled-jobs.yml`, `prediction-log.yml`, `preflight-check.yml`,
`send-notification.yml` and `calibration-report.yml` are all left alone. No other file under
`scripts/` changes, and `docs/projection-model-backlog.md` is not modified.
