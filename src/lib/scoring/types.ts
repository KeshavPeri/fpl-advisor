/**
 * Shared types for the 2026/27 scoring rules module.
 *
 * Position codes are defined locally (not imported from any FPL reference
 * schema elsewhere in the codebase) per ticket #15 scope: these functions
 * take plain position codes as input and have no dependency on how the rest
 * of the app models a player.
 */

/** FPL position codes: 1 = goalkeeper, 2 = defender, 3 = midfielder, 4 = forward. */
export type Position = 1 | 2 | 3 | 4

export const GOALKEEPER: Position = 1
export const DEFENDER: Position = 2
export const MIDFIELDER: Position = 3
export const FORWARD: Position = 4

/** Raw defensive-action counts for a single player in a single match. */
export interface DefensiveActionStats {
  clearances: number
  blocks: number
  interceptions: number
  tackles: number
  /** Ball recoveries. Count toward MID/FWD defensive contribution, not DEF or GK. */
  recoveries: number
}

/** A single save event, for BPS purposes. */
export interface SaveEvent {
  insideBox: boolean
  isBigChance: boolean
  isPenaltySave: boolean
}
