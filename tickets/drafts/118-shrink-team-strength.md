## Problem

Ticket #235 works — 20 of 20 fixtures now resolve to the `team-strength`
source, and the club table is sensible in its ordering. But the numbers it
produces are far too extreme, and two of them are impossible.

From the diagnostic run against live data on 16 Sept 2026, gameweek 5:

| Team | Opponent | H/A | Point-in-time expectedScore |
|---|---|---|---|
| Nott'm Forest | Coventry City | H | **1.0000** |
| Coventry City | Nott'm Forest | A | **0.0000** |
| Leeds | Crystal Palace | H | 0.9926 |
| Crystal Palace | Leeds | A | 0.0074 |

An `expectedScore` of exactly 1.0 is not a strong fixture, it is a certainty.
Downstream in `src/lib/projection/expectedPoints.ts` it makes
`defensiveMultiplier` exactly 0, so `expectedGoalsConceded` is 0, so the
clean-sheet probability is 1.0 — **the model is projecting a guaranteed clean
sheet**, and the mirror row projects a team that cannot keep one. Both are in
live projections now.

### Cause

`SCALE = 5.6225` in `src/lib/projection/teamStrength.ts` was calibrated
against a FULL 2025-2026 season. Its own doc comment records the target it
was fitted to reproduce:

> Target (live elo-derived expectedScore, `player_projections.components`,
> rows where `eloFallbackUsed` is false): n = 3,181, mean = 0.5003,
> **population stdDev = 0.1701**

The same comment records the input distribution it was divided against:
`stdDev = 0.9564`, measured over 698 observations from a completed season.

After four matches the input distribution is nothing like that. A four-match
goal-difference-per-match rate has far higher variance than a thirty-eight
match one — Coventry sit at −2.50 and Brighton at +2.00, neither of which is
a real strength, both of which are small-sample artefacts. Dividing a much
wider input by a scale fitted to a much narrower one over-disperses the
output.

The diagnostic measured exactly that: point-in-time population stdDev
**0.2956** against a calibration target of **0.1701**. The construction is
74% over-dispersed relative to its own stated design target.

### The gate did not catch it

Gate 2 reads "point-in-time spread >= frozen-elo spread, and the columns are
not identical". Both halves passed. It is **one-sided**: it can only catch a
spread that is too narrow, never one that is too wide. A 74% overshoot
sailed through.

`LEARNINGS-second-build-wave.md` §21 recorded that a gate comparing new
against old passes vacuously when the new path does not run. This is the
neighbouring failure: a gate with a one-sided bound passes when the new path
runs far too hard. Both fixes belong in this ticket.

## The fix

### 1. Shrink the rate toward the league mean

The league mean goal difference per match is **exactly 0 by construction** —
every goal scored by one club is conceded by another, so the rates sum to
zero across the league. Shrinking toward it is therefore just:

```
shrunkTeamStrengthRate = (goalsScored - goalsConceded) / (matches + K)
```

which is precisely `shrunkRate(total, observedCount, prior)` from
`src/lib/projection/rates.ts` with `prior = 0`. **Import and reuse
`shrunkRate` unmodified.** Do not write a second shrinkage formula — this
repo already has one, `SHRINKAGE_K` is already the established pattern for
exactly this problem, and a divergent copy is how two implementations drift.

`teamStrengthRate` keeps its current unshrunk form and its current name — it
is the raw figure the diagnostic's club table reports, and that table is how
a human checks whether the ratings are sensible. Add the shrunk variant
alongside it; `computeFixtureExpectedScore` consumes the shrunk one.

### 2. Calibrate K, do not choose it

Fit `TEAM_STRENGTH_SHRINKAGE_K` so the resulting `expectedScore` population
stdDev over the current gameweek's fixtures matches the **0.1701** target
already documented in `SCALE`'s own comment. That target is not invented for
this ticket — it is the figure the whole construction was built to reproduce,
and hitting it is what makes `SCALE` valid again.

Computed ahead of the ticket, over gameweek 5's twenty rows, for orientation
only — **re-derive rather than trusting these**:

| K | resulting stdDev | rows clamped | range |
|---|---|---|---|
| 0 (today) | 0.2957 | 2 | 0.000 – 1.000 |
| 3 | 0.2021 | 0 | 0.153 – 0.847 |
| 5 | 0.1739 | 0 | 0.210 – 0.790 |
| 8 | 0.1502 | 0 | 0.259 – 0.741 |

