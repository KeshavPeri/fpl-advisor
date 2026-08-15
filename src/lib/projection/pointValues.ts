/**
 * The 2026/27 standard FPL scoring point values — verified 15 Aug 2026
 * against two independent published scoring tables (draftfantasy.com and
 * worldinsport.com), both agreeing. This is the **only** place in the
 * repository these numbers may appear (ticket #33 DoD) — every other module
 * that needs a goal, assist, clean-sheet, appearance, goals-conceded or
 * save point value imports it from here rather than restating it.
 *
 * `src/lib/scoring/totalMatchPoints.ts` deliberately holds none of these
 * values (see the comment at the top of that file — it is an aggregator,
 * not a rules table). This file is the other half of that split: it is
 * where the values themselves live, for both the live scoring module and
 * this ticket's projection model.
 *
 * NOTE: the goalkeeper goal value is 10, not 6. That is the current
 * published figure for 2026/27, not a typo — do not "correct" it back to
 * the historical 6.
 */
import type { Position } from '../scoring/types.ts'
import { DEFENDER, GOALKEEPER } from '../scoring/types.ts'

// Keyed on the plain FPL position codes (1 GK, 2 DEF, 3 MID, 4 FWD — same
// convention as the `element_type` comment in the #9 reference-schema
// migration) rather than the imported GOALKEEPER/DEFENDER/... constants:
// those are typed as the widened `Position` union in scoring/types.ts, not
// as literal types, so using them as computed object keys here would make
// TypeScript infer an index signature instead of the exact
// Record<Position, number> these tables are meant to be.

/** Points per goal scored, by position. */
export const GOAL_POINTS: Readonly<Record<Position, number>> = {
  1: 10, // goalkeeper
  2: 6, // defender
  3: 5, // midfielder
  4: 4, // forward
}

/** Points for a clean sheet (60+ minutes required), by position. */
export const CLEAN_SHEET_POINTS: Readonly<Record<Position, number>> = {
  1: 4, // goalkeeper
  2: 4, // defender
  3: 1, // midfielder
  4: 0, // forward
}

/** Points per assist: flat 3, every position. */
export const ASSIST_POINTS = 3

/** Appearance points: 1 point for 1-59 minutes played, 2 points for 60+. */
export const APPEARANCE_POINTS_UNDER_60 = 1
export const APPEARANCE_POINTS_60_PLUS = 2

/**
 * Goals conceded: -1 point per 2 goals conceded while on the pitch.
 * Applies to goalkeepers and defenders only.
 */
export const GOALS_CONCEDED_POINTS_PER_UNIT = -1
export const GOALS_CONCEDED_DIVISOR = 2

/**
 * Saves: +1 point per 3 saves. Uncapped. Goalkeepers only.
 */
export const SAVE_POINTS_PER_UNIT = 1
export const SAVES_DIVISOR = 3

export function goalPoints(position: Position): number {
  return GOAL_POINTS[position]
}

export function cleanSheetPoints(position: Position): number {
  return CLEAN_SHEET_POINTS[position]
}

/** Goals-conceded points apply to goalkeepers and defenders only. */
export function goalsConcededPointsApply(position: Position): boolean {
  return position === GOALKEEPER || position === DEFENDER
}

/** Save points apply to goalkeepers only. */
export function savePointsApply(position: Position): boolean {
  return position === GOALKEEPER
}

/**
 * Expected appearance points from probability of appearing at all
 * (`pAppears`) and probability of reaching 60 minutes (`pSixtyPlus`):
 * `pAppears × APPEARANCE_POINTS_UNDER_60 + pSixtyPlus × (APPEARANCE_POINTS_60_PLUS - APPEARANCE_POINTS_UNDER_60)`,
 * i.e. `pAppears × 1 + pSixtyPlus × 1` at today's values — every appearance
 * earns the base point, and reaching 60 minutes earns the second point on
 * top.
 */
export function expectedAppearancePoints(pAppears: number, pSixtyPlus: number): number {
  return pAppears * APPEARANCE_POINTS_UNDER_60 + pSixtyPlus * (APPEARANCE_POINTS_60_PLUS - APPEARANCE_POINTS_UNDER_60)
}
