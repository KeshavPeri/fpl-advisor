/**
 * Fixture difficulty model — ClubElo-based expected result for a team in one
 * fixture, plus the attacking multiplier and expected goals conceded
 * derived from it. The "fixture difficulty via ClubElo" and (combined with
 * clean-sheet math in `expectedPoints.ts`) "clean-sheet probability" inputs
 * named in product-brief.md §6d.
 *
 * Pure computation only: no I/O, no database, no fetch.
 */

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

// ============================================================================
// Elo expected score
// ============================================================================

/**
 * Home-advantage elo bonus. The conventional value used in elo-rating
 * football models — not fitted to this app's own data. Tier 3, decided in
 * the ticket.
 */
export const HOME_ADVANTAGE_ELO = 65

/**
 * Expected result for the "for" team in a fixture, as a value in [0, 1]
 * (1.0 = certain win, 0.5 = a coin flip, 0.0 = certain loss — this is an
 * expected-score in the elo sense, not a win probability alone). Standard
 * elo logistic curve, with home advantage folded into the rating gap before
 * the curve is applied.
 */
export function expectedScore(eloFor: number, eloAgainst: number, isHome: boolean): number {
  const homeAdjustment = isHome ? HOME_ADVANTAGE_ELO : -HOME_ADVANTAGE_ELO
  return 1 / (1 + 10 ** ((eloAgainst - eloFor - homeAdjustment) / 400))
}

// ============================================================================
// Elo fallback — FPL's own 1-5 FDR, for a team whose elo is null
// ============================================================================

/**
 * Returned by {@link expectedScoreFromDifficulty} for an FDR value outside
 * the documented 1-5 mapping (should not occur against real FPL data, but a
 * defensive default is cheaper than a crash). Neutral, not an assertion
 * either way.
 */
const NEUTRAL_EXPECTED_SCORE = 0.5

/**
 * Documented fallback mapping from FPL's own `team_h_difficulty` /
 * `team_a_difficulty` (1 = easiest fixture, 5 = hardest, from that team's
 * own perspective — home/away is already baked into which of the two
 * columns is read, unlike the elo formula which takes a separate `isHome`
 * flag) onto the same [0, 1] expected-score space {@link expectedScore}
 * produces. Anchored so FDR 3 (an average fixture) lands on 0.5 — the same
 * value `expectedScore` gives for two evenly-matched teams — and spread
 * evenly either side. A small stated table, not fitted to data. Tier 3,
 * decided in the ticket.
 *
 * Used whenever a fixture's team has a null `teams.elo` (never treated as
 * elo 0 — see `expectedPoints.ts`'s combiner, which is what actually
 * decides when to fall back to this).
 */
const DIFFICULTY_EXPECTED_SCORE: Readonly<Record<number, number>> = {
  1: 0.75,
  2: 0.625,
  3: 0.5,
  4: 0.375,
  5: 0.25,
}

export function expectedScoreFromDifficulty(difficulty: number): number {
  return DIFFICULTY_EXPECTED_SCORE[difficulty] ?? NEUTRAL_EXPECTED_SCORE
}

// ============================================================================
// Attacking multiplier and expected goals conceded, derived from expectedScore
// ============================================================================

/**
 * Clamp range for {@link attackingMultiplier}. MIN = 0 is arithmetic: an
 * attacking-rate multiplier can never be negative (that would mean negative
 * expected goals), so the floor at zero follows directly from what a
 * multiplier is, not from a judgement about the data. MAX = 2 is a judgement
 * call, not derived from the damped formula's own domain — carried over
 * unchanged from the pre-damping ceiling (ticket #182 / the model review's
 * R3: "clamp unchanged") as defensive headroom for an out-of-range
 * `expectedScore`, even though the damped formula below never itself
 * exceeds 1.5 for any `expectedScore` inside its real [0, 1] domain
 * (`ATTACKING_MULTIPLIER_OFFSET + 1 = 1.5`).
 */
export const ATTACKING_MULTIPLIER_MIN = 0
export const ATTACKING_MULTIPLIER_MAX = 2

