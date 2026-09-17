## Problem

Captaincy is the single highest-leverage decision the app makes — it doubles
one player's score every week — and it has never been measured.

The user's specific complaint about gameweek 4 was a captaincy call: the app
picked B.Fernandes against Man City when a Chelsea captain was the obvious
choice. That complaint led to four tickets of fixture-term repair (#235, #242,
#238, #244). None of them measures whether captaincy actually improved,
because nothing scores captaincy at all.

`scripts/recommendation-scorecard.ts` scores the recommendation as a whole.
It does not answer the one question that matters here: **of the eleven
players who started, did the app captain the best one?**

That question is now answerable. `notifications.plan_snapshot` (#233) freezes
the captain and starting eleven actually issued, and `prediction_log` carries
settled `actual_points` per player per gameweek.

## The work

Add a captaincy section to `scripts/recommendation-scorecard.ts`. Read-only —
changes no model file and no recommendation.

For every gameweek with a `notifications.plan_snapshot` and settled actuals:

- **Chosen captain** and their actual points.
- **Best available captain** — the highest actual scorer among the starting
  eleven in that same snapshot. Hindsight, and labelled as such: this is a
  ceiling, not a target anyone could have hit.
- **Regret** = best available actual minus chosen actual. This is the number
  that matters; report the per-gameweek value and the pooled mean.
- **Rank of the chosen captain** within the starting eleven by actual points
  (1 = best). A mean rank near 1 is a good captain picker; near 5.5 is a coin
  flip.
- **Vice-captain** and whether it would have been better, reported separately.
  Only meaningful when the captain played 0 minutes, so state the count of
  gameweeks where the vice actually came into effect rather than scoring it
  every week.

Also report the same four figures for a **naive baseline**: captaining the
highest-PROJECTED player in the starting eleven. The app's captain usually is
that player, so where the two diverge is exactly where the recommendation
logic added or destroyed value, and without the baseline the regret number
says nothing about whether the app is doing better than its own projection.

Pool from the underlying gameweek rows, never a mean of per-gameweek means.
Print the sample size beside every figure — there are at most four gameweeks
of snapshots, and a mean over four is weak evidence. Say so in the report
itself, in the same shape `bonus-validation-report.ts` states its own
three-gameweek limitation.

Where a gameweek has no `plan_snapshot` (every gameweek before #233 merged),
say so and exclude it. Never fall back to the mutable `recommendations` table
for this section — the whole point is scoring what was actually sent.

## Falsification gate

None — this is a read-only instrument, and it makes no claim that a number
will move.

The ticket's own success condition is that it runs against live data and
produces a regret figure and a mean rank. If it cannot, because no gameweek
has both a snapshot and settled actuals, **stop and report that** rather than
shipping a section that prints nothing.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: regret is 0 when the chosen captain was the best; rank is
  computed correctly with tied actual scores; a gameweek with no snapshot is
  excluded and named; a captain who played 0 minutes triggers the vice-captain
  path; pooling is from underlying rows.
- Hand-run against live data. Paste the captaincy section into the PR body.

## Out of scope

- Changing how the captain is chosen. This ticket measures; acting on what it
  finds is the next ticket, and it needs this number to exist first.
- `scripts/generate-recommendations.ts` and the solver.
- Every other section of the scorecard.
- `src/lib/projection/expectedPoints.ts`, `teamStrength.ts`, `fixture.ts`,
  `bonus.ts`, `scripts/project-points.ts`, `scripts/preflight-check.ts`,
  `scripts/team-strength-diagnostic.ts`, `scripts/ingest-core-insights.ts` —
  #238, #244 and the price-history ticket in this same batch own these.

## Files

- `scripts/recommendation-scorecard.ts`
- `scripts/recommendation-scorecard.test.ts`
