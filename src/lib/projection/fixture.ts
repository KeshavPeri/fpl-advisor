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
 * `2 × (1 − expectedScore)` form) are explicitly UNTOUCHED by this
 * measurement. The same source bucket table's "actual conceded" / "actual
 * CS%" columns (not reproduced above — see the review doc) show the
 * defensive side also overshoots, but damping it is deliberately deferred:
 * goalkeeper/defender ranking is the model's clearest win and depends on
 * that spread, and confirming the fix needs a live database read the review
 * flags as out of scope here. Do not extend this reasoning to
 * `defensiveMultiplier` without its own separate measurement and ticket.
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
 * `leagueBaselineGoals × 2 × (1 - expectedScore)`, clamped at zero from
 * below. At `expectedScore = 0.5` this is exactly `leagueBaselineGoals`
 * (the league-average defensive expectation, unadjusted); a heavily
 * favoured fixture pushes it toward 0.
 */
export function expectedGoalsConceded(leagueBaselineGoals: number, expectedScoreValue: number): number {
  return Math.max(0, leagueBaselineGoals * 2 * (1 - expectedScoreValue))
}

/**
 * Multiplier applied to a goalkeeper's baseline saves rate for this fixture:
 * `2 × (1 - expectedScore)`, clamped to `[0, 2]` — the exact defensive
 * mirror of {@link attackingMultiplier} (`2 × expectedScore`), and the ratio
 * form of {@link expectedGoalsConceded} (`leagueBaselineGoals × 2 × (1 -
 * expectedScore)` — divide out `leagueBaselineGoals` and this is what is
 * left). Saves and goals conceded share one cause, being under pressure from
 * the same fixture, so they share one multiplier derived the same way: a
 * team twice as likely to concede faces roughly twice the shot volume. At
 * `expectedScore = 0.5` (an even fixture) this is exactly `1.0` — no
 * adjustment. A heavily unfavoured fixture pushes toward `2.0` (double the
 * expected saves workload); a heavily favoured one pushes toward `0.0`.
 *
 * `expectedGoalsConceded(b, s) === b * defensiveMultiplier(s)` by
 * construction (see fixture.test.ts) -- the two are never allowed to drift
 * apart. See docs/projection-model-backlog.md G1 for the caveat this does
 * NOT resolve: shot volume and shot quality are correlated, not identical,
 * so this slightly double-counts the fixture against expectedGoalsConceded.
 */
export function defensiveMultiplier(expectedScoreValue: number): number {
  return clamp(2 * (1 - expectedScoreValue), 0, 2)
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
