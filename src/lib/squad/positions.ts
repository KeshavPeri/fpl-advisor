/**
 * FPL position codes and the 2026/27 squad shape.
 *
 * The ticket asks for these to come from an `element_types` reference
 * table rather than being hardcoded — but no such table exists.
 * `supabase/migrations/20260811100000_reference_schema.sql` (#9) scoped the
 * reference schema to exactly four tables (teams, players, fixtures,
 * gameweeks); `element_types` was never one of them, and this ticket is not
 * the reference schema. `players.element_type` itself carries only the
 * codes as a comment ("1 GK, 2 DEF, 3 MID, 4 FWD"), matching FPL's own
 * bootstrap-static/ numbering, which is stable across seasons.
 *
 * `src/lib/scoring/types.ts` (#15) defines the same codes for a different
 * reason and explicitly does *not* want to be imported by the rest of the
 * app ("Position codes are defined locally … these functions take plain
 * position codes as input and have no dependency on how the rest of the
 * app models a player"), so reusing that module here would create exactly
 * the coupling it was written to avoid. This file is the squad feature's
 * own single source for the codes instead of scattering 1/2/3/4 through
 * validation and rendering logic. See decisions/ticket-13.md.
 */

export type PositionCode = 1 | 2 | 3 | 4

export const GOALKEEPER: PositionCode = 1
export const DEFENDER: PositionCode = 2
export const MIDFIELDER: PositionCode = 3
export const FORWARD: PositionCode = 4

export const POSITION_ORDER: readonly PositionCode[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]

export const POSITION_LABEL: Record<PositionCode, string> = {
  [GOALKEEPER]: 'Goalkeeper',
  [DEFENDER]: 'Defender',
  [MIDFIELDER]: 'Midfielder',
  [FORWARD]: 'Forward',
}

export const POSITION_SHORT_LABEL: Record<PositionCode, string> = {
  [GOALKEEPER]: 'GK',
  [DEFENDER]: 'DEF',
  [MIDFIELDER]: 'MID',
  [FORWARD]: 'FWD',
}

/** How many of each position sit in a 15-man squad, 2026/27 rules. */
export const SQUAD_SLOT_COUNT: Record<PositionCode, number> = {
  [GOALKEEPER]: 2,
  [DEFENDER]: 5,
  [MIDFIELDER]: 5,
  [FORWARD]: 3,
}

export const SQUAD_SIZE = 15
export const STARTING_XI_SIZE = 11
export const BENCH_SIZE = 4

/** Legal starting-XI formation bounds: [min, max] starters per position. */
export const FORMATION_BOUNDS: Record<PositionCode, [min: number, max: number]> = {
  [GOALKEEPER]: [1, 1],
  [DEFENDER]: [3, 5],
  [MIDFIELDER]: [2, 5],
  [FORWARD]: [1, 3],
}

/**
 * squad_position 1-15, assigned by fixed position blocks so the DB's
 * `PRIMARY KEY (gameweek_id, squad_position)` is meaningful and stable:
 * 1-2 goalkeepers, 3-7 defenders, 8-12 midfielders, 13-15 forwards.
 */
export function squadPositionRange(position: PositionCode): { start: number; end: number } {
  let start = 1
  for (const code of POSITION_ORDER) {
    const count = SQUAD_SLOT_COUNT[code]
    if (code === position) {
      return { start, end: start + count - 1 }
    }
    start += count
  }
  throw new Error(`Unknown position code: ${String(position)}`)
}

export function positionForSquadPosition(squadPosition: number): PositionCode {
  let start = 1
  for (const code of POSITION_ORDER) {
    const count = SQUAD_SLOT_COUNT[code]
    if (squadPosition >= start && squadPosition < start + count) {
      return code
    }
    start += count
  }
  throw new Error(`squad_position out of range: ${String(squadPosition)}`)
}
