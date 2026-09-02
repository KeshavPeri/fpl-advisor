import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import type { Position } from '../scoring/types.ts'
import { attackingMultiplier, defensiveMultiplier, expectedScore, expectedScoreFromDifficulty } from './fixture.ts'
import { ASSIST_POINTS, cleanSheetPoints as cleanSheetPointsFor } from './pointValues.ts'
import {
  ASSIST_CONVERSION_DEFENDER,
  ASSIST_CONVERSION_FORWARD,
  ASSIST_CONVERSION_GOALKEEPER,
  ASSIST_CONVERSION_MAX,
  ASSIST_CONVERSION_MIDFIELDER,
  ASSIST_CONVERSION_MIN,
  assistConversionFactor,
  clampAssistConversionFactor,
  cleanSheetProbability,
  expectedGoalsConcededPoints,
  expectedSavePoints,
  GOAL_CONVERSION_DEFENDER,
  GOAL_CONVERSION_FORWARD,
  GOAL_CONVERSION_GOALKEEPER,
  GOAL_CONVERSION_MAX,
  GOAL_CONVERSION_MIDFIELDER,
  GOAL_CONVERSION_MIN,
  clampGoalConversionFactor,
  goalConversionFactor,
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
// Ticket #109 -- expected saves scale with fixture difficulty
// ============================================================================

describe('expectedSaves scales with fixture difficulty (ticket #109)', () => {
  it('a goalkeeper\'s projected save points are strictly higher in a hard fixture than an easy one, all else equal', () => {
    const gk = player({
      position: GOALKEEPER,
      rateHistory: { minutesPlayed: 900, totalXg: 0, totalXa: 0, totalSaves: 27, totalCbi: 0, totalRecoveries: 0 }, // 3 saves/90 observed
      ratePositionPrior: { xgPer90: 0, xaPer90: 0, savesPer90: 3, cbiPer90: 0, recoveriesPer90: 0 },
    })
    const hardFixture = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 5 }) // expectedScore 0.25 -> savesMultiplier 1.5
    const easyFixture = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 1 }) // expectedScore 0.75 -> savesMultiplier 0.5

    const hard = projectPlayerFixture(gk, hardFixture)
    const easy = projectPlayerFixture(gk, easyFixture)

    expect(hard.modelInputs.savesMultiplier).toBeCloseTo(1.5, 10)
    expect(easy.modelInputs.savesMultiplier).toBeCloseTo(0.5, 10)
    expect(hard.expectedEvents.expectedSaves).toBeGreaterThan(easy.expectedEvents.expectedSaves)
    expect(hard.components.savePoints).toBeGreaterThan(easy.components.savePoints)
  })

  it('modelInputs.savesMultiplier equals defensiveMultiplier(expectedScore) and expectedSaves is savesPer90 x minutesFraction x that multiplier', () => {
    const gk = player({
      position: GOALKEEPER,
      rateHistory: { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      ratePositionPrior: { xgPer90: 0, xaPer90: 0, savesPer90: 4, cbiPer90: 0, recoveriesPer90: 0 },
      recentMinutes: [90, 90, 90, 90, 90], // minutesFraction = 1
    })
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 4 }) // expectedScore 0.375
    const projection = projectPlayerFixture(gk, f)

    expect(projection.modelInputs.expectedScore).toBeCloseTo(0.375, 10)
    const expectedMultiplier = defensiveMultiplier(0.375)
    expect(projection.modelInputs.savesMultiplier).toBeCloseTo(expectedMultiplier, 12)
    expect(projection.expectedEvents.expectedSaves).toBeCloseTo(4 * 1 * expectedMultiplier, 10)
  })

  it('the FPL-FDR fallback path flows through the new multiplier identically to the elo path -- same expectedScore, same multiplier, either way', () => {
    const gk = player({
      position: GOALKEEPER,
      rateHistory: { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      ratePositionPrior: { xgPer90: 0, xaPer90: 0, savesPer90: 5, cbiPer90: 0, recoveriesPer90: 0 },
      recentMinutes: [90, 90, 90, 90, 90],
    })

    // Fallback path: three promoted clubs with no ClubElo rating -> null elo -> eloFallbackUsed.
    const fallbackFixture = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 2 })
    const fallback = projectPlayerFixture(gk, fallbackFixture)
    expect(fallback.modelInputs.eloFallbackUsed).toBe(true)
    expect(fallback.modelInputs.expectedScore).toBeCloseTo(expectedScoreFromDifficulty(2), 12)
    expect(fallback.modelInputs.savesMultiplier).toBeCloseTo(defensiveMultiplier(fallback.modelInputs.expectedScore), 12)

    // Elo path: both teams rated -> not the fallback. Same formula (defensiveMultiplier)
    // is applied to whatever expectedScore this path produces.
    const eloFixture = fixture({ teamElo: 1620, opponentElo: 1480, isHome: true })
    const elo = projectPlayerFixture(gk, eloFixture)
    expect(elo.modelInputs.eloFallbackUsed).toBe(false)
    const expectedEloScore = expectedScore(1620, 1480, true)
    expect(elo.modelInputs.expectedScore).toBeCloseTo(expectedEloScore, 12)
    expect(elo.modelInputs.savesMultiplier).toBeCloseTo(defensiveMultiplier(expectedEloScore), 12)

    // Both paths apply the identical function to whatever expectedScore they produced --
    // there is no separate branch or scaling for the fallback case.
    expect(fallback.expectedEvents.expectedSaves).toBeCloseTo(5 * 1 * defensiveMultiplier(fallback.modelInputs.expectedScore), 10)
    expect(elo.expectedEvents.expectedSaves).toBeCloseTo(5 * 1 * defensiveMultiplier(elo.modelInputs.expectedScore), 10)
  })
})

