/**
 * Ranking the solver's alternative solutions — ticket #47.
 *
 * `num_iterations` (raised to 3 by this ticket, see scripts/build-solver-
 * input.ts) can legitimately return fewer than three DISTINCT solutions —
 * that is not an error (see this ticket's DoD: "stores what it got",
 * records the shortfall). This module ranks whatever solution indices are
 * actually present, best score first, and reports how many were expected
 * vs found so the caller can log the shortfall without failing the run.
 */

export interface RankedSolution {
  solutionIndex: number
  score: number
  /** 0 for the best-scoring solution ("Plan A"), ascending. */
  planIndex: number
}

/**
 * Ranks a map of solutionIndex -> total plan score, best (highest) score
 * first, and assigns `planIndex` 0/1/2 in that order. Ties break on the
 * solver's own `solutionIndex` ascending, so the ordering is deterministic.
 */
export function rankSolutions(scoresBySolutionIndex: ReadonlyMap<number, number>): RankedSolution[] {
  return [...scoresBySolutionIndex.entries()]
    .sort(([indexA, scoreA], [indexB, scoreB]) => scoreB - scoreA || indexA - indexB)
    .map(([solutionIndex, score], planIndex) => ({ solutionIndex, score, planIndex }))
}

export interface IterationShortfall {
  requested: number
  found: number
  isShortfall: boolean
}

/** Whether the solve returned fewer distinct solutions than `num_iterations` requested — a shortfall to record in `job_runs.details`, never a failure (see this ticket's DoD). */
export function detectIterationShortfall(requested: number, found: number): IterationShortfall {
  return { requested, found, isShortfall: found < requested }
}
