import { describe, expect, it } from 'vitest'
import {
  estimateDefconHitRate,
  expectedDefensiveContributionPoints,
  isQualifyingMatch,
  positionPriorHitRate,
} from './defconRate.ts'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import type { Position } from '../scoring/types.ts'
import type { DefensiveContributionMatch } from './types.ts'

function match({
  minutesPlayed = 90,
  clearances = 0,
  blocks = 0,
  interceptions = 0,
  tackles = 0,
  recoveries = 0,
}: Partial<DefensiveContributionMatch>): DefensiveContributionMatch {
  return { minutesPlayed, clearances, blocks, interceptions, tackles, recoveries }
}

describe('threshold check is delegated to the scoring module, not reimplemented', () => {
  it('defender one short of the CBIT threshold is a miss (estimate stays at the shrinkage floor)', () => {
    // clearances: 9 — one below the defender threshold the scoring module enforces.
    const estimate = estimateDefconHitRate(DEFENDER, [match({ clearances: 9 })], 0)
    expect(estimate).toBe(0)
  })

  it('defender reaching the CBIT threshold is a hit (estimate rises off the shrinkage floor)', () => {
    // clearances: 10 — exactly the defender threshold the scoring module enforces.
    const estimate = estimateDefconHitRate(DEFENDER, [match({ clearances: 10 })], 0)
    expect(estimate).toBeCloseTo(1 / 6, 10) // (1 hit + 5*0 prior) / (1 + 5)
  })

  it('midfielder one short of the CBIRT threshold is a miss', () => {
    // clearances: 11 — one below the mid/forward threshold the scoring module enforces.
    const estimate = estimateDefconHitRate(MIDFIELDER, [match({ clearances: 11 })], 0)
    expect(estimate).toBe(0)
  })

  it('midfielder reaching the CBIRT threshold is a hit', () => {
    // clearances: 12 — exactly the mid/forward threshold the scoring module enforces.
    const estimate = estimateDefconHitRate(MIDFIELDER, [match({ clearances: 12 })], 0)
    expect(estimate).toBeCloseTo(1 / 6, 10)
  })
})

describe('only matches with minutes played >= 60 count toward a player\'s rate', () => {
  it('a player with 60-minute matches plus cameos matches a player with only the 60-minute matches', () => {
    const tenLongMatches: DefensiveContributionMatch[] = [
      ...Array.from({ length: 5 }, () => match({ minutesPlayed: 60, clearances: 10 })), // hit
      ...Array.from({ length: 5 }, () => match({ minutesPlayed: 90, clearances: 0 })), // miss
    ]
    const twentyCameos = Array.from({ length: 20 }, () =>
      match({ minutesPlayed: 5, clearances: 0 }),
    )

    const withoutCameos = estimateDefconHitRate(DEFENDER, tenLongMatches, 0.3)
    const withCameos = estimateDefconHitRate(DEFENDER, [...tenLongMatches, ...twentyCameos], 0.3)

    expect(withCameos).toBe(withoutCameos)
  })

  it('a 59-minute match does not qualify even if it reaches the threshold', () => {
    const estimate = estimateDefconHitRate(
      DEFENDER,
      [match({ minutesPlayed: 59, clearances: 15 })],
      0,
    )
    expect(estimate).toBe(0) // no qualifying matches -> falls back to the prior (0)
  })

  it('isQualifyingMatch is exactly the 60-minute cutoff', () => {
    expect(isQualifyingMatch(match({ minutesPlayed: 59 }))).toBe(false)
    expect(isQualifyingMatch(match({ minutesPlayed: 60 }))).toBe(true)
  })
})

describe('a player with no qualifying matches returns the position prior exactly', () => {
  it('empty match history', () => {
    expect(estimateDefconHitRate(DEFENDER, [], 0.27)).toBe(0.27)
  })

  it('only non-qualifying cameos', () => {
    const cameos = [match({ minutesPlayed: 10 }), match({ minutesPlayed: 45 })]
    expect(estimateDefconHitRate(MIDFIELDER, cameos, 0.33)).toBe(0.33)
  })
})

describe('shrinkage toward the prior', () => {
  it('one qualifying hit does not return 1.0 — it sits strictly between the prior and 1.0', () => {
    const prior = 0.3
    const estimate = estimateDefconHitRate(DEFENDER, [match({ clearances: 10 })], prior)
    expect(estimate).toBeGreaterThan(prior)
    expect(estimate).toBeLessThan(1.0)
  })
})

describe('convergence on the observed rate with many qualifying matches', () => {
  it('prior 0.40, 100 matches, 40 hits -> estimate is exactly 0.40', () => {
    const matches = [
      ...Array.from({ length: 40 }, () => match({ clearances: 10 })), // hit
      ...Array.from({ length: 60 }, () => match({ clearances: 0 })), // miss
    ]
    expect(estimateDefconHitRate(DEFENDER, matches, 0.4)).toBe(0.4)
  })

  it('prior 0.20, 100 matches, 40 hits -> estimate is within 0.01 of 0.39', () => {
    const matches = [
      ...Array.from({ length: 40 }, () => match({ clearances: 10 })),
      ...Array.from({ length: 60 }, () => match({ clearances: 0 })),
    ]
    expect(estimateDefconHitRate(DEFENDER, matches, 0.2)).toBeCloseTo(0.39, 2)
  })
})