describe('outfield players (defender, midfielder, forward) are byte-for-byte unchanged by ticket #109', () => {
  // savesPer90 is near zero for real outfield players, so this would hold trivially --
  // it is asserted here instead, with a deliberately large savesPer90 (9/90, absurd for
  // an outfield player) and a fixture whose savesMultiplier is far from 1.0 (1.5), so
  // that if the multiplier ever leaked into a component other than savePoints, this
  // test would catch it. It cannot leak: expectedSaves feeds only
  // expectedSavePoints(expectedSaves, position), and savePointsApply(position) is false
  // for every outfield position regardless of the value of expectedSaves -- so
  // savePoints is 0 both before and after this ticket's change, and every other
  // component is computed from xgPer90/xaPer90/defconHitRate/teamLambdaConceded alone,
  // none of which this ticket touches.
  const rateHistory = { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 }
  const ratePositionPrior = { xgPer90: 0, xaPer90: 0, savesPer90: 9, cbiPer90: 0, recoveriesPer90: 0 }
  const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 5, leagueBaselineGoals: 1 }) // expectedScore 0.25 -> savesMultiplier 1.5, attackMultiplier 0.5

  // Hand-computed pre-ticket values for this fixture (leagueBaselineGoals=1, expectedScore=0.25):
  //   teamLambdaConceded = expectedGoalsConceded(1, 0.25) = 1 x 2 x 0.75 = 1.5
  //   pCleanSheet = exp(-1.5); pSixtyPlus = 1 (recentMinutes all 90, status 'a')
  //   expectedGoals = expectedAssists = 0 (xgPer90 = xaPer90 = 0)
  //   defensiveContributionPoints = 0 (defconPositionPrior = 0, no matches)
  //   appearancePoints = 1 x 1 + 1 x 1 = 2 (pAppears = pSixtyPlus = 1)
  // None of these depend on savesPer90 or the new savesMultiplier -- unaffected by this ticket.
  const teamLambdaConceded = 1.5
  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)

  it.each([
    [DEFENDER, 4],
    [MIDFIELDER, 1],
    [FORWARD, 0],
  ] as const)('%s: every component matches the pre-ticket value', (position, expectedCleanSheetPointsValue) => {
    const p = player({ position, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
    const projection = projectPlayerFixture(p, f)

    expect(cleanSheetPointsFor(position)).toBe(expectedCleanSheetPointsValue) // sanity-check the table read above
    expect(projection.components.appearancePoints).toBeCloseTo(2, 12)
    expect(projection.components.goalPoints).toBe(0)
    expect(projection.components.assistPoints).toBe(0)
    expect(projection.components.cleanSheetPoints).toBeCloseTo(pCleanSheet * 1 * expectedCleanSheetPointsValue, 12)
    expect(projection.components.goalsConcededPoints).toBeCloseTo(expectedGoalsConcededPoints(teamLambdaConceded, position), 12)
    expect(projection.components.savePoints).toBe(0) // gated by savePointsApply(position), independent of expectedSaves
    expect(projection.components.defensiveContributionPoints).toBe(0)
    expect(projection.components.bonusPoints).toBe(0)

    // The multiplied expectedSaves is real (surfaced in expectedEvents) but never reaches components.
    expect(projection.expectedEvents.expectedSaves).toBeCloseTo(9 * 1 * 1.5, 10)
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

})

// ============================================================================
// Ticket #148 -- assist conversion factor
// ============================================================================

describe('assist conversion clamp: ASSIST_CONVERSION_MIN/MAX', () => {
  it('is [1.0, 2.5]', () => {
    expect(ASSIST_CONVERSION_MIN).toBe(1.0)
    expect(ASSIST_CONVERSION_MAX).toBe(2.5)
  })

  it('a value inside the range passes through unchanged', () => {
    expect(clampAssistConversionFactor(1.3)).toBe(1.3)
    expect(clampAssistConversionFactor(ASSIST_CONVERSION_MIN)).toBe(ASSIST_CONVERSION_MIN)
    expect(clampAssistConversionFactor(ASSIST_CONVERSION_MAX)).toBe(ASSIST_CONVERSION_MAX)
  })

  it('a value outside the stated range is clamped rather than applied', () => {
    // Above the max: a hypothetical future re-measurement of 10x is not applied as-is.
    expect(clampAssistConversionFactor(10)).toBe(ASSIST_CONVERSION_MAX)
    // Below the min: a hypothetical future re-measurement of 0.2x is not applied as-is either.
    expect(clampAssistConversionFactor(0.2)).toBe(ASSIST_CONVERSION_MIN)
    // A negative or zero raw ratio (e.g. a data glitch) is still floored at the min, not passed through.
    expect(clampAssistConversionFactor(0)).toBe(ASSIST_CONVERSION_MIN)
    expect(clampAssistConversionFactor(-3)).toBe(ASSIST_CONVERSION_MIN)
  })
})

describe('the per-position assist conversion constants are the measured ratios, rounded to two decimals', () => {
  it('goalkeeper 2.30, defender 1.30, midfielder 1.33, forward 2.12', () => {
    expect(ASSIST_CONVERSION_GOALKEEPER).toBe(2.3)
    expect(ASSIST_CONVERSION_DEFENDER).toBe(1.3)
    expect(ASSIST_CONVERSION_MIDFIELDER).toBe(1.33)
    expect(ASSIST_CONVERSION_FORWARD).toBe(2.12)
  })

  it('every measured constant already sits inside the clamp range (today\'s measurement needs no clamping)', () => {
    for (const value of [ASSIST_CONVERSION_GOALKEEPER, ASSIST_CONVERSION_DEFENDER, ASSIST_CONVERSION_MIDFIELDER, ASSIST_CONVERSION_FORWARD]) {
      expect(value).toBeGreaterThanOrEqual(ASSIST_CONVERSION_MIN)
      expect(value).toBeLessThanOrEqual(ASSIST_CONVERSION_MAX)
    }
  })
})

describe('assistConversionFactor: goalkeeper is handled explicitly, not a fallthrough default', () => {
  it('GOALKEEPER returns its own measured constant, not another position\'s', () => {
    expect(assistConversionFactor(GOALKEEPER)).toBe(ASSIST_CONVERSION_GOALKEEPER)
    expect(assistConversionFactor(GOALKEEPER)).not.toBe(assistConversionFactor(DEFENDER))
    expect(assistConversionFactor(GOALKEEPER)).not.toBe(assistConversionFactor(MIDFIELDER))
    expect(assistConversionFactor(GOALKEEPER)).not.toBe(assistConversionFactor(FORWARD))
  })

  it('every position returns its own clamped, named constant', () => {
    expect(assistConversionFactor(GOALKEEPER)).toBe(clampAssistConversionFactor(ASSIST_CONVERSION_GOALKEEPER))
    expect(assistConversionFactor(DEFENDER)).toBe(clampAssistConversionFactor(ASSIST_CONVERSION_DEFENDER))
    expect(assistConversionFactor(MIDFIELDER)).toBe(clampAssistConversionFactor(ASSIST_CONVERSION_MIDFIELDER))
    expect(assistConversionFactor(FORWARD)).toBe(clampAssistConversionFactor(ASSIST_CONVERSION_FORWARD))
  })

  it('a goalkeeper\'s projected assist points use the goalkeeper factor, not silently zero or a default', () => {
    // A goalkeeper with a deliberately nonzero xaPer90 (unrealistic in practice, but exercises
    // the position-specific path rather than relying on real GK xA being ~0).
    const gk = player({
      position: GOALKEEPER,
      rateHistory: { minutesPlayed: 900, totalXg: 0, totalXa: 4.5, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      ratePositionPrior: { xgPer90: 0, xaPer90: 0.2, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
      recentMinutes: [90, 90, 90, 90, 90],
    })
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3 }) // expectedScore 0.5 -> attackMultiplier 1
    const projection = projectPlayerFixture(gk, f)

    // playerRates.xaPer90 blends observed (0.2) with the (also 0) position prior via rates.ts's
    // shrinkage, which this ticket does not touch -- rather than hand-deriving that blend here,
    // assert the relationship this ticket DOES own: expectedAssists is exactly xaPer90 (as
    // reported on modelInputs) x minutesFraction (1) x attackMultiplier (1) x the GK factor.
    const expectedAssistsHand =
      projection.modelInputs.xaPer90 * 1 * attackingMultiplier(0.5) * ASSIST_CONVERSION_GOALKEEPER
    expect(projection.modelInputs.expectedAssists).toBeCloseTo(expectedAssistsHand, 10)
    expect(projection.expectedEvents.expectedAssists).toBeCloseTo(expectedAssistsHand, 10)
    expect(projection.components.assistPoints).toBeCloseTo(expectedAssistsHand * ASSIST_POINTS, 10)
    // And it is NOT what the pre-ticket formula (no factor) would have given -- the factor is
    // really being applied, not a no-op for goalkeepers.
    const preTicketExpectedAssists = projection.modelInputs.xaPer90 * 1 * attackingMultiplier(0.5)
    expect(projection.modelInputs.expectedAssists).not.toBeCloseTo(preTicketExpectedAssists, 5)
  })
})

describe('projectPlayerFixture: expectedAssists is xaPer90 x minutesFraction x attackMultiplier x assistConversionFactor(position), and it alone drives assistPoints', () => {
  it.each([
    [DEFENDER, ASSIST_CONVERSION_DEFENDER],
    [MIDFIELDER, ASSIST_CONVERSION_MIDFIELDER],
    [FORWARD, ASSIST_CONVERSION_FORWARD],
  ] as const)('%s uses its own factor (%d)', (position, factor) => {
    const p = player({
      position,
      rateHistory: { minutesPlayed: 900, totalXg: 0, totalXa: 3.6, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 }, // 0.36 xA/90 observed
      ratePositionPrior: { xgPer90: 0, xaPer90: 0.36, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }, // prior matches observed exactly, so shrinkage lands on 0.36 regardless of its exact formula
      recentMinutes: [90, 90, 90, 90, 90],
    })
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 }) // expectedScore 0.5 -> attackMultiplier 1, minutesFraction 1
    const projection = projectPlayerFixture(p, f)

    expect(projection.modelInputs.xaPer90).toBeCloseTo(0.36, 10)
    // minutesFraction = 1, attackMultiplier = 1 at this fixture -- expectedAssists is exactly xaPer90 x factor.
    const expectedAssistsHand = 0.36 * factor
    expect(projection.modelInputs.expectedAssists).toBeCloseTo(expectedAssistsHand, 10)
    expect(projection.expectedEvents.expectedAssists).toBeCloseTo(expectedAssistsHand, 10)
    expect(projection.components.assistPoints).toBeCloseTo(expectedAssistsHand * ASSIST_POINTS, 10)
  })
})

