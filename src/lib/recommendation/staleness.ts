/**
 * Stale plan_index rows — ticket #60.
 *
 * `recommendations` is keyed on (gameweek_id, plan_index) and upserted in place, so a plan_index
 * this run no longer produces (e.g. gameweek N had a Plan C last run but this run's distinctness
 * collapse only produced Plan A and Plan B) is never overwritten by the upsert alone — it just
 * sits there as a stale row from an earlier run. This function is the pure half of the fix: it
 * says WHICH plan_index values are now stale, given what was stored before and what this run is
 * about to store. It does no I/O — see scripts/generate-recommendations.ts for the read/delete
 * this feeds (currently not wired in; see decisions/ticket-60.md for why).
 */

/** The plan_index values present before this run that are absent from what this run is about to store — the rows a caller would need to remove so a stored set is never e.g. {0, 2} with a stale 1 missing in between. */
export function computeStalePlanIndices(previousPlanIndices: readonly number[], newPlanIndices: readonly number[]): number[] {
  const keep = new Set(newPlanIndices)
  return previousPlanIndices.filter((i) => !keep.has(i)).sort((a, b) => a - b)
}
