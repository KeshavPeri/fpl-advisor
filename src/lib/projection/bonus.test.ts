import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import type { Position } from '../scoring/types.ts'
import { allocateFixtureBonus, expectedBps, type FixtureBonusEntry } from './bonus.ts'
import type { FixtureExpectedEvents } from './expectedPoints.ts'

function events(overrides: Partial<FixtureExpectedEvents> = {}): FixtureExpectedEvents {
  return {
    expectedGoals: 0,
    expectedAssists: 0,
    expectedSaves: 0,
    expectedCbi: 0,
    expectedRecoveries: 0,
    pCleanSheet: 0,
    pAppears: 1,
    pSixtyPlus: 1,
    ...overrides,
  }
}

// ============================================================================
// expectedBps — the appearance term plus every other modelled term
// ============================================================================

describe('expectedBps: appearance term', () => {
  it('a certain starter who always reaches 60 (pAppears=1, pSixtyPlus=1) with no other output scores exactly 6 (APPEARANCE_BPS_60_PLUS)', () => {
    expect(expectedBps(DEFENDER, events())).toBe(6)
  })

  it('a certain appearer who never reaches 60 (pAppears=1, pSixtyPlus=0) with no other output scores exactly 3', () => {
    expect(expectedBps(DEFENDER, events({ pAppears: 1, pSixtyPlus: 0 }))).toBe(3)
  })

  it('a 50/50 chance of appearing at all, never reaching 60, scores exactly 1.5', () => {
    expect(expectedBps(DEFENDER, events({ pAppears: 0.5, pSixtyPlus: 0 }))).toBeCloseTo(1.5, 10)
  })
})

describe('expectedBps: goal, assist, clean sheet, save, CBI and recovery terms', () => {
  it('1 expected goal for a forward adds 24 (GOAL_BPS_FORWARD) on top of the appearance term', () => {
    const value = expectedBps(FORWARD, events({ expectedGoals: 1 }))
    expect(value).toBeCloseTo(6 + 24, 10)
  })

  it('1 expected goal for a midfielder adds 18, for a defender or goalkeeper adds 12', () => {
    expect(expectedBps(MIDFIELDER, events({ expectedGoals: 1 }))).toBeCloseTo(6 + 18, 10)
    expect(expectedBps(DEFENDER, events({ expectedGoals: 1 }))).toBeCloseTo(6 + 12, 10)
    expect(expectedBps(GOALKEEPER, events({ expectedGoals: 1 }))).toBeCloseTo(6 + 12, 10)
  })

  it('1 expected assist adds 9, every position', () => {
    expect(expectedBps(FORWARD, events({ expectedAssists: 1 }))).toBeCloseTo(6 + 9, 10)
  })

  it('a certain clean sheet (pCleanSheet=1) for a nailed defender adds 12; for a forward adds 0', () => {
    expect(expectedBps(DEFENDER, events({ pCleanSheet: 1, pSixtyPlus: 1 }))).toBeCloseTo(6 + 12, 10)
    expect(expectedBps(FORWARD, events({ pCleanSheet: 1, pSixtyPlus: 1 }))).toBeCloseTo(6, 10)
  })

  it('1 expected save adds 2 (ORDINARY_SAVE_BPS)', () => {
    expect(expectedBps(GOALKEEPER, events({ expectedSaves: 1 }))).toBeCloseTo(6 + 2, 10)
  })

  it('3 expected CBI adds exactly 1 (division, not floor)', () => {
    expect(expectedBps(DEFENDER, events({ expectedCbi: 3 }))).toBeCloseTo(6 + 1, 10)
  })

  it('1.5 expected CBI adds exactly 0.5 -- proves the term divides rather than floors like bpsFromCbi', () => {
    expect(expectedBps(DEFENDER, events({ expectedCbi: 1.5 }))).toBeCloseTo(6 + 0.5, 10)
  })

  it('3 expected recoveries adds exactly 1', () => {
    expect(expectedBps(MIDFIELDER, events({ expectedRecoveries: 3 }))).toBeCloseTo(6 + 1, 10)
  })

  it('1.5 expected recoveries adds exactly 0.5 -- division, not floor', () => {
    expect(expectedBps(MIDFIELDER, events({ expectedRecoveries: 1.5 }))).toBeCloseTo(6 + 0.5, 10)
  })
})

// ============================================================================
// allocateFixtureBonus — the share
// ============================================================================

function entry(id: number, position: Position, overrides: Partial<FixtureExpectedEvents> = {}): FixtureBonusEntry<number> {
  return { id, position, events: events(overrides) }
}

