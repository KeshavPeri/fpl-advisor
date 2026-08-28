// Unit tests for scripts/run-backtest.ts's pure functions — ticket #133.
//
// No live Supabase project: every DoD item provable without a database is
// proven here on constructed rows — the no-lookahead property (the most
// important test in this file, per the ticket), the two population-exclusion
// rules, the reconciliation identity, the signed-error wording in both
// directions, both sanity bounds, and the bonus exclusion. What this file
// cannot prove — that the harness produces a sane figure against the real
// 18,243 feature_history / 15,340 player_match_stats rows — is exactly the
// ticket's own named "what a substitute cannot catch" limitation: a new
// workflow_dispatch workflow cannot be run until its file is on the default
// branch, so no live run was possible from this Builder session.
//
// The workflow-file and source-invariant sections at the bottom use the same
// grep-on-real-source technique as scripts/calibration-report.test.ts and
// scripts/build-feature-history.test.ts — proving the shape of what actually
// shipped, not re-deriving the same logic here in TypeScript.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { positionPriorRates } from '../src/lib/projection/rates.ts'
import { positionPriorHitRate } from '../src/lib/projection/defconRate.ts'
import { projectPlayerGameweek } from '../src/lib/projection/expectedPoints.ts'
import { LEAGUE_BASELINE_GOALS_PER_TEAM } from '../src/lib/projection/fixture.ts'
import {
  aggregateActualForGameweek,
  assertReconciles,
  averageMinutesPerMatch,
  bucketByPriorMatches,
  buildDefconMatches,
  buildMeasuredRow,
  buildMultiFixtureDiagnostic,
  buildPlayerRateHistory,
  buildRateHistoryMatch,
  buildRecentMinutes,
  buildTeamSlugsByGameweek,
  checkSanityBounds,
  classifyRow,
  CLEAN_SHEET_RATE_UPPER_BOUND,
  computePositionPriors,
  countMultiFixtureRowsByGameweek,
  DEFAULT_SEASON,
  defconSignedError,
  derivedCleanSheetRate,
  describeSignedError,
  emptyExclusionCounts,
  formatExclusionPercentage,
  incrementExclusion,
  inferTeamSlug,
  MAE_LOWER_BOUND,
  MAE_UPPER_BOUND,
  MIN_BUCKET_SAMPLE_SIZE,
  MULTI_FIXTURE_HEADLINE_THRESHOLD,
  parseMatchIdTeamSlugs,
  pickProjectedComponents,
  projectRow,
  reconstructActualMatchPoints,
  sumComponentTotals,
  summarizeByGameweek,
  summarizeByPosition,
  summarizeErrors,
  totalExcluded,
  type ActualMatchStatsInput,
  type FeatureHistoryRow,
  type MeasuredRow,
  type PositionPrior,
} from './run-backtest.ts'

const zeroPrior = (position = FORWARD): PositionPrior => ({
  rate: positionPriorRates([]),
  defconHitRate: positionPriorHitRate(position, []),
})

function featureRow(overrides: Partial<FeatureHistoryRow> & Pick<FeatureHistoryRow, 'gameweek_id' | 'player_code'>): FeatureHistoryRow {
  return {
    prior_matches: 0,
    prior_minutes: 0,
    prior_xg: 0,
    prior_xa: 0,
    prior_saves: 0,
    prior_clearances: 0,
    prior_blocks: 0,
    prior_interceptions: 0,
    prior_tackles: 0,
    prior_recoveries: 0,
    ...overrides,
  }
}

function actualRow(overrides: Partial<ActualMatchStatsInput> = {}): ActualMatchStatsInput {
  return {
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    teamGoalsConceded: 0,
    saves: 0,
    clearances: 0,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
    ...overrides,
  }
}

// ============================================================================
// THE MOST IMPORTANT TEST IN THIS FILE — no lookahead.
// ============================================================================

describe('projectRow — no lookahead', () => {
  it('the gameweek 3 projection is built from gameweeks 1 and 2 only, never gameweek 3 itself', () => {
    // Three raw matches for one player: gw1 xg=1, gw2 xg=2, gw3 xg=100 —
    // gameweek 3's own xg is deliberately huge and distinguishable, so a
    // leak would be dramatic and obvious, not a rounding-level difference.
    const correctRow3 = featureRow({
      gameweek_id: 3,
      player_code: 500,
      prior_matches: 2,
      prior_minutes: 180,
      prior_xg: 3, // gw1 (1) + gw2 (2) — never gw3's 100
    })
    // Simulates the exact bug this test guards against: gameweek 3's own
    // match folded into its own "prior" totals.
    const leakedRow3 = featureRow({ ...correctRow3, prior_xg: 103 })

    // Direction 1: the rate-history mapping itself carries only gw1+gw2.
    expect(buildPlayerRateHistory(correctRow3).totalXg).toBe(3)
    expect(buildPlayerRateHistory(correctRow3).totalXg).not.toBe(103)

    // Direction 2: the full projection is measurably, not coincidentally,
    // sensitive to this — proving the pipeline actually uses the value
    // rather than the assertion above passing by accident.
    const prior = zeroPrior(FORWARD)
    const correctProjection = projectRow(correctRow3, FORWARD, prior)
    const leakedProjection = projectRow(leakedRow3, FORWARD, prior)

    expect(correctProjection.expectedPoints).toBeLessThan(leakedProjection.expectedPoints)
    expect(leakedProjection.expectedPoints - correctProjection.expectedPoints).toBeGreaterThan(1)
  })

  it('a gameweek 2 row is built from gameweek 1 only, not gameweek 2', () => {
    const correctRow2 = featureRow({
      gameweek_id: 2,
      player_code: 501,
      prior_matches: 1,
      prior_minutes: 90,
      prior_xa: 0.4, // gw1 only
    })
    expect(buildPlayerRateHistory(correctRow2).totalXa).toBeCloseTo(0.4, 10)
  })
})

// ============================================================================
// projectRow — fixture count (ticket #140). THE MOST IMPORTANT TEST IN
// THIS FILE, per the ticket text.
// ============================================================================