Record the fitted value, the gameweek and population it was fitted on, the
target, and the date in the constant's doc comment, matching how `SCALE` and
`SHRINKAGE_K` document themselves. **Tier 2, log HIGH-IMPACT.**

State plainly in the comment that K was fitted on a single early-season
gameweek and must be re-derived once ten gameweeks are on record — as the
season lengthens, the raw rates naturally tighten and the right K falls.

### 3. Bound the output away from certainty

`computeFixtureExpectedScore` currently clamps to `[0, 1]` via `clampUnit`.
Replace that with a clamp to `[MIN_EXPECTED_SCORE, MAX_EXPECTED_SCORE]` =
`[0.05, 0.95]`.

No football fixture is a certainty. An expectedScore of 0 or 1 propagates
into a zero or maximal multiplier and a clean-sheet probability of 0 or 1,
which are not predictions but assertions. This is a **guard, not a
substitute** for the shrinkage above — with a correctly fitted K nothing
should come near it, and the gate below requires exactly that. Tier 3.

The FDR and elo paths are untouched; elo's own logistic curve is already
asymptotic and never reaches 0 or 1.

### 4. Make the gate two-sided

In `scripts/team-strength-diagnostic.ts`, gate 2 becomes a band, not a floor:
the point-in-time population stdDev must fall within **[0.14, 0.20]** — a
reasonable window around the 0.1701 calibration target. Too narrow means the
fixture signal has been shrunk away; too wide means what happened here.

Add gate 4: **no fixture's expectedScore may fall outside [0.10, 0.90]**. If
any does, the shrinkage is insufficient regardless of what the aggregate
stdDev says, and the job must exit non-zero.

## Falsification gate

Run `scripts/team-strength-diagnostic.ts` against live data. **Stop and
report — do not merge — unless all four hold:**

1. At least one fixture resolves to source `team-strength` (the existing
   liveness condition, unchanged).
2. The point-in-time population stdDev falls within **[0.14, 0.20]**.
3. **No fixture's expectedScore falls outside [0.10, 0.90].** Specifically,
   Nott'm Forest v Coventry City must no longer be 1.0000/0.0000.
4. The club table's ORDERING is unchanged from the 16 Sept run — shrinking
   every rate by the same denominator is monotonic, so it cannot reorder the
   table. If the order changes, the shrinkage was applied wrongly (per-club
   match counts differing, or applied before aggregation). Chelsea must still
   rank above Man Utd.

Paste the full report into the PR body.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- `shrunkRate` is imported from `rates.ts`, not reimplemented.
- Named tests: `K = 0` reproduces today's unshrunk rate exactly; a club with
  more matches is shrunk proportionally less; the clamp bounds hold at both
  ends; two clubs with identical records still produce exactly 0.5 plus the
  home term; the club table's raw `teamStrengthRate` is unchanged by this
  ticket.
- Named test that the diagnostic exits non-zero when any fixture falls
  outside [0.10, 0.90], and when the stdDev falls outside [0.14, 0.20].

## Out of scope

- `SCALE` itself. It is correct for the distribution it was fitted on; this
  ticket restores that distribution rather than re-fitting the scale to a
  broken one. Changing both at once makes neither measurable.
- `src/lib/projection/expectedPoints.ts` and its precedence. Ticket #117
  rewrites that function and must not collide — do not touch the file.
- `scripts/project-points.ts`, `scripts/preflight-check.ts`,
  `src/lib/projection/bonus.ts`.
- The attacking/defensive multiplier asymmetry (#184's damping). It needs a
  trustworthy expectedScore first, which is what this ticket delivers, so it
  is the ticket after next.
- `scripts/run-backtest.ts`. It calls `computeFixtureExpectedScore` over
  completed seasons where the rates are already season-length and need no
  shrinkage. Default `K = 0` on the path it uses so its behaviour is
  byte-identical, and assert that with a named test.

## Files

- `src/lib/projection/teamStrength.ts`
- `src/lib/projection/teamStrength.test.ts`
- `scripts/team-strength-diagnostic.ts`
- `scripts/team-strength-diagnostic.test.ts`
