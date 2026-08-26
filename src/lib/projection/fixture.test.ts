import { describe, expect, it } from 'vitest'
import {
  HOME_ADVANTAGE_ELO,
  attackingMultiplier,
  defensiveMultiplier,
  expectedGoalsConceded,
  expectedScore,
  expectedScoreFromDifficulty,
} from './fixture.ts'

describe('expectedScore', () => {
  it('equal elo at home is between 0.592 and 0.593', () => {
    const value = expectedScore(1500, 1500, true)
    expect(value).toBeGreaterThan(0.592)
    expect(value).toBeLessThan(0.593)
  })

  it('home advantage constant is 65', () => {
    expect(HOME_ADVANTAGE_ELO).toBe(65)
  })

  it('matches the stated formula directly for an unequal pair', () => {
    const eloFor = 1600
    const eloAgainst = 1450
    const value = expectedScore(eloFor, eloAgainst, true)
    const expected = 1 / (1 + 10 ** ((eloAgainst - eloFor - 65) / 400))
    expect(value).toBeCloseTo(expected, 12)
  })

  it('is symmetric: expectedScore(a,b,true) + expectedScore(b,a,false) === 1, for three distinct elo pairs', () => {
    const pairs: Array<[number, number]> = [
      [1500, 1500],
      [1650, 1400],
      [1300, 1720],
    ]
    for (const [a, b] of pairs) {
      const sum = expectedScore(a, b, true) + expectedScore(b, a, false)
      expect(sum).toBeCloseTo(1, 12)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-12)
    }
  })

  it('a much stronger team at home approaches (but never reaches) 1', () => {
    const value = expectedScore(2000, 1200, true)
    expect(value).toBeLessThan(1)
    expect(value).toBeGreaterThan(0.98)
  })
})

describe('expectedScoreFromDifficulty — the documented elo-null fallback', () => {
  it('FDR 3 (an average fixture) is neutral: 0.5', () => {
    expect(expectedScoreFromDifficulty(3)).toBe(0.5)
  })
  it('FDR 1 (easiest) is higher than FDR 5 (hardest)', () => {
    expect(expectedScoreFromDifficulty(1)).toBeGreaterThan(expectedScoreFromDifficulty(5))
  })
  it('the table is monotonically decreasing from FDR 1 to FDR 5', () => {
    const values = [1, 2, 3, 4, 5].map(expectedScoreFromDifficulty)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1])
    }
  })
  it('every value stays within [0, 1]', () => {
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const value = expectedScoreFromDifficulty(difficulty)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
  it('an out-of-range difficulty falls back to the neutral 0.5, not NaN or an error', () => {
    expect(expectedScoreFromDifficulty(0)).toBe(0.5)
    expect(expectedScoreFromDifficulty(9)).toBe(0.5)
  })
})

describe('attackingMultiplier', () => {
  it('equals 1.0 exactly at expectedScore = 0.5', () => {
    expect(attackingMultiplier(0.5)).toBe(1.0)
  })
  it('is 2 x expectedScore', () => {
    expect(attackingMultiplier(0.3)).toBeCloseTo(0.6, 10)
    expect(attackingMultiplier(0.9)).toBeCloseTo(1.8, 10)
  })
  it('is clamped to [0, 2] even for an out-of-range expectedScore', () => {
    expect(attackingMultiplier(-1)).toBe(0)
    expect(attackingMultiplier(2)).toBe(2)
  })
})

describe('expectedGoalsConceded', () => {
  it('equals leagueBaselineGoals exactly at expectedScore = 0.5 (an even fixture)', () => {
    expect(expectedGoalsConceded(1.45, 0.5)).toBeCloseTo(1.45, 10)
  })
  it('is leagueBaselineGoals x 2 x (1 - expectedScore)', () => {
    expect(expectedGoalsConceded(1.5, 0.7)).toBeCloseTo(1.5 * 2 * 0.3, 10)
  })
  it('is clamped at zero from below for an expectedScore above 1', () => {
    expect(expectedGoalsConceded(1.5, 1.5)).toBe(0)
  })
  it('never returns a negative value', () => {
    expect(expectedGoalsConceded(1.5, 1.0)).toBeGreaterThanOrEqual(0)
  })
})

describe('defensiveMultiplier -- ticket #109, the exact mirror of attackingMultiplier', () => {
  it('equals 1.0 exactly at expectedScore = 0.5 (an even fixture must leave the term unadjusted)', () => {
    expect(defensiveMultiplier(0.5)).toBe(1.0)
  })
  it('is 2 x (1 - expectedScore)', () => {
    expect(defensiveMultiplier(0.3)).toBeCloseTo(2 * 0.7, 10)
    expect(defensiveMultiplier(0.9)).toBeCloseTo(2 * 0.1, 10)
  })
  it('returns 2.0 at expectedScore = 0 (certain loss -- maximum shot pressure)', () => {
    expect(defensiveMultiplier(0)).toBe(2.0)
  })
  it('returns 0.0 at expectedScore = 1 (certain win -- no shot pressure)', () => {
    expect(defensiveMultiplier(1)).toBe(0.0)
  })
  it('is clamped to [0, 2] even for an out-of-range expectedScore', () => {
    expect(defensiveMultiplier(-1)).toBe(2)
    expect(defensiveMultiplier(2)).toBe(0)
  })
  it('agrees with expectedGoalsConceded by construction: expectedGoalsConceded(b, s) === b x defensiveMultiplier(s), across five values of s', () => {
    const leagueBaselineGoals = 1.45
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      expect(expectedGoalsConceded(leagueBaselineGoals, s)).toBeCloseTo(leagueBaselineGoals * defensiveMultiplier(s), 12)
    }
  })
})

describe('every returned value is finite', () => {
  it.each([
    [1500, 1500, true],
    [1000, 2000, false],
    [0, 0, true],
  ] as const)('expectedScore(%j, %j, %j)', (a, b, home) => {
    expect(Number.isFinite(expectedScore(a, b, home))).toBe(true)
  })
})