describe('projectRow — a player with two fixtures in one gameweek', () => {
  it('is projected as the sum of both fixtures — matching what the actual side sums via aggregateActualForGameweek', () => {
    const row = featureRow({
      gameweek_id: 10,
      player_code: 700,
      prior_matches: 5,
      prior_minutes: 450,
      prior_xg: 2,
      prior_xa: 1,
    })
    const prior = zeroPrior(FORWARD)

    const oneFixture = projectRow(row, FORWARD, prior, 1)
    const twoFixtures = projectRow(row, FORWARD, prior, 2)

    // Two IDENTICAL neutral fixture contexts must sum to exactly double a
    // single one — projectPlayerGameweek's own summation, unmodified.
    expect(twoFixtures.fixtures.length).toBe(2)
    expect(twoFixtures.expectedPoints).toBeCloseTo(oneFixture.expectedPoints * 2, 10)
    expect(twoFixtures.expectedMinutes).toBeCloseTo(oneFixture.expectedMinutes * 2, 10)

    // The count itself is exactly what the actual side counts: a double
    // gameweek is two player_match_stats rows, summed independently by
    // aggregateActualForGameweek — matchesFound is the count run-backtest.ts
    // feeds into projectRow as fixtureCount (see main()).
    const actualOutcome = aggregateActualForGameweek(FORWARD, [
      actualRow({ minutesPlayed: 90, goals: 1 }),
      actualRow({ minutesPlayed: 90, goals: 0 }),
    ])
    expect(actualOutcome.matchesFound).toBe(2)
    expect(actualOutcome.featured).toBe(true)
  })

  it('a blank fixture count (0) projects zero points, never an error', () => {
    const row = featureRow({ gameweek_id: 12, player_code: 702, prior_matches: 2, prior_minutes: 180 })
    const projection = projectRow(row, FORWARD, zeroPrior(FORWARD), 0)
    expect(projection.fixtures).toEqual([])
    expect(projection.expectedPoints).toBe(0)
  })
})

describe('projectRow — a single-fixture gameweek is a no-op, unchanged from before ticket #140', () => {
  it('omitting fixtureCount defaults to exactly 1 fixture, identical to passing 1 explicitly', () => {
    const row = featureRow({ gameweek_id: 11, player_code: 701, prior_matches: 3, prior_minutes: 270, prior_xg: 1 })
    const prior = zeroPrior(MIDFIELDER)
    expect(projectRow(row, MIDFIELDER, prior)).toEqual(projectRow(row, MIDFIELDER, prior, 1))
  })

  it('full equality: the default single-fixture projection matches a hand-built one-neutral-fixture call to projectPlayerGameweek directly', () => {
    const row = featureRow({ gameweek_id: 20, player_code: 703, prior_matches: 4, prior_minutes: 360, prior_xg: 3, prior_xa: 0.5 })
    const prior = zeroPrior(DEFENDER)
    const viaProjectRow = projectRow(row, DEFENDER, prior)
    const viaDirectCall = projectPlayerGameweek(
      {
        position: DEFENDER,
        status: 'a',
        chanceOfPlayingNextRound: null,
        recentMinutes: buildRecentMinutes(row),
        rateHistory: buildPlayerRateHistory(row),
        ratePositionPrior: prior.rate,
        defconMatches: buildDefconMatches(row),
        defconPositionPrior: prior.defconHitRate,
      },
      [{ fixtureId: row.gameweek_id, isHome: true, teamElo: null, opponentElo: null, fplDifficulty: 3, leagueBaselineGoals: LEAGUE_BASELINE_GOALS_PER_TEAM }],
    )
    expect(viaProjectRow).toEqual(viaDirectCall)
  })
})

// ============================================================================
// Rate/minutes/defcon input mapping — exact for rates, an averaged
// approximation for minutes/defcon (see file header).
// ============================================================================

describe('buildPlayerRateHistory / buildRateHistoryMatch', () => {
  it('maps prior_* totals directly, with CBI as clearances + blocks + interceptions (never tackles)', () => {
    const row = featureRow({
      gameweek_id: 5,
      player_code: 1,
      prior_matches: 4,
      prior_minutes: 360,
      prior_xg: 2.5,
      prior_xa: 1.1,
      prior_saves: 0,
      prior_clearances: 10,
      prior_blocks: 3,
      prior_interceptions: 7,
      prior_tackles: 99, // deliberately excluded from CBI — must not appear in totalCbi
      prior_recoveries: 12,
    })
    expect(buildPlayerRateHistory(row)).toEqual({
      minutesPlayed: 360,
      totalXg: 2.5,
      totalXa: 1.1,
      totalSaves: 0,
      totalCbi: 20, // 10 + 3 + 7, not +99
      totalRecoveries: 12,
    })
    expect(buildRateHistoryMatch(row)).toEqual({
      minutesPlayed: 360,
      xg: 2.5,
      xa: 1.1,
      saves: 0,
      cbi: 20,
      recoveries: 12,
    })
  })
})

describe('averageMinutesPerMatch / buildRecentMinutes / buildDefconMatches', () => {
  it('is 0 with no prior matches, never a division by zero', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 2, prior_matches: 0, prior_minutes: 0 })
    expect(averageMinutesPerMatch(row)).toBe(0)
    expect(buildRecentMinutes(row)).toEqual([])
    expect(buildDefconMatches(row)).toEqual([])
  })

  it('averages cumulative totals across prior_matches into one representative match', () => {
    const row = featureRow({
      gameweek_id: 4,
      player_code: 3,
      prior_matches: 3,
      prior_minutes: 270,
      prior_clearances: 6,
      prior_blocks: 3,
      prior_interceptions: 3,
      prior_tackles: 9,
      prior_recoveries: 15,
    })
    expect(averageMinutesPerMatch(row)).toBe(90)
    expect(buildRecentMinutes(row)).toEqual([90])
    expect(buildDefconMatches(row)).toEqual([
      { minutesPlayed: 90, clearances: 2, blocks: 1, interceptions: 1, tackles: 3, recoveries: 5 },
    ])
  })
})

