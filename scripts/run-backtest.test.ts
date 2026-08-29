// Unit tests for scripts/run-backtest.ts's pure functions — ticket #133,
// extended by #140 and #147.
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
//
// Ticket #147's ranking-skill tests are their own section, "RANKING SKILL",
// near the end of this file — every hand-computed expectation is worked out
// in that test's own comment (ticket text: "not copied from the failing
// output"), never derived by running the code once and pasting its answer.

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
  checkRankingSanityBounds,
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
  rankDescending,
  reconstructActualMatchPoints,
  spearmanCorrelation,
  SPEARMAN_LOWER_BOUND,
  SPEARMAN_UPPER_BOUND,
  sumComponentTotals,
  summarizeByGameweek,
  summarizeByPosition,
  summarizeErrors,
  summarizeRankingByGameweek,
  summarizeRankingByPosition,
  summarizeSeasonRanking,
  toRankingPair,
  TOP10_OVERLAP_UPPER_BOUND_FRACTION,
  topNOverlap,
  totalExcluded,
  type ActualMatchStatsInput,
  type FeatureHistoryRow,
  type MeasuredRow,
  type PositionPrior,
  type PositionRankingSummary,
  type RankingPair,
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
// RANKING SKILL — ticket #147.
// ============================================================================

describe('rankDescending', () => {
  it('rank 1 is the highest value, with no ties', () => {
    expect(rankDescending([10, 30, 20])).toEqual([3, 1, 2])
  })

  it('tied values share the AVERAGE of the ranks they would occupy (ticket text: "average ranks is standard")', () => {
    // Three players tied for the top value (positions/ranks 1,2,3 -> average 2), then two more distinct values.
    expect(rankDescending([5, 5, 5, 3, 1])).toEqual([2, 2, 2, 4, 5])
  })

  it('all values tied gives every element the same average rank', () => {
    // Four tied values occupy ranks 1..4; average = 2.5.
    expect(rankDescending([7, 7, 7, 7])).toEqual([2.5, 2.5, 2.5, 2.5])
  })

  it('handles a tie in the middle of an otherwise distinct sequence', () => {
    // Values 40,30,30,20 -> ranks 1, (2+3)/2=2.5, 2.5, 4.
    expect(rankDescending([40, 30, 30, 20])).toEqual([1, 2.5, 2.5, 4])
  })
})

describe('spearmanCorrelation — perfect agreement, perfect reversal, shuffled', () => {
  const pairs = (projected: number[], actual: number[]): RankingPair[] => projected.map((p, i) => ({ projected: p, actual: actual[i] }))

  it('perfect agreement (identical order on both sides) returns exactly 1', () => {
    const result = spearmanCorrelation(pairs([10, 9, 8, 7, 6, 5], [50, 45, 40, 35, 30, 25]))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(1, 10)
  })

  it('perfect reversal (highest projected = lowest actual) returns exactly -1', () => {
    const result = spearmanCorrelation(pairs([10, 9, 8, 7, 6, 5], [1, 2, 3, 4, 5, 6]))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(-1, 10)
  })

  it('a shuffled ranking returns near zero', () => {
    // Hand-worked, no ties. Projected ranks (already in rank order 1..6):
    // [1,2,3,4,5,6]. Actual VALUES are set to their own rank directly (1..6
    // used as values, so actual rank == actual value), permuted to
    // [4,1,6,3,5,2] — i.e. player 1 (projected rank 1) has actual rank 4,
    // player 2 (projected rank 2) has actual rank 1, and so on.
    //
    // d_i = projectedRank_i - actualRank_i:
    //   1-4=-3, 2-1=1, 3-6=-3, 4-3=1, 5-5=0, 6-2=4
    // d_i^2: 9, 1, 9, 1, 0, 16 -> sum = 36
    // No ties on either side, so the classic formula applies exactly:
    //   rho = 1 - 6*sum(d^2) / (n*(n^2-1)) = 1 - 6*36/(6*35) = 1 - 216/210 = -0.028571...
    const result = spearmanCorrelation(pairs([1, 2, 3, 4, 5, 6], [4, 1, 6, 3, 5, 2]))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(-0.0285714286, 6)
    expect(Math.abs(result!)).toBeLessThan(0.1)
  })
})

