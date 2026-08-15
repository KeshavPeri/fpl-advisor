import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_AVAILABILITY,
  NO_HISTORY_BASELINE_MINUTES,
  NO_HISTORY_BASELINE_SIXTY_PLUS_RATE,
  availabilityFactor,
  estimateMinutes,
} from './minutes.ts'

describe('the ticket #33 worked example', () => {
  const recentMinutes = [90, 90, 90, 62, 20]
  const availability = 0.75
  const estimate = estimateMinutes(recentMinutes, availability)

  it('expected minutes is 52.8, within 0.001', () => {
    expect(estimate.expectedMinutes).toBeCloseTo(52.8, 3)
  })
  it('pSixtyPlus is 0.60, within 0.001', () => {
    expect(estimate.pSixtyPlus).toBeCloseTo(0.6, 3)
  })
  it('pAppears is 0.75, within 0.001', () => {
    expect(estimate.pAppears).toBeCloseTo(0.75, 3)
  })
})

describe('availability derivation from status and chance_of_playing_next_round', () => {
  it("status 'a' with a null chance -> 1.0", () => {
    expect(availabilityFactor('a', null)).toBe(1.0)
  })
  it('a non-null chance always wins, regardless of status -> chance / 100', () => {
    expect(availabilityFactor('a', 75)).toBeCloseTo(0.75, 10)
    expect(availabilityFactor('d', 50)).toBeCloseTo(0.5, 10)
    expect(availabilityFactor('i', 25)).toBeCloseTo(0.25, 10)
  })
  it("status 'i' with a null chance -> 0.0", () => {
    expect(availabilityFactor('i', null)).toBe(0.0)
  })
  it("status 's' with a null chance -> 0.0", () => {
    expect(availabilityFactor('s', null)).toBe(0.0)
  })
  it("status 'u' with a null chance -> 0.0", () => {
    expect(availabilityFactor('u', null)).toBe(0.0)
  })
  it('an unrecognised status with a null chance -> neutral (0.5), not an assertion either way', () => {
    expect(availabilityFactor('d', null)).toBe(NEUTRAL_AVAILABILITY)
    expect(availabilityFactor('n', null)).toBe(NEUTRAL_AVAILABILITY)
  })
  it('a chance of 0 is respected as 0, not treated as "missing"', () => {
    expect(availabilityFactor('d', 0)).toBe(0)
  })
})

describe('no-history fallback', () => {
  it('returns the named baseline (not zero, NaN, or an error) for an empty recent-minutes array', () => {
    const estimate = estimateMinutes([], 1.0)
    expect(estimate.expectedMinutes).toBe(NO_HISTORY_BASELINE_MINUTES)
    expect(estimate.pSixtyPlus).toBe(NO_HISTORY_BASELINE_SIXTY_PLUS_RATE)
    expect(estimate.pAppears).toBe(1.0)
    expect(Number.isFinite(estimate.expectedMinutes)).toBe(true)
    expect(Number.isNaN(estimate.expectedMinutes)).toBe(false)
  })
  it('the fallback is still scaled by availability', () => {
    const estimate = estimateMinutes([], 0.5)
    expect(estimate.expectedMinutes).toBeCloseTo(NO_HISTORY_BASELINE_MINUTES * 0.5, 10)
    expect(estimate.pSixtyPlus).toBeCloseTo(NO_HISTORY_BASELINE_SIXTY_PLUS_RATE * 0.5, 10)
  })
  it('zero availability gives zero minutes, not an error', () => {
    const estimate = estimateMinutes([], 0)
    expect(estimate.expectedMinutes).toBe(0)
    expect(estimate.pAppears).toBe(0)
    expect(estimate.pSixtyPlus).toBe(0)
  })
})

describe('the 60-minute qualifying rule from defconRate.ts is NOT applied here', () => {
  it('a cameo (< 60 minutes) still counts toward the average and toward pAppears', () => {
    // All five matches are cameos under 60 minutes — defconRate.ts would
    // treat every one of these as non-qualifying and fall back to a prior.
    // minutes.ts must still average them, not discard them.
    const estimate = estimateMinutes([10, 15, 20, 25, 30], 1.0)
    expect(estimate.expectedMinutes).toBeCloseTo(20, 10) // (10+15+20+25+30)/5
    expect(estimate.pSixtyPlus).toBe(0) // none reach 60
    expect(estimate.pAppears).toBe(1.0) // availability alone, unaffected by the cameo minutes
  })
})

describe('fewer than five history rows (early in a first season) — average over however many are given', () => {
  it('two match rows', () => {
    const estimate = estimateMinutes([90, 70], 1.0)
    expect(estimate.expectedMinutes).toBeCloseTo(80, 10)
    expect(estimate.pSixtyPlus).toBe(1.0)
  })
})

describe('every returned value is finite', () => {
  it.each([
    [[], 1.0],
    [[], 0],
    [[0, 0, 0, 0, 0], 1.0],
    [[90, 90, 90, 90, 90], 0.5],
  ] as const)('recentMinutes=%j availability=%j', (recentMinutes, availability) => {
    const estimate = estimateMinutes(recentMinutes, availability)
    expect(Number.isFinite(estimate.expectedMinutes)).toBe(true)
    expect(Number.isFinite(estimate.pAppears)).toBe(true)
    expect(Number.isFinite(estimate.pSixtyPlus)).toBe(true)
  })
})