describe('every returned probability is in [0, 1] inclusive', () => {
  const cases: Array<[Position, DefensiveContributionMatch[], number]> = [
    [DEFENDER, [], 0],
    [DEFENDER, [], 1],
    [DEFENDER, [match({ clearances: 10 })], 0],
    [DEFENDER, [match({ clearances: 0 })], 1],
    [MIDFIELDER, Array.from({ length: 50 }, () => match({ clearances: 12 })), 0.1],
    [FORWARD, Array.from({ length: 3 }, () => match({ recoveries: 12 })), 0.9],
    [GOALKEEPER, [match({ clearances: 20 })], 0.8],
  ]

  it.each(cases)('position %s stays within [0, 1]', (position, matches, prior) => {
    const estimate = estimateDefconHitRate(position, matches, prior)
    expect(estimate).toBeGreaterThanOrEqual(0)
    expect(estimate).toBeLessThanOrEqual(1)
  })
})

describe('recoveries count for midfielders/forwards and not for defenders, end to end', () => {
  it('a match reaching threshold only via recoveries lifts the midfielder estimate but not the defender estimate', () => {
    // tackles: 6, recoveries: 6 -> CBIT = 6 (miss for DEF), CBIRT = 12 (hit for MID/FWD).
    const recoveryHeavyMatch = match({ tackles: 6, recoveries: 6 })

    const defenderEstimate = estimateDefconHitRate(DEFENDER, [recoveryHeavyMatch], 0)
    const midfielderEstimate = estimateDefconHitRate(MIDFIELDER, [recoveryHeavyMatch], 0)
    const forwardEstimate = estimateDefconHitRate(FORWARD, [recoveryHeavyMatch], 0)

    expect(defenderEstimate).toBe(0)
    expect(midfielderEstimate).toBeCloseTo(1 / 6, 10)
    expect(forwardEstimate).toBeCloseTo(1 / 6, 10)
  })
})

describe('goalkeepers', () => {
  it('always return a probability of 0, regardless of stats or prior', () => {
    const estimate = estimateDefconHitRate(
      GOALKEEPER,
      [match({ clearances: 50, blocks: 50, interceptions: 50, tackles: 50, recoveries: 50 })],
      0.9,
    )
    expect(estimate).toBe(0)
  })

  it('always return expected defensive-contribution points of 0', () => {
    const probability = estimateDefconHitRate(GOALKEEPER, [match({ clearances: 50 })], 0.9)
    expect(expectedDefensiveContributionPoints(probability)).toBe(0)
  })

  it('position prior is always 0 for goalkeepers, even given matches that would otherwise "hit"', () => {
    const gkMatches = [match({ clearances: 50 }), match({ clearances: 50 })]
    expect(positionPriorHitRate(GOALKEEPER, gkMatches)).toBe(0)
  })
})

describe('expected defensive-contribution points', () => {
  it('equal probability times 2', () => {
    expect(expectedDefensiveContributionPoints(0)).toBe(0)
    expect(expectedDefensiveContributionPoints(0.3)).toBeCloseTo(0.6, 10)
    expect(expectedDefensiveContributionPoints(0.5)).toBe(1.0)
    expect(expectedDefensiveContributionPoints(1)).toBe(2)
  })

  it('never exceed 2, even if an out-of-range probability is passed in', () => {
    expect(expectedDefensiveContributionPoints(1.5)).toBe(2)
  })

  it('never go below 0, even if an out-of-range probability is passed in', () => {
    expect(expectedDefensiveContributionPoints(-0.5)).toBe(0)
  })
})

describe('position-prior helper', () => {
  it('returns the observed proportion of qualifying matches that hit the threshold', () => {
    const matches = [
      ...Array.from({ length: 3 }, () => match({ clearances: 10 })), // hit, qualifying
      ...Array.from({ length: 5 }, () => match({ clearances: 0 })), // miss, qualifying
      ...Array.from({ length: 2 }, () => match({ minutesPlayed: 10, clearances: 10 })), // hit but non-qualifying
    ]
    // 3 hits out of 8 qualifying matches; the two cameos are excluded even though they "hit".
    expect(positionPriorHitRate(DEFENDER, matches)).toBeCloseTo(3 / 8, 10)
  })

  it('returns the stated neutral value (0.5) for an empty match set, not zero and not an error', () => {
    expect(positionPriorHitRate(DEFENDER, [])).toBe(0.5)
  })

  it('returns the neutral value when every match is non-qualifying', () => {
    const onlyCameos = [match({ minutesPlayed: 20 }), match({ minutesPlayed: 45 })]
    expect(positionPriorHitRate(MIDFIELDER, onlyCameos)).toBe(0.5)
  })
})
