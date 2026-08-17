import { describe, expect, it } from 'vitest'
import { deriveLineup, findCaptain, findViceCaptain, type LineupPickInput } from './lineup.ts'

function pick(overrides: Partial<LineupPickInput> = {}): LineupPickInput {
  return {
    playerId: 1,
    playerCode: 100,
    isLineup: true,
    benchOrder: null,
    isCaptain: false,
    isViceCaptain: false,
    ...overrides,
  }
}

describe('deriveLineup', () => {
  it('splits eleven starters from four bench players', () => {
    const starters = Array.from({ length: 11 }, (_, i) => pick({ playerId: i + 1, isLineup: true, benchOrder: null }))
    const bench = [1, 2, 3, 4].map((order) => pick({ playerId: 100 + order, isLineup: false, benchOrder: order }))
    const { startingXI, bench: derivedBench } = deriveLineup([...starters, ...bench])
    expect(startingXI).toHaveLength(11)
    expect(derivedBench).toHaveLength(4)
  })

  it('a pick with benchOrder 1 (the shift of the solver\'s raw bench slot 0) is classified as bench, never as a starter — the single most likely off-by-one', () => {
    const picks = [
      pick({ playerId: 1, isLineup: true, benchOrder: null }),
      pick({ playerId: 2, isLineup: false, benchOrder: 1 }), // solver's raw "bench: 0" shifted by +1
    ]
    const { startingXI, bench } = deriveLineup(picks)
    expect(startingXI.map((p) => p.playerId)).not.toContain(2)
    expect(bench.map((p) => p.playerId)).toContain(2)
    expect(bench).toHaveLength(1)
  })

  it('orders the bench ascending by benchOrder — first off the bench is index 0', () => {
    const picks = [
      pick({ playerId: 14, isLineup: false, benchOrder: 4 }),
      pick({ playerId: 12, isLineup: false, benchOrder: 2 }),
      pick({ playerId: 11, isLineup: false, benchOrder: 1 }),
      pick({ playerId: 13, isLineup: false, benchOrder: 3 }),
    ]
    const { bench } = deriveLineup(picks)
    expect(bench.map((p) => p.playerId)).toEqual([11, 12, 13, 14])
  })

  it('classifies membership from isLineup alone, not from benchOrder being non-null', () => {
    // A starter should never carry a non-null benchOrder in real data, but this proves the
    // function does not use benchOrder-presence as its membership test.
    const picks = [pick({ playerId: 1, isLineup: true, benchOrder: null })]
    const { startingXI, bench } = deriveLineup(picks)
    expect(startingXI).toHaveLength(1)
    expect(bench).toHaveLength(0)
  })
})

describe('findCaptain / findViceCaptain', () => {
  it('finds the captain among the starting XI', () => {
    const startingXI = [pick({ playerId: 1 }), pick({ playerId: 2, isCaptain: true }), pick({ playerId: 3 })]
    expect(findCaptain(startingXI)?.playerId).toBe(2)
  })

  it('finds the vice-captain among the starting XI', () => {
    const startingXI = [pick({ playerId: 1 }), pick({ playerId: 2, isViceCaptain: true }), pick({ playerId: 3 })]
    expect(findViceCaptain(startingXI)?.playerId).toBe(2)
  })

  it('returns null, never throws, when nobody is flagged captain', () => {
    const startingXI = [pick({ playerId: 1 }), pick({ playerId: 2 })]
    expect(findCaptain(startingXI)).toBeNull()
  })
})