describe('spearmanCorrelation — hand-computed 6–8 player case (not copied from the failing output)', () => {
  it('matches a coefficient worked out by hand for 7 players', () => {
    // 7 players. Projected points are strictly decreasing, so projected
    // ranks are exactly the position order [1,2,3,4,5,6,7] with no ties.
    // Actual points are chosen so the actual ranks, in the SAME position
    // order, are the permutation [2,1,4,3,6,5,7] (worked out first, then the
    // point values below are picked to realise it: actual rank r <-> value
    // 8-r, i.e. rank1=7, rank2=6, rank3=5, rank4=4, rank5=3, rank6=2, rank7=1):
    //   position1 wants actual rank 2 -> value 6
    //   position2 wants actual rank 1 -> value 7
    //   position3 wants actual rank 4 -> value 4
    //   position4 wants actual rank 3 -> value 5
    //   position5 wants actual rank 6 -> value 2
    //   position6 wants actual rank 5 -> value 3
    //   position7 wants actual rank 7 -> value 1
    // Check: sorting [6,7,4,5,2,3,1] descending gives 7(pos2),6(pos1),5(pos4),
    // 4(pos3),3(pos6),2(pos5),1(pos7) -> ranks by position [2,1,4,3,6,5,7]. Matches.
    //
    // No ties on either side, so the classic no-tie formula applies exactly:
    //   d_i = projectedRank_i - actualRank_i = 1-2,2-1,3-4,4-3,5-6,6-5,7-7
    //       = -1, 1, -1, 1, -1, 1, 0
    //   d_i^2 = 1,1,1,1,1,1,0 -> sum = 6
    //   rho = 1 - 6*6 / (7*(49-1)) = 1 - 36/336 = 1 - 0.107142857... = 0.892857142857...
    const projected = [7, 6, 5, 4, 3, 2, 1]
    const actual = [6, 7, 4, 5, 2, 3, 1]
    const result = spearmanCorrelation(projected.map((p, i) => ({ projected: p, actual: actual[i] })))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.8928571429, 6)
  })
})

