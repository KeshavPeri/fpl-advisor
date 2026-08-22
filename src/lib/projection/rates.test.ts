import { describe, expect, it } from 'vitest'
import { SHRINKAGE_K, computePlayerRates, positionPriorRates } from './rates.ts'

const zeroPrior = { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }

describe('shrinkage strength is k = 3, pre-answered in the ticket', () => {
  it('is exactly 3', () => {
    expect(SHRINKAGE_K).toBe(3)
  })
})

describe('the ticket #33 worked example', () => {
  it('900 minutes, total xG 4.3, position prior 0.30 -> xgPer90 exactly 0.40 (5.2 / 13)', () => {
    const rates = computePlayerRates(
      { minutesPlayed: 900, totalXg: 4.3, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      { xgPer90: 0.3, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
    )
    expect(rates.xgPer90).toBeCloseTo(0.4, 10)
    expect(rates.xgPer90).toBeCloseTo(5.2 / 13, 12)
  })
})

describe('a player with zero minutes returns the position prior exactly', () => {
  it('xgPer90, xaPer90 and savesPer90 all equal their priors', () => {
    const prior = { xgPer90: 0.27, xaPer90: 0.15, savesPer90: 1.8, cbiPer90: 0, recoveriesPer90: 0 }
    const rates = computePlayerRates(
      { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      prior,
    )
    expect(rates.xgPer90).toBeCloseTo(prior.xgPer90, 10)
    expect(rates.xaPer90).toBeCloseTo(prior.xaPer90, 10)
    expect(rates.savesPer90).toBeCloseTo(prior.savesPer90, 10)
  })

  // Ticket #78: cbiPer90 and recoveriesPer90 are the two new shrunk rates,
  // built with the exact same formula as xG/xA/saves above -- this asserts
  // that formula's "returns the prior exactly at zero minutes" guarantee
  // extends to both of them too, not just the three pre-existing rates.
  it('cbiPer90 and recoveriesPer90 also equal their priors exactly', () => {
    const prior = { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 4.2, recoveriesPer90: 6.7 }
    const rates = computePlayerRates(
      { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      prior,
    )
    expect(rates.cbiPer90).toBeCloseTo(prior.cbiPer90, 10)
    expect(rates.recoveriesPer90).toBeCloseTo(prior.recoveriesPer90, 10)
  })
})

describe('shrinkage toward the prior', () => {
  it('a small sample sits strictly between the observed rate and the prior', () => {
    // 90 minutes (1 ninety), 1 xG -> raw observed rate would be 1.0/90 = 1.0 per 90.
    const prior = { xgPer90: 0.2, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }
    const rates = computePlayerRates(
      { minutesPlayed: 90, totalXg: 1, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      prior,
    )
    expect(rates.xgPer90).toBeGreaterThan(prior.xgPer90)
    expect(rates.xgPer90).toBeLessThan(1.0)
  })

  it('cbiPer90 also sits strictly between the observed rate and the prior', () => {
    // 90 minutes (1 ninety), 6 CBI -> raw observed rate would be 6.0 per 90.
    const prior = { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 1.0, recoveriesPer90: 0 }
    const rates = computePlayerRates(
      { minutesPlayed: 90, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 6, totalRecoveries: 0 },
      prior,
    )
    expect(rates.cbiPer90).toBeGreaterThan(prior.cbiPer90)
    expect(rates.cbiPer90).toBeLessThan(6.0)
  })
})

describe('convergence on the observed rate with a large sample', () => {
  it('3600 minutes (40 nineties), 20 xG -> close to the raw 0.5 per 90 rate regardless of a very different prior', () => {
    const rates = computePlayerRates(
      { minutesPlayed: 3600, totalXg: 20, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      { xgPer90: 0.05, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
    )
    // (20 + 3*0.05) / (40 + 3) = 20.15 / 43 ~= 0.4686 -- pulled only slightly off 0.5 by the prior.
    expect(rates.xgPer90).toBeCloseTo(20.15 / 43, 10)
    expect(rates.xgPer90).toBeGreaterThan(0.45)
  })
})

describe('positionPriorRates: computed from the data passed in, never hardcoded', () => {
  it('divides total counting stats by total nineties across every match given', () => {
    const matches = [
      { minutesPlayed: 90, xg: 0.5, xa: 0.2, saves: 0, cbi: 3, recoveries: 2 },
      { minutesPlayed: 90, xg: 0.3, xa: 0.1, saves: 0, cbi: 6, recoveries: 4 },
      { minutesPlayed: 45, xg: 0.1, xa: 0.0, saves: 0, cbi: 0, recoveries: 0 },
    ]
    // total minutes 225 -> 2.5 nineties. total xG 0.9, total xA 0.3, total CBI 9, total recoveries 6.
    const prior = positionPriorRates(matches)
    expect(prior.xgPer90).toBeCloseTo(0.9 / 2.5, 10)
    expect(prior.xaPer90).toBeCloseTo(0.3 / 2.5, 10)
    expect(prior.savesPer90).toBe(0)
    expect(prior.cbiPer90).toBeCloseTo(9 / 2.5, 10)
    expect(prior.recoveriesPer90).toBeCloseTo(6 / 2.5, 10)
  })

  it('an empty match set returns all-zero rates, not an error or NaN', () => {
    const prior = positionPriorRates([])
    expect(prior).toEqual(zeroPrior)
  })

  it('a match set with zero total minutes returns all-zero rates, not NaN from a division by zero', () => {
    const prior = positionPriorRates([{ minutesPlayed: 0, xg: 5, xa: 5, saves: 5, cbi: 5, recoveries: 5 }])
    expect(prior.xgPer90).toBe(0)
    expect(prior.xaPer90).toBe(0)
    expect(prior.savesPer90).toBe(0)
    expect(prior.cbiPer90).toBe(0)
    expect(prior.recoveriesPer90).toBe(0)
  })

  it('saves rate is computed the same way, from the saves column', () => {
    const matches = [{ minutesPlayed: 90, xg: 0, xa: 0, saves: 3, cbi: 0, recoveries: 0 }]
    const prior = positionPriorRates(matches)
    expect(prior.savesPer90).toBeCloseTo(3, 10)
  })

  it('cbi rate is clearances + blocks + interceptions, not tackles -- the caller decides what counts as CBI, this function just divides', () => {
    const matches = [{ minutesPlayed: 90, xg: 0, xa: 0, saves: 0, cbi: 7, recoveries: 0 }]
    const prior = positionPriorRates(matches)
    expect(prior.cbiPer90).toBeCloseTo(7, 10)
  })

  it('recoveries rate is computed the same way, from the recoveries column', () => {
    const matches = [{ minutesPlayed: 90, xg: 0, xa: 0, saves: 0, cbi: 0, recoveries: 5 }]
    const prior = positionPriorRates(matches)
    expect(prior.recoveriesPer90).toBeCloseTo(5, 10)
  })
})

describe('no probability or rate literal appears outside SHRINKAGE_K and test fixtures', () => {
  it('a zero prior with zero history yields exactly zero, proving no hidden hardcoded floor', () => {
    const rates = computePlayerRates(
      { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      zeroPrior,
    )
    expect(rates).toEqual(zeroPrior)
  })
})

describe('every returned rate is finite', () => {
  it.each([
    [{ minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 }, zeroPrior],
    [
      { minutesPlayed: 900, totalXg: 4.3, totalXa: 2.1, totalSaves: 0, totalCbi: 12, totalRecoveries: 20 },
      { xgPer90: 0.3, xaPer90: 0.1, savesPer90: 0, cbiPer90: 2, recoveriesPer90: 3 },
    ],
    [
      { minutesPlayed: 90, totalXg: 0, totalXa: 0, totalSaves: 10, totalCbi: 0, totalRecoveries: 0 },
      { xgPer90: 0, xaPer90: 0, savesPer90: 3, cbiPer90: 0, recoveriesPer90: 0 },
    ],
  ] as const)('history=%j prior=%j', (history, prior) => {
    const rates = computePlayerRates(history, prior)
    expect(Number.isFinite(rates.xgPer90)).toBe(true)
    expect(Number.isFinite(rates.xaPer90)).toBe(true)
    expect(Number.isFinite(rates.savesPer90)).toBe(true)
    expect(Number.isFinite(rates.cbiPer90)).toBe(true)
    expect(Number.isFinite(rates.recoveriesPer90)).toBe(true)
  })
})
