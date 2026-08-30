## Context

**Defender goals are now the largest single calibration error in the model, and it is specific to
defenders.** From the calibration report of 30 Aug 2026 — the first run of that instrument since
ticket #155 fixed its population mismatch, and therefore the first one whose ratios can be read:

| Position | Goals, actual pts/90 | Goals, projected pts/90 | Ratio (proj/actual) |
|---|---|---|---|
| **Defender** | **0.27** | **0.38** | **1.38x** |
| Midfielder | 0.77 | 0.79 | 1.02x |
| Forward | 1.74 | 1.78 | 1.02x |

Nothing else in that report sits outside [0.90x, 1.10x] except forward assists (0.72x, a separate
question). Midfielders and forwards run through the **same** `attackingMultiplier`, the **same**
minutes model and the **same** `xgPer90`, and both are calibrated — which localises the gap to the
xG-to-goals step for defenders specifically, exactly as ticket #148 localised the xA-to-assist step.

### The measurement, taken before this ticket was written

Actual goals divided by summed xG, per position, computed directly from FPL-Core-Insights'
per-gameweek `playermatchstats.csv` files — the same source `scripts/ingest-core-insights.ts` reads —
for season 2025-2026, Premier League matches only, with position resolved from that season's own
`players.csv`. **This is the identical method and the identical source ticket #148 used**, and it
reproduces #148's published assist figures exactly (defenders 237 / 182.908110 = 1.295733), so the
pipeline behind these numbers is already verified against a merged ticket.

| Position | Goals | Sum xG | Ratio (actual/xG) | Sample |
|---|---|---|---|---|
| Goalkeeper | 0 | 0.160000 | — (undefined) | n=1026 player-matches, 56 players |
| **Defender** | **137** | **180.862900** | **0.757480** | n=4450 player-matches, 189 players |
| Midfielder | 533 | 542.257100 | 0.982929 | n=5763 player-matches, 254 players |
| Forward | 335 | 343.627900 | 0.974892 | n=1515 player-matches, 66 players |

**Two independent instruments agree.** The calibration report's 1.38x implies a conversion of
1/1.38 = 0.72; the direct source measurement gives 0.757. Midfielders and forwards measure at 0.98
and 0.97 against calibration ratios of 1.02x and 1.02x. **The defender gap is real and it is roughly
a quarter of their projected goal output.**

### Why defenders under-convert xG, as the *because*

A defender's xG is dominated by set-piece headers and scrambles in crowded boxes. xG models rate a
chance by its location and type; defenders are worse finishers than the population average from
those same positions, and defender shots more often come under contact. The gap is a property of
**who** is taking the chance, which is precisely what a per-position conversion factor is for.

### Goalkeepers have no measurable ratio and must not get one

Zero goals across 1,026 player-matches against 0.16 total xG. **A ratio of 0/0.16 is not a
measurement**, and setting the factor to 0.0 would assert a goalkeeper can never score, which is
false. The term is numerically irrelevant either way — 0.16 xG across a whole season is under
0.0002 per match — so the honest value is **1.0, no adjustment**, explicitly labelled as
no-information rather than measured.

Depends on #148 (merged, the pattern this follows), #152, #154 and #155 — all merged. Nothing
unmerged.

## Scope

**In scope:**

- **A position-specific goal conversion factor**, applied to `expectedGoals` in
  `src/lib/projection/expectedPoints.ts`, **structured exactly like #148's
  `assistConversionFactor`** — named exported constant per position, a `switch` with one explicit
  case per position including goalkeeper, `assertNeverPosition` as the only `default`, and a clamp.
- **Each constant carries the measurement in its comment** — the raw ratio, the sample size, the
  season, the source, and the date — matching #148's constants byte-for-byte in style.
- **A clamp with stated bounds**, so a future re-measurement on thin data cannot swing every
  projection.
- **`expectedGoals` surfaced in `modelInputs`**, alongside the `expectedAssists` field #148 added,
  so the reasoning screen and any future calibration see the adjusted figure and not only the points.

**Explicitly out of scope:**

- **No change to assists, clean sheets, appearance, saves, defensive contribution, goals conceded or
  bonus.** Exactly one term moves, so its effect on the next report is attributable. This is the
  single most important constraint in the ticket.
- **No change to `attackingMultiplier`, `expectedScore`, `fixture.ts`, or the FDR fallback.**
  Midfielders and forwards at 1.02x prove the fixture multiplier is not the cause.
- **No change to `xgPer90`, `rates.ts`, or the shrinkage.** The rate is what the source reports; the
  conversion is the layer above it.
- **No change to `GOAL_POINTS` or any scoring constant.** A defender's goal is still worth what FPL
  says it is worth — this ticket changes how many goals are expected, not what one is worth.
- **No change to any file under `scripts/`.** `run-backtest.ts` and `calibration-report.ts` both pick
  this up on their next run, which is the point.
- **No new data source, no new ingested column, no migration, no UI.**
- **No edit to `docs/projection-model-backlog.md`.** Record the measurement in this ticket's
  decisions file.

## Definition of done

- [ ] A named exported constant per position holds that position's goal conversion factor, each
      commented with its raw measured ratio, sample size, season and source.
- [ ] **The constants are the measured values, rounded to two decimals** — defender `0.76`,
      midfielder `0.98`, forward `0.97` — and **goalkeeper is `1.0`, commented as no-information
      (0 goals in 1,026 player-matches, 0.16 total xG) rather than as a measurement.** No
      hand-chosen literal anywhere. Grep-checkable: each value appears exactly once.