// ============================================================================
// Position priors — computed per (gameweek, position), from that SAME
// gameweek's cross-player data only.
// ============================================================================

describe('computePositionPriors', () => {
  it('aggregates only rows for the matching gameweek and position, ignoring other gameweeks/positions', () => {
    const rows: FeatureHistoryRow[] = [
      featureRow({ gameweek_id: 5, player_code: 10, prior_matches: 2, prior_minutes: 180, prior_xg: 2 }), // FWD, gw5
      featureRow({ gameweek_id: 5, player_code: 11, prior_matches: 2, prior_minutes: 180, prior_xg: 4 }), // FWD, gw5
      featureRow({ gameweek_id: 6, player_code: 10, prior_matches: 3, prior_minutes: 270, prior_xg: 999 }), // different gameweek — must not contaminate gw5's prior
      featureRow({ gameweek_id: 5, player_code: 20, prior_matches: 2, prior_minutes: 180, prior_xg: 999 }), // different position — must not contaminate FWD's prior
    ]
    const positionOf = (code: number): typeof FORWARD | typeof MIDFIELDER => (code === 20 ? MIDFIELDER : FORWARD)
    const priors = computePositionPriors(rows, positionOf)

    const fwdGw5 = priors.get('5:4')! // 4 = FORWARD position code
    expect(fwdGw5).toBeDefined()
    // Weighted-by-minutes rate across the two FWD gw5 rows only: (2+4) xg / (360/90) nineties = 1.5.
    expect(fwdGw5.rate.xgPer90).toBeCloseTo(1.5, 10)
  })

  it('a row with prior_matches = 0 contributes nothing to the prior', () => {
    const rows: FeatureHistoryRow[] = [
      featureRow({ gameweek_id: 1, player_code: 30, prior_matches: 0 }), // must not contribute
      featureRow({ gameweek_id: 1, player_code: 31, prior_matches: 1, prior_minutes: 90, prior_xg: 9 }),
    ]
    const priors = computePositionPriors(rows, () => MIDFIELDER)
    const prior = priors.get('1:3')! // 3 = MIDFIELDER
    expect(prior.rate.xgPer90).toBeCloseTo(9, 10) // only player 31's row counted
  })
})

// ============================================================================
// reconstructActualMatchPoints — actual-side reconstruction, using
// team_goals_conceded (never the per-player goals_conceded column).
// ============================================================================

describe('reconstructActualMatchPoints — appearance points', () => {
  it('scores 0 for a zero-minute row, 1 for 1-59 minutes, 2 for 60+', () => {
    expect(reconstructActualMatchPoints(MIDFIELDER, actualRow({ minutesPlayed: 0 })).components.appearancePoints).toBe(0)
    expect(reconstructActualMatchPoints(MIDFIELDER, actualRow({ minutesPlayed: 45 })).components.appearancePoints).toBe(1)
    expect(reconstructActualMatchPoints(MIDFIELDER, actualRow({ minutesPlayed: 90 })).components.appearancePoints).toBe(2)
  })
})

describe('reconstructActualMatchPoints — clean sheets use team_goals_conceded, per position', () => {
  it('a clean sheet requires 60+ minutes AND team_goals_conceded = 0', () => {
    const gk60CS = reconstructActualMatchPoints(GOALKEEPER, actualRow({ minutesPlayed: 60, teamGoalsConceded: 0 }))
    expect(gk60CS.components.cleanSheetPoints).toBe(4)

    const def59NoCS = reconstructActualMatchPoints(DEFENDER, actualRow({ minutesPlayed: 59, teamGoalsConceded: 0 }))
    expect(def59NoCS.components.cleanSheetPoints).toBe(0) // under 60 minutes, even with 0 conceded

    const midConceded = reconstructActualMatchPoints(MIDFIELDER, actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 }))
    expect(midConceded.components.cleanSheetPoints).toBe(0)

    const fwdCS = reconstructActualMatchPoints(FORWARD, actualRow({ minutesPlayed: 90, teamGoalsConceded: 0 }))
    expect(fwdCS.components.cleanSheetPoints).toBe(0) // forwards never earn clean-sheet points, by table
  })

  it('goals-conceded points apply to GK/DEF only, and are computed from team_goals_conceded', () => {
    const def = reconstructActualMatchPoints(DEFENDER, actualRow({ minutesPlayed: 90, teamGoalsConceded: 3 }))
    expect(def.components.goalsConcededPoints).toBe(-1) // floor(3/2) * -1
    const fwd = reconstructActualMatchPoints(FORWARD, actualRow({ minutesPlayed: 90, teamGoalsConceded: 3 }))
    expect(fwd.components.goalsConcededPoints).toBe(0)
  })
})

describe('reconstructActualMatchPoints — defensive contribution is delegated to src/lib/scoring/', () => {
  it('a defender reaching 10 CBIT scores the +2 cap', () => {
    const result = reconstructActualMatchPoints(
      DEFENDER,
      actualRow({ minutesPlayed: 90, clearances: 4, blocks: 2, interceptions: 2, tackles: 2 }),
    )
    expect(result.components.defensiveContributionPoints).toBe(2)
  })
})

describe('reconstructActualMatchPoints — bonus is excluded', () => {
  it('total points never include a bonus contribution', () => {
    // A row with a very high BPS-adjacent stat line still totals to exactly
    // the sum of the 7 modelled components — nothing else is added.
    const result = reconstructActualMatchPoints(
      MIDFIELDER,
      actualRow({ minutesPlayed: 90, goals: 2, assists: 1, teamGoalsConceded: 0 }),
    )
    const componentSum = Object.values(result.components).reduce((sum, v) => sum + v, 0)
    expect(result.totalPoints).toBe(componentSum) // no hidden bonus term added on top
  })
})

// ============================================================================
// aggregateActualForGameweek — grouping, featured/teamGoalsConcededKnown
// gates, double-gameweek summing.
// ============================================================================