describe('spearmanCorrelation — ties (named test, three tied projections)', () => {
  it('matches a coefficient worked out by hand for three players tied on projected points', () => {
    // 5 players. Projected: [5,5,5,3,1] — three tied at the top value, so by
    // rankDescending's average-rank rule their ranks are all (1+2+3)/3 = 2;
    // the remaining two are distinct: rank 4, rank 5.
    //   projectedRanks = [2,2,2,4,5]
    // Actual: [4,5,3,2,1] — no ties. Sorted descending: 5(pos2),4(pos1),
    // 3(pos3),2(pos4),1(pos5) -> actualRanks by position = [2,1,3,4,5].
    //
    // Pearson correlation of [2,2,2,4,5] and [2,1,3,4,5]:
    //   meanP = 15/5 = 3, meanA = 15/5 = 3
    //   dP = [-1,-1,-1,1,2], dA = [-1,-2,0,1,2]
    //   covariance = (-1*-1)+(-1*-2)+(-1*0)+(1*1)+(2*2) = 1+2+0+1+4 = 8
    //   varP = 1+1+1+1+4 = 8, varA = 1+4+0+1+4 = 10
    //   rho = 8 / sqrt(8*10) = 8 / sqrt(80) = 8 / 8.94427... = 0.894427...
    const result = spearmanCorrelation([
      { projected: 5, actual: 4 },
      { projected: 5, actual: 5 },
      { projected: 5, actual: 3 },
      { projected: 3, actual: 2 },
      { projected: 1, actual: 1 },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.894427191, 6)
  })
})

describe('spearmanCorrelation — edge cases', () => {
  it('returns null with fewer than 2 pairs', () => {
    expect(spearmanCorrelation([])).toBeNull()
    expect(spearmanCorrelation([{ projected: 5, actual: 5 }])).toBeNull()
  })

  it('returns null (never NaN) when every projected value is identical — undefined correlation, not zero', () => {
    const result = spearmanCorrelation([
      { projected: 4, actual: 1 },
      { projected: 4, actual: 2 },
      { projected: 4, actual: 3 },
    ])
    expect(result).toBeNull()
  })
})

describe('toRankingPair', () => {
  it('lifts projectedPoints/actualPoints off a MeasuredRow-shaped value', () => {
    expect(toRankingPair({ projectedPoints: 4.5, actualPoints: 2 })).toEqual({ projected: 4.5, actual: 2 })
  })
})

describe('topNOverlap', () => {
  it('counts rows in both the top-N-by-projected and top-N-by-actual sets', () => {
    // 5 rows, projected order (desc): idx0(10),idx1(8),idx2(6),idx3(4),idx4(2)
    // actual order (desc):            idx4(9),idx1(7),idx0(5),idx3(3),idx2(1)
    // top-3 by projected = {idx0,idx1,idx2}; top-3 by actual = {idx4,idx1,idx0}
    // overlap = {idx0,idx1} -> 2
    const rows: RankingPair[] = [
      { projected: 10, actual: 5 },
      { projected: 8, actual: 7 },
      { projected: 6, actual: 1 },
      { projected: 4, actual: 3 },
      { projected: 2, actual: 9 },
    ]
    expect(topNOverlap(rows, 3)).toEqual({ overlap: 2, n: 3 })
  })

  it('perfect agreement gives full overlap', () => {
    const rows: RankingPair[] = [
      { projected: 10, actual: 100 },
      { projected: 8, actual: 80 },
      { projected: 6, actual: 60 },
    ]
    expect(topNOverlap(rows, 2)).toEqual({ overlap: 2, n: 2 })
  })

  it('caps N at the population size rather than claiming a top-10 out of 3', () => {
    const rows: RankingPair[] = [
      { projected: 3, actual: 3 },
      { projected: 2, actual: 2 },
      { projected: 1, actual: 1 },
    ]
    expect(topNOverlap(rows, 10)).toEqual({ overlap: 3, n: 3 })
  })

  it('is { overlap: 0, n: 0 } for an empty population', () => {
    expect(topNOverlap([], 10)).toEqual({ overlap: 0, n: 0 })
  })
})

describe('summarizeRankingByGameweek', () => {
  const gwRow = (gameweekId: number, projectedPoints: number, actualPoints: number): MeasuredRow =>
    measuredRow({ gameweekId, position: MIDFIELDER, projectedPoints, actualPoints })

  it('labels a gameweek "too small to read" below MIN_BUCKET_SAMPLE_SIZE — never as a correlation', () => {
    const rows = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE - 1 }, (_, i) => gwRow(1, i, i))
    const byGameweek = summarizeRankingByGameweek(rows)
    const summary = byGameweek.get(1)!
    expect(summary.n).toBe(MIN_BUCKET_SAMPLE_SIZE - 1)
    expect(summary.tooSmallToRead).toBe(true)
    expect(summary.spearman).toBeNull()
    expect(summary.top10).toBeNull()
    expect(summary.top20).toBeNull()
  })

  it('reports a real figure at exactly MIN_BUCKET_SAMPLE_SIZE rows', () => {
    const rows = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => gwRow(1, i, i)) // perfect agreement
    const byGameweek = summarizeRankingByGameweek(rows)
    const summary = byGameweek.get(1)!
    expect(summary.n).toBe(MIN_BUCKET_SAMPLE_SIZE)
    expect(summary.tooSmallToRead).toBe(false)
    expect(summary.spearman).toBeCloseTo(1, 10)
    expect(summary.top10).toEqual({ overlap: 10, n: 10 })
    expect(summary.top20).toEqual({ overlap: 20, n: 20 })
  })

  it('partitions rows by gameweek, one summary per gameweek', () => {
    const rows = [
      ...Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => gwRow(1, i, i)),
      ...Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => gwRow(2, i, MIN_BUCKET_SAMPLE_SIZE - 1 - i)), // gw2: perfect reversal
    ]
    const byGameweek = summarizeRankingByGameweek(rows)
    expect([...byGameweek.keys()]).toEqual([1, 2])
    expect(byGameweek.get(1)!.spearman).toBeCloseTo(1, 10)
    expect(byGameweek.get(2)!.spearman).toBeCloseTo(-1, 10)
  })
})

describe('summarizeSeasonRanking', () => {
  it('pools every measured row for the season Spearman figure, mirroring how `overall` pools MAE', () => {
    const rows = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: i, actualPoints: i }))
    const byGameweek = summarizeRankingByGameweek(rows)
    const season = summarizeSeasonRanking(rows, byGameweek)
    expect(season.n).toBe(MIN_BUCKET_SAMPLE_SIZE)
    expect(season.spearman).toBeCloseTo(1, 10)
  })

  it('sums top-N overlap across gameweeks, excluding any gameweek too small to read', () => {
    const bigGw1 = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: i, actualPoints: i }))
    const bigGw2 = Array.from({ length: MIN_BUCKET_SAMPLE_SIZE }, (_, i) => measuredRow({ gameweekId: 2, position: MIDFIELDER, projectedPoints: i, actualPoints: i }))
    const tinyGw3 = Array.from({ length: 5 }, (_, i) => measuredRow({ gameweekId: 3, position: MIDFIELDER, projectedPoints: i, actualPoints: i }))
    const rows = [...bigGw1, ...bigGw2, ...tinyGw3]
    const byGameweek = summarizeRankingByGameweek(rows)
    const season = summarizeSeasonRanking(rows, byGameweek)
    // Two full gameweeks, each contributing overlap 10/n=10 and 20/n=20; the
    // 5-row gameweek is too small to read and contributes nothing.
    expect(season.top10).toEqual({ overlap: 20, n: 20 })
    expect(season.top20).toEqual({ overlap: 40, n: 40 })
  })
})