- [ ] The factor is clamped to a stated range that **does not bind any of the four values above**,
      and a named test asserts a value outside the range is clamped rather than applied.
- [ ] `expectedGoals` is multiplied by the position's factor in `projectPlayerFixture`, and
      **nothing else in the component set changes.** A test asserts every other component is
      byte-identical for a fixed input. **This is the most important test in the ticket** — the same
      item that carried #148.
- [ ] A goalkeeper's goal term is handled by its own explicit `switch` case, not by a default.
      Named test.
- [ ] `modelInputs` carries the adjusted `expectedGoals`.
- [ ] **No exported signature in `src/lib/projection/` changes** — no parameter added, removed or
      retyped on any existing export. New exports are additive only. **This is a hard constraint,
      not a preference:** another ticket in this batch edits `scripts/run-backtest.ts`, which imports
      this module, and a signature change breaks `tsc -b` on the second merge even though the file
      lists are disjoint (`LEARNINGS-second-build-wave.md` §11).
- [ ] Every existing test in `expectedPoints.test.ts` that does not concern goals passes
      **unmodified**. Any goals test that legitimately changes has its new expected value
      **computed by hand in the test's own comment**, never copied from the failing output.
- [ ] `src/lib/projection/` stays pure: no I/O, no clock, no environment.
- [ ] Nothing under `scripts/`, `supabase/`, `docs/`, `src/screens/`, `src/components/` or
      `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic, not that the corrected
      figure is closer to reality. The human check after merge is running `project-points`, then
      dispatching `Calibration report` and confirming **the defender goals ratio moves from 1.38x
      toward 1.00x while midfielder and forward goals stay near 1.02x.** **What will NOT change,
      and must not be read as a regression:** the backtest's aggregate goals signed error currently
      reads exactly **0.000**, which is an offsetting average — defenders over, others near
      calibrated — so **this ticket will push that aggregate figure negative.** That is the ticket
      working. **Judge this ticket on the calibration report's per-position goals ratio, never on
      the backtest's aggregate goals line.**

## Notes for the Analyst / Builder

**The measurement already exists — do not re-derive it, and do not re-run the fetch.** The table in
Context was computed before this ticket was written, from the source, by the same method ticket #148
used, and it reproduces #148's own published assist numbers exactly as a cross-check. Copy the four
ratios into the constants and record the table in `decisions/ticket-<number>.md`. **If you believe a
number is wrong, say so and stop** rather than substituting your own.

**Why per-position rather than one factor, as its *because*.** Defenders measure 0.757 against
midfielders' 0.983 and forwards' 0.975. **Because** a single factor fitted across all positions would
under-correct defenders and wrongly suppress midfielders and forwards — and the captaincy decision
turns on exactly the comparison between a defender and an attacker (`docs/projection-model-backlog.md`
G7), a flat factor would move the wrong players down the list.

**This ticket is #148 for goals, and it should read like it.** `assistConversionFactor` and its four
constants in `expectedPoints.ts` are the template: same comment structure, same clamp pattern, same
explicit goalkeeper case, same `assertNeverPosition` default. **Match it deliberately** — two nearly
identical mechanisms written two different ways is a maintenance trap.

**Adding `expectedGoals` to `FixtureModelInputs` was checked, not assumed — re-verify it anyway.**
Adding a required field to an exported interface breaks any consumer that constructs it as a
literal. `grep -rn "FixtureModelInputs" scripts/` was run while writing this ticket: the only hits
are comments and one structural single-field read in `scripts/calibration-report.ts`, and
`scripts/run-backtest.ts` — the file the companion ticket edits — does not reference it at all. **Run
that grep again before adding the field**, and if a literal construction exists anywhere under
`scripts/` or `src/`, make the field optional and say so in the decisions log rather than editing
the consumer, which is out of scope.

**The clamp bounds are a judgement and the comment must say so** (`LEARNINGS-second-build-wave.md`
§16d). The measured values span 0.757 to 0.983. Bounds must leave all four untouched while still
catching a wild future re-measurement; the upper bound is not 1.0 — a position genuinely could
out-convert its xG — and the comment should state that rather than implying an arithmetic ceiling.
**The previous ticket in this project to assert an arithmetic ceiling from intuition was wrong twice
in a row** (the appearance per-90 bound, #155 follow-up). Do not repeat it.

**G7 is affected and the decisions log should note it.** `docs/projection-model-backlog.md` G7 asks
whether a defender is ever the right captain, and records that the model captained a defender in
four of five gameweeks. This ticket cuts defender goal output by roughly a quarter, which moves that
question — **but it does not settle it**, because defender projections are dominated by appearance,
clean sheet and defensive contribution, not goals. Say that plainly rather than claiming G7 is
closed.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*, including the four measured ratios and their sample sizes.

**Two other tickets are running in this batch.** One owns `scripts/run-backtest.ts`; the other owns
`scripts/build-solver-input.ts`, `scripts/store-squad-advisory.ts` and `docs/solver-notes.md`. This
ticket touches none of them — **do not edit `docs/projection-model-backlog.md` either**; it is named
in neither ticket's scope and belongs to nobody this batch.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/`, `src/screens/`,
`src/components/` or `.github/` changes. `src/lib/projection/rates.ts`,
`src/lib/projection/fixture.ts`, `src/lib/projection/minutes.ts`,
`src/lib/projection/defconRate.ts`, `src/lib/projection/bonus.ts`,
`src/lib/projection/pointValues.ts` and everything under `src/lib/scoring/` are not modified. No
exported signature in `src/lib/projection/` changes; new exports are additive only. No dependency is
added, removed or upgraded. No build configuration changes.
