/**
 * Pure formation/bench derivation for the pitch (ticket #38).
 *
 * Formation comes from `is_starting` + `players.element_type` counts, never
 * from `squad_position` (the fixed 1-15 DB slot) — the ticket is explicit
 * that `squad_position` is not formation position. Row sizes follow the
 * actual saved squad; nothing here assumes a fixed shape like 4-4-2.
 *
 * No I/O — takes already-resolved `PitchPlayer` objects (name, price,
 * position, captaincy, bench order, availability already joined by the
 * caller) and only arranges them. See HomeScreen.tsx and
 * decisions/ticket-38.md for how — and with what data-availability caveat —
 * those objects get built.
 */

import {
  FORMATION_BOUNDS,
  POSITION_ORDER,
  type PositionCode,
} from '../lib/squad/positions'
import type { Availability } from './pitchAvailability'

export interface PitchPlayer {
  playerId: number
  position: PositionCode
  name: string
  /** Tenths of a million, `players.now_cost`'s own convention — see formatMoney. */
  price: number
  isStarting: boolean
  /** 1-4, lowest substituted first. Null for a starter. */
  benchOrder: number | null
  isCaptain: boolean
  isViceCaptain: boolean
  availability: Availability
  /**
   * `players.teams(short_name)` (ticket #276, H3) — drives the shirt's club colour via
   * src/lib/teamColours.ts. Optional/nullable: an older caller, or a player whose team join
   * failed, still renders today's neutral shirt (PlayerShirt.tsx's own fallback), never crashes.
   */
  teamShortName?: string | null
}

export interface FormationRow {
  position: PositionCode
  players: PitchPlayer[]
}

export interface PitchLayout {
  /** GK, DEF, MID, FWD, in that vertical order — POSITION_ORDER's own order.
   * A position with zero starters (an incomplete saved squad) is omitted
   * rather than rendered as an empty row. */
  rows: FormationRow[]
  /** Non-starters, `benchOrder` ascending, lowest first. A pick with no
   * `benchOrder` sorts last rather than crashing — defensive only; every
   * saved bench pick has one by construction (src/lib/squad/api.ts). */
  bench: PitchPlayer[]
  /** Whether the starting XI's per-position counts fall inside
   * FORMATION_BOUNDS — used to decide whether to note an unusual/incomplete
   * formation, never to reject or reshape what's rendered (DoD: "render the
   * picks that exist, don't crash"). */
  isFormationLegal: boolean
}

export function buildPitchLayout(players: readonly PitchPlayer[]): PitchLayout {
  const starters = players.filter((p) => p.isStarting)

  const rows: FormationRow[] = POSITION_ORDER.map((position) => ({
    position,
    players: starters.filter((p) => p.position === position),
  })).filter((row) => row.players.length > 0)

  const bench = players
    .filter((p) => !p.isStarting)
    .slice()
    .sort((a, b) => (a.benchOrder ?? Number.MAX_SAFE_INTEGER) - (b.benchOrder ?? Number.MAX_SAFE_INTEGER))

  const isFormationLegal = POSITION_ORDER.every((position) => {
    const [min, max] = FORMATION_BOUNDS[position]
    const count = starters.filter((p) => p.position === position).length
    return count >= min && count <= max
  })

  return { rows, bench, isFormationLegal }
}