describe('modelInputs.expectedAssists is surfaced alongside the existing fields', () => {
  it('matches expectedEvents.expectedAssists and is present for every position', () => {
    const positions: Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
    for (const position of positions) {
      const p = player({
        position,
        rateHistory: { minutesPlayed: 900, totalXg: 0, totalXa: 1.8, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
        ratePositionPrior: { xgPer90: 0, xaPer90: 0.18, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
      })
      const projection = projectPlayerFixture(p, fixture())
      expect(projection.modelInputs.expectedAssists).toBe(projection.expectedEvents.expectedAssists)
      expect(Number.isFinite(projection.modelInputs.expectedAssists)).toBe(true)
    }
  })
})

describe('ticket #148: every component other than assistPoints/goalPoints (and expectedAssists/expectedGoals) is byte-identical to the pre-ticket formula, for a fixed input, across every position', () => {
  // Hand-computed pre-ticket values for this fixture and player shape (leagueBaselineGoals=1.4,
  // teamElo/opponentElo null, fplDifficulty=3 -> expectedScore=0.5 -> attackMultiplier=1,
  // defensiveMultiplier=1; recentMinutes all 90 with status 'a' -> pAppears=pSixtyPlus=1;
  // xgPer90=0.3, savesPer90=2 observed with a matching prior so shrinkage lands exactly there):
  //   teamLambdaConceded = expectedGoalsConceded(1.4, 0.5) = 1.4 x 2 x 0.5 = 1.4
  //   pCleanSheet = exp(-1.4)
  //   expectedGoals (raw, pre-#162) = 0.3 x 1 x 1 = 0.3 -- ticket #162 (see its own section
  //     below) now multiplies this by the position's goalConversionFactor, so goalPoints
  //     is hand-computed below using the named GOAL_CONVERSION_* constants directly, NOT
  //     the pre-ticket 0.3 alone. This test's OWN concern (assist conversion, #148) is
  //     unaffected either way -- goalPoints was never part of what #148 changed.
  //   expectedSaves = 2 x 1 x defensiveMultiplier(0.5) = 2 x 1 x 1 = 2
  //   defensiveContributionPoints = 0 (defconPositionPrior=0, no matches, for every position)
  //   appearancePoints = 1 x 1 + 1 x 1 = 2
  // None of these depend on xaPer90 or the assist conversion factor -- unaffected by #148.
  const rateHistory = { minutesPlayed: 900, totalXg: 3.0, totalXa: 3.6, totalSaves: 20, totalCbi: 0, totalRecoveries: 0 }
  const ratePositionPrior = { xgPer90: 0.3, xaPer90: 0.36, savesPer90: 2, cbiPer90: 0, recoveriesPer90: 0 }
  const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 })
  const teamLambdaConceded = 1.4
  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)
  const expectedGoalsRawHand = 0.3
  const expectedSavesHand = 2

  it.each([
    [GOALKEEPER, 4, ASSIST_CONVERSION_GOALKEEPER, GOAL_CONVERSION_GOALKEEPER],
    [DEFENDER, 4, ASSIST_CONVERSION_DEFENDER, GOAL_CONVERSION_DEFENDER],
    [MIDFIELDER, 1, ASSIST_CONVERSION_MIDFIELDER, GOAL_CONVERSION_MIDFIELDER],
    [FORWARD, 0, ASSIST_CONVERSION_FORWARD, GOAL_CONVERSION_FORWARD],
  ] as const)('%s: every component except assistPoints/goalPoints matches the pre-ticket formula exactly; assistPoints reflects the assist factor', (position, expectedCleanSheetPointsValue, assistFactor, goalFactor) => {
    const p = player({ position, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
    const projection = projectPlayerFixture(p, f)

    expect(cleanSheetPointsFor(position)).toBe(expectedCleanSheetPointsValue) // sanity-check the table read above
    expect(projection.components.appearancePoints).toBeCloseTo(2, 12)
    // goalPoints = expectedGoalsRawHand x this position's goalConversionFactor (ticket #162)
    // x goalPoints(position) -- hand-computed from the named constants, not the pre-#162
    // formula, since #162 legitimately changed this value (see the header comment above).
    expect(projection.components.goalPoints).toBeCloseTo(
      expectedGoalsRawHand * goalFactor * goalPointsForAssistTest(position),
      10,
    )
    expect(projection.components.cleanSheetPoints).toBeCloseTo(pCleanSheet * 1 * expectedCleanSheetPointsValue, 12)
    expect(projection.components.goalsConcededPoints).toBeCloseTo(expectedGoalsConcededPoints(teamLambdaConceded, position), 12)
    expect(projection.components.savePoints).toBeCloseTo(expectedSavePoints(expectedSavesHand, position), 10)
    expect(projection.components.defensiveContributionPoints).toBe(0)
    expect(projection.components.bonusPoints).toBe(0)

    // assistPoints DOES change: it is xaPer90 x minutesFraction x attackMultiplier x this
    // position's factor x ASSIST_POINTS, not the pre-ticket xaPer90 x minutesFraction x
    // attackMultiplier x ASSIST_POINTS.
    const preTicketAssistPoints = 0.36 * 1 * 1 * ASSIST_POINTS
    const postTicketAssistPoints = 0.36 * 1 * 1 * assistFactor * ASSIST_POINTS
    expect(projection.components.assistPoints).toBeCloseTo(postTicketAssistPoints, 10)
    expect(projection.components.assistPoints).not.toBeCloseTo(preTicketAssistPoints, 5)
  })
})

// Local helper for the byte-identical tests above -- goalPoints(position) from pointValues.ts,
// imported under its own name so it does not collide with this file's `goalPoints` test data.
function goalPointsForAssistTest(position: Position): number {
  return { 1: 10, 2: 6, 3: 5, 4: 4 }[position]
}

// ============================================================================
// Ticket #162 -- goal conversion factor
// ============================================================================

describe('goal conversion clamp: GOAL_CONVERSION_MIN/MAX', () => {
  it('is [0.5, 1.5]', () => {
    expect(GOAL_CONVERSION_MIN).toBe(0.5)
    expect(GOAL_CONVERSION_MAX).toBe(1.5)
  })

  it('a value inside the range passes through unchanged', () => {
    expect(clampGoalConversionFactor(0.9)).toBe(0.9)
    expect(clampGoalConversionFactor(GOAL_CONVERSION_MIN)).toBe(GOAL_CONVERSION_MIN)
    expect(clampGoalConversionFactor(GOAL_CONVERSION_MAX)).toBe(GOAL_CONVERSION_MAX)
  })

  it('a value outside the stated range is clamped rather than applied', () => {
    // Above the max: a hypothetical future re-measurement of 3x is not applied as-is.
    expect(clampGoalConversionFactor(3)).toBe(GOAL_CONVERSION_MAX)
    // Below the min: a hypothetical future re-measurement of 0.1x is not applied as-is either.
    expect(clampGoalConversionFactor(0.1)).toBe(GOAL_CONVERSION_MIN)
    // A negative or zero raw ratio (e.g. a data glitch) is still floored at the min, not passed through.
    expect(clampGoalConversionFactor(0)).toBe(GOAL_CONVERSION_MIN)
    expect(clampGoalConversionFactor(-3)).toBe(GOAL_CONVERSION_MIN)
  })
})

describe('the per-position goal conversion constants are the measured ratios, rounded to two decimals', () => {
  it('goalkeeper 1.00 (no-information), defender 0.76, midfielder 0.98, forward 0.97', () => {
    expect(GOAL_CONVERSION_GOALKEEPER).toBe(1.0)
    expect(GOAL_CONVERSION_DEFENDER).toBe(0.76)
    expect(GOAL_CONVERSION_MIDFIELDER).toBe(0.98)
    expect(GOAL_CONVERSION_FORWARD).toBe(0.97)
  })

  it('every measured constant already sits inside the clamp range (today\'s measurement needs no clamping)', () => {
    for (const value of [GOAL_CONVERSION_GOALKEEPER, GOAL_CONVERSION_DEFENDER, GOAL_CONVERSION_MIDFIELDER, GOAL_CONVERSION_FORWARD]) {
      expect(value).toBeGreaterThanOrEqual(GOAL_CONVERSION_MIN)
      expect(value).toBeLessThanOrEqual(GOAL_CONVERSION_MAX)
    }
  })

  it('the clamp bounds do not bind any of the four values -- each sits strictly inside, not on the boundary', () => {
    for (const value of [GOAL_CONVERSION_GOALKEEPER, GOAL_CONVERSION_DEFENDER, GOAL_CONVERSION_MIDFIELDER, GOAL_CONVERSION_FORWARD]) {
      expect(value).toBeGreaterThan(GOAL_CONVERSION_MIN)
      expect(value).toBeLessThan(GOAL_CONVERSION_MAX)
    }
  })
})

describe('goalConversionFactor: goalkeeper is handled explicitly, not a fallthrough default', () => {
  it('GOALKEEPER returns its own (no-information) constant, not another position\'s', () => {
    expect(goalConversionFactor(GOALKEEPER)).toBe(GOAL_CONVERSION_GOALKEEPER)
    expect(goalConversionFactor(GOALKEEPER)).not.toBe(goalConversionFactor(DEFENDER))
    expect(goalConversionFactor(GOALKEEPER)).not.toBe(goalConversionFactor(MIDFIELDER))
    expect(goalConversionFactor(GOALKEEPER)).not.toBe(goalConversionFactor(FORWARD))
  })

  it('every position returns its own clamped, named constant', () => {
    expect(goalConversionFactor(GOALKEEPER)).toBe(clampGoalConversionFactor(GOAL_CONVERSION_GOALKEEPER))
    expect(goalConversionFactor(DEFENDER)).toBe(clampGoalConversionFactor(GOAL_CONVERSION_DEFENDER))
    expect(goalConversionFactor(MIDFIELDER)).toBe(clampGoalConversionFactor(GOAL_CONVERSION_MIDFIELDER))
    expect(goalConversionFactor(FORWARD)).toBe(clampGoalConversionFactor(GOAL_CONVERSION_FORWARD))
  })

  it('a goalkeeper\'s projected goal points use the goalkeeper factor explicitly (1.0, no correction) -- reached via its own named case, not by falling through to a default', () => {
    // A goalkeeper with a deliberately nonzero xgPer90 (unrealistic in practice, but exercises
    // the position-specific path rather than relying on real GK xG being ~0).
    const gk = player({
      position: GOALKEEPER,
      rateHistory: { minutesPlayed: 900, totalXg: 4.5, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
      ratePositionPrior: { xgPer90: 0.2, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
      recentMinutes: [90, 90, 90, 90, 90],
    })
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3 }) // expectedScore 0.5 -> attackMultiplier 1
    const projection = projectPlayerFixture(gk, f)

    // playerRates.xgPer90 blends observed (0.2) with the (also 0) position prior via rates.ts's
    // shrinkage, which this ticket does not touch -- rather than hand-deriving that blend here,
    // assert the relationship this ticket DOES own: expectedGoals is exactly xgPer90 (as
    // reported on modelInputs) x minutesFraction (1) x attackMultiplier (1) x the GK factor.
    const expectedGoalsHand = projection.modelInputs.xgPer90 * 1 * attackingMultiplier(0.5) * GOAL_CONVERSION_GOALKEEPER
    expect(projection.modelInputs.expectedGoals).toBeCloseTo(expectedGoalsHand, 10)
    expect(projection.expectedEvents.expectedGoals).toBeCloseTo(expectedGoalsHand, 10)
    expect(projection.components.goalPoints).toBeCloseTo(expectedGoalsHand * goalPointsForAssistTest(GOALKEEPER), 10)
    // GOAL_CONVERSION_GOALKEEPER is exactly 1.0 -- confirm the explicit case is really what's
    // being exercised (a fallthrough to the assertNeverPosition default would throw instead of
    // returning a number at all).
    expect(goalConversionFactor(GOALKEEPER)).toBe(1.0)
  })
})

describe('projectPlayerFixture: expectedGoals is xgPer90 x minutesFraction x attackMultiplier x goalConversionFactor(position), and it alone drives goalPoints', () => {
  it.each([
    [DEFENDER, GOAL_CONVERSION_DEFENDER],
    [MIDFIELDER, GOAL_CONVERSION_MIDFIELDER],
    [FORWARD, GOAL_CONVERSION_FORWARD],
  ] as const)('%s uses its own factor (%d)', (position, factor) => {
    const p = player({
      position,
      rateHistory: { minutesPlayed: 900, totalXg: 3.6, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 }, // 0.36 xG/90 observed
      ratePositionPrior: { xgPer90: 0.36, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }, // prior matches observed exactly, so shrinkage lands on 0.36 regardless of its exact formula
      recentMinutes: [90, 90, 90, 90, 90],
    })
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 }) // expectedScore 0.5 -> attackMultiplier 1, minutesFraction 1
    const projection = projectPlayerFixture(p, f)

    expect(projection.modelInputs.xgPer90).toBeCloseTo(0.36, 10)
    // minutesFraction = 1, attackMultiplier = 1 at this fixture -- expectedGoals is exactly xgPer90 x factor.
    const expectedGoalsHand = 0.36 * factor
    expect(projection.modelInputs.expectedGoals).toBeCloseTo(expectedGoalsHand, 10)
    expect(projection.expectedEvents.expectedGoals).toBeCloseTo(expectedGoalsHand, 10)
    expect(projection.components.goalPoints).toBeCloseTo(expectedGoalsHand * goalPointsForAssistTest(position), 10)
  })
})

