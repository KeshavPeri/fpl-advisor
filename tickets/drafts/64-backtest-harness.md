## Context

**Feature-list item 32, first slice — and the first thing in this project that can say whether the
model is any good, rather than whether it is internally consistent.**

Ticket #121 built `feature_history`: for every player and gameweek of a season, the cumulative
totals of that player's Premier League matches **strictly before** that gameweek. Ticket #125 made it
usable and dense. It is now populated — **18,243 rows across 562 players for 2025-2026**, run
28 August 2026.

**Nothing reads it.** That is the third write-with-no-consumer this project has created, and the
first two both turned out to be wrong in production once something finally looked.

### What a backtest is, and why the existing report is not one

The calibration report compares last season's actuals against **this season's** projections at a
position level. Its own caveats say so plainly: *"it uses full-season hindsight on both sides, which
is invalid for judging any one prediction but fine for judging a position-level distribution."*

**A backtest asks a different question**: for each gameweek of last season, using only what was
knowable **before** that gameweek, what would the model have projected — and what actually happened?
That is a per-player, per-gameweek measurement with no hindsight, and it is the only thing that can
answer whether a recommendation would have been good.

`feature_history`'s strictly-before rule is exactly what makes it possible.

### Scope of this first slice

**Measure the projection, not the recommendation.** Replaying transfers, captaincy and the solver
across a season is item 32's full ambition and a much larger piece of work. This slice establishes
the measurement substrate: point-in-time projections against actual points, per player, per gameweek,
with the error decomposed by position and by component.

Depends on item 29's first slice (#121, merged) and #125 (merged, table populated). Nothing unmerged.

## Scope

**In scope:**

- **A new hand-run job `scripts/run-backtest.ts`** and a **`workflow_dispatch`-only workflow**,
  `.github/workflows/backtest.yml`. No schedule — this is run deliberately, and it reads a whole
  season.
- **For each (player, gameweek) row in `feature_history` for the configured season:**
  - Build the model's rate inputs from that row's prior-match totals **and nothing else**.
  - Produce a projected points figure using the existing pure modules under `src/lib/projection/`,
    imported, never reimplemented.
  - Reconstruct that gameweek's **actual** points from `player_match_stats` using the existing pure
    modules under `src/lib/scoring/`, imported, never reimplemented.
  - Record the signed error.
- **A markdown report**, uploaded as an artefact, matching the shape
  `scripts/calibration-report.ts` already establishes:
  - Mean absolute error and mean signed error, **overall, by position, and by gameweek**.
  - The **measured population** stated explicitly and separately from the excluded one — see below.
  - Sample sizes beside every figure, and a provenance section.
- **The measured population is `prior_matches > 0` and the player actually featured or was expected
  to.** A player with no prior matches has no point-in-time signal at all, and a player who did not
  feature is a correct zero that would flatter the error. **Both are counted and reported
  separately, never folded into the headline.**
- **Bonus is excluded from both sides**, for the same reason #127 established: the actuals source has
  no `bonus` column and can never have one, verified.
- **Sanity bounds that fail the report rather than printing.** Mean absolute error outside
  **1.0 to 3.5** points per player-gameweek, or a derived clean-sheet rate above **60%**, means the
  harness is wrong, not the model.
- **Counters in `job_runs.details`**: feature-history rows read, actual rows matched, rows measured,
  rows excluded with the reason, and the headline error figures. **The counts must reconcile
  arithmetically.**
- **`docs/projection-model-backlog.md` gains a section** recording what this slice measures, what it
  deliberately does not, and that the recommendation-level backtest remains open.

**Explicitly out of scope:**

- **No replay of transfers, captaincy, the solver, or a season's league position.** That is item 32's
  remaining work and item 33 after it.
- **No change to the projection model, the scoring module, or any stored projection.** This job reads
  and reports; it writes only its own `job_runs` row and its artefact.
- **No migration and no new table.** Results go in the artefact and the job row. **If they turn out
  to be worth storing, that is a later ticket** — storing a measurement before anyone has read one
  is how the last three unread tables happened.
- **No change to `scripts/calibration-report.ts`.** Another ticket in this batch owns it, and the two
  reports answer different questions and both should exist.
- **No comparison between model versions**, and no use of `PROJECTION_MODEL_VERSION`.
- **No wiring into any scheduled workflow.**
- **No conclusion written into the code** about whether the model is good.

## Definition of done

- [ ] `.github/workflows/backtest.yml` exists, has `workflow_dispatch` and **no** `schedule` key.
      Grep-checkable.
- [ ] The season is read from an environment variable with a documented default of `2025-2026`,
      matching `FEATURE_HISTORY_SEASON`'s convention.
- [ ] **The job imports the rate and points modules from `src/lib/projection/` and the scoring
      modules from `src/lib/scoring/`.** Grep-checkable: no local reimplementation of a per-90 rate,
      a shrinkage formula or a points calculation appears in the job.
