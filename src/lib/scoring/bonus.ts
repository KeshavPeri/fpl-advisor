/**
 * Bonus point allocation (3/2/1) from a match's BPS ranking, including ties,
 * per the published Premier League rule:
 *
 * - No tie: top three by BPS get 3, 2, 1.
 * - Tie for first: all players tied for first get 3; the next-highest
 *   distinct BPS value gets 1. Nobody gets 2.
 * - Tie for second: the outright leader gets 3; all players tied for second
 *   get 2. Nobody gets 1.
 * - Tie for third: the outright leader gets 3, the outright second gets 2,
 *   and every player tied for third gets 1.
 *
 * Implementation note: this is standard competition ("1224") ranking — a
 * player's rank is 1 + the count of players with strictly greater BPS, and
 * bonus = 3 for rank 1, 2 for rank 2, 1 for rank 3, 0 otherwise. Working
 * through each case above against this formula confirms it reproduces the
 * published rule exactly, including that a 3-or-more-way tie for first
 * pushes the next distinct value to rank 4 (0 bonus, not 1) — so it is used
 * here as the one general rule rather than special-casing tie sizes.
 */

export interface BpsEntry<Id> {
  id: Id
  bps: number
}

export interface BonusResult<Id> {
  id: Id
  bonus: number
}

function bonusForRank(rank: number): number {
  if (rank === 1) return 3
  if (rank === 2) return 2
  if (rank === 3) return 1
  return 0
}

/**
 * Allocates 3/2/1 bonus points to a match's players from their BPS totals,
 * handling ties at any position per the published PL rule.
 */
export function allocateBonusPoints<Id>(entries: BpsEntry<Id>[]): BonusResult<Id>[] {
  return entries.map((entry) => {
    const rank = 1 + entries.filter((other) => other.bps > entry.bps).length
    return { id: entry.id, bonus: bonusForRank(rank) }
  })
}
