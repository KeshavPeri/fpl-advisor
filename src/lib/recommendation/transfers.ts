/**
 * "What changed between this plan and the current squad" — ticket #47.
 *
 * `solver_picks.is_transfer_in` / `is_transfer_out` already carry the
 * solver's own answer to that question, per player per gameweek (see
 * `scripts/store-solver-output.ts`'s `mapResultsCsvRow`). This module reads
 * those flags for one plan's CURRENT-gameweek picks only — never a future
 * horizon gameweek — and turns them into an explicit summary, including the
 * "roll your transfer" case: a plan with no transfer is a real, positive
 * finding here (`isRoll: true`), never a null or an empty result. See
 * design-reference.md's interface-writing rule: an empty transfer is an
 * invitation to act on, i.e. a confident answer, not an absence.
 */

export interface TransferPickInput {
  playerId: number
  playerCode: number | null
  isTransferIn: boolean
  isTransferOut: boolean
}

export interface TransferSummary<T extends TransferPickInput> {
  /** True when this plan makes no transfer this gameweek — a real, stored recommendation ("roll your transfer"), not an absence. */
  isRoll: boolean
  transferIn: T | null
  transferOut: T | null
  /** `max(transfersIn.length, transfersOut.length)` — the two should always agree for a valid solve (one out for every in), but this does not assume they do. */
  transfersMade: number
}

/** Derives the transfer summary for one plan's CURRENT-gameweek picks. Pass only the picks for the current gameweek — a future horizon gameweek's transfer flags are out of scope for this ticket (see file header). */
export function deriveTransferSummary<T extends TransferPickInput>(currentGameweekPicks: readonly T[]): TransferSummary<T> {
  const transfersIn = currentGameweekPicks.filter((p) => p.isTransferIn)
  const transfersOut = currentGameweekPicks.filter((p) => p.isTransferOut)
  const transfersMade = Math.max(transfersIn.length, transfersOut.length)
  return {
    isRoll: transfersMade === 0,
    transferIn: transfersIn[0] ?? null,
    transferOut: transfersOut[0] ?? null,
    transfersMade,
  }
}
