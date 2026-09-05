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

describe('ticket #207 — reverted from #191: the plain windowed mean, deliberately, on the exact cases #191 cited', () => {
  it(
    'a nailed starter who missed exactly one of five matches (90,90,90,90,0) is discounted to 72 expected minutes ' +
      'and pSixtyPlus 0.8 — this is #191\'s own motivating case (its file header called a plain mean "measurably ' +
      'wrong" here), reverted deliberately: the honest backtest (ticket #201) showed the plain mean below still ' +
      'ranks players better overall than #191\'s start/minutes-given-start split that "fixed" this exact case. See ' +
      'docs/projection-model-backlog.md for the full evidence. This test pins the reverted number so nobody ' +
      "re-introduces the split without re-litigating that evidence.",
    () => {
      const estimate = estimateMinutes([90, 90, 90, 90, 0], 1.0)
      expect(estimate.expectedMinutes).toBeCloseTo(72, 10) // (90+90+90+90+0)/5
      expect(estimate.pSixtyPlus).toBeCloseTo(0.8, 10) // 4 of 5 reach 60+
    },
  )

  it('a player whose two most recent matches are 0 minutes (90,90,20,0,0) averages to 40 expected minutes and pSixtyPlus 0.4 — the ticket #187/#201 worked window', () => {
    const estimate = estimateMinutes([90, 90, 20, 0, 0], 1.0)
    expect(estimate.expectedMinutes).toBeCloseTo(40, 10) // (90+90+20+0+0)/5
    expect(estimate.pSixtyPlus).toBeCloseTo(0.4, 10) // 2 of 5 reach 60+
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

  it.each([
    [[], 1.0, 60],
    [[0, 0, 0, 0, 0], 1.0, 45],
    [[90, 90, 90, 90, 90], 0.5, 90],
  ] as const)('recentMinutes=%j availability=%j seasonMinutesPerMatch=%j', (recentMinutes, availability, seasonMinutesPerMatch) => {
    const estimate = estimateMinutes(recentMinutes, availability, seasonMinutesPerMatch)
    expect(Number.isFinite(estimate.expectedMinutes)).toBe(true)
    expect(Number.isFinite(estimate.pAppears)).toBe(true)
    expect(Number.isFinite(estimate.pSixtyPlus)).toBe(true)
  })
})

describe('ticket #213 — shrinking the recent window toward the season figure', () => {
  describe('the two collapse ends the DoD names', () => {
    it(
      'collapses to today\'s (pre-#213) behaviour when no season figure is supplied at all — a producer that ' +
        'cannot supply one (see PlayerProjectionInput\'s own comment) must reproduce the exact pre-#213 number, ' +
        'not a silently different one',
      () => {
        const withoutShrinkage = estimateMinutes([90, 90, 90, 90, 0], 1.0)
        const withUndefinedSeasonFigure = estimateMinutes([90, 90, 90, 90, 0], 1.0, undefined)
        expect(withUndefinedSeasonFigure.expectedMinutes).toBeCloseTo(withoutShrinkage.expectedMinutes, 10)
        expect(withUndefinedSeasonFigure.expectedMinutes).toBeCloseTo(72, 10)
      },
    )

    it(
      'collapses to today\'s behaviour when a full window\'s season figure equals the window\'s own mean — "no ' +
        'season history beyond it": nothing for shrinkage to pull the window away from',
      () => {
        const recentMinutes = [90, 90, 90, 90, 0]
        const windowMean = 72 // (90+90+90+90+0)/5
        const estimate = estimateMinutes(recentMinutes, 1.0, windowMean)
        expect(estimate.expectedMinutes).toBeCloseTo(72, 10)
      },
    )

    it('collapses to exactly the season figure when the window is empty', () => {
      const estimate = estimateMinutes([], 1.0, 63)
      expect(estimate.expectedMinutes).toBeCloseTo(63, 10)
    })

    it('the empty-window collapse to the season figure is still scaled by availability', () => {
      const estimate = estimateMinutes([], 0.5, 63)
      expect(estimate.expectedMinutes).toBeCloseTo(63 * 0.5, 10)
    })
  })

  describe('the two named concrete cases', () => {
    it(
      'a nailed starter with one recent rested match (90,90,90,90,0) moves LESS toward the discount than he does ' +
        'today: a season figure of 84 (mostly starts, this is his one rest all season) shrinks the raw 72 back up ' +
        'to 76.5, a smaller discount than the unshrunk 72',
      () => {
        const recentMinutes = [90, 90, 90, 90, 0]
        const unshrunk = estimateMinutes(recentMinutes, 1.0)
        const shrunk = estimateMinutes(recentMinutes, 1.0, 84)
        expect(unshrunk.expectedMinutes).toBeCloseTo(72, 10)
        // shrunkRate(360, 5, 84) = (360 + 3*84) / (5+3) = 612/8 = 76.5
        expect(shrunk.expectedMinutes).toBeCloseTo(76.5, 10)
        expect(shrunk.expectedMinutes).toBeGreaterThan(unshrunk.expectedMinutes)
      },
    )

    it(
      'a genuinely fading player (0,0,10,20,30 — losing his place) STILL moves well below his season figure: ' +
        'shrinkage narrows the gap, it does not erase the fade',
      () => {
        const recentMinutes = [0, 0, 10, 20, 30]
        const seasonMinutesPerMatch = 70 // was a regular starter for most of the season before the fade
        const unshrunk = estimateMinutes(recentMinutes, 1.0)
        const shrunk = estimateMinutes(recentMinutes, 1.0, seasonMinutesPerMatch)
        expect(unshrunk.expectedMinutes).toBeCloseTo(12, 10) // (0+0+10+20+30)/5
        // shrunkRate(60, 5, 70) = (60 + 3*70) / (5+3) = 270/8 = 33.75
        expect(shrunk.expectedMinutes).toBeCloseTo(33.75, 10)
        // Moved up from the raw window mean (shrinkage pulls toward the season figure)...
        expect(shrunk.expectedMinutes).toBeGreaterThan(unshrunk.expectedMinutes)
        // ...but still well short of the season figure — the fade is real evidence, not noise shrinkage erases.
        expect(shrunk.expectedMinutes).toBeLessThan(seasonMinutesPerMatch - 30)
      },
    )
  })

  it('pSixtyPlus is completely unaffected by seasonMinutesPerMatch — ticket #213 touches only the mean', () => {
    const recentMinutes = [90, 90, 90, 90, 0]
    const withoutShrinkage = estimateMinutes(recentMinutes, 1.0)
    const withShrinkage = estimateMinutes(recentMinutes, 1.0, 84)
    expect(withShrinkage.pSixtyPlus).toBeCloseTo(withoutShrinkage.pSixtyPlus, 10)
    expect(withShrinkage.pAppears).toBeCloseTo(withoutShrinkage.pAppears, 10)
  })
})
