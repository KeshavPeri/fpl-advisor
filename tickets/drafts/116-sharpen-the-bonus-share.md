## Problem

The bonus allocator gets the total right and the shape wrong. It spreads the
six points too thinly, under-paying the players who actually win bonus by
roughly half.

First real measurement, from `scripts/bonus-validation-report.ts` run on
15 Sept 2026 against `gameweek_live_stats` (ticket #224 — the first
per-player bonus and BPS data this repo has ever had):

| Population | n | Mean projected | Mean actual | Signed error |
|---|---|---|---|---|
| Pooled, all matched players | 1867 | 0.064 | 0.103 | +0.039 |
| Pooled, top 20 projected | 60 | 0.224 | 0.433 | +0.209 |
| GW2, top 20 | 20 | 0.338 | 0.600 | +0.262 |
| GW3, top 20 | 20 | 0.334 | 0.400 | +0.066 |
| GW2, all players | 616 | 0.097 | 0.106 | +0.008 |
| GW3, all players | 652 | 0.092 | 0.098 | +0.006 |

Read those last two rows against the top-20 rows. Across the whole
population the allocator is within 0.008 — the LEVEL is right. Across the top
20 it is short by 0.26 and 0.07 — the DISTRIBUTION is wrong. Six points that
should be concentrated on three players are being smeared across fifty.

### Why

`allocateFixtureBonus` in `src/lib/projection/bonus.ts` gives each player a
share strictly linear in expected BPS above the appearance baseline:

```
const rawShare = (excessByEntry[index] / totalExcess) * TOTAL_BONUS_POINTS_PER_FIXTURE
```

Real bonus is not proportional. It is winner-take-most: 3, 2, 1 to exactly
three players and nothing to everyone else. A linear proportional share
cannot reproduce that shape at any scaling — it will always under-weight the
top of the distribution and over-weight the tail. This is a structural
mismatch between the allocator's form and the thing it models, not a
mis-tuned constant.

## The fix

Sharpen the share with a single exponent.

```
share_i = (excess_i ^ ALPHA) / Σ(excess_j ^ ALPHA) * 6
```

`ALPHA = 1` is exactly today's behaviour, so the change is a strict
generalisation. `ALPHA > 1` concentrates the six points on the highest-BPS
players. Normalising after raising to the power means the per-fixture total
stays 6 by construction, so **the level cannot break while the shape is being
fixed** — the one property that makes this a safe change.

The exception is clamping. More concentration means more players hitting
`MAX_BONUS_POINTS_PER_PLAYER_FIXTURE` (3.0), and this file deliberately drops
the clamped residual rather than redistributing it, so a fixture with a
clamped player sums to less than 6. The current report shows 0 clamped
player-fixtures. That count will rise. It must be measured, not assumed
harmless — see the gate.

### Calibrating ALPHA without fooling ourselves

Three gameweeks exist, and gameweek 1 is useless here: the allocator
projected 0.000 bonus for all 599 players because no current-season data
existed yet. That is a start-of-season artefact, not a share-shape problem,
and it carries no information about ALPHA.

That leaves gameweeks 2 and 3. Fitting on both and then scoring on both would
be circular.

- **Fit ALPHA on gameweek 2 only** (n = 616), by minimising the absolute
  signed error on the top-20-projected population.
- **Evaluate on gameweek 3 only** (n = 652), held out and never used in the
  fit. This is the number the gate reads.
- Report the pooled figure too, clearly labelled as in-sample for gameweek 2.

Store ALPHA as an exported named constant with the fitted value, the two
sample sizes, the fit/holdout split and the date in its doc comment — the
same convention `SCALE` in `teamStrength.ts` follows. This is CALIBRATED, not
chosen. Tier 2, log HIGH-IMPACT.

State plainly in the comment that two gameweeks is thin, that the instrument
gains exactly one gameweek per week, and that ALPHA must be re-fitted and
re-checked once ten finished gameweeks are on record. Add that as a G-entry
in `docs/projection-model-backlog.md`.

## Falsification gate

The premise is a causal claim about a measured number.

Re-run `scripts/bonus-validation-report.ts` after the change. **Stop and
report — do not merge — unless all three hold on GAMEWEEK 3, the held-out
gameweek:**

1. The top-20 mean signed error falls to below **0.033** in absolute terms —
   half its current 0.066. A change that does not halve the defect it was
   built to fix has not earned the added parameter.
2. The all-players mean signed error stays within **0.020** in absolute terms
   (currently 0.006). The level must not be traded for the shape.
3. The clamped player-fixture count and the mean per-fixture allocated total
   are both reported. If the mean total per fixture falls below **5.70**, the
   clamping residual is eating the pool and ALPHA is too aggressive — stop.

Paste the full before-and-after report into the PR body.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: `ALPHA = 1` reproduces today's allocation exactly; a higher
  ALPHA concentrates the share on the highest-excess entry; the per-fixture
  total is still 6 when nothing clamps; all-zero excess still returns all
  zeroes with no divide-by-zero; a clamped entry still leaves its residual
  unallocated rather than redistributing it.
- `scripts/bonus-validation-report.ts` reports the clamped count and the mean
  per-fixture allocated total, which it does not today.
- The G3 entry in `docs/projection-model-backlog.md` is corrected. It
  currently states that validating the bonus allocator is permanently
  impossible because `player_match_stats` carries neither bonus nor BPS.
  Ticket #224 made it possible and this ticket acts on it. Leave the
  historical reasoning, mark it superseded, and say what replaced it.

## Out of scope

- Gameweek 1 projecting 0.000 bonus for every player. It is correct given no
  prior data, it happens once a season, and fixing it means inventing a
  start-of-season prior — a separate question with its own evidence bar.
- `expectedBps` and `nonAppearanceBps`. This ticket changes how the shares
  are SPREAD, never how BPS itself is estimated. If the fit says the problem
  is in the BPS estimate rather than the share shape, stop and report rather
  than widening scope.
- Predicting exact 1st/2nd/3rd placings. The allocator models the
  distribution and is not being turned into a ranker.
- `scripts/project-points.ts`. `allocateFixtureBonus`'s signature does not
  change, so its call site does not either. If it turns out the call site
  must change, stop and report — two other tickets in this batch touch that
  file.
- `scripts/preflight-check.ts` and `src/lib/projection/teamStrength.ts`.

## Files

- `src/lib/projection/bonus.ts`
- `src/lib/projection/bonus.test.ts`
- `scripts/bonus-validation-report.ts`
- `scripts/bonus-validation-report.test.ts`
- `docs/projection-model-backlog.md`
