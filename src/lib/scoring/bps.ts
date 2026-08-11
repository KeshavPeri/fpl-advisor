/**
 * Bonus Points System (BPS) contributions — 2026/27 rules.
 *
 * Changes from 2025/26, verified 10 Aug 2026 against the Premier League
 * (product-brief.md §6d):
 * - CBI (clearances + blocks + interceptions — NOT tackles) earns 1 BPS per
 *   THREE actions, not two.
 * - The −1 BPS penalty for being tackled is REMOVED; being tackled
 *   contributes 0 BPS.
 * - Goalkeepers earn 2 BPS for ANY save, per save (accumulates across the
 *   match, not a flat per-match award); +1 BPS if the save was inside the
 *   box; +1 BPS if the save kept out a big chance; a penalty save is a flat
 *   7 BPS (down from 8), replacing rather than stacking with the ordinary
 *   save BPS.
 */
import type { SaveEvent } from './types.ts'

const CBI_ACTIONS_PER_BPS = 3
const PENALTY_SAVE_BPS = 7
const ORDINARY_SAVE_BPS = 2
const INSIDE_BOX_SAVE_BONUS_BPS = 1
const BIG_CHANCE_SAVE_BONUS_BPS = 1

/** BPS earned from CBI (clearances + blocks + interceptions) actions: 1 per 3. */
export function bpsFromCbi(cbi: number): number {
  return Math.floor(cbi / CBI_ACTIONS_PER_BPS)
}

/**
 * BPS contribution from being tackled. Removed for 2026/27 — always 0.
 * Kept as an explicit function (rather than deleting the concept outright)
 * so callers and tests document the removal rather than silently omitting it.
 */
export function bpsFromBeingTackled(): number {
  return 0
}

/** BPS earned from a single goalkeeper save event. */
export function bpsFromSave(save: SaveEvent): number {
  if (save.isPenaltySave) return PENALTY_SAVE_BPS

  let bps = ORDINARY_SAVE_BPS
  if (save.insideBox) bps += INSIDE_BOX_SAVE_BONUS_BPS
  if (save.isBigChance) bps += BIG_CHANCE_SAVE_BONUS_BPS
  return bps
}

/** BPS earned from all of a goalkeeper's saves in a match — accumulates per save. */
export function bpsFromSaves(saves: SaveEvent[]): number {
  return saves.reduce((total, save) => total + bpsFromSave(save), 0)
}