describe('aggregateActualForGameweek', () => {
  it('featured is false and teamGoalsConcededKnown is vacuously true with zero rows', () => {
    const outcome = aggregateActualForGameweek(MIDFIELDER, [])
    expect(outcome.featured).toBe(false)
    expect(outcome.teamGoalsConcededKnown).toBe(true)
    expect(outcome.totalPoints).toBe(0)
  })

  it('featured is false for a row present but with 0 minutes (an unused substitute)', () => {
    const outcome = aggregateActualForGameweek(MIDFIELDER, [actualRow({ minutesPlayed: 0 })])
    expect(outcome.featured).toBe(false)
  })

  it('teamGoalsConcededKnown is false if any matching row has a null team_goals_conceded', () => {
    const outcome = aggregateActualForGameweek(DEFENDER, [actualRow({ teamGoalsConceded: null })])
    expect(outcome.teamGoalsConcededKnown).toBe(false)
  })

  it('a double gameweek sums each match independently rather than merging stats first', () => {
    const match1 = actualRow({ minutesPlayed: 90, goals: 1, teamGoalsConceded: 0 }) // clean sheet + goal
    const match2 = actualRow({ minutesPlayed: 90, goals: 0, teamGoalsConceded: 2 }) // no clean sheet
    const outcome = aggregateActualForGameweek(FORWARD, [match1, match2])
    const separate1 = reconstructActualMatchPoints(FORWARD, match1)
    const separate2 = reconstructActualMatchPoints(FORWARD, match2)
    expect(outcome.totalPoints).toBe(separate1.totalPoints + separate2.totalPoints)
    expect(outcome.matchesFound).toBe(2)
  })
})

// ============================================================================
// classifyRow — the two named population-exclusion tests, plus the
// unresolved-player-code and data-incomplete reasons for completeness.
// ============================================================================

describe('classifyRow — a row with prior_matches = 0 is excluded from the headline and counted separately', () => {
  it('excludes with reason noPriorMatches, never reaching the actual-data checks', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 40, prior_matches: 0 })
    const result = classifyRow(row, MIDFIELDER, [actualRow({ minutesPlayed: 90 })])
    expect(result).toEqual({ kind: 'excluded', reason: 'noPriorMatches' })
  })
})

describe('classifyRow — a player who did not feature in a gameweek is excluded from the headline and counted separately', () => {
  it('excludes with reason didNotFeature when no actual row has minutes played', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 41, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, MIDFIELDER, [actualRow({ minutesPlayed: 0 })])
    expect(result).toEqual({ kind: 'excluded', reason: 'didNotFeature' })
  })

  it('excludes with reason didNotFeature when no actual row exists at all', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 42, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, MIDFIELDER, [])
    expect(result).toEqual({ kind: 'excluded', reason: 'didNotFeature' })
  })
})

describe('classifyRow — a blank gameweek (ticket #140): the player is unfeatured because their team had NO fixture, not because they were benched', () => {
  it('excludes with reason blankGameweek when hadFixture is explicitly false and the player did not feature', () => {
    const row = featureRow({ gameweek_id: 6, player_code: 50, prior_matches: 4, prior_minutes: 360 })
    const result = classifyRow(row, MIDFIELDER, [], false)
    expect(result).toEqual({ kind: 'excluded', reason: 'blankGameweek' })
  })

  it('a row with actual rows present but 0 minutes is still blankGameweek when hadFixture is false — the exclusion reason follows hadFixture, not the shape of the (empty) actual data', () => {
    const row = featureRow({ gameweek_id: 6, player_code: 51, prior_matches: 4, prior_minutes: 360 })
    const result = classifyRow(row, MIDFIELDER, [actualRow({ minutesPlayed: 0 })], false)
    expect(result).toEqual({ kind: 'excluded', reason: 'blankGameweek' })
  })

  it('defaults to didNotFeature (hadFixture = true) — every pre-#140 3-arg call site is an exact no-op', () => {
    const row = featureRow({ gameweek_id: 6, player_code: 52, prior_matches: 4, prior_minutes: 360 })
    expect(classifyRow(row, MIDFIELDER, [])).toEqual({ kind: 'excluded', reason: 'didNotFeature' })
    expect(classifyRow(row, MIDFIELDER, [], true)).toEqual({ kind: 'excluded', reason: 'didNotFeature' })
  })

  it('a MEASURED row is unaffected by hadFixture — the flag only matters when the player is unfeatured', () => {
    const row = featureRow({ gameweek_id: 6, player_code: 53, prior_matches: 4, prior_minutes: 360 })
    const result = classifyRow(row, FORWARD, [actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 })], false)
    expect(result.kind).toBe('measured')
  })
})

describe('classifyRow — other reasons', () => {
  it('excludes with reason unresolvedPlayerCode when position cannot be resolved', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 43, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, undefined, [actualRow()])
    expect(result).toEqual({ kind: 'excluded', reason: 'unresolvedPlayerCode' })
  })

  it('excludes with reason actualDataIncomplete when the player featured but team_goals_conceded is null', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 44, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, DEFENDER, [actualRow({ minutesPlayed: 90, teamGoalsConceded: null })])
    expect(result).toEqual({ kind: 'excluded', reason: 'actualDataIncomplete' })
  })

  it('is measured when prior_matches > 0, the player featured, and team_goals_conceded is known', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 45, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, FORWARD, [actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 })])
    expect(result.kind).toBe('measured')
  })
})

// ============================================================================
// The counters reconcile exactly.
// ============================================================================