describe('modelInputs.expectedGoals is surfaced alongside the existing fields', () => {
  it('matches expectedEvents.expectedGoals and is present for every position', () => {
    const positions: Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
    for (const position of positions) {
      const p = player({
        position,
        rateHistory: { minutesPlayed: 900, totalXg: 1.8, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
        ratePositionPrior: { xgPer90: 0.18, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 },
      })
      const projection = projectPlayerFixture(p, fixture())
      expect(projection.modelInputs.expectedGoals).toBe(projection.expectedEvents.expectedGoals)
      expect(Number.isFinite(projection.modelInputs.expectedGoals)).toBe(true)
    }
  })
})

describe('ticket #162: every component other than goalPoints (and expectedGoals) is byte-identical to the pre-ticket formula, for a fixed input, across every position', () => {
  // Hand-computed pre-ticket values for this fixture and player shape (leagueBaselineGoals=1.4,
  // teamElo/opponentElo null, fplDifficulty=3 -> expectedScore=0.5 -> attackMultiplier=1,
  // defensiveMultiplier=1; recentMinutes all 90 with status 'a' -> pAppears=pSixtyPlus=1;
  // xgPer90=0.3, xaPer90=0.36, savesPer90=2 observed with matching priors so shrinkage lands
  // exactly there -- the SAME fixed input as the ticket #148 byte-identical test above, reused
  // deliberately so both tickets' effects can be cross-checked against each other):
  //   teamLambdaConceded = expectedGoalsConceded(1.4, 0.5) = 1.4 x 2 x 0.5 = 1.4
  //   pCleanSheet = exp(-1.4)
  //   expectedGoals (raw, pre-#162) = 0.3 x 1 x 1 = 0.3
  //   expectedAssists = 0.36 x 1 x 1 x this position's assistConversionFactor (ticket #148,
  //     already established, untouched by #162)
  //   expectedSaves = 2 x 1 x defensiveMultiplier(0.5) = 2 x 1 x 1 = 2
  //   defensiveContributionPoints = 0 (defconPositionPrior=0, no matches, for every position)
  //   appearancePoints = 1 x 1 + 1 x 1 = 2
  // None of these depend on xgPer90 or the new goal conversion factor -- unaffected by this ticket.
  const rateHistory = { minutesPlayed: 900, totalXg: 3.0, totalXa: 3.6, totalSaves: 20, totalCbi: 0, totalRecoveries: 0 }
  const ratePositionPrior = { xgPer90: 0.3, xaPer90: 0.36, savesPer90: 2, cbiPer90: 0, recoveriesPer90: 0 }
  const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 })
  const teamLambdaConceded = 1.4
  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)
  const expectedGoalsRawHand = 0.3
  const expectedAssistsRawHand = 0.36
  const expectedSavesHand = 2

  it.each([
    [GOALKEEPER, 4, ASSIST_CONVERSION_GOALKEEPER, GOAL_CONVERSION_GOALKEEPER],
    [DEFENDER, 4, ASSIST_CONVERSION_DEFENDER, GOAL_CONVERSION_DEFENDER],
    [MIDFIELDER, 1, ASSIST_CONVERSION_MIDFIELDER, GOAL_CONVERSION_MIDFIELDER],
    [FORWARD, 0, ASSIST_CONVERSION_FORWARD, GOAL_CONVERSION_FORWARD],
  ] as const)('%s: every component except goalPoints matches the pre-ticket formula exactly; goalPoints reflects the goal factor', (position, expectedCleanSheetPointsValue, assistFactor, goalFactor) => {
    const p = player({ position, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
    const projection = projectPlayerFixture(p, f)

    expect(cleanSheetPointsFor(position)).toBe(expectedCleanSheetPointsValue) // sanity-check the table read above
    expect(projection.components.appearancePoints).toBeCloseTo(2, 12)
    expect(projection.components.assistPoints).toBeCloseTo(expectedAssistsRawHand * assistFactor * ASSIST_POINTS, 10)
    expect(projection.components.cleanSheetPoints).toBeCloseTo(pCleanSheet * 1 * expectedCleanSheetPointsValue, 12)
    expect(projection.components.goalsConcededPoints).toBeCloseTo(expectedGoalsConcededPoints(teamLambdaConceded, position), 12)
    expect(projection.components.savePoints).toBeCloseTo(expectedSavePoints(expectedSavesHand, position), 10)
    expect(projection.components.defensiveContributionPoints).toBe(0)
    expect(projection.components.bonusPoints).toBe(0)

    // goalPoints DOES change: it is xgPer90 x minutesFraction x attackMultiplier x this
    // position's goal factor x goalPoints(position), not the pre-ticket xgPer90 x
    // minutesFraction x attackMultiplier x goalPoints(position).
    const preTicketGoalPoints = expectedGoalsRawHand * goalPointsForAssistTest(position)
    const postTicketGoalPoints = expectedGoalsRawHand * goalFactor * goalPointsForAssistTest(position)
    expect(projection.components.goalPoints).toBeCloseTo(postTicketGoalPoints, 10)
    if (goalFactor === 1.0) {
      // Goalkeeper's factor is exactly 1.0 (no-information, no correction) -- goalPoints
      // genuinely equals the pre-ticket value here, which is the CORRECT behaviour for this
      // one position, not a sign the factor failed to apply (see goalConversionFactor's own
      // explicit-case test above for that distinction).
      expect(projection.components.goalPoints).toBeCloseTo(preTicketGoalPoints, 10)
    } else {
      expect(projection.components.goalPoints).not.toBeCloseTo(preTicketGoalPoints, 5)
    }
  })
})

