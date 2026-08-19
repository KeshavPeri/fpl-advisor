/**
 * Plan distinctness — ticket #60.
 *
 * `scripts/build-solver-input.ts`'s `iteration_criteria` fix (this_gw_transfer_in, not
 * this_gw_transfer_in_out) stops the optimiser from generating alternatives that differ only
 * in a nearly-free outgoing bench player. This module is the second half of the fix: it catches
 * every OTHER way two of the solver's alternative solutions can turn out to be the same
 * decision — e.g. two different solution_index values that happen to agree on who comes in,
 * who is captain, and land within a hair of the same score. Two plans are the same decision
 * when all three hold:
 *
 *   - identical incoming player (including both being a roll with no transfer)
 *   - identical captain
 *   - projected score within SCORE_TOLERANCE points of each other
 *
 * The OUTGOING player is deliberately NOT part of the comparison — see the ticket's Context
 * section: varying only who is sold is exactly the failure mode this ticket exists to catch,
 * not a legitimate point of difference.
 */

/**
 * How close two plans' projected scores (summed across the whole solve horizon, same quantity
 * as src/lib/recommendation/score.ts's computePlanScore) must be, on top of already sharing the
 * same incoming player and captain, to count as the same decision rather than two distinct
 * alternatives. Tier 3, a judgement call — EXPLICITLY UNCALIBRATED, same status as
 * confidence.ts's thresholds: product-brief.md §9 open question 2 says the real number belongs
 * to a future backtest, not to taste. Logged as uncalibrated in decisions/ticket-60.md.
 */
export const SCORE_TOLERANCE = 0.5

export interface PlanDecisionKey {
  /** True when this plan makes no transfer this gameweek (see transfers.ts's TransferSummary.isRoll). */
  isRoll: boolean
  /** The incoming player's id, or null for a roll. Ignored when isRoll is true on both sides. */
  transferInPlayerId: number | null
  captainPlayerId: number
  /** This plan's own score — see score.ts's computePlanScore, summed across the whole solve horizon. */
  score: number
}

/**
 * Whether two plans represent the same decision — identical incoming player (or both a roll),
 * identical captain, and scores within `tolerance` of each other. The outgoing player is not a
 * parameter of this function at all: it cannot be compared even by accident. See this module's
 * own header.
 */
export function isSameDecision(a: PlanDecisionKey, b: PlanDecisionKey, tolerance: number = SCORE_TOLERANCE): boolean {
  const sameIncoming = a.isRoll && b.isRoll ? true : !a.isRoll && !b.isRoll && a.transferInPlayerId === b.transferInPlayerId
  if (!sameIncoming) return false
  if (a.captainPlayerId !== b.captainPlayerId) return false
  return Math.abs(a.score - b.score) <= tolerance
}

export interface CollapseResult<T> {
  /** The kept plan for each distinct decision, highest-scoring first (input order is trusted to already be score-descending — see collapseSameDecisionPlans). */
  survivors: T[]
  /** How many input plans were dropped as a duplicate decision of an already-kept survivor. */
  collapsedCount: number
}

/**
 * Collapses a list of plans — already ranked best score first (see ranking.ts's rankSolutions)
 * — down to one survivor per distinct decision, keeping the highest-scoring plan in each group.
 * Because the input is processed in score-descending order and only the FIRST plan seen for a
 * given decision is kept, the survivor for every group is automatically its highest scorer —
 * no separate max-finding step is needed.
 */
export function collapseSameDecisionPlans<T extends PlanDecisionKey>(
  rankedDescending: readonly T[],
  tolerance: number = SCORE_TOLERANCE,
): CollapseResult<T> {
  const survivors: T[] = []
  for (const candidate of rankedDescending) {
    const isDuplicateOfAKeptPlan = survivors.some((kept) => isSameDecision(kept, candidate, tolerance))
    if (!isDuplicateOfAKeptPlan) survivors.push(candidate)
  }
  return { survivors, collapsedCount: rankedDescending.length - survivors.length }
}

/**
 * Re-assigns `planIndex` contiguously from 0 over a list already in the final storage order
 * (highest-scoring survivor first — the order `collapseSameDecisionPlans`'s own `survivors`
 * already come in). Whatever `planIndex`/`solutionIndex` a survivor originally carried (e.g. the
 * solver's raw 0/1/2 before a collapse dropped the middle one) is irrelevant here — every plan's
 * FINAL plan_index is purely its position in this list, so a stored set can only ever be `[0]`,
 * `[0, 1]` or `[0, 1, 2]`, never a gap like `[0, 2]`.
 */
export function assignContiguousPlanIndices<T>(orderedSurvivors: readonly T[]): (T & { planIndex: number })[] {
  return orderedSurvivors.map((plan, planIndex) => ({ ...plan, planIndex }))
}