/**
 * Ticket #182 — damps {@link attackingMultiplier}'s slope to its measured
 * value. Full derivation: `docs/model-review-2026-09-02.md` §1b.
 *
 * MECHANISM. The pre-#182 formula (`2 × expectedScore`) implies a raw-goals
 * slope of `LEAGUE_BASELINE_GOALS_PER_TEAM × 2 = 1.45 × 2 = 2.9` goals per
 * unit of `expectedScore` — roughly twice the measured slope below. That
 * overstates how much one fixture should swing a team's attacking output: at
 * the bucket extremes it projects a heavily-favoured team for ~24% more
 * goals than observed, and a heavily-disfavoured team for ~30% fewer.
 *
 * MEASUREMENT (docs/model-review-2026-09-02.md, 2 September 2026;
 * arithmetic reproduced independently for this ticket, same date): actual
 * team goals scored, bucketed by point-in-time `expectedScore`, over every
 * resolvable 2025-2026 Premier League team-match (n=698 total):
 *
 *   es bucket    | n   | mean es | actual goals | current model (1.45×2×es)
 *   0.00–0.35    | 123 | 0.251   | 1.04         | 0.73
 *   0.35–0.45    | 138 | 0.401   | 1.23         | 1.16
 *   0.45–0.55    | 176 | 0.500   | 1.35         | 1.45
 *   0.55–0.65    | 138 | 0.599   | 1.61         | 1.74
 *   0.65–1.01    | 123 | 0.749   | 1.75         | 2.17
 *
 * Fitted slope: the review states "≈1.43", reproduced here as the
 * extreme-bucket endpoint slope from the table above —
 * `(1.75 − 1.04) / (0.749 − 0.251) = 0.71 / 0.498 = 1.4257 ≈ 1.43` goals per
 * unit of `expectedScore` — about half the current model's 2.9 (a
 * whole-table weighted least-squares fit over the five bucket means, by
 * comparison, gives ≈1.50, the same "roughly half" conclusion within
 * reconstruction noise). A damped multiplier of slope 1 instead of slope 2
 * — `ATTACKING_MULTIPLIER_OFFSET + expectedScore` — implies a raw-goals
 * slope of `LEAGUE_BASELINE_GOALS_PER_TEAM × 1 = 1.45`, matching the
 * measured ~1.43–1.50 closely, and reproduces the bucket means well:
 * predicted `1.45 × (0.5 + 0.251) = 1.089` vs actual 1.04 at the low bucket;
 * `1.45 × (0.5 + 0.749) = 1.811` vs actual 1.75 at the high bucket
 * (residuals from −0.10 to +0.02 across all five buckets — every bucket
 * within ~0.1 goals, none systematically). `ATTACKING_MULTIPLIER_OFFSET` =
 * 0.5 is also exactly the value that leaves an even fixture
 * (`expectedScore = 0.5`) unadjusted at `1.0`, matching the pre-#182 formula
 * at that one point — see `attackingMultiplier`'s "equals 1.0 exactly" test,
 * the most important one this ticket adds.
 *
 * `expectedGoalsConceded` / `defensiveMultiplier` (the mirror
 * `2 × (1 − expectedScore)` form) were explicitly UNTOUCHED by this
 * measurement — ticket #182 deliberately deferred damping the defensive
 * side without its own separate in-harness measurement (goalkeeper/defender
 * ranking is the model's clearest win and depends on that spread). **Ticket
 * #244 is that separate measurement** and damped `defensiveMultiplier` /
 * `expectedGoalsConceded` to a mirrored slope — see
 * `DEFENSIVE_MULTIPLIER_OFFSET`'s own comment below for the full derivation.
 * This paragraph is left as the historical record of #182's own deferral,
 * not restated as still-current.
 */
export const ATTACKING_MULTIPLIER_OFFSET = 0.5

/**
 * Multiplier applied to a team's baseline attacking rates for this fixture:
 * `ATTACKING_MULTIPLIER_OFFSET + expectedScore`, clamped to
 * `[ATTACKING_MULTIPLIER_MIN, ATTACKING_MULTIPLIER_MAX]` — see the
 * constant's own comment for the measurement this damped slope is fitted
 * to. At `expectedScore = 0.5` (an even fixture) this is exactly `1.0` — no
 * adjustment, identical to the pre-#182 formula at that one point. A
 * heavily favoured fixture pushes toward `1.5` (at `expectedScore = 1`); a
 * heavily unfavoured one pushes toward `0.5` (at `expectedScore = 0`) —
 * half the pre-#182 formula's slope.
 */