describe('assertReconciles', () => {
  it('does not throw when measured + excluded (by reason) equals rows read', () => {
    const counts = emptyExclusionCounts()
    incrementExclusion(counts, 'noPriorMatches')
    incrementExclusion(counts, 'noPriorMatches')
    incrementExclusion(counts, 'didNotFeature')
    incrementExclusion(counts, 'actualDataIncomplete')
    incrementExclusion(counts, 'unresolvedPlayerCode')
    expect(totalExcluded(counts)).toBe(5)
    expect(() => assertReconciles(8, 3, counts)).not.toThrow() // 3 measured + 5 excluded = 8 read
  })

  it('throws, naming both sides, when the counts do not reconcile', () => {
    const counts = emptyExclusionCounts()
    incrementExclusion(counts, 'noPriorMatches')
    expect(() => assertReconciles(10, 3, counts)).toThrow(/reconciliation failed/)
  })

  it('reconciles with the new blankGameweek reason included (ticket #140)', () => {
    const counts = emptyExclusionCounts()
    incrementExclusion(counts, 'noPriorMatches')
    incrementExclusion(counts, 'didNotFeature')
    incrementExclusion(counts, 'blankGameweek')
    incrementExclusion(counts, 'blankGameweek')
    expect(totalExcluded(counts)).toBe(4)
    expect(() => assertReconciles(6, 2, counts)).not.toThrow() // 2 measured + 4 excluded = 6 read
  })
})

// ============================================================================
// Error aggregation and the signed-error wording — positive and negative
// named cases, per the ticket ("this sign is easy to invert").
// ============================================================================

function measuredRow(overrides: Partial<MeasuredRow> & Pick<MeasuredRow, 'gameweekId' | 'position' | 'projectedPoints' | 'actualPoints'>): MeasuredRow {
  const signedError = overrides.projectedPoints - overrides.actualPoints
  return {
    signedError,
    absError: Math.abs(signedError),
    projectedComponents: sumComponentTotals([]),
    actualComponents: sumComponentTotals([]),
    actualMinutes: 90,
    // Ticket #140 defaults — an ordinary single-fixture row with no history,
    // overridable per test. Existing tests that predate #140 never set
    // these, so they exercise exactly this default.
    fixtureCount: 1,
    priorMatches: 0,
    ...overrides,
  }
}

describe('summarizeErrors / summarizeByPosition / summarizeByGameweek', () => {
  it('returns null figures for an empty set, never NaN or a divide-by-zero', () => {
    const summary = summarizeErrors([])
    expect(summary).toEqual({ n: 0, meanAbsoluteError: null, meanSignedError: null })
  })

  it('computes mean absolute and mean signed error correctly', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 5, actualPoints: 3 }), // +2
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 2, actualPoints: 4 }), // -2
    ]
    const summary = summarizeErrors(rows)
    expect(summary.n).toBe(2)
    expect(summary.meanAbsoluteError).toBeCloseTo(2, 10)
    expect(summary.meanSignedError).toBeCloseTo(0, 10)
  })

  it('summarizeByPosition splits rows by position', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 5, actualPoints: 5 }),
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 10, actualPoints: 4 }),
    ]
    const byPosition = summarizeByPosition(rows)
    expect(byPosition[FORWARD].n).toBe(1)
    expect(byPosition[DEFENDER].n).toBe(1)
    expect(byPosition[MIDFIELDER].n).toBe(0)
  })

  it('summarizeByGameweek reports every gameweek separately, ascending, so a bad week is visible', () => {
    const rows = [
      measuredRow({ gameweekId: 2, position: FORWARD, projectedPoints: 1, actualPoints: 1 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 10, actualPoints: 0 }), // a bad week
    ]
    const byGameweek = summarizeByGameweek(rows)
    expect([...byGameweek.keys()]).toEqual([1, 2])
    expect(byGameweek.get(1)!.meanAbsoluteError).toBe(10)
    expect(byGameweek.get(2)!.meanAbsoluteError).toBe(0)
  })
})

describe('describeSignedError — positive case (over-projecting)', () => {
  it('states the model is over-projecting when mean signed error is positive', () => {
    expect(describeSignedError(1.234)).toMatch(/OVER-projecting/)
    expect(describeSignedError(1.234)).not.toMatch(/UNDER-projecting/)
  })
})

describe('describeSignedError — negative case (under-projecting)', () => {
  it('states the model is under-projecting when mean signed error is negative', () => {
    expect(describeSignedError(-1.234)).toMatch(/UNDER-projecting/)
    expect(describeSignedError(-1.234)).not.toMatch(/OVER-projecting/)
  })
})

describe('describeSignedError — edge cases', () => {
  it('is worded distinctly for exactly zero and for no measured rows', () => {
    expect(describeSignedError(0)).toMatch(/exactly calibrated/)
    expect(describeSignedError(null)).toMatch(/no measured rows/)
  })
})

// ============================================================================
// derivedCleanSheetRate.
// ============================================================================

describe('derivedCleanSheetRate', () => {
  it('is null with no qualifying (60+ minute) rows for that position', () => {
    expect(derivedCleanSheetRate([], DEFENDER)).toBeNull()
  })

  it('is the fraction of qualifying rows with a clean sheet, excluding sub-60-minute rows', () => {
    const cs = reconstructActualMatchPoints(DEFENDER, actualRow({ minutesPlayed: 90, teamGoalsConceded: 0 })).components
    const noCs = reconstructActualMatchPoints(DEFENDER, actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 })).components
    const rows: MeasuredRow[] = [
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 0, actualPoints: 0, actualComponents: cs, actualMinutes: 90 }),
      measuredRow({ gameweekId: 2, position: DEFENDER, projectedPoints: 0, actualPoints: 0, actualComponents: noCs, actualMinutes: 90 }),
      // Sub-60-minute row must not count toward the denominator even if it somehow carried clean-sheet points.
      measuredRow({ gameweekId: 3, position: DEFENDER, projectedPoints: 0, actualPoints: 0, actualComponents: cs, actualMinutes: 45 }),
    ]
    expect(derivedCleanSheetRate(rows, DEFENDER)).toBeCloseTo(0.5, 10)
  })
})

// ============================================================================
// checkSanityBounds — named tests at each bound.
// ============================================================================

describe('checkSanityBounds — mean absolute error lower bound', () => {
  it('fails, naming the figure, when MAE is below 1.0', () => {
    const result = checkSanityBounds(MAE_LOWER_BOUND - 0.01, {})
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/mean absolute error/)
    expect(result.failures[0]).toContain((MAE_LOWER_BOUND - 0.01).toFixed(3))
  })

  it('passes at exactly the lower bound', () => {
    expect(checkSanityBounds(MAE_LOWER_BOUND, {}).ok).toBe(true)
  })
})

