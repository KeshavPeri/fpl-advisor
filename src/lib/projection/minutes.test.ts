import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_AVAILABILITY,
  NO_HISTORY_BASELINE_MINUTES,
  NO_HISTORY_BASELINE_SIXTY_PLUS_RATE,
  availabilityFactor,
  estimateMinutes,
} from './minutes.ts'

describe('the ticket #33 worked example, recomputed by hand for the ticket #188 estimator', () => {
  // recentMinutes = [90, 90, 90, 62, 20] is a FULL 5-row window, so the v2
  // estimator drops its single lowest raw value before splitting into
  // featured/minutes-given-featured/60-plus-given-featured (see minutes.ts
  // file header). By hand:
  //   sorted:            [20, 62, 90, 90, 90]
  //   drop lowest (20):  [62, 90, 90, 90]           <- the "sample"
  //   featured (>0):     [62, 90, 90, 90]  (all four)
  //   pFeature         = 4/4 = 1.0
  //   minutesGivenFeat = (62+90+90+90)/4 = 332/4 = 83
  //   pSixtyGivenFeat  = 4/4 = 1.0   (62 already clears the 60-minute bar)
  //   expectedMinutesRaw = 1.0 * 83   = 83
  //   pSixtyPlusRaw       = 1.0 * 1.0 = 1.0
  // scaled by availability = 0.75:
  //   expectedMinutes = 83   * 0.75 = 62.25
  //   pSixtyPlus      = 1.0  * 0.75 = 0.75
  const recentMinutes = [90, 90, 90, 62, 20]
  const availability = 0.75
  const estimate = estimateMinutes(recentMinutes, availability)

  it('expected minutes is 62.25, within 0.001', () => {
    expect(estimate.expectedMinutes).toBeCloseTo(62.25, 3)
  })
  it('pSixtyPlus is 0.75, within 0.001', () => {
    expect(estimate.pSixtyPlus).toBeCloseTo(0.75, 3)
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
  it('cameos under 60 minutes still count toward the estimate and toward pAppears, not discarded', () => {
    // All five matches are cameos under 60 minutes — defconRate.ts would
    // treat every one of these as non-qualifying and fall back to a prior.
    // minutes.ts must still use every one of them (none dropped for being
    // under 60), which this test still demonstrates after ticket #188: this
    // is a FULL 5-row window, so the v2 estimator drops its single lowest
    // raw value (20, the qualifying-rule filter would have dropped none of
    // them), then treats the remaining four cameos as "featured" (>0) and
    // averages their minutes — it does not gate any of them out for being
    // under 60. By hand:
    //   sorted:            [10, 15, 20, 25, 30]
    //   drop lowest (10):  [15, 20, 25, 30]
    //   featured (>0):     [15, 20, 25, 30]  (all four — cameos still count)
    //   pFeature         = 4/4 = 1.0
    //   minutesGivenFeat = (15+20+25+30)/4 = 90/4 = 22.5
    //   pSixtyGivenFeat  = 0/4 = 0            (none of the four reach 60)
    //   expectedMinutesRaw = 1.0 * 22.5 = 22.5;  pSixtyPlusRaw = 1.0 * 0 = 0
    // at availability 1.0: expectedMinutes = 22.5, pSixtyPlus = 0.
    const estimate = estimateMinutes([10, 15, 20, 25, 30], 1.0)
    expect(estimate.expectedMinutes).toBeCloseTo(22.5, 10)
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

describe('ticket #188 — minutes v2: start probability x minutes-given-start', () => {
  it('one rested match in an otherwise nailed-starter window (90,90,90,90,0) is materially higher than the old 72.0/0.8, not just nudged', () => {
    // Full 5-row window. By hand:
    //   sorted:            [0, 90, 90, 90, 90]
    //   drop lowest (0):   [90, 90, 90, 90]
    //   featured (>0):     [90, 90, 90, 90]  (all four)
    //   pFeature = 4/4 = 1.0; minutesGivenFeat = 90; pSixtyGivenFeat = 4/4 = 1.0
    //   expectedMinutesRaw = 1.0 * 90 = 90; pSixtyPlusRaw = 1.0 * 1.0 = 1.0
    // at full availability (1.0): expectedMinutes = 90, pSixtyPlus = 1.0 —
    // against the v1 estimator's 72.0 / 0.8 for this exact window (§ ticket
    // #188 context: this is the live GW3 Haaland case).
    const estimate = estimateMinutes([90, 90, 90, 90, 0], 1.0)
    expect(estimate.expectedMinutes).toBeCloseTo(90, 10)
    expect(estimate.pSixtyPlus).toBeCloseTo(1.0, 10)
    // Explicit regression guard against the old formula's numbers, so this
    // test fails loudly if the estimator ever reverts to a plain mean.
    expect(estimate.expectedMinutes).toBeGreaterThan(72.0 * 1.2)
    expect(estimate.pSixtyPlus).toBeGreaterThan(0.8 * 1.2)
  })

  it('a genuine rotation player (90,0,45,0,90) is NOT inflated into a nailed starter', () => {
    // Full 5-row window with TWO low/zero values (unlike the single-outlier
    // case above), so only one is dropped and one zero remains in the
    // sample — the mechanism that stops "one robustness fix" from becoming
    // "everyone is a starter". By hand:
    //   sorted:            [0, 0, 45, 90, 90]
    //   drop lowest (0):   [0, 45, 90, 90]        <- one zero remains
    //   featured (>0):     [45, 90, 90]
    //   pFeature = 3/4 = 0.75
    //   minutesGivenFeat = (45+90+90)/3 = 225/3 = 75
    //   pSixtyGivenFeat  = 2/3 (45 does not reach 60; both 90s do)
    //   expectedMinutesRaw = 0.75 * 75      = 56.25
    //   pSixtyPlusRaw       = 0.75 * (2/3)  = 0.5
    // at full availability (1.0): expectedMinutes = 56.25, pSixtyPlus = 0.5.
    const rotation = estimateMinutes([90, 0, 45, 0, 90], 1.0)
    expect(rotation.expectedMinutes).toBeCloseTo(56.25, 10)
    expect(rotation.pSixtyPlus).toBeCloseTo(0.5, 10)

    // The actual DoD requirement: recognisably below a nailed starter's
    // figures for the same availability, not just below some fixed number.
    const nailedStarter = estimateMinutes([90, 90, 90, 90, 90], 1.0)
    expect(rotation.expectedMinutes).toBeLessThan(nailedStarter.expectedMinutes * 0.8)
    expect(rotation.pSixtyPlus).toBeLessThan(nailedStarter.pSixtyPlus * 0.8)
  })

  it('five identical full matches still give expectedMinutes = 90 x pAppears, pSixtyPlus = pAppears — the unambiguous case must not move', () => {
    // Full 5-row window, all identical. Dropping the single lowest (one of
    // the five 90s) leaves four more 90s — the estimate is unchanged by
    // construction for a genuinely uniform window.
    const availability = 0.6
    const estimate = estimateMinutes([90, 90, 90, 90, 90], availability)
    expect(estimate.expectedMinutes).toBeCloseTo(90 * availability, 10)
    expect(estimate.pSixtyPlus).toBeCloseTo(availability, 10)
  })

  it('availability still scales both outputs; zero availability gives zero regardless of the window', () => {
    const fullAvailability = estimateMinutes([90, 90, 90, 90, 90], 1.0)
    const halfAvailability = estimateMinutes([90, 90, 90, 90, 90], 0.5)
    expect(halfAvailability.expectedMinutes).toBeCloseTo(fullAvailability.expectedMinutes * 0.5, 10)
    expect(halfAvailability.pSixtyPlus).toBeCloseTo(fullAvailability.pSixtyPlus * 0.5, 10)

    const zeroAvailability = estimateMinutes([90, 90, 90, 90, 90], 0)
    expect(zeroAvailability.expectedMinutes).toBe(0)
    expect(zeroAvailability.pAppears).toBe(0)
    expect(zeroAvailability.pSixtyPlus).toBe(0)
  })

  it('the empty-window (no-history) path is untouched by the v2 estimator', () => {
    const estimate = estimateMinutes([], 1.0)
    expect(estimate.expectedMinutes).toBe(NO_HISTORY_BASELINE_MINUTES)
    expect(estimate.pSixtyPlus).toBe(NO_HISTORY_BASELINE_SIXTY_PLUS_RATE)
    expect(estimate.pAppears).toBe(1.0)
  })

  it('expectedMinutes never exceeds 90 even on a dirty above-90 source value', () => {
    // 96 simulates a stoppage-time-inflated minutes_played reading; the
    // defensive Math.min(..., 90) in estimateMinutes must hold regardless.
    const estimate = estimateMinutes([96, 96, 96, 96, 96], 1.0)
    expect(estimate.expectedMinutes).toBeLessThanOrEqual(90)
  })

  it('pSixtyPlus never exceeds 1', () => {
    const estimate = estimateMinutes([90, 90, 90, 90, 90], 1.0)
    expect(estimate.pSixtyPlus).toBeLessThanOrEqual(1)
  })

  it.each([
    [[90, 90, 90, 90, 0], 1.0],
    [[90, 0, 45, 0, 90], 1.0],
    [[0, 0, 0, 0, 0], 1.0],
    [[10, 15, 20, 25, 30], 1.0],
  ] as const)('bounds hold for recentMinutes=%j availability=%j', (recentMinutes, availability) => {
    const estimate = estimateMinutes(recentMinutes, availability)
    expect(estimate.expectedMinutes).toBeGreaterThanOrEqual(0)
    expect(estimate.expectedMinutes).toBeLessThanOrEqual(90)
    expect(estimate.pSixtyPlus).toBeGreaterThanOrEqual(0)
    expect(estimate.pSixtyPlus).toBeLessThanOrEqual(1)
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