describe('ticket #168: diagnosed the forward-assist calibration gap, shipped no model change -- every component, forward assistPoints included, matches the pre-ticket (#162) formula exactly, for a fixed input, across every position', () => {
  // Same fixed input as the #148/#162 byte-identical tests above, reused
  // deliberately so all three tickets' effects (or, here, the deliberate lack
  // of one) can be cross-checked against each other. See this file's "Ticket
  // #168" comment (above the "Player + fixture inputs" section) for the full
  // diagnosis of why no fix ships: the measured gap is not primarily a
  // shrinkage/position-prior defect in this file or rates.ts.
  const rateHistory = { minutesPlayed: 900, totalXg: 3.0, totalXa: 3.6, totalSaves: 20, totalCbi: 0, totalRecoveries: 0 }
  const ratePositionPrior = { xgPer90: 0.3, xaPer90: 0.36, savesPer90: 2, cbiPer90: 0, recoveriesPer90: 0 }
  const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: 1.4 })
  const teamLambdaConceded = 1.4
  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)
  const expectedGoalsRawHand = 0.3
  const expectedAssistsRawHand = 0.36
  const expectedSavesHand = 2

  it.each([
    [GOALKEEPER, 4, ASSIST_CONVERSION_GOALKEEPER, GOAL_CONVERSION_GOALKEEPER],
    [DEFENDER, 4, ASSIST_CONVERSION_DEFENDER, GOAL_CONVERSION_DEFENDER],
    [MIDFIELDER, 1, ASSIST_CONVERSION_MIDFIELDER, GOAL_CONVERSION_MIDFIELDER],
    [FORWARD, 0, ASSIST_CONVERSION_FORWARD, GOAL_CONVERSION_FORWARD],
  ] as const)(
    '%s: every component, including assistPoints, matches the pre-ticket formula exactly',
    (position, expectedCleanSheetPointsValue, assistFactor, goalFactor) => {
      const p = player({ position, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
      const projection = projectPlayerFixture(p, f)

      expect(projection.components.appearancePoints).toBeCloseTo(2, 12)
      expect(projection.components.goalPoints).toBeCloseTo(
        expectedGoalsRawHand * goalFactor * goalPointsForAssistTest(position),
        10,
      )
      // assistPoints -- the term this ticket investigated -- is UNCHANGED: still
      // xaPer90 x minutesFraction x attackMultiplier x this position's EXISTING,
      // untouched assistConversionFactor x ASSIST_POINTS, forward included.
      expect(projection.components.assistPoints).toBeCloseTo(expectedAssistsRawHand * assistFactor * ASSIST_POINTS, 10)
      expect(projection.components.cleanSheetPoints).toBeCloseTo(pCleanSheet * 1 * expectedCleanSheetPointsValue, 12)
      expect(projection.components.goalsConcededPoints).toBeCloseTo(
        expectedGoalsConcededPoints(teamLambdaConceded, position),
        12,
      )
      expect(projection.components.savePoints).toBeCloseTo(expectedSavePoints(expectedSavesHand, position), 10)
      expect(projection.components.defensiveContributionPoints).toBe(0)
      expect(projection.components.bonusPoints).toBe(0)
    },
  )

  it('FORWARD assistPoints specifically still uses the unmodified ASSIST_CONVERSION_FORWARD -- no second, forward-specific correction was introduced by this ticket', () => {
    const p = player({ position: FORWARD, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
    const projection = projectPlayerFixture(p, f)
    expect(ASSIST_CONVERSION_FORWARD).toBe(2.12) // unchanged by ticket #168
    expect(projection.components.assistPoints).toBeCloseTo(0.36 * 2.12 * ASSIST_POINTS, 10)
  })

  it('goalkeeper, defender and midfielder assist output is unchanged for a fixed input -- named test, per the DoD', () => {
    const gk = projectPlayerFixture(
      player({ position: GOALKEEPER, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] }),
      f,
    )
    const def = projectPlayerFixture(
      player({ position: DEFENDER, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] }),
      f,
    )
    const mid = projectPlayerFixture(
      player({ position: MIDFIELDER, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] }),
      f,
    )
    expect(gk.components.assistPoints).toBeCloseTo(0.36 * ASSIST_CONVERSION_GOALKEEPER * ASSIST_POINTS, 10)
    expect(def.components.assistPoints).toBeCloseTo(0.36 * ASSIST_CONVERSION_DEFENDER * ASSIST_POINTS, 10)
    expect(mid.components.assistPoints).toBeCloseTo(0.36 * ASSIST_CONVERSION_MIDFIELDER * ASSIST_POINTS, 10)
  })
})

