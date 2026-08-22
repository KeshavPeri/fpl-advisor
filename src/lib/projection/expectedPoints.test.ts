import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import type { Position } from '../scoring/types.ts'
import {
  cleanSheetProbability,
  expectedGoalsConcededPoints,
  expectedSavePoints,
  projectPlayerFixture,
  projectPlayerGameweek,
  type FixtureContext,
  type PlayerProjectionInput,
} from './expectedPoints.ts'

const zeroRates = { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }

function player(overrides: Partial<PlayerProjectionInput> = {}): PlayerProjectionInput {
  return {
    position: DEFENDER,
    status: 'a',
    chanceOfPlayingNextRound: null,
    recentMinutes: [90, 90, 90, 90, 90],
    rateHistory: { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
    ratePositionPrior: zeroRates,
    defconMatches: [],
    defconPositionPrior: 0,
    ...overrides,
  }
}

function fixture(overrides: Partial<FixtureContext> = {}): FixtureContext {
  return {
    fixtureId: 1,
    isHome: true,
    teamElo: 1500,
    opponentElo: 1500,
    fplDifficulty: 3,
    leagueBaselineGoals: 1.45,
    ...overrides,
  }
}

// ============================================================================
// Clean-sheet probability
// ============================================================================

describe('cleanSheetProbability', () => {
  it('lambdaConceded = 1.4 -> between 0.246 and 0.247', () => {
    const value = cleanSheetProbability(1.4)
    expect(value).toBeGreaterThan(0.246)
    expect(value).toBeLessThan(0.247)
  })
  it('is exp(-lambda)', () => {
    expect(cleanSheetProbability(0)).toBe(1)
    expect(cleanSheetProbability(2)).toBeCloseTo(Math.exp(-2), 12)
  })
})

describe('clean-sheet points in the combiner: pCleanSheet x pSixtyPlus x cleanSheetPoints(position)', () => {
  it('a defender playing the full match, an even (0.5 expectedScore) fixture with leagueBaselineGoals 1.4', () => {
    // equal elo at home does NOT give expectedScore exactly 0.5 (home advantage
    // applies) -- use equal elo with isHome irrelevant cancelled by picking
    // a fixture where eloFor === eloAgainst and home advantage is zeroed by
    // using the FDR-3 fallback instead, which is defined to be exactly 0.5.
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 })
    const p = player({ recentMinutes: [90, 90, 90, 90, 90] }) // pSixtyPlus = 1, availability = 1
    const projection = projectPlayerFixture(p, f)

    // expectedScore = 0.5 (FDR 3) -> teamLambdaConceded = 1.4 * 2 * 0.5 = 1.4
    expect(projection.modelInputs.expectedScore).toBe(0.5)
    expect(projection.modelInputs.expectedGoalsConceded).toBeCloseTo(1.4, 10)
    expect(projection.modelInputs.pCleanSheet).toBeCloseTo(Math.exp(-1.4), 12)

    const expectedCleanSheetPoints = Math.exp(-1.4) * 1 * 4 // cleanSheetPoints(DEFENDER) = 4
    expect(projection.components.cleanSheetPoints).toBeCloseTo(expectedCleanSheetPoints, 6)
  })

  it('the 60-minute requirement is applied, not assumed away: a player never reaching 60 earns no clean-sheet points even with a certain clean sheet', () => {
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 1, leagueBaselineGoals: 0 }) // 0 goals conceded league-wide -> pCleanSheet = 1
    const p = player({ recentMinutes: [10, 15, 20, 25, 30] }) // never reaches 60 -> pSixtyPlus = 0
    const projection = projectPlayerFixture(p, f)
    expect(projection.modelInputs.pCleanSheet).toBeCloseTo(1, 10)
    expect(projection.components.cleanSheetPoints).toBe(0)
  })
})

// ============================================================================
// Goals conceded — true Poisson expectation, not the linear approximation
// ============================================================================

describe('expectedGoalsConcededPoints', () => {
  it('lambdaConceded = 1.4, defender -> between -0.47 and -0.46 (the exact case the linear approximation gets wrong)', () => {
    const value = expectedGoalsConcededPoints(1.4, DEFENDER)
    expect(value).toBeGreaterThan(-0.47)
    expect(value).toBeLessThan(-0.46)
  })

  it('is NOT the linear -lambda/2 approximation, which would give -0.70', () => {
    const value = expectedGoalsConcededPoints(1.4, DEFENDER)
    const linearApproximation = -1.4 / 2
    expect(linearApproximation).toBeCloseTo(-0.7, 10)
    expect(Math.abs(value - linearApproximation)).toBeGreaterThan(0.15)
  })

  it('goalkeeper gets the same treatment as a defender', () => {
    const value = expectedGoalsConcededPoints(1.4, GOALKEEPER)
    expect(value).toBeGreaterThan(-0.47)
    expect(value).toBeLessThan(-0.46)
  })

  it('is zero for midfielders and forwards', () => {
    expect(expectedGoalsConcededPoints(1.4, MIDFIELDER)).toBe(0)
    expect(expectedGoalsConcededPoints(1.4, FORWARD)).toBe(0)
  })

  it('is zero when lambdaConceded is zero', () => {
    expect(expectedGoalsConcededPoints(0, DEFENDER)).toBeCloseTo(0, 12)
  })
})

