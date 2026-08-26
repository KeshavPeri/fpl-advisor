import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import type { Position } from '../scoring/types.ts'
import { defensiveMultiplier, expectedScore, expectedScoreFromDifficulty } from './fixture.ts'
import { cleanSheetPoints as cleanSheetPointsFor } from './pointValues.ts'
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
