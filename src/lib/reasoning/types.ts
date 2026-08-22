/**
 * Types for the reasoning screen (ticket #79, feature-list item 21). Same
 * "small local copy of a domain type" precedent `src/lib/verdict/types.ts`
 * already documents — this module does not import from
 * `src/lib/recommendation/` even though the shapes overlap, because that
 * module is pure solver logic owned by a different ticket. `ConfidenceBand`
 * matches `public.recommendations.confidence_band`'s CHECK constraint
 * exactly, same as verdict/types.ts.
 */

export type ConfidenceBand = 'clear' | 'marginal' | 'coin-flip'

/** One entry from the stored `recommendations.coverage` jsonb column. */
export interface CoverageEntry {
  role: string
  playerId: number
  hasHistory: boolean
}

/**
 * One starting-XI `solver_picks` row for the recommendation's own
 * `gameweek_id` + `solution_index` + solver run (same run-filter rule as
 * `src/lib/verdict/api.ts` — see that file's own comment on why: two solver
 * runs can coexist for one gameweek, ticket #72). Carries `playerId` (unlike
 * verdict's `GameweekPick`) because the reasoning screen needs to identify
 * WHICH starter is the captain's nearest rival, not just sum a total.
 * `expectedPoints` here is the solver's raw per-player xP, never doubled for
 * captaincy — the captain-gap calculation in derive.ts compares raw
 * projections, the same figure both players were actually projected to
 * score before any multiplier is applied.
 */
export interface StartingXIPick {
  playerId: number
  expectedPoints: number
  isCaptain: boolean
}

/**
 * Every point component stored under one player's
 * `player_projections.components.points` for this gameweek, exactly as
 * written by scripts/project-points.ts — appearance/goal/assist/clean
 * sheet/goals conceded/save/defensive-contribution/bonus today, and
 * whatever a future ticket (e.g. #78 for bonus) adds tomorrow with no
 * change needed here. derive.ts iterates this object's own keys; it never
 * assumes which keys exist.
 */
export type ProjectionPointsBreakdown = Record<string, number>

/** One player's resolved projection row for this gameweek — read once per
 *  named player (transfer-in/out, captain, vice-captain), never the whole
 *  ~600-row table (see api.ts's own comment on why no pagination loop is
 *  needed for this particular read). */
export interface PlayerProjectionData {
  playerId: number
  points: ProjectionPointsBreakdown
  modelVersion: string
  computedAt: string
}

/** Which role a named player plays in the recommendation — matches
 *  `src/lib/recommendation/coverage.ts`'s `CoverageCheckedRole` values
 *  exactly, since `recommendations.coverage` was written using them. */
export type ReasoningRole = 'transferIn' | 'transferOut' | 'captain' | 'viceCaptain'

/**
 * Everything `deriveReasoningView` needs for one recommendation — already
 * resolved by `src/lib/reasoning/api.ts` (player names looked up, every
 * reason line fetched in order, the starting XI and the four named players'
 * projections read). Plan A only (`plan_index = 0`), matching the verdict
 * card's own scope — this ticket never reads Plan B/C.
 */
export interface ReasoningRecommendationData {
  gameweekId: number
  gameweekName: string
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: number
  grossPointsRounded: number
  netPointsRounded: number
  confidenceBand: ConfidenceBand
  coverage: readonly CoverageEntry[]
  /** `recommendation_reasons.reason`, ALL rows for this plan, ordered by
   *  order_index ascending — unlike the verdict card, which only reads
   *  order_index 0. */
  reasons: readonly string[]
  /** Display name for every player id referenced above that could be resolved. */
  playerNames: ReadonlyMap<number, string>
  /** `solver_runs.horizon` for the recommendation's own resolved run. Null
   *  when the run (or its horizon) could not be resolved — the view must
   *  render this as an explicit "unavailable" label, never a guessed or
   *  hardcoded gameweek count. */
  horizon: number | null
  /** This recommendation's starting XI, run-filtered the same way
   *  `src/lib/verdict/api.ts` filters `solver_picks` (ticket #72). Null when
   *  no rows could be found — the captain-confidence band then has nothing
   *  to compare against and derive.ts must say so rather than guessing. */
  startingXI: readonly StartingXIPick[] | null
  /** Resolved `player_projections` row for every named player (transfer-in,
   *  transfer-out, captain, vice-captain) that has one. A player with no
   *  entry here (projection missing or read failed) gets an explicit
   *  "unavailable" breakdown in the view, never a blank screen. */
  projections: ReadonlyMap<number, PlayerProjectionData>
}