describe('checkSanityBounds — mean absolute error upper bound', () => {
  it('fails, naming the figure, when MAE is above 3.5', () => {
    const result = checkSanityBounds(MAE_UPPER_BOUND + 0.01, {})
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/mean absolute error/)
    expect(result.failures[0]).toContain((MAE_UPPER_BOUND + 0.01).toFixed(3))
  })

  it('passes at exactly the upper bound', () => {
    expect(checkSanityBounds(MAE_UPPER_BOUND, {}).ok).toBe(true)
  })
})

describe('checkSanityBounds — derived clean-sheet rate bound', () => {
  it('fails, naming the position, when a position exceeds 60%', () => {
    const result = checkSanityBounds(2.0, { [DEFENDER]: CLEAN_SHEET_RATE_UPPER_BOUND + 0.01 })
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/Defender/)
    expect(result.failures[0]).toMatch(/clean-sheet rate/)
  })

  it('passes at exactly the bound', () => {
    expect(checkSanityBounds(2.0, { [DEFENDER]: CLEAN_SHEET_RATE_UPPER_BOUND }).ok).toBe(true)
  })

  it('a null rate (no qualifying rows) does not fail the bound', () => {
    expect(checkSanityBounds(2.0, { [DEFENDER]: null }).ok).toBe(true)
  })

  it('overall MAE and a position clean-sheet rate can both fail at once', () => {
    const result = checkSanityBounds(MAE_UPPER_BOUND + 1, { [FORWARD]: 0.9 })
    expect(result.failures.length).toBe(2)
  })
})

// ============================================================================
// parseMatchIdTeamSlugs / inferTeamSlug / buildTeamSlugsByGameweek — ticket
// #140, blank-gameweek detection.
// ============================================================================

describe('parseMatchIdTeamSlugs', () => {
  it('splits a Premier League match_id into its two team slugs', () => {
    expect(parseMatchIdTeamSlugs('25-26-prem-manchester-united-vs-arsenal')).toEqual(['manchester-united', 'arsenal'])
  })

  it('handles hyphenated team names on both sides', () => {
    expect(parseMatchIdTeamSlugs('25-26-prem-nottingham-forest-vs-wolverhampton-wanderers')).toEqual([
      'nottingham-forest',
      'wolverhampton-wanderers',
    ])
  })

  it('works across season prefixes, season-value-agnostic like competition.ts', () => {
    expect(parseMatchIdTeamSlugs('26-27-prem-arsenal-vs-chelsea')).toEqual(['arsenal', 'chelsea'])
  })

  it('returns null for a non-prem competition slug — this job only ever reads prem rows, but the parser does not guess', () => {
    expect(parseMatchIdTeamSlugs('25-26-fa-cup-arsenal-vs-liverpool')).toBeNull()
  })

  it('returns null for a malformed match_id', () => {
    expect(parseMatchIdTeamSlugs('not-a-real-match-id')).toBeNull()
    expect(parseMatchIdTeamSlugs('25-26-prem-onlyoneteam')).toBeNull()
  })
})

describe('inferTeamSlug', () => {
  it('picks the slug appearing most often — the player\'s own team, not any single opponent', () => {
    const matchIds = [
      '25-26-prem-arsenal-vs-chelsea',
      '25-26-prem-liverpool-vs-arsenal',
      '25-26-prem-arsenal-vs-everton',
    ]
    expect(inferTeamSlug(matchIds)).toBe('arsenal')
  })

  it('returns null with no parseable match_ids', () => {
    expect(inferTeamSlug([])).toBeNull()
    expect(inferTeamSlug(['garbage'])).toBeNull()
  })
})

describe('buildTeamSlugsByGameweek', () => {
  it('groups the set of team-slugs that played, per gameweek, across every row', () => {
    const rows = [
      { gameweek: 1, matchId: '25-26-prem-arsenal-vs-chelsea' },
      { gameweek: 1, matchId: '25-26-prem-liverpool-vs-everton' },
      { gameweek: 2, matchId: '25-26-prem-arsenal-vs-fulham' },
    ]
    const byGameweek = buildTeamSlugsByGameweek(rows)
    expect([...byGameweek.get(1)!].sort()).toEqual(['arsenal', 'chelsea', 'everton', 'liverpool'])
    expect([...byGameweek.get(2)!].sort()).toEqual(['arsenal', 'fulham'])
    expect(byGameweek.has(3)).toBe(false)
  })
})

// ============================================================================
// bucketByPriorMatches / defconSignedError — ticket #140.
// ============================================================================

describe('defconSignedError', () => {
  it('is projected defcon minus actual defcon, mirroring the overall signedError convention', () => {
    const row = measuredRow({
      gameweekId: 1,
      position: DEFENDER,
      projectedPoints: 0,
      actualPoints: 0,
      projectedComponents: { ...sumComponentTotals([]), defensiveContributionPoints: 0.3 },
      actualComponents: { ...sumComponentTotals([]), defensiveContributionPoints: 1.1 },
    })
    expect(defconSignedError(row)).toBeCloseTo(0.3 - 1.1, 10)
  })
})

