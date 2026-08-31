## Context

**Forward assists are the last component outside ±10% on either instrument, and the obvious fix has
already been applied and did not work.**

Calibration report, 31 Aug 2026 — the first run since #155 fixed its population mismatch, so these
ratios are trustworthy:

| Position | Assists, actual pts/90 | Assists, projected pts/90 | Ratio |
|---|---|---|---|
| Goalkeeper | 0.01 | 0.02 | 1.12x |
| Defender | 0.24 | 0.23 | 0.93x |
| Midfielder | 0.51 | 0.51 | 1.00x |
| **Forward** | **0.40** | **0.27** | **0.67x** |

Every other component at every other position now sits between 0.90x and 1.10x. Forwards' assists do
not, and the figure has moved the wrong way across three runs (0.79x → 0.72x → 0.67x).

**The conversion factor is not the cause, and this is what makes the ticket interesting.** Ticket
#148 measured forwards' actual-assists-to-xA ratio directly from FPL-Core-Insights
(107 / 50.556239 = 2.116455, n=1515 player-matches, 66 players) and set
`ASSIST_CONVERSION_FORWARD = 2.12`. That correction is already applied on every projection. Forwards
are still 33% short.

**So the gap is upstream of the conversion**, in the rate itself: `xaPer90` for forwards, as produced
by `src/lib/projection/rates.ts`'s two-stage shrinkage. Two candidate mechanisms, and **choosing
between them from this evidence alone would be guessing:**

- **The position prior is dragging forwards down.** `positionPriorRates` is computed from whatever
  Premier League rows the job reads across both ingested seasons. If the forward population's xA
  distribution is heavily skewed — a few high-creativity forwards against many who create nothing —
  the mean prior sits below the players who actually get recommended, and shrinkage pulls every
  forward toward it.
- **The population being projected is not the population being measured.** The projected side
  averages 73 distinct forwards; the actual side has 48. If the extra 25 are low-minutes squad
  forwards, the projected mean is diluted in a way the appearance-weighting does not fully correct.

Note also that this ratio moved between the 30 and 31 Aug runs (0.72x → 0.67x) while **no ticket
touched assists** — #162 changed goals only. The projected population grew from 4,330 to 4,345 rows
over the same period. **That drift is itself a finding to explain**, not to ignore.

Depends on #148, #155, #159, #160, #162 — all merged. Nothing unmerged.

## Scope

**In scope:**

- **A diagnostic, recorded in the decisions file, that distinguishes the two mechanisms above**
  before any constant changes. At minimum: the forward xA-per-90 distribution (not just its mean) in
  the ingested seasons, the position prior's value, and how far a typical recommended forward is
  shrunk from his own rate toward it.
- **A fix derived from that diagnostic**, in `src/lib/projection/` — whether that is a
  position-specific shrinkage constant, a change to how the forward position prior is computed, or
  a documented conclusion that the model is right and the instrument is wrong.
- **Whatever constant the fix introduces is a named export with the measurement, sample size, season
  and date in its comment**, and is clamped, exactly as `ASSIST_CONVERSION_FORWARD` is.

**Explicitly out of scope:**

- **No change to `ASSIST_CONVERSION_FORWARD` or any other assist conversion factor.** Those were
  measured directly from source and are not the cause. Changing one to close the gap would be
  fitting a constant to an error whose mechanism is unexplained.
- **No change to goals, clean sheets, appearance, saves, defensive contribution or bonus.** Exactly
  one term moves.
- **No change to `attackingMultiplier`, `fixture.ts`, or `minutes.ts`.** Midfielder assists sit at
  1.00x through the identical multiplier and minutes model.
- **No change to any file under `scripts/`.** `run-backtest.ts` is owned by another ticket in this
  batch; `calibration-report.ts` picks this up on its next run.
- **No new data source, no ingested column, no migration, no UI.**
- **No edit to `docs/projection-model-backlog.md`.**

## Definition of done

- [ ] The diagnostic is recorded in `decisions/ticket-<number>.md` with its numbers and sample sizes,
      and **states which mechanism it supports and which it rules out.**
- [ ] **If the diagnostic shows the model is right and the report is wrong, say so and change no
      model code.** That is a valid and valuable outcome of this ticket, not a failure. The decisions
      file explains why, and the ticket ships with a reporting-side note only.
- [ ] Any constant introduced is a named export, commented with its measurement, and clamped to a
      stated range with a named test proving the clamp binds.
- [ ] **Nothing else in the component set changes.** A test asserts every other component is
      byte-identical for a fixed input. **The most important test in the ticket.**
- [ ] Goalkeeper, defender and midfielder assist output is unchanged for a fixed input. Named test.
- [ ] **No exported signature in `src/lib/projection/` changes.** New exports are additive only —
      another ticket in this batch edits `scripts/` files that import this module.
- [ ] Every existing test that does not concern forward assists passes **unmodified**. Any changed
      expected value is computed by hand in the test's own comment.
- [ ] `src/lib/projection/` stays pure: no I/O, no clock, no environment.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the human check after merge is running `project-points`,
      then dispatching `Calibration report` and confirming **forward assists move from 0.67x toward
      1.00x while defender (0.93x) and midfielder (1.00x) assists stay put.** If midfielders move,
      the change leaked. **What will NOT change:** the backtest's aggregate assists figure is
      dominated by midfielders and will barely move — judge this on the calibration report's
      per-position assist ratio only.

## Notes for the Analyst / Builder

**Measure before correcting. This is the whole discipline of the ticket.**
`LEARNINGS-second-build-wave.md` §3 records what happens otherwise. #148 already applied the obvious
correction to this exact term and the gap survived it — a second blind correction on top would be
fitting noise.

**The 0.72x → 0.67x drift with no assist code change is a lead, not a nuisance.** If the ratio moves
when the population moves, the population is part of the mechanism, and that points at the second
explanation above rather than the first.

**Forwards are the position with the fewest players and the widest spread.** 48 distinct players on
the actual side. Any conclusion drawn from a mean alone is weak; look at the distribution.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*, including the diagnostic's numbers.

**Two other tickets are running in this batch.** One owns `scripts/ingest-core-insights.ts`,
`scripts/build-feature-history.ts`, a new migration and `supabase/README.md`; the other owns
`src/screens/` and `src/components/`. This ticket touches none of them.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/rates.ts`, `src/lib/projection/rates.test.ts`
- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/`, `src/screens/`,
`src/components/`, `src/lib/scoring/` or `.github/` changes. `src/lib/projection/fixture.ts`,
`minutes.ts`, `defconRate.ts`, `bonus.ts` and `pointValues.ts` are not modified. No exported
signature in `src/lib/projection/` changes; new exports are additive only. No dependency is added,
removed or upgraded.
