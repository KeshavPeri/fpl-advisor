## Problem

The attacking side of the fixture term was measured and damped. The
defensive side was never measured at all, and it is still running at twice
the slope.

`src/lib/projection/fixture.ts`:

```
attackingMultiplier(es)   = clamp(0.5 + es, 0, 2)          slope 1
defensiveMultiplier(es)   = clamp(2 * (1 - es), 0, 2)      slope -2
expectedGoalsConceded(b, es) = max(0, b * 2 * (1 - es))    slope -2b
```

Ticket #184 damped the attacking multiplier from slope 2 to slope 1 on real
evidence — actual team goals scored bucketed by point-in-time
`expectedScore` over every resolvable 2025-2026 Premier League team-match,
n = 698, fitted slope ≈1.43 goals per unit of `expectedScore` against the
model's implied 2.9. The derivation is in `fixture.ts`'s own comment and
`docs/model-review-2026-09-02.md` §1b. That work is sound and is **not** in
question here.

What #184 explicitly did not do is run the same measurement on goals
CONCEDED. Its own comment says the defensive forms are "explicitly
UNTOUCHED by this ticket", and `docs/projection-model-backlog.md`'s G12
records the asymmetry as an open question.

### Why it matters now

The consequence is visible in live projections. In gameweek 4, across the
whole league, the attacking multiplier spanned roughly 1.3× while the
defensive multiplier spanned 2.5× — from 0.39 to 0.97. A favoured team's
expected goals conceded is being pushed down twice as hard as its expected
goals scored is being pushed up.

Expected goals conceded feeds the clean-sheet probability in
`expectedPoints.ts`, and clean sheets are most of a defender's and all of a
goalkeeper's fixture-driven value. If the defensive slope is overstated the
way the attacking one was, then every defender and goalkeeper in a good
fixture is being over-projected, and every one in a bad fixture
under-projected — systematically, all season.

This was not worth measuring while the fixture term itself was broken.
Tickets #235 and #242 fixed that: `expectedScore` now comes from this
season's own results, is correctly dispersed (population stdDev 0.1737
against a 0.1701 target), and is bounded away from certainty. The instrument
is trustworthy, so the measurement is now worth making.

## The work

Add `scripts/fixture-slope-report.ts`, writing to
`./out/fixture-slope-report.md`. Read-only — it changes nothing on its own.

Measure actual team goals CONCEDED bucketed by point-in-time
`expectedScore`, over the SAME population, the SAME buckets and the SAME
method #184 used for goals scored, so the two are directly comparable:

- Every resolvable 2025-2026 Premier League team-match.
- Buckets `0.00–0.35`, `0.35–0.45`, `0.45–0.55`, `0.55–0.65`, `0.65–1.01`.
- Reuse `buildTeamMatchRecords`, `computeTeamStrengthAsOf`,
  `computeFixtureExpectedScore` and `SCALE` from
  `src/lib/projection/teamStrength.ts` **unmodified**. Pass
  `TEAM_STRENGTH_SHRINKAGE_K = 0` on this path — the rates here are already
  season-length, which is the regime `SCALE` was fitted on, and shrinking
  them would move the x-axis away from the one #184's attacking figures were
  measured against. Say so in the code comment.
- A club's goals conceded in a match is the MAX across its own players'
  `team_goals_conceded` rows, exactly as `buildTeamMatchRecords` already
  does it. Never the average, never the first row.

Report, per bucket: n, mean `expectedScore`, mean actual goals conceded, and
what the current model predicts (`leagueBaselineGoals × 2 × (1 − es)`).
Report the fitted slope two ways, matching #184's own presentation: the
extreme-bucket endpoint slope, and a weighted least-squares fit over the five
bucket means.

Also reproduce #184's goals-SCORED table in the same report, from the same
run. Two slopes measured by one method on one population is the only way to
say anything honest about whether the asymmetry is real.

### Then act on what it says

**If the measured conceded slope is materially flatter than −2.9** — outside
±15% of it — damp `expectedGoalsConceded` and `defensiveMultiplier` to match
the measured value, in the same shape #184 used for attack:
`leagueBaselineGoals × (OFFSET − es)` with `OFFSET` set so the slope matches
the measurement and an even fixture (`es = 0.5`) still yields exactly
`leagueBaselineGoals`. Record the fitted value, the population, the two
slope figures and the date in the constant's doc comment, matching how
`ATTACKING_MULTIPLIER_OFFSET` documents itself. **Tier 2, log HIGH-IMPACT.**

**If it is within ±15% of −2.9**, change nothing in `fixture.ts`. The
asymmetry is real, defence genuinely does respond to fixture difficulty
about twice as hard as attack does, and that is a finding worth having. Ship
the report and the corrected G12 entry alone.

Both outcomes are a successful ticket. Do not reach for the first one.

## Falsification gate

The premise is a causal claim about a measured number, so it needs a figure
that must move and a stop condition.

1. The report must cover **at least 600 resolvable team-matches**. #184 had
   698; materially fewer means the reconstruction is dropping rows and the
   slope is not comparable to the one it is being judged against.
2. The goals-SCORED table this report reproduces must match #184's published
   bucket means **within 0.05 goals in every bucket**. It is the same
   measurement on the same data, so if it does not reproduce, the harness is
   wrong and nothing else in the report can be trusted. **Stop and report.**
3. If `fixture.ts` changes, run `scripts/calibration-report.ts` before and
   after. **Goalkeeper and defender clean-sheet calibration must not get
   worse.** Clean sheets are what this constant drives; trading their
   calibration for a better-looking slope is not an improvement. Stop and
   report if either degrades.

Paste the full report, and both calibration reports if the constant changed,
into the PR body.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests for the bucketing boundaries, the weighted fit against a known
  synthetic input, and `K = 0` on this path.
- If `fixture.ts` changed: a named test that `es = 0.5` still yields exactly
  `leagueBaselineGoals`, and that the clamps hold at both ends.
- `docs/projection-model-backlog.md`'s G12 entry is updated with the measured
  answer, whichever way it went. G12 has been an open question since 2
  September; this ticket closes it either way.

## Out of scope

- `attackingMultiplier` and `ATTACKING_MULTIPLIER_OFFSET`. #184 measured them
  properly against point-in-time `expectedScore`, not against the stale elo,
  and its conclusion stands. This ticket measures the other half.
- `src/lib/projection/expectedPoints.ts`, `scripts/project-points.ts`,
  `scripts/preflight-check.ts`, `scripts/team-strength-diagnostic.ts` and
  `src/lib/projection/teamStrength.ts` — ticket #117 is in this same batch
  and owns all of them. `expectedGoalsConceded`'s signature does not change,
  so its call site does not either. **If it turns out any of those files must
  change, stop and report.**
- The clean-sheet formula itself in `expectedPoints.ts`. This ticket changes
  what goes into it, never how it works.
- `src/lib/projection/bonus.ts`.

## Files

- `scripts/fixture-slope-report.ts` (new)
- `scripts/fixture-slope-report.test.ts` (new)
- `src/lib/projection/fixture.ts` (only if the measurement says so)
- `src/lib/projection/fixture.test.ts`
- `docs/projection-model-backlog.md`