export function attackingMultiplier(expectedScoreValue: number): number {
  return clamp(ATTACKING_MULTIPLIER_OFFSET + expectedScoreValue, ATTACKING_MULTIPLIER_MIN, ATTACKING_MULTIPLIER_MAX)
}

/**
 * Expected goals conceded by the "for" team in this fixture:
 * `leagueBaselineGoals × defensiveMultiplier(expectedScore)` — ticket #244
 * rewrote this to call {@link defensiveMultiplier} directly (previously a
 * separately-stated `leagueBaselineGoals × 2 × (1 - expectedScore)`, mirrored
 * by hand rather than shared) so the "never allowed to drift apart"
 * invariant {@link defensiveMultiplier}'s own comment documents is enforced
 * by construction, not just by a test. `Math.max(0, ...)` is defensive
 * belt-and-suspenders only — `defensiveMultiplier` already clamps to `[0,
 * 2]`, so this can only bind for a negative `leagueBaselineGoals`, which
 * should never occur. At `expectedScore = 0.5` this is exactly
 * `leagueBaselineGoals` (the league-average defensive expectation,
 * unadjusted); a heavily favoured fixture pushes it toward
 * `0.5 × leagueBaselineGoals` (not all the way to 0 — see
 * `DEFENSIVE_MULTIPLIER_OFFSET`'s own comment for why the damped range is
 * `[0.5, 1.5]`, mirroring `attackingMultiplier`).
 */
export function expectedGoalsConceded(leagueBaselineGoals: number, expectedScoreValue: number): number {
  return Math.max(0, leagueBaselineGoals * defensiveMultiplier(expectedScoreValue))
}

/**
 * Ticket #244 — damps {@link defensiveMultiplier} / {@link
 * expectedGoalsConceded}'s slope to its measured value, the mirror of what
 * ticket #182 did for {@link attackingMultiplier} (see
 * `ATTACKING_MULTIPLIER_OFFSET`'s own comment above). G12 in
 * `docs/projection-model-backlog.md` recorded this as deliberately
 * UNMEASURED after #182 — "do not extend this reasoning to
 * `defensiveMultiplier` without its own separate measurement and ticket."
 * This is that measurement.
 *
 * MEASUREMENT (`scripts/fixture-slope-report.ts`, `./out/fixture-slope-report.md`,
 * 17 Sept 2026): actual team goals CONCEDED, bucketed by point-in-time
 * `expectedScore`, over every resolvable 2025-2026 Premier League team-match,
 * SAME method, buckets and (data-availability-driven) population #182 used
 * for goals scored (n=758 here vs #182's published n=698 — the difference is
 * 60 early-season team-match perspectives that fall to the neutral es=0.5
 * fallback rather than being excluded; see the report's own note. The
 * goals-SCORED table this same run reproduces matches #182's published
 * bucket means within 0.002 in every bucket, well inside the ticket's ±0.05
 * falsification tolerance, so the harness is trusted):
 *
 *   es bucket    | n   | mean es | actual conceded | current model (1.45×2×(1−es))
 *   0.00–0.35    | 123 | 0.253   | 1.75             | 2.17
 *   0.35–0.45    | 138 | 0.401   | 1.61             | 1.74
 *   0.45–0.55    | 236 | 0.500   | 1.35             | 1.45
 *   0.55–0.65    | 138 | 0.599   | 1.23             | 1.16
 *   0.65–1.01    | 123 | 0.747   | 1.04             | 0.73
 *
 * Fitted slope: extreme-bucket endpoint
 * `(1.04 − 1.75) / (0.747 − 0.253) = −0.71 / 0.494 = −1.4372 ≈ −1.43` goals
 * conceded per unit of `expectedScore` (a weighted least-squares fit over the
 * five bucket means gives ≈−1.50, the same conclusion within reconstruction
 * noise) — essentially the exact mirror of the goals-SCORED slope (+1.43 /
 * +1.50) measured in the same run, and about half the current model's −2.9.
 * `MODEL_IMPLIED_CONCEDED_SLOPE` (−2.9) is outside the ticket's ±15% band
 * around the measured value ([−3.335, −2.465] vs measured ≈−1.43), so per the
 * ticket's own decision rule this constant is damped, not left alone.
 *
 * A damped multiplier of slope magnitude 1 instead of 2 — exactly mirroring
 * `attackingMultiplier`'s own `OFFSET + expectedScore` — implies a raw-goals
 * slope of `LEAGUE_BASELINE_GOALS_PER_TEAM × 1 = 1.45`, matching the measured
 * ~1.43–1.50 closely (predicted `1.45 × (1.5 − 0.253) = 1.808` vs actual 1.75
 * at the low bucket; `1.45 × (1.5 − 0.747) = 1.092` vs actual 1.04 at the
 * high bucket — residuals from −0.10 to +0.06 across all five buckets,
 * comparable in size to #182's own −0.10 to +0.02). `DEFENSIVE_MULTIPLIER_OFFSET`
 * = 1.5 is exactly the value that leaves an even fixture (`expectedScore =
 * 0.5`) unadjusted at `1.0`, matching the pre-#244 formula at that one point
 * — see `defensiveMultiplier`'s "equals 1.0 exactly" test. Note the elegant
 * consequence, not independently chosen: `attackingMultiplier(es) +
 * defensiveMultiplier(es) = (0.5 + es) + (1.5 − es) = 2.0` for every
 * `expectedScore`, i.e. the damped attacking and defensive responses are
 * exact mirrors of one another, same as the measured slopes are.
 *
 * Tier 2, logged HIGH-IMPACT (ticket text) — changes every live defender and
 * goalkeeper clean-sheet projection. `scripts/calibration-report.ts` run
 * before/after (see the Builder's report on ticket #244 for the before/after
 * figures — this Builder session has no Supabase credentials and could not
 * run it against live data; flagged rather than guessed at).
 */
