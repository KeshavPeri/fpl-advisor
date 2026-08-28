## Context

**Assists are the second-largest component error in the model, and two independent instruments agree
on it.**

Backtest, point-in-time, across 8,590 measured player-gameweeks:

| Component | Mean actual | Mean projected | Signed error |
|---|---|---|---|
| Assists | **0.264** | **0.169** | **−0.095** |

The model captures **64%** of assist points. Only defensive contribution is worse, and that one is
under suspicion of being a harness artefact — **this one is not.** The calibration report, built from
entirely different data on a different basis, reports the same direction at every position:

| Position | Assists, proj/actual |
|---|---|
| Defender | 0.74x |
| Midfielder | 0.78x |
| Forward | **0.43x** |

**Two instruments, two methods, same finding.** Goals are near-perfect on both (1.02x and 1.03x in
calibration; −0.006 in the backtest), so this is specific to assists rather than a general attacking
miscalibration.

### The likely mechanism, to be verified not assumed

`src/lib/projection/expectedPoints.ts` computes `expectedAssists = xaPer90 × minutesFraction ×
attackMultiplier`, then multiplies by the assist point value. **xA measures the quality of the chance
created, not whether it was converted** — and a chance is only an assist if the recipient scores.
That should make xA *lower* than actual assists on average only if the population converts above the
xA baseline, which is not obviously true; the more likely explanation is a definitional gap between
the source's xA and FPL's assist rule, which credits some assists xA does not model at all
(penalties won, own goals forced, second assists in some seasons).

**The forward figure is the tell.** 0.43x for forwards against 0.74–0.78x for defenders and
midfielders suggests it is not one flat conversion factor — whatever is missing is missing unevenly
by position.

**This ticket measures before it corrects.** Goals are right, so the fixture multiplier and the
minutes model are both working; the gap is specific and a blind scale factor would paper over
whatever it actually is.

Depends on #133 and #140 (merged). Nothing unmerged.

## Scope

**In scope:**

- **A diagnostic, in the pure projection module's own tests and in the decisions log**, establishing
  the ratio of actual assists to xA-derived expected assists **per position**, computed from
  `player_match_stats` for the ingested historical season. This is the number that decides whether
  one factor or four is correct.
- **A position-specific assist conversion factor** in `src/lib/projection/`, applied to
  `expectedAssists`, derived from that measurement — **not chosen by hand**.
- **The factor is a named exported constant per position** with a comment stating the measured
  ratio, the sample it came from, the date, and that it is a calibration rather than a model of
  anything.
- **The factor is clamped** to a stated range, so a future re-measurement on thin data cannot swing
  a projection wildly.
- **`expectedAssists` is surfaced in `modelInputs`** alongside the existing fields, so the reasoning
  screen and any future calibration can see the adjusted figure and not only the points.

**Explicitly out of scope:**

- **No change to goals, clean sheets, appearance, saves, defensive contribution or bonus.** Goals are
  measured at 1.02x and 1.03x — **the value of this ticket is that exactly one term moves**, so its
  effect on the next backtest is attributable.
- **No change to `attackingMultiplier`, `expectedScore`, the FDR fallback, or `fixture.ts`.**
- **No change to `xaPer90` itself, to `rates.ts`, or to the shrinkage.** The rate is what the source
  reports; the conversion is the layer above it.
- **No new data source and no new ingested column.**
- **No change to `scripts/run-backtest.ts` or `scripts/calibration-report.ts`.** Both are owned by
  other work and both will pick the change up on their next run, which is the point.
- **No migration, no UI, nothing under `supabase/` or `src/screens/`.**

## Definition of done

- [ ] The measured actual-to-expected assist ratio per position is recorded in
      `decisions/ticket-<number>.md`, with the sample size and the season it came from.
- [ ] A position-specific conversion factor exists as a named exported constant per position, each
      commented with the measurement behind it.
- [ ] **No hand-chosen literal.** Each factor is the measured ratio, rounded to two decimals, and the
      comment states the raw measurement. Grep-checkable: every factor appears exactly once.
- [ ] The factor is clamped to a stated range, and a test asserts a value outside it is clamped
      rather than applied.
- [ ] `expectedAssists` in `projectPlayerFixture` is multiplied by the position's factor, and
      **nothing else in the component set changes**. A test asserts every other component is
      byte-identical for a fixed input. **This is the most important test in the ticket.**
- [ ] A goalkeeper's assist term is handled explicitly rather than falling through to a default.
      Named test.
- [ ] `modelInputs` carries the adjusted `expectedAssists`.
- [ ] Every existing test in `expectedPoints.test.ts` that does not concern assists passes
      **unmodified**. Any assist test that legitimately changes has its new expected value
      **computed by hand in the test's own comment**, never copied from the failing output.
- [ ] `src/lib/projection/` stays pure: no I/O, no clock, no environment.
- [ ] Nothing under `scripts/`, `supabase/`, `src/screens/`, `src/components/` or `.github/` is
      added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic, not that the corrected
      figure is closer to reality. The human check after merge is running `project-points`, then
      dispatching `Backtest` and confirming **the assist signed error moves from −0.095 toward zero
      while every other component's error is unchanged.** If another component moves, the change
      leaked. If assists overshoot into positive territory, the factor is too aggressive and the
      clamp needs revisiting.

## Notes for the Analyst / Builder

**Measure first, and this is the whole discipline of the ticket.** `LEARNINGS-second-build-wave.md`
§3 records what happens otherwise: a plausible correction applied to a number nobody had decomposed,
and three tickets chasing a problem that did not exist. **The ratio must be computed from real match
data before a constant is written down**, and the measurement recorded so the next person can
re-derive it rather than trust it.

**Why per-position rather than one factor, as its *because*.** Forwards come out at 0.43x against
0.74–0.78x for defenders and midfielders. **Because** a single factor fitted across all four would
over-correct defenders and under-correct forwards, and the captaincy decision turns on exactly the
comparison between a forward and a defender, one flat number would move the wrong player up the
list. If the measurement comes back showing the positions are actually close, **say so and use one
factor** — the shape of the fix follows the data.

**Goals being right is the strongest evidence you have.** Goals are 1.02x and 1.03x on two
instruments, and they run through the *same* `attackingMultiplier` and the *same* minutes model as
assists. That rules out both as the cause and localises the gap to the xA-to-assist step. **Do not
adjust anything upstream of that step.**

**Clamp it, and say why in the comment.** A calibration constant derived from one season on one
source is a reasonable correction and a poor law. The clamp is what stops a future re-measurement on
thin data from swinging every projection.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*, including the measured ratios.

**Two other tickets may be running in this batch.** One owns `scripts/build-feature-history.ts`, a
new migration and `supabase/README.md`; the other owns `scripts/run-backtest.ts` and
`docs/projection-model-backlog.md`. This ticket touches neither — **do not edit
`docs/projection-model-backlog.md`**; record the measurement in this ticket's decisions file
instead.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts`
- `src/lib/projection/pointValues.ts`, `src/lib/projection/pointValues.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/`, `src/screens/`,
`src/components/` or `.github/` changes. `src/lib/projection/rates.ts`,
`src/lib/projection/fixture.ts`, `src/lib/projection/minutes.ts`,
`src/lib/projection/defconRate.ts`, `src/lib/projection/bonus.ts` and everything under
`src/lib/scoring/` are not modified.
