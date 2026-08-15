import { describe, expect, it } from 'vitest'
import {
  DEFENDER,
  FORWARD,
  GOALKEEPER,
  MIDFIELDER,
  POSITION_ORDER,
  SQUAD_SLOT_COUNT,
} from '../lib/squad/positions'
import { buildPitchLayout, type PitchPlayer } from './pitchLayout'

const AVAILABLE = { ring: 'none', label: 'Available' } as const

let nextId = 1
function player(overrides: Partial<PitchPlayer>): PitchPlayer {
  return {
    playerId: nextId++,
    position: MIDFIELDER,
    name: `Player ${nextId}`,
    price: 50,
    isStarting: true,
    benchOrder: null,
    isCaptain: false,
    isViceCaptain: false,
    availability: AVAILABLE,
    ...overrides,
  }
}

/** Builds a full 15-man squad for a given starting formation [GK, DEF, MID, FWD]. */
function buildSquad([gk, def, mid, fwd]: [number, number, number, number]): PitchPlayer[] {
  const startingByPosition = new Map([
    [GOALKEEPER, gk],
    [DEFENDER, def],
    [MIDFIELDER, mid],
    [FORWARD, fwd],
  ])

  const players: PitchPlayer[] = []
  let benchCounter = 0
  for (const position of POSITION_ORDER) {
    const total = SQUAD_SLOT_COUNT[position]
    const starting = startingByPosition.get(position) ?? 0
    for (let i = 0; i < total; i += 1) {
      const isStarting = i < starting
      players.push(
        player({
          position,
          isStarting,
          benchOrder: isStarting ? null : (benchCounter += 1),
        })
      )
    }
  }
  return players
}

describe('buildPitchLayout — formation rows follow the actual saved squad', () => {
  it('renders a 3-4-3 with the correct per-row counts, GK/DEF/MID/FWD order', () => {
    const players = buildSquad([1, 3, 4, 3])
    const { rows, isFormationLegal } = buildPitchLayout(players)

    expect(rows.map((r) => r.position)).toEqual([GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD])
    expect(rows.map((r) => r.players.length)).toEqual([1, 3, 4, 3])
    expect(isFormationLegal).toBe(true)
  })

  it('renders a 5-3-2 with the correct per-row counts, GK/DEF/MID/FWD order', () => {
    const players = buildSquad([1, 5, 3, 2])
    const { rows, isFormationLegal } = buildPitchLayout(players)

    expect(rows.map((r) => r.position)).toEqual([GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD])
    expect(rows.map((r) => r.players.length)).toEqual([1, 5, 3, 2])
    expect(isFormationLegal).toBe(true)
  })

  it('omits a position row entirely when it has zero starters, rather than rendering it empty', () => {
    // An incomplete saved squad with no forward selected as a starter yet.
    const players = buildSquad([1, 5, 5, 0])
    const { rows } = buildPitchLayout(players)
    expect(rows.some((r) => r.position === FORWARD)).toBe(false)
  })

  it('flags a formation outside FORMATION_BOUNDS as illegal without dropping any player', () => {
    // 2 defenders is below the 3-defender minimum in FORMATION_BOUNDS.
    const players = buildSquad([1, 2, 5, 3])
    const { rows, isFormationLegal } = buildPitchLayout(players)
    expect(isFormationLegal).toBe(false)
    expect(rows.find((r) => r.position === DEFENDER)?.players.length).toBe(2)
  })
})

describe('buildPitchLayout — bench', () => {
  it('sorts the bench by benchOrder ascending, lowest first', () => {
    const players = buildSquad([1, 4, 4, 2])
    const { bench } = buildPitchLayout(players)
    expect(bench.map((p) => p.benchOrder)).toEqual([1, 2, 3, 4])
  })

  it('never mixes a bench player into a formation row', () => {
    const players = buildSquad([1, 4, 4, 2])
    const { rows, bench } = buildPitchLayout(players)
    const startingIds = new Set(rows.flatMap((r) => r.players.map((p) => p.playerId)))
    for (const p of bench) {
      expect(startingIds.has(p.playerId)).toBe(false)
    }
  })
})

describe('buildPitchLayout — incomplete squads (fewer than 15 saved picks)', () => {
  it('renders whatever picks exist without throwing', () => {
    const players = buildSquad([1, 4, 4, 2]).slice(0, 8)
    expect(() => buildPitchLayout(players)).not.toThrow()
  })

  it('handles zero players at all', () => {
    const { rows, bench } = buildPitchLayout([])
    expect(rows).toEqual([])
    expect(bench).toEqual([])
  })
})