// ============================================================================
// Saves — true Poisson expectation
// ============================================================================

describe('expectedSavePoints', () => {
  it('expected 3.0 saves, goalkeeper -> between 0.66 and 0.67', () => {
    const value = expectedSavePoints(3.0, GOALKEEPER)
    expect(value).toBeGreaterThan(0.66)
    expect(value).toBeLessThan(0.67)
  })

  it('is zero for every outfield position', () => {
    expect(expectedSavePoints(3.0, DEFENDER)).toBe(0)
    expect(expectedSavePoints(3.0, MIDFIELDER)).toBe(0)
    expect(expectedSavePoints(3.0, FORWARD)).toBe(0)
  })

  it('is zero when expected saves is zero', () => {
    expect(expectedSavePoints(0, GOALKEEPER)).toBe(0)
  })
})

// ============================================================================
// Defensive contribution — weighted by pSixtyPlus
// ============================================================================

describe('defensive-contribution points in the combiner, weighted by pSixtyPlus', () => {
  it('hit rate 0.5, pSixtyPlus 0.60 -> 0.60 points, within 0.001', () => {
    const p = player({
      position: DEFENDER,
      recentMinutes: [90, 90, 90, 10, 10], // sixtyPlusRate = 3/5 = 0.6, availability 1 -> pSixtyPlus = 0.6
      defconMatches: [], // no qualifying matches -> falls straight to the prior
      defconPositionPrior: 0.5,
    })
    const projection = projectPlayerFixture(p, fixture())
    expect(projection.modelInputs.pSixtyPlus).toBeCloseTo(0.6, 10)
    expect(projection.modelInputs.defconHitRate).toBe(0.5)
    expect(projection.components.defensiveContributionPoints).toBeCloseTo(0.6, 3)
  })

  it('goalkeepers score 0 defensive-contribution points (enforced by defconRate.ts, #28)', () => {
    const p = player({ position: GOALKEEPER, defconPositionPrior: 0.9 })
    const projection = projectPlayerFixture(p, fixture())
    expect(projection.components.defensiveContributionPoints).toBe(0)
  })
})

// ============================================================================
// The elo fallback
// ============================================================================

describe('the elo fallback is used whenever either team in the fixture has a null elo', () => {
  it('null teamElo triggers the fallback', () => {
    const projection = projectPlayerFixture(player(), fixture({ teamElo: null }))
    expect(projection.modelInputs.eloFallbackUsed).toBe(true)
  })
  it('null opponentElo triggers the fallback', () => {
    const projection = projectPlayerFixture(player(), fixture({ opponentElo: null }))
    expect(projection.modelInputs.eloFallbackUsed).toBe(true)
  })
  it('a null elo is never silently treated as elo 0 -- the fallback expectedScore (0.5 at FDR 3) is nowhere near what elo 0 vs 1500 would give', () => {
    const projection = projectPlayerFixture(player(), fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3 }))
    expect(projection.modelInputs.expectedScore).toBe(0.5)
  })
  it('both elo present: the fallback is not used', () => {
    const projection = projectPlayerFixture(player(), fixture({ teamElo: 1500, opponentElo: 1500 }))
    expect(projection.modelInputs.eloFallbackUsed).toBe(false)
  })
})

// ============================================================================
// Double gameweeks and blanks
// ============================================================================

describe('a player whose team has two fixtures in one gameweek', () => {
  it('is projected as the sum of both fixtures -- expected points AND expected minutes', () => {
    const p = player()
    const fixtureA = fixture({ fixtureId: 1 })
    const fixtureB = fixture({ fixtureId: 2 })

    const single = projectPlayerFixture(p, fixtureA)
    const gameweek = projectPlayerGameweek(p, [fixtureA, fixtureB])

    expect(gameweek.expectedPoints).toBeCloseTo(single.expectedPoints * 2, 10)
    expect(gameweek.expectedMinutes).toBeCloseTo(single.expectedMinutes * 2, 10)
    expect(gameweek.fixtures).toHaveLength(2)
  })
})

describe('a player whose team has no fixture in a gameweek', () => {
  it('is projected as 0 expected points and 0 expected minutes, without erroring', () => {
    const gameweek = projectPlayerGameweek(player(), [])
    expect(gameweek.expectedPoints).toBe(0)
    expect(gameweek.expectedMinutes).toBe(0)
    expect(gameweek.fixtures).toEqual([])
  })
})

