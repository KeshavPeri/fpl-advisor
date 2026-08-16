/**
 * Starting XI / bench derivation — ticket #47.
 *
 * The solver's OWN results CSV encodes bench position as `-1` for a starter
 * and `0`-`3` for a bench slot (`0` is a real bench position, not a false).
 * `scripts/store-solver-output.ts` (ticket #41, already merged) shifts that
 * raw column by +1 when it writes `solver_picks.bench_order` — NULL for a
 * starter, `1`-`4` for bench, one of the four being the reserve goalkeeper
 * — specifically so nothing downstream (including this module) has to
 * treat `0` as falsy. `LineupPickInput.benchOrder` below is that already-
 * shifted `solver_picks` convention, not the solver's raw `-1..3` column.
 *
 * This module still classifies starters/bench from the explicit `isLineup`
 * boolean, never from `benchOrder` truthiness, so a future caller that
 * accidentally wires in the raw, unshifted solver column cannot silently
 * misclassify bench slot `0` as a starter — see the named test below, the
 * single most likely off-by-one in this ticket.
 */

export interface LineupPickInput {
  playerId: number
  playerCode: number | null
  isLineup: boolean
  /** NULL for a starter; 1-4 for bench, ascending = first off the bench. The already-shifted `solver_picks.bench_order` convention — see file header. */
  benchOrder: number | null
  isCaptain: boolean
  isViceCaptain: boolean
}

export interface DerivedLineup<T extends LineupPickInput> {
  startingXI: T[]
  /** Ascending by benchOrder — index 0 is the first player off the bench. */
  bench: T[]
}

/**
 * Splits one plan's fifteen picks (for a single gameweek) into a starting
 * XI and an ordered bench. Membership comes from `isLineup` alone —
 * `benchOrder` is used only to order the bench, never to decide who is on
 * it, so a bench player whose order happens to be the lowest value cannot
 * be mistaken for a starter.
 */
export function deriveLineup<T extends LineupPickInput>(picks: readonly T[]): DerivedLineup<T> {
  const startingXI = picks.filter((p) => p.isLineup)
  const bench = picks.filter((p) => !p.isLineup).sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0))
  return { startingXI, bench }
}

/** The captain, from a plan's starting XI. Null if no pick is flagged captain (should not happen for a valid solve, but this module never throws — see generate-recommendations.ts for what a missing captain means for that run). */
export function findCaptain<T extends LineupPickInput>(startingXI: readonly T[]): T | null {
  return startingXI.find((p) => p.isCaptain) ?? null
}

/** The vice-captain, from a plan's starting XI. Same null contract as findCaptain. */
export function findViceCaptain<T extends LineupPickInput>(startingXI: readonly T[]): T | null {
  return startingXI.find((p) => p.isViceCaptain) ?? null
}