export const DEFENSIVE_MULTIPLIER_OFFSET = 1.5

/**
 * Multiplier applied to a goalkeeper's baseline saves rate for this fixture:
 * `DEFENSIVE_MULTIPLIER_OFFSET − expectedScore`, clamped to `[0, 2]` — see
 * `DEFENSIVE_MULTIPLIER_OFFSET`'s own comment for the measurement this
 * damped slope is fitted to (ticket #244; pre-#244 this was `2 × (1 -
 * expectedScore)`, slope magnitude 2 instead of 1). Still the ratio form of
 * {@link expectedGoalsConceded} (`leagueBaselineGoals ×
 * (DEFENSIVE_MULTIPLIER_OFFSET − expectedScore)` — divide out
 * `leagueBaselineGoals` and this is what is left) and still applied to a
 * goalkeeper's saves rate for the same reason as before: saves and goals
 * conceded share one cause, being under pressure from the same fixture, so
 * they share one multiplier derived the same way. At `expectedScore = 0.5`
 * (an even fixture) this is exactly `1.0` — no adjustment, identical to the
 * pre-#244 formula at that one point. A heavily unfavoured fixture pushes
 * toward `1.5` (at `expectedScore = 0`); a heavily favoured one pushes toward
 * `0.5` (at `expectedScore = 1`) — half the pre-#244 formula's slope, the
 * exact mirror of {@link attackingMultiplier}'s own `[0.5, 1.5]` range.
 *
 * `expectedGoalsConceded(b, s) === b * defensiveMultiplier(s)` by
 * construction (see fixture.test.ts, and `expectedGoalsConceded`'s own
 * implementation above, which calls this function directly rather than
 * reimplementing the formula) -- the two are never allowed to drift apart.
 * See docs/projection-model-backlog.md G1 for the caveat this does NOT
 * resolve: shot volume and shot quality are correlated, not identical, so
 * this slightly double-counts the fixture against expectedGoalsConceded.
 */
export function defensiveMultiplier(expectedScoreValue: number): number {
  return clamp(DEFENSIVE_MULTIPLIER_OFFSET - expectedScoreValue, 0, 2)
}

/**
 * Pre-season / early-season placeholder for the league-wide average goals
 * scored per team per match, used when fewer than 20 finished fixtures
 * exist to compute it from `public.fixtures` at runtime (true before GW1
 * 2026/27 — see `scripts/project-points.ts`, which does that runtime
 * computation and falls back to this constant, recording which path was
 * taken). Tier 3, decided in the ticket; superseded by real data as soon as
 * the season has results.
 */
export const LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45