- [ ] **No lookahead.** A unit test constructs a player with matches in gameweeks 1, 2 and 3 and
      asserts the gameweek 3 projection is built from gameweeks 1 and 2 only. **This is the most
      important test in the ticket** — a leak here makes every figure the harness produces flattering
      and wrong, while leaving all the counts reconciling.
- [ ] A row with `prior_matches = 0` is excluded from the headline and counted separately. Named
      test.
- [ ] A player who did not feature in a gameweek is excluded from the headline and counted
      separately. Named test.
- [ ] **The counters reconcile:** rows read = rows measured + rows excluded, by reason, exactly.
      Asserted in a test.
- [ ] Mean absolute error and mean signed error are computed from the raw projected and actual
      figures, and the signed error is stated in words as the model over- or under-projecting. Named
      tests for a positive and a negative case — **this sign is easy to invert and impossible to spot
      once rendered.**
- [ ] **The report fails, naming the figure, when mean absolute error falls outside 1.0–3.5** or any
      position's derived clean-sheet rate exceeds 60%. Named tests at each bound.
- [ ] Per-gameweek figures are reported as well as the season aggregate, so a bad week is visible
      rather than averaged away.
- [ ] Bonus is excluded from both sides. Named test.
- [ ] Every Supabase read paginates and asserts its count independently — `feature_history` holds
      18,243 rows for one season and `player_match_stats` 15,340, both far past the silent 1,000-row
      cap.
- [ ] The job issues no `insert`, `update`, `upsert` or `delete` against any table except its own
      `job_runs` row. Grep-checkable.
- [ ] `docs/projection-model-backlog.md` records the section described in Scope.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted, and no existing file under
      `scripts/` is modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed rows. Nothing proves the
      harness produces a sane figure against 18,243 real ones, and **a new `workflow_dispatch`
      workflow cannot be run until its file is on the default branch**, so no run is asked for here.
      The human check after merge is dispatching `Backtest` and reading the headline **against
      reality before believing it**: a mean absolute error near zero means a lookahead leak or a
      population that has folded the non-appearances back in; a figure above five means the harness
      is broken, not the model.

## Notes for the Analyst / Builder

**The single rule this ticket turns on, as its *because*.** A backtest is only worth running if it
uses nothing the model could not have known. **Because** `feature_history` already enforces the
strictly-before rule at write time, the job's job is simply not to reach past it — **so it must read
`feature_history` and `player_match_stats` for the target gameweek's actuals, and never
`player_match_stats` for the features.** If a Builder finds itself computing a rate from
`player_match_stats`, the lookahead has already happened.

**The measured population decides whether this number means anything.** About one player in six
correctly projects at zero and then scores zero; including them makes any error metric look
excellent and measures nothing but how many players are injured. #123's accuracy display hit exactly
this and its rule applies here.

**Report "not enough data" rather than a number.** `LEARNINGS-second-build-wave.md` §3: *a report
that says "I cannot measure this" is trustworthy; one that says "0.30, probably" is not.* Early
gameweeks of a season have almost no prior matches and will legitimately have tiny measured
populations — say so per gameweek rather than averaging them into the headline.

**Bound every derived figure, and fail rather than warn.** The sister ticket in this batch exists
precisely because the calibration report printed a 95% clean-sheet rate three times with honest
caveats attached. **Caveats do not stop anyone acting on a number; a failed report does.**

**Join on `player_code`, never `player_id`.** `feature_history` is keyed on `player_code` for exactly
this reason, and 453 of 458 element ids changed between seasons (`deltas.md` D9).

**Filter actuals on `competition = 'prem'`.** 18% of `player_match_stats` rows are cup and European
matches and their xG per 90 is 34% higher — a bias landing only on clubs playing in Europe.

**Two known data gaps to carry, not to solve.** `team_goals_conceded` is 98% populated for
2025-2026, so a small number of rows cannot contribute a clean-sheet figure; and the calibration
report reports 2,520 match rows skipped for an unresolvable `player_code`. Count both, report both,
fix neither here.

**This is Tier 2** — it establishes the measurement other model work will be judged by. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/calibration-report.ts`,
`scripts/lib/solver-output.ts` and `scripts/store-chip-advisory.ts`; the other owns
`scripts/build-solver-input.ts`, `src/lib/chips/`, `src/screens/ChipsScreen.tsx` and
`docs/solver-notes.md`. This ticket touches none of them — **this ticket owns
`docs/projection-model-backlog.md` for this batch.**

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts` (new), `scripts/run-backtest.test.ts` (new)
- `.github/workflows/backtest.yml` (new)
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` or `src/` changes. No other workflow file is
touched. No existing file under `scripts/` is modified — `calibration-report.ts`,
`build-solver-input.ts`, `build-feature-history.ts`, `project-points.ts` and `lib/solver-output.ts`
are all left alone. `docs/solver-notes.md` is not modified.