// ============================================================================
// Ticket #182 -- attackingMultiplier damped to its measured slope
// ============================================================================

describe('modelInputs.attackingMultiplier is surfaced alongside the existing savesMultiplier (ticket #182)', () => {
  it('equals attackingMultiplier(modelInputs.expectedScore), and is present for every position', () => {
    const positions: Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
    for (const position of positions) {
      const p = player({ position })
      // fplDifficulty 4 with the FDR fallback -> expectedScore 0.375, not the neutral 0.5,
      // so the surfaced value is actually exercised rather than trivially 1.0.
      const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 4 })
      const projection = projectPlayerFixture(p, f)

      expect(projection.modelInputs.expectedScore).toBeCloseTo(0.375, 10)
      expect(projection.modelInputs.attackingMultiplier).toBeCloseTo(attackingMultiplier(0.375), 12)
      expect(Number.isFinite(projection.modelInputs.attackingMultiplier)).toBe(true)
    }
  })

  it('is exactly 1.0 at an even (FDR 3 / expectedScore 0.5) fixture', () => {
    const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 3 })
    const projection = projectPlayerFixture(player(), f)
    expect(projection.modelInputs.expectedScore).toBe(0.5)
    expect(projection.modelInputs.attackingMultiplier).toBe(1.0)
  })
})

