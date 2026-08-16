/**
 * Plan scoring — ticket #47. Ranks the solver's alternative solutions
 * ("Plan A / Plan B / Plan C", product-brief.md §6c) and measures the gap
 * the confidence band is derived from.
 *
 * `solver_picks.expected_points` is the solver's own per-player `xP` for a
 * gameweek, deliberately NOT multiplied by captaincy (see that migration's
 * own comment) — the CSV's captaincy-weighted `xp_cont` column is not
 * stored. This module reconstructs the same weighting `xp_cont` encodes
 * (2x captain, 1x other lineup, 0x bench) from the `is_lineup`/`is_captain`
 * flags that ARE stored, and sums it across every pick handed to it. Pass
 * every pick for a solution across its WHOLE solve horizon (not just the
 * current gameweek) to score a plan the same way the multi-period solver
 * itself was optimising for — see scripts/generate-recommendations.ts.
 */

export interface ScorePickInput {
  isLineup: boolean
  isCaptain: boolean
  expectedPoints: number
}

/** The solver's own multiplier convention: 2x captain, 1x other starter, 0x bench. Mirrors the CSV's `multiplier` column, which this app does not store directly. */
export function pickMultiplier(pick: Pick<ScorePickInput, 'isLineup' | 'isCaptain'>): number {
  if (!pick.isLineup) return 0
  return pick.isCaptain ? 2 : 1
}

/** Total captaincy-weighted expected points across every pick passed in — a plan's own "score", used both to rank Plan A/B/C and to measure the gap the confidence band is derived from. */
export function computePlanScore(picks: readonly ScorePickInput[]): number {
  return picks.reduce((sum, p) => sum + pickMultiplier(p) * p.expectedPoints, 0)
}
