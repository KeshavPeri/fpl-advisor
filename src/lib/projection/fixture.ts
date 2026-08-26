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
 * Multiplier applied to a team's baseline attacking rates for this fixture:
 * `2 × expectedScore`, clamped to `[0, 2]`. At `expectedScore = 0.5` (an
 * even fixture) this is exactly `1.0` — no adjustment. A heavily favoured
 * fixture pushes toward `2.0` (double the expected attacking output); a
 * heavily unfavoured one pushes toward `0.0`.
 */
export function attackingMultiplier(expectedScoreValue: number): number {
  return clamp(2 * expectedScoreValue, 0, 2)
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
