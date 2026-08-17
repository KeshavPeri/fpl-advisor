import { describe, expect, it } from 'vitest'
import { computePlanScore, pickMultiplier } from './score.ts'

describe('pickMultiplier', () => {
  it('is 2 for the captain', () => {
    expect(pickMultiplier({ isLineup: true, isCaptain: true })).toBe(2)
  })

  it('is 1 for a non-captain starter', () => {
    expect(pickMultiplier({ isLineup: true, isCaptain: false })).toBe(1)
  })

  it('is 0 for a benched player, even if somehow flagged captain', () => {
    expect(pickMultiplier({ isLineup: false, isCaptain: false })).toBe(0)
    expect(pickMultiplier({ isLineup: false, isCaptain: true })).toBe(0)
  })
})

describe('computePlanScore', () => {
  it('sums captaincy-weighted expected points, excluding the bench entirely', () => {
    const picks = [
      { isLineup: true, isCaptain: true, expectedPoints: 5 }, // 2x5 = 10
      { isLineup: true, isCaptain: false, expectedPoints: 4 }, // 1x4 = 4
      { isLineup: false, isCaptain: false, expectedPoints: 100 }, // benched, contributes 0
    ]
    expect(computePlanScore(picks)).toBe(14)
  })

  it('is 0 for an empty pick list', () => {
    expect(computePlanScore([])).toBe(0)
  })
})