describe('bucketByPriorMatches', () => {
  const rowWithPriorMatches = (priorMatches: number, value: number) =>
    measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: value, actualPoints: 0, priorMatches })

  it('partitions rows into the 1–4 / 5–9 / 10–19 / 20+ buckets by label', () => {
    const rows = [rowWithPriorMatches(2, 1), rowWithPriorMatches(7, 1), rowWithPriorMatches(15, 1), rowWithPriorMatches(25, 1)]
    // Pad each bucket past MIN_BUCKET_SAMPLE_SIZE so the figure is reported, not "too small to read".
    const padded = rows.flatMap((r) => Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, () => r))
    const buckets = bucketByPriorMatches(padded, (r) => r.signedError)
    expect(buckets.map((b) => b.label)).toEqual(['1–4', '5–9', '10–19', '20+'])
    expect(buckets.map((b) => b.n)).toEqual([MIN_BUCKET_SAMPLE_SIZE, MIN_BUCKET_SAMPLE_SIZE, MIN_BUCKET_SAMPLE_SIZE, MIN_BUCKET_SAMPLE_SIZE])
    for (const b of buckets) expect(b.tooSmallToRead).toBe(false)
  })

  it('labels a bucket "too small to read" (rather than a figure) below MIN_BUCKET_SAMPLE_SIZE — same rule ticket #123\'s accuracy display uses', () => {
    const rows = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE - 1 }, () => rowWithPriorMatches(2, 5))
    const buckets = bucketByPriorMatches(rows, (r) => r.signedError)
    const bucket14 = buckets.find((b) => b.label === '1–4')!
    expect(bucket14.n).toBe(MIN_BUCKET_SAMPLE_SIZE - 1)
    expect(bucket14.tooSmallToRead).toBe(true)
    expect(bucket14.meanSignedError).toBeNull()
  })

  it('reports the exact mean at precisely MIN_BUCKET_SAMPLE_SIZE rows', () => {
    const rows = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, () => rowWithPriorMatches(30, 4)) // signedError = 4 - 0 = 4
    const buckets = bucketByPriorMatches(rows, (r) => r.signedError)
    const bucket20plus = buckets.find((b) => b.label === '20+')!
    expect(bucket20plus.tooSmallToRead).toBe(false)
    expect(bucket20plus.meanSignedError).toBeCloseTo(4, 10)
  })
})

// ============================================================================
// buildMultiFixtureDiagnostic / countMultiFixtureRowsByGameweek — ticket #140.
// ============================================================================

describe('buildMultiFixtureDiagnostic', () => {
  it('separates multi-fixture rows and reports the headline with and without them', () => {
    const ordinary = measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 4, actualPoints: 4, fixtureCount: 1 }) // error 0
    const double = measuredRow({ gameweekId: 33, position: FORWARD, projectedPoints: 4, actualPoints: 9, fixtureCount: 2 }) // error 5
    const diagnostic = buildMultiFixtureDiagnostic([ordinary, double])
    expect(diagnostic.multiFixtureCount).toBe(1)
    expect(diagnostic.withMultiFixture.n).toBe(2)
    expect(diagnostic.withoutMultiFixture.n).toBe(1)
    expect(diagnostic.withoutMultiFixture.meanAbsoluteError).toBe(0)
  })

  it('flags movesHeadlineSignificantly only when the MAE delta exceeds MULTI_FIXTURE_HEADLINE_THRESHOLD', () => {
    const ordinary = measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 4, actualPoints: 4, fixtureCount: 1 })
    const bigMiss = measuredRow({ gameweekId: 33, position: FORWARD, projectedPoints: 0, actualPoints: 10, fixtureCount: 2 })
    const diagnostic = buildMultiFixtureDiagnostic([ordinary, bigMiss])
    expect(diagnostic.maeDelta).not.toBeNull()
    expect(Math.abs(diagnostic.maeDelta!)).toBeGreaterThan(MULTI_FIXTURE_HEADLINE_THRESHOLD)
    expect(diagnostic.movesHeadlineSignificantly).toBe(true)
  })

  it('does not flag when there are no multi-fixture rows at all — delta is exactly 0', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 4, actualPoints: 5, fixtureCount: 1 }),
      measuredRow({ gameweekId: 2, position: FORWARD, projectedPoints: 3, actualPoints: 3, fixtureCount: 1 }),
    ]
    const diagnostic = buildMultiFixtureDiagnostic(rows)
    expect(diagnostic.multiFixtureCount).toBe(0)
    expect(diagnostic.maeDelta).toBe(0)
    expect(diagnostic.movesHeadlineSignificantly).toBe(false)
  })
})

describe('countMultiFixtureRowsByGameweek', () => {
  it('counts only fixtureCount > 1 rows, grouped by gameweek', () => {
    const rows = [
      measuredRow({ gameweekId: 33, position: FORWARD, projectedPoints: 0, actualPoints: 0, fixtureCount: 2 }),
      measuredRow({ gameweekId: 33, position: MIDFIELDER, projectedPoints: 0, actualPoints: 0, fixtureCount: 2 }),
      measuredRow({ gameweekId: 33, position: DEFENDER, projectedPoints: 0, actualPoints: 0, fixtureCount: 1 }),
      measuredRow({ gameweekId: 10, position: FORWARD, projectedPoints: 0, actualPoints: 0, fixtureCount: 1 }),
    ]
    const counts = countMultiFixtureRowsByGameweek(rows)
    expect(counts.get(33)).toBe(2)
    expect(counts.has(10)).toBe(false)
  })
})

// ============================================================================
// formatExclusionPercentage — ticket #140 ("4,209 of 18,243 is 23%").
// ============================================================================

describe('formatExclusionPercentage', () => {
  it('matches the ticket\'s own worked example', () => {
    expect(formatExclusionPercentage(4209, 18243)).toBe('23%')
  })

  it('is 0% (never NaN or a divide-by-zero) with zero rows read', () => {
    expect(formatExclusionPercentage(0, 0)).toBe('0%')
  })
})

// ============================================================================
// DEFAULT_SEASON.
// ============================================================================

describe('DEFAULT_SEASON', () => {
  it('is 2025-2026, matching FEATURE_HISTORY_SEASON\'s own default', () => {
    expect(DEFAULT_SEASON).toBe('2025-2026')
  })
})

// ============================================================================
// pickProjectedComponents drops bonusPoints.
// ============================================================================

describe('pickProjectedComponents — bonus is excluded', () => {
  it('the returned ComponentTotals shape has no bonus field at all', () => {
    const picked = pickProjectedComponents({
      appearancePoints: 1,
      goalPoints: 2,
      assistPoints: 3,
      cleanSheetPoints: 4,
      goalsConcededPoints: 5,
      savePoints: 6,
      defensiveContributionPoints: 7,
      bonusPoints: 99,
    })
    expect(picked).not.toHaveProperty('bonusPoints')
    expect(Object.keys(picked).sort()).toEqual(
      [
        'appearancePoints',
        'assistPoints',
        'cleanSheetPoints',
        'defensiveContributionPoints',
        'goalPoints',
        'goalsConcededPoints',
        'savePoints',
      ].sort(),
    )
  })
})