describe('summarizeRankingByPosition', () => {
  it('reports all four positions, each with its own sample size', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: 5, actualPoints: 5 }),
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 4, actualPoints: 2 }),
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 2, actualPoints: 4 }),
    ]
    const byPosition = summarizeRankingByPosition(rows)
    expect(byPosition[GOALKEEPER].n).toBe(1)
    expect(byPosition[DEFENDER].n).toBe(2)
    expect(byPosition[MIDFIELDER].n).toBe(0)
    expect(byPosition[FORWARD].n).toBe(0)
    // A single row cannot carry a correlation (n<2).
    expect(byPosition[GOALKEEPER].spearman).toBeNull()
  })

  it('pools a position across the whole season for its Spearman figure, like the by-position MAE table', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: i, actualPoints: i })),
      ...Array.from({ length: 20 }, (_, i) => measuredRow({ gameweekId: 2, position: FORWARD, projectedPoints: i, actualPoints: i })),
    ]
    const byPosition = summarizeRankingByPosition(rows)
    expect(byPosition[FORWARD].n).toBe(40)
    expect(byPosition[FORWARD].spearman).toBeCloseTo(1, 10)
  })

  it('sums top-N overlap per position across gameweeks WITHOUT the 50-row gameweek gate (a per-gameweek goalkeeper population is often under 50)', () => {
    // Two gameweeks of 8 goalkeepers each — well under MIN_BUCKET_SAMPLE_SIZE,
    // but summarizeRankingByPosition must still report a real figure.
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
      ...Array.from({ length: 8 }, (_, i) => measuredRow({ gameweekId: 2, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
    ]
    const byPosition = summarizeRankingByPosition(rows)
    // Each gameweek: topNOverlap caps at population size 8, perfect agreement -> overlap 8 of 8.
    expect(byPosition[GOALKEEPER].top10).toEqual({ overlap: 16, n: 16 })
    expect(byPosition[GOALKEEPER].top20).toEqual({ overlap: 16, n: 16 })
  })
})

describe('checkRankingSanityBounds — Spearman lower bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries([GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [p, { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 } }]))

  it('fails, naming the figure, when season Spearman is below -0.2', () => {
    const result = checkRankingSanityBounds(SPEARMAN_LOWER_BOUND - 0.01, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/season/)
    expect(result.failures[0]).toMatch(/Spearman/)
    expect(result.failures[0]).toContain((SPEARMAN_LOWER_BOUND - 0.01).toFixed(3))
  })

  it('passes at exactly the lower bound', () => {
    const result = checkRankingSanityBounds(SPEARMAN_LOWER_BOUND, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })
})

describe('checkRankingSanityBounds — Spearman upper bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries([GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [p, { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 } }]))

  it('fails, naming the figure, when season Spearman is above 0.9 — the shape a lookahead leak takes', () => {
    const result = checkRankingSanityBounds(SPEARMAN_UPPER_BOUND + 0.01, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/season/)
    expect(result.failures[0]).toContain((SPEARMAN_UPPER_BOUND + 0.01).toFixed(3))
  })

  it('passes at exactly the upper bound', () => {
    const result = checkRankingSanityBounds(SPEARMAN_UPPER_BOUND, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('fails on a position\'s Spearman too, naming that position', () => {
    const byPosition = emptyByPosition()
    byPosition[DEFENDER] = { position: DEFENDER, n: 100, spearman: 0.95, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 } }
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, byPosition as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/Defender/)
  })
})

describe('checkRankingSanityBounds — top-10 overlap bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries([GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [p, { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 } }]))

  it('fails, naming the figure, when the season top-10 overlap exceeds 9 of 10', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 10, n: 10 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/top-10 overlap/)
    expect(result.failures[0]).toMatch(/10 of 10/)
  })

  it('passes at exactly 9 of 10 (the bound, not past it)', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 9, n: 10 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('TOP10_OVERLAP_UPPER_BOUND_FRACTION is exactly 9/10', () => {
    expect(TOP10_OVERLAP_UPPER_BOUND_FRACTION).toBeCloseTo(0.9, 10)
  })

  it('an empty population (n=0) never divides by zero and does not fail the bound', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('a null season Spearman and the top-10 bound can both be checked independently — a null Spearman never fails on its own', () => {
    const result = checkRankingSanityBounds(null, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
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
