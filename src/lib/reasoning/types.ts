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

/**
 * One driver behind a `gbm-v1` player's learned-model prediction — one entry
 * of the up-to-five `components.drivers` array written by
 * `model/fpl_model/live.py` (ticket #131) from `train.contributions`.
 * `feature` is the model's own generated column name (e.g. `r5_total_points`,
 * `lambda_for`) — `derive.ts`'s `describeDriver` turns it into plain words;
 * this type carries the raw name through unchanged. `value` is the feature's
 * own value at prediction time (null when the model had nothing to compute
 * it from), `contribution` is the driver's signed effect on the prediction —
 * its sign is what `derive.ts` reads to say "pushes up" / "pulls down".
 */
export interface PlayerProjectionDriver {
  feature: string
  value: number | null
  contribution: number
}

/**
 * The `gbm-v1` half of a player's projection row (ticket #266) — present
 * only when a `gbm-v1` row was resolved for this player this gameweek,
 * alongside (never instead of) the `baseline-v1` breakdown above. `points`
 * and `modelVersion`/`computedAt` on `PlayerProjectionData` stay the
 * `baseline-v1` ones, unchanged since #79 — this block is additive.
 */
export interface PlayerProjectionLearned {
  modelVersion: string
  expectedPoints: number
  drivers: readonly PlayerProjectionDriver[]
}

/** One player's resolved projection row for this gameweek — read once per
 *  named player (transfer-in/out, captain, vice-captain), never the whole
 *  ~600-row table (see api.ts's own comment on why no pagination loop is
 *  needed for this particular read). */
export interface PlayerProjectionData {
  playerId: number
  points: ProjectionPointsBreakdown
  modelVersion: string
  computedAt: string
  /** The `gbm-v1` row for this same player/gameweek, when one exists
   *  (ticket #266) — see `PlayerProjectionLearned`'s own header. Undefined
   *  when only `baseline-v1` resolved, or no projection resolved at all;
   *  the reasoning screen then renders exactly as it did before this
   *  ticket. */
  learned?: PlayerProjectionLearned
}

/** Which role a named player plays in the recommendation — matches
 *  `src/lib/recommendation/coverage.ts`'s `CoverageCheckedRole` values
 *  exactly, since `recommendations.coverage` was written using them. */
export type ReasoningRole = 'transferIn' | 'transferOut' | 'captain' | 'viceCaptain'

/**
 * One stored alternative plan (`plan_index` 1 or 2) for the same gameweek as
 * Plan A — ticket #102. Deliberately a much smaller shape than Plan A's own
 * fields on `ReasoningRecommendationData`: no starting XI, no per-player
 * projection breakdown. The alternatives section exists to show HOW an
 * alternative differs from Plan A and by how much, not to re-render a whole
 * second reasoning card (see this ticket's Notes — "not a menu").
 */
export interface AlternativePlanData {
  /** 1 for Plan B, 2 for Plan C. Never 0 — Plan A is never itself an "alternative". */
  planIndex: number
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  hitCost: number
  grossPointsRounded: number
  netPointsRounded: number
  confidenceBand: ConfidenceBand
  /** Same shape and same "no entry = no known gap" reading as Plan A's own
   *  `coverage` field — this plan's own stored `recommendations.coverage`
   *  row, not Plan A's. */
  coverage: readonly CoverageEntry[]
  /** `recommendation_reasons.reason` for this plan, order_index ascending.
   *  Empty when this plan has no stored reasons at all (ticket DoD: a plan
   *  missing its reasons still renders, just without them) — never used to
   *  drop the plan. */
  reasons: readonly string[]
}

/**
 * Everything `deriveReasoningView` needs for one recommendation — already
 * resolved by `src/lib/reasoning/api.ts` (player names looked up, every
 * reason line fetched in order, the starting XI and the four named players'
 * projections read). Plan A's own fields below are unchanged from before
 * ticket #102 (`plan_index = 0`, matching the verdict card's own scope for
 * Plan A). `alternatives` is new in #102: every OTHER stored plan
 * (`plan_index` 1 and 2 when present) for this same gameweek, ordered
 * ascending — `[]` when Plan A is the only plan #60's distinctness collapse
 * left standing, which is a normal, confident outcome, not a shortfall.
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
  /** Every OTHER stored plan for this same gameweek (`plan_index` 1, 2),
   *  ordered ascending. See `AlternativePlanData`'s own header. */
  alternatives: readonly AlternativePlanData[]
  /** `recommendations.updated_at` for Plan A (`plan_index = 0`) — the
   *  recommendation's OWN solve time, set explicitly by
   *  scripts/generate-recommendations.ts on every upsert. Ticket #277: the
   *  footer used to read a resolved player_projections row's `computed_at`
   *  instead, which could legitimately differ from when the recommendation
   *  itself was produced. This is the one correct source for "Updated …"
   *  on the reasoning screen. */
  updatedAt: string
}
