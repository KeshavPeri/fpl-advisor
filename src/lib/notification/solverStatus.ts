/**
 * Solver-status labelling — ticket #55 (feature-list item 14).
 *
 * product-brief.md §6c: "a timed-out solution is usable but must be
 * labelled", never presented as a proven optimum. `solver_runs.solver_status`
 * (ticket #41's `solver_output` migration) stores the solver's own status
 * string verbatim — 'Optimal', 'Time limit reached', etc — and is never
 * normalized to "optimal" by this app, so this module does the same: it
 * never invents a friendlier label, it only decides whether the RAW string
 * counts as a proven optimum and, if not, produces the caveat sentence the
 * Telegram message adds.
 *
 * Pure, no I/O — `scripts/send-telegram.ts` reads `solver_runs.solver_status`
 * and passes the raw string in here.
 */

export interface SolverStatusInfo {
  /** True only when the underlying solve reached a PROVEN optimum. False for every other known status, and false when the status is unknown (no solver_runs row could be resolved) — never guessed true. */
  isOptimal: boolean
  /** The solver's own status string verbatim, or null when no solver_runs row was resolvable (e.g. a null solver_run_id). Never rewritten to 'optimal'/'timed out' — see this file's header. */
  status: string | null
}

/**
 * Exactly 'Optimal' (case-sensitive, matching HiGHS's own status text as
 * stored by `scripts/store-solver-output.ts`'s `classifySolve`) is a proven
 * optimum. Every other status — including a status this app has never seen
 * before — is treated as NOT proven, because the honest default is "don't
 * claim more than the solver actually reported."
 */
export function isProvenOptimal(status: string | null): boolean {
  return status === 'Optimal'
}

/**
 * The caveat line added to a Telegram message when the plan being sent did
 * not come from a proven-optimal solve. Never claims the plan is wrong —
 * product-brief.md §6c is explicit that a timed-out solve is still usable —
 * only that it isn't a proven best, so the confidence band it carries is not
 * overstated by omission.
 */
export function composeSolverCaveat(status: string): string {
  return `This plan comes from a solve that did not reach a proven optimum (status: ${status}). It is usable, but not guaranteed best.`
}