// ============================================================================
// Finiteness — no NaN, no Infinity, ever
// ============================================================================

describe('every returned expected-points value is finite', () => {
  const positions: Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
  const scenarios: Array<{ name: string; p: PlayerProjectionInput; f: FixtureContext }> = []

  for (const position of positions) {
    scenarios.push({
      name: `${position} with full history`,
      p: player({
        position,
        recentMinutes: [90, 90, 90, 90, 90],
        rateHistory: { minutesPlayed: 900, totalXg: 4.3, totalXa: 2.1, totalSaves: 30, totalCbi: 40, totalRecoveries: 60 },
        ratePositionPrior: { xgPer90: 0.3, xaPer90: 0.15, savesPer90: 3, cbiPer90: 4, recoveriesPer90: 6 },
        defconMatches: [],
        defconPositionPrior: 0.4,
      }),
      f: fixture(),
    })
    scenarios.push({
      name: `${position} with zero history (new signing)`,
      p: player({
        position,
        recentMinutes: [],
        rateHistory: { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      }),
      f: fixture({ teamElo: null, opponentElo: null }),
    })
    scenarios.push({
      name: `${position} with zero availability (injured)`,
      p: player({ position, status: 'i', chanceOfPlayingNextRound: null }),
      f: fixture(),
    })
  }

  it.each(scenarios.map((s) => [s.name, s.p, s.f] as const))('%s', (_name, p, f) => {
    const projection = projectPlayerFixture(p, f)
    expect(Number.isFinite(projection.expectedPoints)).toBe(true)
    expect(Number.isFinite(projection.expectedMinutes)).toBe(true)
    for (const value of Object.values(projection.components)) {
      expect(Number.isFinite(value)).toBe(true)
    }
    for (const value of Object.values(projection.expectedEvents)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

// ============================================================================
// Ticket #78 — expectedEvents surfaced, bonus stays 0 in this function
// ============================================================================

describe('projectPlayerFixture never sets bonus -- that is the second pass (bonus.ts) alone', () => {
  it('components.bonusPoints is always exactly 0, regardless of position or fixture', () => {
    const projection = projectPlayerFixture(player({ position: FORWARD }), fixture())
    expect(projection.components.bonusPoints).toBe(0)
  })
})

describe('expectedEvents carries the raw event counts projectPlayerFixture already computes, not thrown away', () => {
  it('expectedGoals, expectedAssists, expectedSaves, expectedCbi, expectedRecoveries, pCleanSheet, pAppears, pSixtyPlus are all present and finite', () => {
    const p = player({
      position: MIDFIELDER,
      recentMinutes: [90, 90, 90, 90, 90],
      rateHistory: { minutesPlayed: 900, totalXg: 4.3, totalXa: 2.1, totalSaves: 0, totalCbi: 18, totalRecoveries: 27 },
      ratePositionPrior: { xgPer90: 0.3, xaPer90: 0.15, savesPer90: 0, cbiPer90: 2, recoveriesPer90: 3 },
    })
    const projection = projectPlayerFixture(p, fixture())
    const events = projection.expectedEvents

    expect(events.expectedGoals).toBeGreaterThan(0)
    expect(events.expectedAssists).toBeGreaterThan(0)
    expect(events.expectedCbi).toBeGreaterThan(0)
    expect(events.expectedRecoveries).toBeGreaterThan(0)
    expect(events.pCleanSheet).toBe(projection.modelInputs.pCleanSheet)
    expect(events.pAppears).toBe(projection.modelInputs.pAppears)
    expect(events.pSixtyPlus).toBe(projection.modelInputs.pSixtyPlus)
  })

  it('expectedCbi and expectedRecoveries scale with minutesFraction only -- no fixture attacking multiplier applied', () => {
    // A heavily favoured fixture (high expectedScore) inflates expectedGoals/expectedAssists via the
    // attacking multiplier, but must leave expectedCbi/expectedRecoveries untouched -- they are
    // defensive-action counts, scaled by minutes exposure only (see expectedPoints.ts's comment).
    const p = player({
      rateHistory: { minutesPlayed: 900, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 45, totalRecoveries: 90 },
      ratePositionPrior: { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 5, recoveriesPer90: 10 },
    })
    const evenFixture = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3 }) // expectedScore 0.5 -> multiplier 1.0
    const favouredFixture = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 1 }) // expectedScore 0.75 -> multiplier 1.5

    const evenProjection = projectPlayerFixture(p, evenFixture)
    const favouredProjection = projectPlayerFixture(p, favouredFixture)

    expect(favouredProjection.expectedEvents.expectedCbi).toBeCloseTo(evenProjection.expectedEvents.expectedCbi, 10)
    expect(favouredProjection.expectedEvents.expectedRecoveries).toBeCloseTo(
      evenProjection.expectedEvents.expectedRecoveries,
      10,
    )
  })
})