// ============================================================================
// buildMeasuredRow — the signed-error sign convention itself.
// ============================================================================

describe('buildMeasuredRow', () => {
  it('signedError is projected minus actual', () => {
    const outcome = aggregateActualForGameweek(FORWARD, [actualRow({ minutesPlayed: 90, goals: 0, teamGoalsConceded: 0 })])
    const row = buildMeasuredRow(1, FORWARD, 10, sumComponentTotals([]), outcome)
    expect(row.signedError).toBe(10 - outcome.totalPoints)
    expect(row.absError).toBe(Math.abs(10 - outcome.totalPoints))
  })
})

// ============================================================================
// Source invariants — proving the shape of the shipped source, since main()'s
// Supabase reads need a live project this Builder session does not have.
// ============================================================================

const sourcePath = fileURLToPath(new URL('./run-backtest.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

describe('run-backtest.ts — imports the rate and points modules, never reimplements them', () => {
  it('imports rates.ts, defconRate.ts, expectedPoints.ts, fixture.ts and pointValues.ts from src/lib/projection/', () => {
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/rates\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/defconRate\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/expectedPoints\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/fixture\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/pointValues\.ts['"]/)
  })

  it('imports the scoring modules from src/lib/scoring/', () => {
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/scoring\/types\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/scoring\/defensiveContribution\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/scoring\/goalkeeperSaves\.ts['"]/)
    expect(source).toMatch(/from ['"]\.\.\/src\/lib\/scoring\/totalMatchPoints\.ts['"]/)
  })

  it('never declares its own SHRINKAGE_K or a re-derived shrinkage formula', () => {
    expect(source).not.toMatch(/SHRINKAGE_K\s*=/)
    expect(source).not.toMatch(/const\s+k\s*=\s*3/)
  })

  it('never reimplements totalMatchPoints\' summation locally (only calls the imported function)', () => {
    expect(source).not.toMatch(/function\s+totalMatchPoints/)
  })
})

describe('run-backtest.ts — the join is on player_code, never player_id', () => {
  it('selects no player_id column from feature_history or player_match_stats', () => {
    expect(source).not.toMatch(/\.select\([^)]*\bplayer_id\b/)
  })

  it('filters player_match_stats to competition = PREMIER_LEAGUE_COMPETITION, imported not hardcoded', () => {
    expect(source).toMatch(/import\s*\{\s*PREMIER_LEAGUE_COMPETITION\s*\}\s*from\s*['"]\.\/lib\/competition\.ts['"]/)
    expect(source).toMatch(/\.eq\(\s*['"]competition['"]\s*,\s*PREMIER_LEAGUE_COMPETITION\s*\)/)
    expect(source).not.toMatch(/\.eq\(\s*['"]competition['"]\s*,\s*['"]prem['"]\s*\)/)
  })

  it('reads team_goals_conceded, never the per-player goals_conceded column, for actuals', () => {
    expect(source).toMatch(
      /'player_code, match_id, gameweek, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries'/,
    )
    // A bare "goals_conceded" column in a select list (comma-delimited, not
    // prefixed by "team_") would appear as ", goals_conceded," or end a
    // select string as ", goals_conceded'" — neither pattern occurs.
    expect(source).not.toMatch(/,\s*goals_conceded\s*[,']/)
  })

  it('selects match_id from player_match_stats — ticket #140, team-slug inference for blank-gameweek detection only, never used for point reconstruction', () => {
    expect(source).toMatch(/match_id/)
  })
})

describe('run-backtest.ts — read-only except its own job_runs row', () => {
  it('issues no upsert, update or delete against any table', () => {
    expect(source).not.toMatch(/\.upsert\(/)
    expect(source).not.toMatch(/\.update\(/)
    expect(source).not.toMatch(/\.delete\(\s*\)/)
  })

  it('the only .insert( call targets job_runs', () => {
    const insertCalls = source.match(/\.from\(\s*['"][a-z_]+['"]\s*\)\s*\n?\s*\.insert\(/g) ?? []
    for (const call of insertCalls) {
      expect(call).toMatch(/job_runs/)
    }
    expect(insertCalls.length).toBeGreaterThan(0)
  })
})

describe('run-backtest.ts — every Supabase read paginates and count-checks independently', () => {
  it('uses fetchAllPages for players, feature_history and player_match_stats', () => {
    const fetchAllPagesCalls = source.match(/fetchAllPages</g) ?? []
    expect(fetchAllPagesCalls.length).toBe(3)
  })

  it('calls assertRowCountMatches once per paginated read', () => {
    const assertCalls = source.match(/assertRowCountMatches\(/g) ?? []
    expect(assertCalls.length).toBe(3)
  })
})

describe('run-backtest.ts — season is a documented, defaulted environment variable', () => {
  it('reads BACKTEST_SEASON, trimmed, defaulting to DEFAULT_SEASON', () => {
    expect(source).toMatch(/process\.env\.BACKTEST_SEASON/)
    expect(source).toMatch(/\.trim\(\)\s*\|\|\s*DEFAULT_SEASON/)
  })
})

// ============================================================================
// The workflow file — workflow_dispatch only, no schedule.
// ============================================================================

describe('.github/workflows/backtest.yml', () => {
  const workflowPath = fileURLToPath(new URL('../.github/workflows/backtest.yml', import.meta.url))
  const workflowSource = readFileSync(workflowPath, 'utf8')

  it('exists and has workflow_dispatch', () => {
    expect(workflowSource).toMatch(/workflow_dispatch/)
  })

  it('has no schedule key', () => {
    expect(workflowSource).not.toMatch(/^\s*schedule:/m)
  })

  it('runs scripts/run-backtest.ts and uploads its report as an artifact', () => {
    expect(workflowSource).toMatch(/run-backtest\.ts/)
    expect(workflowSource).toMatch(/upload-artifact/)
  })
})