describe('allocateFixtureBonus: sums to 6.00 (+/- 0.01) whenever at least one player has positive excess and nobody is clamped', () => {
  it('shape 1: three players with clearly different, well-balanced excess (goal, assist, clean sheet) -- none over the 50%-of-total share that would trigger a clamp', () => {
    const entries = [
      entry(1, FORWARD, { expectedGoals: 0.1 }), // excess 0.1 * 24 = 2.4
      entry(2, MIDFIELDER, { expectedAssists: 0.2 }), // excess 0.2 * 9 = 1.8
      entry(3, DEFENDER, { pCleanSheet: 0.1, pSixtyPlus: 1 }), // excess 0.1 * 1 * 12 = 1.2
    ]
    const results = allocateFixtureBonus(entries)
    const total = results.reduce((sum, r) => sum + r.bonusPoints, 0)
    expect(total).toBeGreaterThanOrEqual(5.99)
    expect(total).toBeLessThanOrEqual(6.01)
    expect(results.every((r) => !r.clamped)).toBe(true)
    // Player 1's excess (2.4) is exactly 4/3 of player 2's (1.8) -> shares should reflect that ratio.
    const p1 = results.find((r) => r.id === 1)!.bonusPoints
    const p2 = results.find((r) => r.id === 2)!.bonusPoints
    expect(p1 / p2).toBeCloseTo(2.4 / 1.8, 6)
  })

  it('shape 2: two players tied on excess via two DIFFERENT terms (CBI vs recoveries) -- the only two-player shape that cannot clamp, since a strict majority share is mathematically forced above 3.0 unless the pair is exactly equal', () => {
    const entries = [
      entry(1, DEFENDER, { expectedCbi: 6 }), // excess 6 / 3 = 2.0
      entry(2, DEFENDER, { expectedRecoveries: 6 }), // excess 6 / 3 = 2.0
    ]
    const results = allocateFixtureBonus(entries)
    const total = results.reduce((sum, r) => sum + r.bonusPoints, 0)
    expect(total).toBeCloseTo(6.0, 6)
    expect(results.every((r) => !r.clamped)).toBe(true)
    expect(results[0].bonusPoints).toBeCloseTo(3.0, 6)
    expect(results[1].bonusPoints).toBeCloseTo(3.0, 6)
  })

  it('shape 3: a large group (~50 players, both clubs) with only a handful having any excess -- realistic fixture-projection shape', () => {
    const entries: FixtureBonusEntry<number>[] = []
    for (let i = 0; i < 44; i++) {
      entries.push(entry(i, DEFENDER)) // squad players with zero excess
    }
    entries.push(entry(100, FORWARD, { expectedGoals: 0.15 })) // excess 0.15 * 24 = 3.6
    entries.push(entry(101, MIDFIELDER, { expectedAssists: 0.3 })) // excess 0.3 * 9 = 2.7
    entries.push(entry(102, DEFENDER, { pCleanSheet: 0.25, pSixtyPlus: 1 })) // excess 0.25 * 1 * 12 = 3.0

    const results = allocateFixtureBonus(entries)
    const total = results.reduce((sum, r) => sum + r.bonusPoints, 0)
    expect(total).toBeGreaterThanOrEqual(5.99)
    expect(total).toBeLessThanOrEqual(6.01)
    expect(results.every((r) => !r.clamped)).toBe(true)
    // Every zero-excess squad player gets exactly 0.
    for (let i = 0; i < 44; i++) {
      expect(results.find((r) => r.id === i)?.bonusPoints).toBe(0)
    }
  })
})

describe('allocateFixtureBonus: clamping', () => {
  it('a player whose raw share would exceed 3.0 is capped at 3.0, marked clamped, and the residual is left unallocated (fixture total < 6.00)', () => {
    const entries = [
      // Overwhelmingly dominant excess -> raw share would be close to the full 6.
      entry(1, FORWARD, { expectedGoals: 2, expectedAssists: 1 }),
      entry(2, DEFENDER, { expectedCbi: 0.3 }),
    ]
    const results = allocateFixtureBonus(entries)
    const dominant = results.find((r) => r.id === 1)!
    expect(dominant.clamped).toBe(true)
    expect(dominant.bonusPoints).toBe(3.0)

    const total = results.reduce((sum, r) => sum + r.bonusPoints, 0)
    expect(total).toBeLessThan(6.0)
  })

  it('no player-fixture is ever assigned more than 3.0, even with a single-entry group taking 100% of the excess', () => {
    const entries = [entry(1, FORWARD, { expectedGoals: 5 })]
    const results = allocateFixtureBonus(entries)
    expect(results[0].bonusPoints).toBeLessThanOrEqual(3.0)
    expect(results[0].clamped).toBe(true)
  })

  it('a non-clamped player in the same fixture as a clamped one keeps its own proportional share, not a redistributed one', () => {
    const entries = [
      entry(1, FORWARD, { expectedGoals: 2, expectedAssists: 1 }), // dominant, will clamp
      entry(2, DEFENDER, { expectedCbi: 0.3 }), // small, non-dominant
      entry(3, DEFENDER, { expectedCbi: 0.3 }), // identical to player 2
    ]
    const results = allocateFixtureBonus(entries)
    const p2 = results.find((r) => r.id === 2)!
    const p3 = results.find((r) => r.id === 3)!
    expect(p2.clamped).toBe(false)
    expect(p3.clamped).toBe(false)
    // Two players with identical excess get identical shares.
    expect(p2.bonusPoints).toBeCloseTo(p3.bonusPoints, 10)
  })
})

describe('allocateFixtureBonus: zero excess', () => {
  it('every player with zero excess allocates zero bonus to everyone, with no divide-by-zero (NaN)', () => {
    const entries = [entry(1, DEFENDER), entry(2, GOALKEEPER), entry(3, MIDFIELDER)]
    const results = allocateFixtureBonus(entries)
    for (const result of results) {
      expect(result.bonusPoints).toBe(0)
      expect(result.clamped).toBe(false)
      expect(Number.isNaN(result.bonusPoints)).toBe(false)
    }
  })

  it('an empty entries array returns an empty result, no error', () => {
    expect(allocateFixtureBonus([])).toEqual([])
  })
})
