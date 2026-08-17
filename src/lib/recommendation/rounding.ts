/**
 * Rounding — ticket #47. The solver's own results CSV carries `ft` (free
 * transfers available) and `transfer_count` (transfers made) as floats with
 * binary noise: a true value of `1` can arrive as `0.9999999999999996` or
 * `1.0000000000000044` (see this ticket's own Context section, and
 * scripts/generate-recommendations.ts's file header for where these numbers
 * come from and why this app currently derives its own transfer counts
 * instead of reading the solver's noisy columns directly).
 *
 * Every count this module or scripts/generate-recommendations.ts treats as
 * a whole number is routed through `roundSolverCount` first. Nothing in
 * this codebase compares a raw solver-derived count against an integer with
 * `===` — see hitCost.test.ts and this file's own test for the guard.
 */

/** Rounds a raw solver-derived count to the nearest whole number. Never compare the raw input to an integer with `===` — round first, always. */
export function roundSolverCount(raw: number): number {
  return Math.round(raw)
}
