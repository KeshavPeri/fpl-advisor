/**
 * Goalkeeper save points — 2026/27 rules.
 *
 * NOT capped. Points accrue in complete groups of three saves: 3 saves = 1
 * point, 6 = 2, 9 = 3, and so on with no upper bound.
 *
 * This is a distinct function from defensive contribution points
 * (see defensiveContribution.ts) — deliberately not implemented as a variant
 * of that function, since one is capped and threshold-based while the other
 * is uncapped and accumulates in units of three.
 */

/** Points earned from goalkeeper saves in one match. Uncapped. */
export function goalkeeperSavePoints(saves: number): number {
  return Math.floor(saves / 3)
}
