/**
 * Hit-cost arithmetic — ticket #47. product-brief.md §6d: "the app must
 * state the cost and the net explicitly" whenever a hit is recommended.
 */
import { roundSolverCount } from './rounding.ts'

/** The in-game points cost of one transfer beyond the free allowance. Tier 3 (product-brief.md §4: in-game points are not real money). Independently named from scripts/build-solver-input.ts's own `HIT_COST` (the config value passed to the solver) — same number, separate compilation environment, not imported (see CLAUDE.md's scripts/src sharing note). */
export const HIT_COST_PER_TRANSFER = 4

/**
 * `4 × (transfers made − free transfers available)`, floored at zero.
 * Both inputs are rounded first — see rounding.ts's file header for why a
 * raw solver-derived count must never be compared or subtracted before
 * rounding.
 */
export function computeHitCost(transfersMade: number, freeTransfersAvailable: number): number {
  const made = roundSolverCount(transfersMade)
  const free = roundSolverCount(freeTransfersAvailable)
  return Math.max(0, made - free) * HIT_COST_PER_TRANSFER
}

/** Net projected gain after the hit — gross minus the hit cost, nothing more. */
export function computeNetPoints(grossPoints: number, hitCost: number): number {
  return grossPoints - hitCost
}