describe('ticket #182: every component other than goalPoints/assistPoints (and expectedGoals/expectedAssists) is byte-identical to the pre-ticket formula, for a fixed input at a fixed, non-neutral expectedScore, across every position', () => {
  // A deliberately non-0.5 expectedScore (0.25, via the FDR-5 fallback) so the damped
  // attackingMultiplier is actually exercised -- at 0.5 both the pre- and post-#182
  // formulas agree, which would prove nothing.
  //
  // Hand-computed pre- and post-ticket values for this fixture and player shape
  // (leagueBaselineGoals=1.4, teamElo/opponentElo null, fplDifficulty=5 ->
  // expectedScore=0.25; recentMinutes all 90 with status 'a' -> pAppears=pSixtyPlus=1;
  // xgPer90=0.3, xaPer90=0.36, savesPer90=2 observed with matching priors so shrinkage
  // lands exactly there -- the SAME rate shape as the #148/#162 byte-identical tests,
  // reused deliberately so all three tickets' effects can be cross-checked):
  //   defensiveMultiplier(0.25) = 2 x (1 - 0.25) = 1.5 -- UNTOUCHED by this ticket
  //   teamLambdaConceded = expectedGoalsConceded(1.4, 0.25) = 1.4 x 2 x 0.75 = 2.1
  //   pCleanSheet = exp(-2.1)
  //   expectedSaves = 2 x 1 x defensiveMultiplier(0.25) = 2 x 1 x 1.5 = 3
  //   attackingMultiplier(0.25) = 0.5 + 0.25 = 0.75 -- THIS is what #182 changed (pre-ticket
  //     value would have been 2 x 0.25 = 0.5)
  //   expectedGoals (raw) = 0.3 x 1 x 0.75 = 0.225 x this position's goalConversionFactor
  //   expectedAssists (raw) = 0.36 x 1 x 0.75 = 0.27 x this position's assistConversionFactor
  //   defensiveContributionPoints = 0 (defconPositionPrior=0, no matches, for every position)
  //   appearancePoints = 1 x 1 + 1 x 1 = 2
  // None of cleanSheetPoints/goalsConcededPoints/savePoints/defensiveContributionPoints/
  // appearancePoints depend on attackingMultiplier -- unaffected by this ticket.
  const rateHistory = { minutesPlayed: 900, totalXg: 3.0, totalXa: 3.6, totalSaves: 20, totalCbi: 0, totalRecoveries: 0 }
  const ratePositionPrior = { xgPer90: 0.3, xaPer90: 0.36, savesPer90: 2, cbiPer90: 0, recoveriesPer90: 0 }
  const f = fixture({ teamElo: null, opponentElo: null, fplDifficulty: 5, leagueBaselineGoals: 1.4 })
  const teamLambdaConceded = 2.1
  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)
  const expectedSavesHand = 3
  const preTicketAttackMultiplier = 0.5 // 2 x 0.25
  const postTicketAttackMultiplier = 0.75 // 0.5 + 0.25

  it.each([
    [GOALKEEPER, 4, ASSIST_CONVERSION_GOALKEEPER, GOAL_CONVERSION_GOALKEEPER],
    [DEFENDER, 4, ASSIST_CONVERSION_DEFENDER, GOAL_CONVERSION_DEFENDER],
    [MIDFIELDER, 1, ASSIST_CONVERSION_MIDFIELDER, GOAL_CONVERSION_MIDFIELDER],
    [FORWARD, 0, ASSIST_CONVERSION_FORWARD, GOAL_CONVERSION_FORWARD],
  ] as const)(
    '%s: every component except goalPoints/assistPoints matches the pre-ticket formula exactly; goalPoints/assistPoints reflect the damped multiplier',
    (position, expectedCleanSheetPointsValue, assistFactor, goalFactor) => {
      const p = player({ position, rateHistory, ratePositionPrior, defconPositionPrior: 0, defconMatches: [] })
      const projection = projectPlayerFixture(p, f)

      expect(projection.modelInputs.expectedScore).toBeCloseTo(0.25, 10)
      expect(projection.modelInputs.attackingMultiplier).toBeCloseTo(postTicketAttackMultiplier, 12)
      expect(cleanSheetPointsFor(position)).toBe(expectedCleanSheetPointsValue) // sanity-check the table read above

      expect(projection.components.appearancePoints).toBeCloseTo(2, 12)
      expect(projection.components.cleanSheetPoints).toBeCloseTo(pCleanSheet * 1 * expectedCleanSheetPointsValue, 12)
      expect(projection.components.goalsConcededPoints).toBeCloseTo(expectedGoalsConcededPoints(teamLambdaConceded, position), 12)
      expect(projection.components.savePoints).toBeCloseTo(expectedSavePoints(expectedSavesHand, position), 10)
      expect(projection.components.defensiveContributionPoints).toBe(0)
      expect(projection.components.bonusPoints).toBe(0)

      // goalPoints/assistPoints DO change: they use the post-#182 attackingMultiplier
      // (0.75), not the pre-#182 value (0.5) -- both computed by hand above, neither
      // copied from this function's own output.
      const preTicketGoalPoints = 0.3 * 1 * preTicketAttackMultiplier * goalFactor * goalPointsForAssistTest(position)
      const postTicketGoalPoints = 0.3 * 1 * postTicketAttackMultiplier * goalFactor * goalPointsForAssistTest(position)
      expect(projection.components.goalPoints).toBeCloseTo(postTicketGoalPoints, 10)
      expect(projection.components.goalPoints).not.toBeCloseTo(preTicketGoalPoints, 5)

      const preTicketAssistPoints = 0.36 * 1 * preTicketAttackMultiplier * assistFactor * ASSIST_POINTS
      const postTicketAssistPoints = 0.36 * 1 * postTicketAttackMultiplier * assistFactor * ASSIST_POINTS
      expect(projection.components.assistPoints).toBeCloseTo(postTicketAssistPoints, 10)
      expect(projection.components.assistPoints).not.toBeCloseTo(preTicketAssistPoints, 5)
    },
  )
})

describe('expectedEvents: expectedCbi and expectedRecoveries (ticket #78, unaffected by ticket #148)', () => {
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
