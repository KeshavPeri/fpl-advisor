/**
 * Rate model — shrunk per-90 attacking/save rates from a player's own match
 * history plus a position prior. Two of these (xG, xA per 90) are the
 * "xG and xA rates" input named in product-brief.md §6d; a third
 * (saves per 90) reuses the identical method to feed the goalkeeper save-
 * points calculation in `expectedPoints.ts`, since `player_match_stats`
 * already carries a `saves` column and the shrinkage formula is generic.
 * Two more (CBI, recoveries per 90 — ticket #78) feed the bonus-points
 * projection in `bonus.ts` the same way, for the same reason: the shrinkage
 * formula is generic in the underlying count, not specific to attacking
 * stats.
 *
 * Pure computation only: no I/O, no database, no fetch.
 *
 * The formula, stated once here rather than per-rate: shrink the observed
 * per-90 rate toward a position prior by `k` "phantom prior nineties":
 * `(total + k × prior) / (ninetiesPlayed + k)`. With zero minutes played
 * this reduces to exactly the prior; with a full season of minutes it
 * converges on the player's own observed rate. `k = 3` is pre-answered in
 * the ticket — smaller than defconRate.ts's k = 5 because these rates are
 * lower-variance counting stats (xG/xA/saves accumulate roughly linearly
 * per 90) than a binary per-match threshold hit.
 */

/** Shrinkage strength: "phantom prior nineties" the prior is worth against observed data. Pre-answered in the ticket. */
export const SHRINKAGE_K = 3

export interface PlayerRates {
  xgPer90: number
  xaPer90: number
  savesPer90: number
  /** CBI = clearances + blocks + interceptions — NOT tackles, same definition as `src/lib/scoring/bps.ts`. Ticket #78, feeds the bonus-points projection. */
  cbiPer90: number
  /** Ball recoveries per 90. Ticket #78, feeds the bonus-points projection. */
  recoveriesPer90: number
}

/** A player's own match-history totals, aggregated across every match row available (not just the last five — see minutes.ts for that separate, smaller window). */
export interface PlayerRateHistory {
  minutesPlayed: number
  totalXg: number
  totalXa: number
  totalSaves: number
  /** Sum of clearances + blocks + interceptions across every match — ticket #78. */
  totalCbi: number
  /** Sum of recoveries across every match — ticket #78. */
  totalRecoveries: number
}

function shrunkRate(total: number, ninetiesPlayed: number, prior: number): number {
  return (total + SHRINKAGE_K * prior) / (ninetiesPlayed + SHRINKAGE_K)
}

/**
 * Shrunk per-90 rates for one player, from their own history totals and a
 * position prior (see {@link positionPriorRates}). A player with zero
 * minutes played returns the position prior exactly, by construction of the
 * formula above — no special-cased branch needed.
 */
export function computePlayerRates(history: PlayerRateHistory, positionPrior: PlayerRates): PlayerRates {
  const ninetiesPlayed = history.minutesPlayed / 90
  return {
    xgPer90: shrunkRate(history.totalXg, ninetiesPlayed, positionPrior.xgPer90),
    xaPer90: shrunkRate(history.totalXa, ninetiesPlayed, positionPrior.xaPer90),
    savesPer90: shrunkRate(history.totalSaves, ninetiesPlayed, positionPrior.savesPer90),
    cbiPer90: shrunkRate(history.totalCbi, ninetiesPlayed, positionPrior.cbiPer90),
    recoveriesPer90: shrunkRate(history.totalRecoveries, ninetiesPlayed, positionPrior.recoveriesPer90),
  }
}

/** One match's worth of the raw stats {@link positionPriorRates} aggregates over. */
export interface RateHistoryMatch {
  minutesPlayed: number
  xg: number
  xa: number
  saves: number
  /** Clearances + blocks + interceptions for this match — NOT tackles. Ticket #78. */
  cbi: number
  /** Recoveries for this match. Ticket #78. */
  recoveries: number
}

/**
 * Position-level prior per-90 rates: the observed totals across every match
 * passed in, divided by total nineties played. Feed it every match row for
 * every player in one position (e.g. every midfielder's matches from the
 * current season) to get that position's baseline — nothing here is
 * hardcoded, per the DoD.
 *
 * An empty match set (or a set with zero total minutes) returns all-zero
 * rates rather than dividing by zero — there is no data to compute a
 * baseline from, and 0 is at least honest about that, unlike a fabricated
 * literal.
 */
export function positionPriorRates(matches: readonly RateHistoryMatch[]): PlayerRates {
  const totalMinutes = matches.reduce((sum, m) => sum + m.minutesPlayed, 0)
  const ninetiesPlayed = totalMinutes / 90
  if (ninetiesPlayed === 0) {
    return { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }
  }

  const totalXg = matches.reduce((sum, m) => sum + m.xg, 0)
  const totalXa = matches.reduce((sum, m) => sum + m.xa, 0)
  const totalSaves = matches.reduce((sum, m) => sum + m.saves, 0)
  const totalCbi = matches.reduce((sum, m) => sum + m.cbi, 0)
  const totalRecoveries = matches.reduce((sum, m) => sum + m.recoveries, 0)

  return {
    xgPer90: totalXg / ninetiesPlayed,
    xaPer90: totalXa / ninetiesPlayed,
    savesPer90: totalSaves / ninetiesPlayed,
    cbiPer90: totalCbi / ninetiesPlayed,
    recoveriesPer90: totalRecoveries / ninetiesPlayed,
  }
}
