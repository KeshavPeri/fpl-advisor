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
 *
 * The constants below this point (ticket #78) are the wider BPS table
 * needed to *project* bonus points, not merely settle a finished match's
 * CBI/save/tackle terms. Verified 22 Aug 2026 against two Premier League
 * sources — do NOT take these from training data, and do NOT "correct"
 * toward fplai.app, which publishes the goal-by-position values inverted:
 *  - premierleague.com/en/news/106533 — the BPS explainer (core table).
 *  - premierleague.com/en/news/4679946 — the 2026/27 BPS changes article.
 */
import type { Position } from './types.ts'
import { DEFENDER, GOALKEEPER, MIDFIELDER } from './types.ts'
import type { SaveEvent } from './types.ts'

export const CBI_ACTIONS_PER_BPS = 3
const PENALTY_SAVE_BPS = 7
export const ORDINARY_SAVE_BPS = 2
const INSIDE_BOX_SAVE_BONUS_BPS = 1
const BIG_CHANCE_SAVE_BONUS_BPS = 1

/** BPS for playing 1-59 minutes. Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const APPEARANCE_BPS_UNDER_60 = 3
/** BPS for playing 60 or more minutes (replaces, does not stack with, the under-60 value). Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const APPEARANCE_BPS_60_PLUS = 6

/** BPS for a goal scored by a goalkeeper or defender. Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const GOAL_BPS_GOALKEEPER_DEFENDER = 12
/** BPS for a goal scored by a midfielder. Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const GOAL_BPS_MIDFIELDER = 18
/** BPS for a goal scored by a forward. Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const GOAL_BPS_FORWARD = 24

/** BPS for an assist, every position. Unchanged for 2026/27. Source: premierleague.com/en/news/106533. */
export const ASSIST_BPS = 9

/** BPS for a clean sheet earned by a goalkeeper or defender (same 60+ minute gate as FPL scoring). Unchanged for 2026/27. Source: premierleague.com/en/news/106533. Midfielders and forwards earn 0 clean-sheet BPS — see {@link cleanSheetBps} below rather than a second named-zero constant. */
export const CLEAN_SHEET_BPS_GOALKEEPER_DEFENDER = 12

/** Ball recoveries: 1 BPS per 3 recoveries. Unchanged for 2026/27. Source: premierleague.com/en/news/4679946. */
export const RECOVERY_ACTIONS_PER_BPS = 3

/** BPS for a single goal, by the scorer's position — {@link GOAL_BPS_GOALKEEPER_DEFENDER}, {@link GOAL_BPS_MIDFIELDER} or {@link GOAL_BPS_FORWARD}. */
export function goalBps(position: Position): number {
  if (position === GOALKEEPER || position === DEFENDER) return GOAL_BPS_GOALKEEPER_DEFENDER
  if (position === MIDFIELDER) return GOAL_BPS_MIDFIELDER
  return GOAL_BPS_FORWARD // FORWARD is the only remaining Position value
}

/** BPS for a clean sheet, by position — {@link CLEAN_SHEET_BPS_GOALKEEPER_DEFENDER} for goalkeepers and defenders, 0 for midfielders and forwards. */
export function cleanSheetBps(position: Position): number {
  return position === GOALKEEPER || position === DEFENDER ? CLEAN_SHEET_BPS_GOALKEEPER_DEFENDER : 0
}

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
