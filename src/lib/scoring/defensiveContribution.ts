/**
 * Defensive contribution points — 2026/27 rules (unchanged from 2025/26).
 *
 * Capped at +2 per match; it is a threshold, not a per-action accumulator:
 * reaching the threshold scores 2, and further actions in the same match do
 * not score more.
 *
 * - Defenders: threshold is 10 CBIT (clearances + blocks + interceptions +
 *   tackles). Recoveries do NOT count for defenders.
 * - Midfielders and forwards: threshold is 12 CBIRT (the same four actions
 *   plus recoveries).
 * - Goalkeepers do not earn defensive contribution points.
 *
 * This is a distinct function from goalkeeper save points
 * (see goalkeeperSaves.ts) — the two are not variants of one another.
 */
import type { DefensiveActionStats, Position } from './types.ts'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from './types.ts'

const DEFENSIVE_CONTRIBUTION_CAP = 2
const DEFENDER_THRESHOLD = 10
const MID_FORWARD_THRESHOLD = 12

/** Sum of clearances, blocks, interceptions and tackles. */
export function cbitCount(stats: DefensiveActionStats): number {
  return stats.clearances + stats.blocks + stats.interceptions + stats.tackles
}

/** CBIT plus recoveries. */
export function cbirtCount(stats: DefensiveActionStats): number {
  return cbitCount(stats) + stats.recoveries
}

/**
 * Defensive contribution points for one player in one match.
 * Returns 0 or 2 (the cap) — never a partial or multiplied value.
 */
export function defensiveContributionPoints(
  position: Position,
  stats: DefensiveActionStats,
): number {
  if (position === GOALKEEPER) return 0

  if (position === DEFENDER) {
    return cbitCount(stats) >= DEFENDER_THRESHOLD ? DEFENSIVE_CONTRIBUTION_CAP : 0
  }

  if (position === MIDFIELDER || position === FORWARD) {
    return cbirtCount(stats) >= MID_FORWARD_THRESHOLD ? DEFENSIVE_CONTRIBUTION_CAP : 0
  }

  return 0
}
