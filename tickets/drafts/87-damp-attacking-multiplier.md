## Context

**The model exaggerates how much a fixture matters for attacking output, and the correct slope has
been measured.**

`src/lib/projection/fixture.ts` scales every attacking term by:

```ts
attackingMultiplier(expectedScoreValue) = clamp(2 * expectedScoreValue, 0, 2)
```

so a team with `expectedScore = 1.0` is projected for **twice** the attacking output of an even
fixture and **infinitely more** than a hopeless one.

`docs/model-review-2026-09-02.md` tested that directly: it bucketed **actual** goals by the
point-in-time `expectedScore` each row would have received, over the 2025-2026 measured population,
and fitted the observed relationship. **The real slope is roughly half the model's — about 1.43 goals
per unit of `expectedScore` against the model's 2.9.** A damped form,
`0.5 + expectedScore`, fits the buckets almost exactly: same slope ratio (1.0 against the current
2.0), and — importantly — **identical at `expectedScore = 0.5`, so an even fixture is unchanged.**

Measured effect on ranking: **+0.013 for forwards on a single gameweek, +0.012 for midfielders on the
five-gameweek horizon the solver actually optimises.** Small, real, and the only genuine model defect
the review found.

**This also answers `docs/projection-model-backlog.md` G8 in reverse.** G8 suspected fixture
sensitivity was *too narrow*. For the attacking terms it is **too wide.**

**One term only, and this constraint is the ticket.** `expectedGoalsConceded` and
`defensiveMultiplier` use the mirror form `2 × (1 − expectedScore)` and **have not been measured.**
Changing them on the strength of this finding would be assuming the defensive side has the same
slope, which nothing here establishes — and it would make the next report unattributable.

Depends on #162, #175, #177 — all merged. Nothing unmerged.

## Scope

**In scope:**

- **Reproduce the measurement before changing anything.** Bucket actual goals by point-in-time
  `expectedScore` from the FPL-Core-Insights source, over 2025-2026 Premier League matches, and
  confirm the fitted slope. Record the bucket table, its sample sizes and the fit in the decisions
  file.
- **Damp `attackingMultiplier`** to the measured form, as a named exported constant or constants with
  the measurement, sample size, season and date in the comment — the same structure
  `assistConversionFactor` and the goal conversion factors already use.
- **A clamp with stated bounds**, and a comment saying which end is arithmetic and which is a
  judgement.
- **`modelInputs` surfaces the applied multiplier**, alongside the existing `savesMultiplier`, so the
  reasoning screen and any future calibration can see it.

**Explicitly out of scope:**

- **No change to `defensiveMultiplier`, `expectedGoalsConceded`, or the clean-sheet path.**
  Unmeasured, mirror-formed, and a separate question. **The existing test asserting
  `expectedGoalsConceded(b, s) === b * defensiveMultiplier(s)` must still pass unmodified** — that
  identity is between the two defensive functions and this ticket touches neither.
- **No change to `expectedScore` itself, the elo mapping, the FDR fallback, or
  `LEAGUE_BASELINE_GOALS_PER_TEAM`.**
- **No change to assists' or goals' conversion factors** (#148, #162). Those are level calibrations
  and the review measured them as rank-neutral; layering a third multiplier on the same term is what
  #168 refused to do.
- **No change to minutes, shrinkage, defcon, saves, bonus or appearance.**
- **No change to any file under `scripts/`.** Both `run-backtest.ts` and `calibration-report.ts` pick
  this up on their next run, which is the point.
- **No edit to `docs/projection-model-backlog.md`**, including G8, even though this finding bears on
  it directly. Record it in the decisions file; the backlog is updated separately.

## Definition of done

- [ ] The bucket table, its sample sizes, the fitted slope and the resulting form are recorded in
      `decisions/ticket-<number>.md`. **If the reproduction disagrees materially with the review's
      figure, stop and report rather than shipping either number.**
- [ ] `attackingMultiplier` uses the measured form, with named constants carrying the measurement in
      their comments. **No hand-chosen literal.** Grep-checkable: each value appears exactly once.
- [ ] **`attackingMultiplier(0.5)` returns exactly `1.0`** — an even fixture is unchanged, which is
      what keeps the backtest's neutral-fallback rows comparable to previous runs. **Named test, and
      the most important one in the ticket.**
- [ ] The multiplier is clamped to a stated range, with a named test proving a value outside it is
      clamped rather than applied.
- [ ] **Nothing else in the component set changes.** A test asserts every other component is
      byte-identical for a fixed input at a fixed `expectedScore`. Clean sheets, goals conceded and
      saves in particular must not move.
- [ ] `modelInputs` carries the applied attacking multiplier.
- [ ] **No exported signature in `src/lib/projection/` changes.** New exports are additive only —
      another ticket in this batch edits `scripts/run-backtest.ts`, which imports this module.
- [ ] Every existing test that does not concern the attacking multiplier passes **unmodified**. Any
      changed expected value is computed by hand in the test's own comment, never copied from failing
      output.
- [ ] `src/lib/projection/` stays pure: no I/O, no clock, no environment.
- [ ] Nothing under `scripts/`, `supabase/`, `docs/`, `src/screens/`, `src/components/` or `.github/`
      is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic, not that the damped form is
      closer to reality. The human check after merge is running `project-points`, then dispatching
      `Backtest` and `Calibration report` and confirming **forward and midfielder Spearman rise by
      roughly the predicted amounts (+0.013 and +0.012 respectively) and goals stay calibrated near
      1.00x–1.05x.** **What will NOT change:** goalkeeper and defender ranking barely move — their
      points are dominated by clean sheets and defensive contributions, which this ticket does not
      touch. **A large movement in clean sheets means the change leaked into the defensive path.**

## Notes for the Analyst / Builder

**Measure first, then correct. The review already did it, and you are reproducing it, not trusting
it.** `LEARNINGS-second-build-wave.md` §3 records what happens when a plausible correction is applied
to a number nobody decomposed. The reproduction is cheap — the source CSVs are fetchable and #148,
#162 and #168 all used exactly this method.

**Preserving `attackingMultiplier(0.5) === 1.0` is not cosmetic.** The backtest falls back to a
neutral fixture for teams with under three prior matches, and every pre-#175 report was computed
entirely at that point. Keeping the neutral value exact is what makes the next report comparable to
the last one.

**Do not touch the defensive mirror, however tempting the symmetry.** The two functions were built to
mirror each other deliberately, and `fixture.ts` says so. **Breaking the symmetry on measured
evidence for one side is correct; extending an unmeasured assumption to the other is not.** Note in
the decisions file that the defensive slope is now unmeasured and asymmetric, and that measuring it is
a follow-up.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*, including the bucket table.

**Two other tickets are running in this batch**, owning `scripts/build-feature-history.ts` plus a
migration, and `scripts/run-backtest.ts`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/fixture.ts`, `src/lib/projection/fixture.test.ts`
- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts` — **only** to
  surface the applied multiplier in `modelInputs`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/`, `src/screens/`,
`src/components/` or `.github/` changes. `src/lib/projection/rates.ts`, `minutes.ts`,
`defconRate.ts`, `bonus.ts`, `pointValues.ts` and everything under `src/lib/scoring/` are not
modified. No exported signature in `src/lib/projection/` changes; new exports are additive only.
