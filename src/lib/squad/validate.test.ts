import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER, squadPositionRange } from './positions'
import type { SquadSlot } from './types'
import { validateSquad } from './validate'

/** Builds a full 15-slot squad. `starting` counts are [GK, DEF, MID, FWD]. */
function buildSquad(starting: [number, number, number, number]): SquadSlot[] {
  const slots: SquadSlot[] = []
  let nextPlayerId = 1
  const positions = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD] as const

  positions.forEach((position, i) => {
    const { start, end } = squadPositionRange(position)
    const startingCount = starting[i]
    for (let squadPosition = start; squadPosition <= end; squadPosition += 1) {
      slots.push({
        squadPosition,
        position,
        playerId: nextPlayerId++,
        isStarting: squadPosition - start < startingCount,
        benchOrder: null,
        isCaptain: false,
        isViceCaptain: false,
      })
    }
  })

  // Captain/vice on the first two starters found.
  const starters = slots.filter((s) => s.isStarting)
  starters[0].isCaptain = true
  starters[1].isViceCaptain = true

  return slots
}

const VALID_MONEY = ['0.5', '99.5', '1'] as const

describe('validateSquad — formation legality (product-brief.md / ticket #13 examples)', () => {
  it('rejects a 2-5-3 (2 DEF is below the 3-defender minimum)', () => {
    const slots = buildSquad([1, 2, 5, 3])
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('defender'))).toBe(true)
  })

  it('accepts a 3-4-3', () => {
    const slots = buildSquad([1, 3, 4, 3])
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.errors).toEqual([])
    expect(result.parsed).not.toBeNull()
  })

  it('accepts a 3-5-2', () => {
    const slots = buildSquad([1, 3, 5, 2])
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.errors).toEqual([])
    expect(result.parsed).not.toBeNull()
  })
})

describe('validateSquad — counts', () => {
  it('rejects fewer than 15 picks, naming how many are missing', () => {
    const slots = buildSquad([1, 3, 4, 3])
    slots[14].playerId = null // empty the last forward slot
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('14 of 15') && e.includes('1 slot'))).toBe(true)
  })

  it('rejects other than 11 starters', () => {
    const slots = buildSquad([1, 3, 4, 2]) // 10 starters
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('10 players') && e.includes('exactly 11'))).toBe(
      true
    )
  })
})

describe('validateSquad — captaincy', () => {
  it('rejects captain and vice-captain being the same player', () => {
    const slots = buildSquad([1, 3, 4, 3])
    const starters = slots.filter((s) => s.isStarting)
    starters[0].isCaptain = false // clear buildSquad's default captain
    starters[1].isCaptain = true
    starters[1].isViceCaptain = true
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('same player'))).toBe(true)
  })

  it('rejects a missing captain', () => {
    const slots = buildSquad([1, 3, 4, 3])
    slots.filter((s) => s.isStarting)[0].isCaptain = false
    const result = validateSquad(slots, ...VALID_MONEY)
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('No captain'))).toBe(true)
  })
})

describe('validateSquad — money fields', () => {
  it('rejects a non-numeric bank value', () => {
    const slots = buildSquad([1, 3, 4, 3])
    const result = validateSquad(slots, 'lots', '99.5', '1')
    expect(result.parsed).toBeNull()
    expect(result.errors.some((e) => e.includes('Bank must be a number'))).toBe(true)
  })

  it('accepts a fully valid squad and parses the money fields to tenths', () => {
    const slots = buildSquad([1, 3, 4, 3])
    const result = validateSquad(slots, '0.5', '99.5', '2')
    expect(result.errors).toEqual([])
    expect(result.parsed).toEqual({ bank: 5, squadValue: 995, freeTransfers: 2 })
  })
})
