/**
 * Data-coverage honesty — ticket #47, product-brief.md §8 (added 15 Aug
 * 2026, binding on items 13/17/21). A projection built on no history must
 * not be presented like one built on a season of it. 45% of the player
 * list had zero historical match rows on the first live run — this is the
 * normal GW1 state, not a defect, and every recommended player must be
 * checked and labelled, not silently trusted.
 *
 * This module does no I/O — the caller (scripts/generate-recommendations.ts)
 * resolves which player codes have ANY row in `player_match_stats` and
 * passes that set in.
 */

/** Which role a checked player plays in the recommendation — used to word the stored reason line, not to change the check itself. */
export type CoverageCheckedRole = 'transferIn' | 'transferOut' | 'captain' | 'viceCaptain'

export interface CoveragePlayerRef {
  role: CoverageCheckedRole
  playerId: number
  playerCode: number | null
}

export interface CoverageResult {
  role: CoverageCheckedRole
  playerId: number
  hasHistory: boolean
}

/** A player with no `playerCode` at all (should not happen for a currently-ingested player, but this module never assumes) is treated as having no history — the honest default, matching product-brief.md §8's "no recommendation beats a wrong one" (§6a) spirit. */
export function checkCoverage(refs: readonly CoveragePlayerRef[], codesWithHistory: ReadonlySet<number>): CoverageResult[] {
  return refs.map((ref) => ({
    role: ref.role,
    playerId: ref.playerId,
    hasHistory: ref.playerCode !== null && codesWithHistory.has(ref.playerCode),
  }))
}

/** True if ANY checked player in this plan has no history — the trigger for `applyCoverageFloor` (confidence.ts) and for the coverage reason lines. */
export function hasAnyCoverageGap(results: readonly CoverageResult[]): boolean {
  return results.some((r) => !r.hasHistory)
}
