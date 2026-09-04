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
import { defensiveContributionPoints } from '../src/lib/scoring/defensiveContribution.ts'
import { positionPriorRates } from '../src/lib/projection/rates.ts'
import { estimateDefconHitRate, positionPriorHitRate } from '../src/lib/projection/defconRate.ts'
import { estimateMinutes } from '../src/lib/projection/minutes.ts'
import { projectPlayerGameweek, type GameweekProjection } from '../src/lib/projection/expectedPoints.ts'
import { HOME_ADVANTAGE_ELO, LEAGUE_BASELINE_GOALS_PER_TEAM } from '../src/lib/projection/fixture.ts'
import {
  aggregateActualForGameweek,
  assertFiveGameweekReconciles,
  assertReconciles,
  averageMinutesPerMatch,
  buildBaselineVerdicts,
  bucketByPriorMatches,
  buildClubFixtureSchedule,
  buildDefconMatches,
  buildDefconMatchesFromCounts,
  buildFeatureHistoryIndex,
  buildFiveGameweekWindow,
  buildMeasuredRow,
  buildMultiFixtureDiagnostic,
  buildPlayerRateHistory,
  buildPlayerSeasonMatches,
  buildRateHistoryMatch,
  buildRecentMinutes,
  buildTeamMatchRecords,
  buildTeamSlugsByGameweek,
  checkOracleCeiling,
  checkRankingSanityBounds,
  checkSanityBounds,
  classifyDefconSource,
  classifyFiveGameweekRow,
  classifyRecentMinutesSource,
  classifyRow,
  CLEAN_SHEET_RATE_UPPER_BOUND,
  computeBaselineMinutesPerMatch,
  computeBaselineXgXaPerMatch,
  computeConstantBaselineSpearman,
  computeFixtureExpectedScore,
  computeGenericConstantBaselineSpearman,
  computeLastGameweekInData,
  computeOracleAppearanceRate,
  computeOracleFeaturedRate,
  computeOracleFiveGameweekEstimate,
  computeOracleRate,
  computePositionPriors,
  computeTeamStrengthAsOf,
  CONSTANT_BASELINE_LABEL,
  CONSTANT_BASELINE_VALUE,
  countMultiFixtureRowsByGameweek,
  DEFAULT_SEASON,
  defconSignedError,
  derivedCleanSheetRate,
  describeSignedError,
  eloForExpectedScore,
  emptyDefconSourceCounts,
  emptyExclusionCounts,
  emptyFiveGameweekExclusionCounts,
  emptyFixtureCoverageCounts,
  emptyPositionResolutionCounts,
  emptyRecentMinutesSourceCounts,
  emptyRecentMinutesWindowLengthDistribution,
  estimateMinutesPreTicket191,
  FIVE_GAMEWEEK_HORIZON,
  fallbackPositionPrior,
  fixtureHasSufficientHistory,
  formatExclusionPercentage,
  generateReportMarkdown,
  groupSeasonMatchesByPlayer,
  hasDefconCounters,
  hasStoredRecentMinutesWindow,
  incrementDefconSource,
  incrementExclusion,
  incrementFiveGameweekExclusion,
  incrementFixtureCoverage,
  incrementPositionResolution,
  incrementRecentMinutesSource,
  incrementRecentMinutesWindowLength,
  inferTeamSlug,
  isFiveGameweekWindowTruncated,
  lookupClubFixtureSchedule,
  MAE_LOWER_BOUND,
  MAE_UPPER_BOUND,
  MIN_BUCKET_SAMPLE_SIZE,
  MIN_TEAM_PRIOR_MATCHES,
  MULTI_FIXTURE_HEADLINE_THRESHOLD,
  NEUTRAL_EXPECTED_SCORE_VALUE,
  parseMatchIdTeamSlugs,
  pickProjectedComponents,
  PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL,
  PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL,
  projectAndReconstructWindowGameweek,
  projectRow,
  projectRowPreTicket191Minutes,
  rankDescending,
  reconstructActualMatchPoints,
  resolveFixtureTeams,
  resolveRowPosition,
  SCALE,
  spearmanCorrelation,
  SPEARMAN_LOWER_BOUND,
  SPEARMAN_UPPER_BOUND,
  sumComponentTotals,
  summarizeBaselines,
  summarizeByGameweek,
  summarizeByPosition,
  summarizeErrors,
  summarizeFiveGameweekBaselines,
  summarizeGenericBaselineSpearman,
  summarizeGenericRankingByGroup,
  summarizeGenericRankingByPosition,
  summarizeGenericSeasonRanking,
  summarizeRankingByGameweek,
  summarizeRankingByGameweekAndPosition,
  summarizeRankingByPosition,
  summarizeSeasonRanking,
  sumClubScheduleLegCounts,
  teamStrengthRate,
  toActualMatchStatsInput,
  toRankingPair,
  TOP10_OVERLAP_UPPER_BOUND_FRACTION,
  topNIsMeaningful,
  topNOverlap,
  TOP_N_MAX_POPULATION_FRACTION,
  totalExcluded,
  totalFiveGameweekExcluded,
  type ActualMatchStatsInput,
  type ActualSourceRow,
  type ClubScheduleLegCounts,
  type FeatureHistoryRow,
  type FiveGameweekRow,
  type GenericRankingRow,
  type MatchStatsForTeamStrength,
  type MeasuredRow,
  type PlayerSeasonMatch,
  type PositionPrior,
  type PositionRankingSummary,
  type RankingPair,
  type ReportData,
  type TeamMatchRecord,
  type TeamStrengthRecord,
} from './run-backtest.ts'

const zeroPrior = (position = FORWARD): PositionPrior => ({
  rate: positionPriorRates([]),
  defconHitRate: positionPriorHitRate(position, []),
})

// Ticket #154: element_type, prior_defcon_qualifying_matches and
// prior_defcon_hits all default to null — "never computed" (a row predating
// the #146 migration), the same default a real pre-migration row carries.
// Every test that needs the new columns passes them explicitly via
// overrides; every test that does not is exercising the pre-#154 fallback
// paths, unmodified. Ticket #175: team_code likewise defaults to null (a
// row predating the #167 migration) — every fixture-aware test passes it
// explicitly. Ticket #187: prior_recent_minutes likewise defaults to null (a
// row predating the #185 migration, or never rebuilt after it landed) — every
// test that does not pass it explicitly is exercising the pre-#187
// single-averaged-match fallback path, unmodified, exactly like every other
// column here.
function featureRow(overrides: Partial<FeatureHistoryRow> & Pick<FeatureHistoryRow, 'gameweek_id' | 'player_code'>): FeatureHistoryRow {
  return {
    element_type: null,
    team_code: null,
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
    prior_defcon_qualifying_matches: null,
    prior_defcon_hits: null,
    prior_recent_minutes: null,
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

// Ticket #183: ActualSourceRow — the shape run-backtest.ts actually reads
// from player_match_stats (ActualMatchStatsInput plus match_id/gameweek/
// player_code/team_code/opponent_team_code). team_code/opponent_team_code
// default to null (a genuinely resolvable club is explicit, per test).
function sourceRow(overrides: Partial<ActualSourceRow> & Pick<ActualSourceRow, 'player_code' | 'gameweek'>): ActualSourceRow {
  return {
    match_id: `match-${overrides.gameweek}`,
    minutes_played: 90,
    goals: 0,
    assists: 0,
    team_goals_conceded: 0,
    saves: 0,
    clearances: 0,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
    team_code: null,
    opponent_team_code: null,
    ...overrides,
  }
}

// Ticket #183: FiveGameweekRow — mirrors measuredRow's own defaulting style.
function fiveGwRow(
  overrides: Partial<FiveGameweekRow> & Pick<FiveGameweekRow, 'position' | 'startGameweekId' | 'actualPoints'>,
): FiveGameweekRow {
  return {
    playerCode: 1,
    projectedPoints: overrides.actualPoints,
    baselineMinutesPerMatch: 0,
    baselineXgXaPerMatch: 0,
    // Ticket #193 — the club-schedule leg diagnostics; 0 by default, like
    // every other "didn't happen for this constructed row" field here.
    legsWithScheduleFixture: 0,
    legsBlankGameweek: 0,
    legsDidNotFeatureButClubHadFixture: 0,
    // Ticket #201, Part 2 — the pre-#191 minutes reconstruction's own sum; 0
    // by default, same convention as every other field above.
    preTicket191MinutesProjectedPoints: 0,
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
// FIXTURE-AWARE EXPECTED SCORE — ticket #175.
// ============================================================================

function teamStatsRow(overrides: Partial<MatchStatsForTeamStrength> & Pick<MatchStatsForTeamStrength, 'matchId' | 'gameweek' | 'teamCode'>): MatchStatsForTeamStrength {
  return {
    opponentTeamCode: null,
    teamGoalsConceded: null,
    ...overrides,
  }
}

describe('buildTeamMatchRecords — the max-across-players correction (ticket #175)', () => {
  it('a normal match: two teams, several players each — goalsConceded is the MAX across each team\'s own players, goalsScored is the opponent\'s own max', () => {
    const rows: MatchStatsForTeamStrength[] = [
      // Team 10 (three players) concedes 2 (their goalkeeper's figure — the
      // team total — while an outfield player's own goals_conceded-shaped
      // field here is irrelevant; team_goals_conceded is already the
      // TEAM figure per player, see file header).
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      // Team 20 concedes 1.
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 20, opponentTeamCode: 10, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 20, opponentTeamCode: 10, teamGoalsConceded: 1 }),
    ]
    const records = buildTeamMatchRecords(rows)
    expect(records).toHaveLength(2)
    const team10 = records.find((r) => r.teamCode === 10)
    const team20 = records.find((r) => r.teamCode === 20)
    expect(team10).toEqual({ matchId: 'm1', gameweek: 5, teamCode: 10, goalsConceded: 2, goalsScored: 1 })
    expect(team20).toEqual({ matchId: 'm1', gameweek: 5, teamCode: 20, goalsConceded: 1, goalsScored: 2 })
  })

  it('a player substituted before a late goal: his 0 must not win over his goalkeeper\'s real 1 — the MAX, never the average or the first row found', () => {
    const rows: MatchStatsForTeamStrength[] = [
      // The substituted outfield player: withdrawn before the late goal, so
      // his own team_goals_conceded is 0.
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 30, opponentTeamCode: 40, teamGoalsConceded: 0 }),
      // His goalkeeper played the full 90 and saw the goal: team_goals_conceded 1.
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 30, opponentTeamCode: 40, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 40, opponentTeamCode: 30, teamGoalsConceded: 0 }),
    ]
    const records = buildTeamMatchRecords(rows)
    const team30 = records.find((r) => r.teamCode === 30)
    // The average (0.5) or "first row found" (0) would both be wrong — the
    // team actually conceded 1, and only the max reproduces that.
    expect(team30?.goalsConceded).toBe(1)
    expect(team30?.goalsConceded).not.toBe(0)
    expect(team30?.goalsConceded).not.toBe(0.5)
  })

  it('a 0-0 match: both teams\' real zero is preserved, never skipped as "unknown" (a falsy-check bug would drop it)', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm3', gameweek: 2, teamCode: 50, opponentTeamCode: 60, teamGoalsConceded: 0 }),
      teamStatsRow({ matchId: 'm3', gameweek: 2, teamCode: 60, opponentTeamCode: 50, teamGoalsConceded: 0 }),
    ]
    const records = buildTeamMatchRecords(rows)
    expect(records).toHaveLength(2)
    expect(records.find((r) => r.teamCode === 50)).toEqual({ matchId: 'm3', gameweek: 2, teamCode: 50, goalsConceded: 0, goalsScored: 0 })
    expect(records.find((r) => r.teamCode === 60)).toEqual({ matchId: 'm3', gameweek: 2, teamCode: 60, goalsConceded: 0, goalsScored: 0 })
  })

  it('a match where the opponent side never resolves (no team_goals_conceded rows for it) contributes NOTHING for either side — never a guessed goalsScored', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm4', gameweek: 3, teamCode: 70, opponentTeamCode: 80, teamGoalsConceded: 1 }),
      // Team 80's own row exists (so its opponent pointer is known) but its
      // team_goals_conceded is null throughout — never resolved.
      teamStatsRow({ matchId: 'm4', gameweek: 3, teamCode: 80, opponentTeamCode: 70, teamGoalsConceded: null }),
    ]
    expect(buildTeamMatchRecords(rows)).toEqual([])
  })

  it('rows with a null teamCode are ignored entirely, never grouped under a fake key', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm5', gameweek: 1, teamCode: null as unknown as number, opponentTeamCode: 90, teamGoalsConceded: 1 }),
    ]
    expect(buildTeamMatchRecords(rows)).toEqual([])
  })
})

describe('buildClubFixtureSchedule — the PUBLISHED schedule, not the player\'s own appearances (ticket #193)', () => {
  it('a single fixture: one club, one gameweek, one opponent — however many of its players\' rows the match produced', () => {
    const schedule = buildClubFixtureSchedule([
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 20, opponentTeamCode: 10, teamGoalsConceded: 1 }),
    ])
    // Eleven players' rows for one match are still ONE fixture — the key is
    // (match_id, team_code), never the row count.
    expect(lookupClubFixtureSchedule(schedule, 10, 5)).toEqual([20])
    expect(lookupClubFixtureSchedule(schedule, 20, 5)).toEqual([10])
  })

  it('a DOUBLE gameweek — two match_ids, one gameweek, one club — returns two opponents, so the leg projects two fixtures', () => {
    const schedule = buildClubFixtureSchedule([
      teamStatsRow({ matchId: 'dgw-a', gameweek: 7, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 0 }),
      teamStatsRow({ matchId: 'dgw-a', gameweek: 7, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 0 }),
      teamStatsRow({ matchId: 'dgw-b', gameweek: 7, teamCode: 10, opponentTeamCode: 30, teamGoalsConceded: 2 }),
    ])
    const fixtures = lookupClubFixtureSchedule(schedule, 10, 7)
    expect(fixtures).toHaveLength(2)
    expect([...fixtures].sort((a, b) => (a as number) - (b as number))).toEqual([20, 30])
  })

  it('a match whose team_goals_conceded is null on BOTH sides still appears — a schedule needs no goals at all (this is exactly where it differs from buildTeamMatchRecords)', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'unresolved', gameweek: 3, teamCode: 70, opponentTeamCode: 80, teamGoalsConceded: null }),
      teamStatsRow({ matchId: 'unresolved', gameweek: 3, teamCode: 80, opponentTeamCode: 70, teamGoalsConceded: null }),
    ]
    // buildTeamMatchRecords drops this match entirely — it cannot resolve a
    // goals figure for either side.
    expect(buildTeamMatchRecords(rows)).toEqual([])
    // The schedule keeps it: the match was played, so it was scheduled.
    const schedule = buildClubFixtureSchedule(rows)
    expect(lookupClubFixtureSchedule(schedule, 70, 3)).toEqual([80])
    expect(lookupClubFixtureSchedule(schedule, 80, 3)).toEqual([70])
  })

  it('a club with no rows in a gameweek returns nothing — its blank gameweek, never an invented neutral fixture', () => {
    const schedule = buildClubFixtureSchedule([teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 1 })])
    expect(lookupClubFixtureSchedule(schedule, 10, 6)).toEqual([]) // club played, but not that gameweek
    expect(lookupClubFixtureSchedule(schedule, 99, 5)).toEqual([]) // a club with no rows at all
  })

  it('rows with a null teamCode are ignored entirely, never grouped under a fake key — same rule as buildTeamMatchRecords', () => {
    const schedule = buildClubFixtureSchedule([
      teamStatsRow({ matchId: 'm5', gameweek: 1, teamCode: null as unknown as number, opponentTeamCode: 90, teamGoalsConceded: 1 }),
    ])
    expect(schedule.size).toBe(0)
  })

  it('an unresolved opponent_team_code is kept as null, never dropped — the club still had a fixture, and resolveFixtureTeams is what decides whether it can be priced', () => {
    const schedule = buildClubFixtureSchedule([teamStatsRow({ matchId: 'm6', gameweek: 4, teamCode: 10, opponentTeamCode: null, teamGoalsConceded: 1 })])
    expect(lookupClubFixtureSchedule(schedule, 10, 4)).toEqual([null])
    // One fixture, but not a priceable one: the neutral fallback, exactly as
    // ticket #175's own gate already decides.
    expect(resolveFixtureTeams(10, lookupClubFixtureSchedule(schedule, 10, 4))).toBe(false)
  })
})

describe('computeTeamStrengthAsOf — THE LOOKAHEAD GUARD (ticket #175, the most important test in the ticket)', () => {
  it('a gameweek-3 projection sees gameweeks 1 and 2 only — never gameweek 3 itself or later', () => {
    const records = [
      { matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'b', gameweek: 2, teamCode: 1, goalsConceded: 0, goalsScored: 1 },
      // Gameweek 3's own record is deliberately huge and distinguishable —
      // a leak would be dramatic and obvious, not a rounding-level difference.
      { matchId: 'c', gameweek: 3, teamCode: 1, goalsConceded: 0, goalsScored: 100 },
      // A later gameweek, further proof `<` not `<=` is the guard.
      { matchId: 'd', gameweek: 4, teamCode: 1, goalsConceded: 0, goalsScored: 200 },
    ]
    const strength = computeTeamStrengthAsOf(records, 1, 3)
    expect(strength).toEqual({ matches: 2, goalsScored: 3, goalsConceded: 1 })
    expect(strength.goalsScored).not.toBe(103)
    expect(strength.goalsScored).not.toBe(303)
  })

  it('a gameweek-1 team has no prior record at all: matches=0, never a guessed value', () => {
    const records = [{ matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 }]
    expect(computeTeamStrengthAsOf(records, 1, 1)).toEqual({ matches: 0, goalsScored: 0, goalsConceded: 0 })
  })

  it('only the requested teamCode\'s records are summed — another team\'s history never leaks in', () => {
    const records = [
      { matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'a', gameweek: 1, teamCode: 2, goalsConceded: 2, goalsScored: 1 },
    ]
    expect(computeTeamStrengthAsOf(records, 1, 5)).toEqual({ matches: 1, goalsScored: 2, goalsConceded: 1 })
  })
})

describe('teamStrengthRate', () => {
  it('is (goalsScored - goalsConceded) / matches', () => {
    expect(teamStrengthRate({ matches: 4, goalsScored: 10, goalsConceded: 6 })).toBeCloseTo(1, 10)
  })

  it('is 0 with no prior matches, never a division by zero', () => {
    expect(teamStrengthRate({ matches: 0, goalsScored: 0, goalsConceded: 0 })).toBe(0)
  })
})

describe('fixtureHasSufficientHistory / MIN_TEAM_PRIOR_MATCHES (ticket #175)', () => {
  it('true only when BOTH teams meet MIN_TEAM_PRIOR_MATCHES', () => {
    const enough: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES, goalsScored: 5, goalsConceded: 3 }
    const notEnough: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 5, goalsConceded: 3 }
    expect(fixtureHasSufficientHistory(enough, enough)).toBe(true)
    expect(fixtureHasSufficientHistory(enough, notEnough)).toBe(false)
    expect(fixtureHasSufficientHistory(notEnough, enough)).toBe(false)
    expect(fixtureHasSufficientHistory(notEnough, notEnough)).toBe(false)
  })
})

describe('computeFixtureExpectedScore (ticket #175)', () => {
  const strong: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 } // rate = 1.5
  const weak: TeamStrengthRecord = { matches: 10, goalsScored: 5, goalsConceded: 20 } // rate = -1.5
  const identicalA: TeamStrengthRecord = { matches: 6, goalsScored: 9, goalsConceded: 6 } // rate = 0.5
  const identicalB: TeamStrengthRecord = { matches: 3, goalsScored: 4.5, goalsConceded: 3 } // rate = 0.5, different matches

  it('is exactly 0.5 when two teams have identical prior records — named test', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalA, 4)).toBe(0.5)
  })

  it('is exactly 0.5 for two DIFFERENT teams whose RATE happens to be identical, regardless of scale — the delta cancels to 0, not an approximation', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalB, 1)).toBe(0.5)
    expect(computeFixtureExpectedScore(identicalA, identicalB, 100)).toBe(0.5)
  })

  it('a stronger team gets an expectedScore above 0.5, a weaker one below', () => {
    const strongVsWeak = computeFixtureExpectedScore(strong, weak, 4)
    const weakVsStrong = computeFixtureExpectedScore(weak, strong, 4)
    expect(strongVsWeak).toBeGreaterThan(0.5)
    expect(weakVsStrong).toBeLessThan(0.5)
    expect(strongVsWeak + weakVsStrong).toBeCloseTo(1, 10) // symmetric around 0.5
  })

  it('is clamped to exactly 1 for an extreme delta relative to scale, never a value above 1', () => {
    expect(computeFixtureExpectedScore(strong, weak, 0.1)).toBe(1)
  })

  it('is clamped to exactly 0 for an extreme delta the other way, never a value below 0', () => {
    expect(computeFixtureExpectedScore(weak, strong, 0.1)).toBe(0)
  })

  it('falls back to NEUTRAL_EXPECTED_SCORE_VALUE (0.5) when EITHER team is below MIN_TEAM_PRIOR_MATCHES, even with a huge underlying delta', () => {
    const thin: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 20, goalsConceded: 0 }
    expect(computeFixtureExpectedScore(thin, weak, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
    expect(computeFixtureExpectedScore(strong, thin, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
  })
})

describe('resolveFixtureTeams (ticket #175)', () => {
  it('true when the own club and every opponent resolve', () => {
    expect(resolveFixtureTeams(10, [20])).toBe(true)
    expect(resolveFixtureTeams(10, [20, 30])).toBe(true) // a double gameweek, both opponents known
  })

  it('false when the own club is unresolved, regardless of the opponents', () => {
    expect(resolveFixtureTeams(null, [20])).toBe(false)
  })

  it('false when ANY matched opponent is unresolved — the ~141-row mid-season-transfer case', () => {
    expect(resolveFixtureTeams(10, [null])).toBe(false)
    expect(resolveFixtureTeams(10, [20, null])).toBe(false) // one resolved, one not: still excluded
  })

  it('false with no matched actual rows at all — nothing to build a fixture from', () => {
    expect(resolveFixtureTeams(10, [])).toBe(false)
  })
})

describe('classifyRow — unresolvedFixtureTeams (ticket #175)', () => {
  it('excludes with reason unresolvedFixtureTeams when fixtureTeamsResolved is explicitly false and the row would otherwise be measured', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 60, prior_matches: 3, prior_minutes: 270 })
    const result = classifyRow(row, FORWARD, [actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 })], true, false)
    expect(result).toEqual({ kind: 'excluded', reason: 'unresolvedFixtureTeams' })
  })

  it('defaults to true (measured) — every pre-#175 3-arg and 4-arg call site is an exact no-op', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 61, prior_matches: 3, prior_minutes: 270 })
    const actualRows = [actualRow({ minutesPlayed: 90, teamGoalsConceded: 1 })]
    expect(classifyRow(row, FORWARD, actualRows).kind).toBe('measured')
    expect(classifyRow(row, FORWARD, actualRows, true).kind).toBe('measured')
  })

  it('an EARLIER exclusion reason (e.g. noPriorMatches) still wins even when fixtureTeamsResolved is false — precedence unchanged', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 62, prior_matches: 0 })
    const result = classifyRow(row, FORWARD, [actualRow({ minutesPlayed: 90 })], true, false)
    expect(result).toEqual({ kind: 'excluded', reason: 'noPriorMatches' })
  })
})

describe('ExclusionCounts / assertReconciles — unresolvedFixtureTeams reconciles like every other reason (ticket #175)', () => {
  it('reconciles with unresolvedFixtureTeams included', () => {
    const counts = emptyExclusionCounts()
    incrementExclusion(counts, 'noPriorMatches')
    incrementExclusion(counts, 'unresolvedFixtureTeams')
    incrementExclusion(counts, 'unresolvedFixtureTeams')
    expect(totalExcluded(counts)).toBe(3)
    expect(() => assertReconciles(5, 2, counts)).not.toThrow() // 2 measured + 3 excluded = 5 read
  })
})

describe('FixtureCoverageCounts — emptyFixtureCoverageCounts / incrementFixtureCoverage (ticket #175)', () => {
  it('tallies real vs neutral-fallback independently', () => {
    const counts = emptyFixtureCoverageCounts()
    incrementFixtureCoverage(counts, true)
    incrementFixtureCoverage(counts, true)
    incrementFixtureCoverage(counts, false)
    expect(counts).toEqual({ realFixture: 2, neutralFallback: 1 })
  })
})

describe('eloForExpectedScore (ticket #175)', () => {
  it('at s=0.5, the elo gap is exactly HOME_ADVANTAGE_ELO (log10(1) = 0)', () => {
    expect(eloForExpectedScore(0.5)).toBe(HOME_ADVANTAGE_ELO)
  })

  it('round-trips through fixture.ts\'s own expectedScore formula (isHome=false, opponentElo=0) back to the original target, for several values', () => {
    // Reproduces the exact construction buildFixtureContextFromExpectedScore
    // uses, via the same expectedScore fixture.ts exports and this file
    // imports for other tests — proving eloForExpectedScore is a true
    // inverse, not merely "close enough".
    const expectedScoreFn = (eloFor: number, eloAgainst: number, isHome: boolean): number =>
      1 / (1 + 10 ** ((eloAgainst - eloFor - (isHome ? HOME_ADVANTAGE_ELO : -HOME_ADVANTAGE_ELO)) / 400))
    for (const s of [0.05, 0.25, 0.5, 0.6, 0.75, 0.95]) {
      const eloFor = eloForExpectedScore(s)
      expect(expectedScoreFn(eloFor, 0, false)).toBeCloseTo(s, 10)
    }
  })

  it('resolves the s=0 and s=1 boundaries via Infinity arithmetic — exactly 0 and exactly 1, never NaN', () => {
    const expectedScoreFn = (eloFor: number, eloAgainst: number, isHome: boolean): number =>
      1 / (1 + 10 ** ((eloAgainst - eloFor - (isHome ? HOME_ADVANTAGE_ELO : -HOME_ADVANTAGE_ELO)) / 400))
    expect(expectedScoreFn(eloForExpectedScore(0), 0, false)).toBe(0)
    expect(expectedScoreFn(eloForExpectedScore(1), 0, false)).toBe(1)
    expect(Number.isNaN(eloForExpectedScore(0))).toBe(false)
    expect(Number.isNaN(eloForExpectedScore(1))).toBe(false)
  })
})

// Compares two GameweekProjections on everything that actually determines
// the numbers this file reports (expectedPoints, expectedMinutes, and every
// fixture's components/expectedEvents) while ignoring modelInputs.
// eloFallbackUsed — a legitimate, expected difference in HOW expectedScore
// 0.5 was reached (the pre-#175 fplDifficulty fallback vs this ticket's
// elo-gap construction), never in the resulting number. Asserting on that
// diagnostic flag here would be asserting an implementation detail neither
// this ticket nor #147 ever claimed to preserve.
function expectSameProjectionOutcome(a: GameweekProjection, b: GameweekProjection): void {
  expect(a.expectedPoints).toBeCloseTo(b.expectedPoints, 10)
  expect(a.expectedMinutes).toBeCloseTo(b.expectedMinutes, 10)
  expect(a.fixtures).toHaveLength(b.fixtures.length)
  a.fixtures.forEach((fixture, i) => {
    expect(fixture.components).toEqual(b.fixtures[i].components)
    expect(fixture.expectedEvents).toEqual(b.fixtures[i].expectedEvents)
    expect(fixture.modelInputs.expectedScore).toBeCloseTo(b.fixtures[i].modelInputs.expectedScore, 10)
  })
}

describe('projectRow — fixture-aware expectedScore (ticket #175)', () => {
  it('a defined expectedScore of exactly 0.5 reproduces the SAME projection outcome as the neutral fallback — same points, same components, same expectedScore (0.5), only the construction path (eloFallbackUsed) legitimately differs', () => {
    const row = featureRow({ gameweek_id: 15, player_code: 800, prior_matches: 5, prior_minutes: 450, prior_xg: 2 })
    const prior = zeroPrior(FORWARD)
    const neutral = projectRow(row, FORWARD, prior, 1)
    const explicitHalf = projectRow(row, FORWARD, prior, 1, [0.5])
    expectSameProjectionOutcome(explicitHalf, neutral)
    expect(neutral.fixtures[0].modelInputs.eloFallbackUsed).toBe(true) // fplDifficulty fallback (teamElo/opponentElo null)
    expect(explicitHalf.fixtures[0].modelInputs.eloFallbackUsed).toBe(false) // this ticket's elo-gap construction (both non-null)
  })

  it('a favourable expectedScore (0.75) projects MORE points than neutral; an unfavourable one (0.25) projects FEWER — the fixture actually moves the number', () => {
    const row = featureRow({ gameweek_id: 15, player_code: 801, prior_matches: 5, prior_minutes: 450, prior_xg: 2 })
    const prior = zeroPrior(FORWARD)
    const neutral = projectRow(row, FORWARD, prior, 1, [0.5])
    const favourable = projectRow(row, FORWARD, prior, 1, [0.75])
    const unfavourable = projectRow(row, FORWARD, prior, 1, [0.25])
    expect(favourable.expectedPoints).toBeGreaterThan(neutral.expectedPoints)
    expect(unfavourable.expectedPoints).toBeLessThan(neutral.expectedPoints)
  })

  it('a multi-fixture row can carry a DIFFERENT expectedScore per fixture, by index — a double gameweek against two different-strength opponents', () => {
    const row = featureRow({ gameweek_id: 15, player_code: 802, prior_matches: 5, prior_minutes: 450, prior_xg: 2 })
    const prior = zeroPrior(FORWARD)
    const mixed = projectRow(row, FORWARD, prior, 2, [0.75, 0.25])
    const bothFavourable = projectRow(row, FORWARD, prior, 2, [0.75, 0.75])
    const bothNeutral = projectRow(row, FORWARD, prior, 2, [0.5, 0.5])
    expect(mixed.fixtures).toHaveLength(2)
    // Every FORWARD component fixture.ts feeds is LINEAR in expectedScore
    // (attackingMultiplier = 2s; forwards earn no clean-sheet/goals-conceded
    // points at all — pointValues.ts), so [0.75, 0.25] sums to EXACTLY the
    // same total as [0.5, 0.5] (both average to 0.5) — proving each index's
    // own value was actually used (not just the first one broadcast to
    // both fixtures, which would instead make mixed equal bothFavourable).
    expect(mixed.expectedPoints).toBeCloseTo(bothNeutral.expectedPoints, 10)
    expect(mixed.expectedPoints).toBeLessThan(bothFavourable.expectedPoints)
  })

  it('an index past the end of fixtureExpectedScores falls back to neutral for that fixture only', () => {
    const row = featureRow({ gameweek_id: 15, player_code: 803, prior_matches: 5, prior_minutes: 450, prior_xg: 2 })
    const prior = zeroPrior(FORWARD)
    const oneScoreTwoFixtures = projectRow(row, FORWARD, prior, 2, [0.75])
    const explicitMixed = projectRow(row, FORWARD, prior, 2, [0.75, 0.5])
    expectSameProjectionOutcome(oneScoreTwoFixtures, explicitMixed)
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
// buildRecentMinutes — ticket #187, Defect 1 fix. THE NAMED TEST the ticket
// text requires: "a named test proves a five-entry window reaches
// estimateMinutes() intact rather than being averaged."
// ============================================================================

describe('hasStoredRecentMinutesWindow / classifyRecentMinutesSource (ticket #187)', () => {
  it('is false, and classifies as averagedFallback, when prior_recent_minutes is null — the pre-#185 case', () => {
    expect(hasStoredRecentMinutesWindow({ prior_recent_minutes: null })).toBe(false)
    expect(classifyRecentMinutesSource({ prior_recent_minutes: null })).toBe('averagedFallback')
  })

  it('is true, and classifies as storedWindow, when prior_recent_minutes is a real array — including the real empty-array case (prior_matches = 0)', () => {
    expect(hasStoredRecentMinutesWindow({ prior_recent_minutes: [] })).toBe(true)
    expect(classifyRecentMinutesSource({ prior_recent_minutes: [] })).toBe('storedWindow')
    expect(hasStoredRecentMinutesWindow({ prior_recent_minutes: [90, 45] })).toBe(true)
    expect(classifyRecentMinutesSource({ prior_recent_minutes: [90, 45] })).toBe('storedWindow')
  })
})

describe('RecentMinutesSourceCounts — emptyRecentMinutesSourceCounts / incrementRecentMinutesSource (ticket #187)', () => {
  it('tallies each of the two sources independently', () => {
    const counts = emptyRecentMinutesSourceCounts()
    incrementRecentMinutesSource(counts, 'storedWindow')
    incrementRecentMinutesSource(counts, 'storedWindow')
    incrementRecentMinutesSource(counts, 'averagedFallback')
    expect(counts).toEqual({ fromStoredWindow: 2, fromAveragedFallback: 1 })
  })
})

describe('RecentMinutesWindowLengthDistribution — empty/increment (ticket #187)', () => {
  it('builds a histogram keyed by observed length, starting from an empty object', () => {
    const distribution = emptyRecentMinutesWindowLengthDistribution()
    expect(distribution).toEqual({})
    incrementRecentMinutesWindowLength(distribution, 5)
    incrementRecentMinutesWindowLength(distribution, 5)
    incrementRecentMinutesWindowLength(distribution, 0)
    incrementRecentMinutesWindowLength(distribution, 1)
    expect(distribution).toEqual({ 5: 2, 0: 1, 1: 1 })
  })
})

describe('buildRecentMinutes — reads the #185 stored window (ticket #187)', () => {
  it('returns the stored window exactly, most-recent-first, when prior_recent_minutes is non-null — never averaged', () => {
    const row = featureRow({
      gameweek_id: 6,
      player_code: 4,
      prior_matches: 5,
      prior_minutes: 200,
      prior_recent_minutes: [90, 90, 20, 0, 0], // most-recent-first: the two 0s are the two MOST RECENT matches
    })
    // Exact array, exact order — proves "unmodified, most-recent-first",
    // never sorted, reversed, or collapsed into a single average.
    expect(buildRecentMinutes(row)).toEqual([90, 90, 20, 0, 0])
  })

  it('a real empty stored window ([], prior_matches = 0) returns [], the same result the pre-#187 fallback already gave for that case', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 9, prior_matches: 0, prior_minutes: 0, prior_recent_minutes: [] })
    expect(buildRecentMinutes(row)).toEqual([])
  })

  it('mutating the returned array never mutates row.prior_recent_minutes — a defensive copy, not the same reference', () => {
    const stored = [90, 45, 90]
    const row = featureRow({ gameweek_id: 7, player_code: 5, prior_matches: 3, prior_minutes: 225, prior_recent_minutes: stored })
    const result = buildRecentMinutes(row)
    result.push(999)
    expect(stored).toEqual([90, 45, 90])
  })

  it('falls back to the pre-#187 single-averaged-match construction when prior_recent_minutes is null (row predates the #185 migration)', () => {
    const row = featureRow({ gameweek_id: 8, player_code: 6, prior_matches: 4, prior_minutes: 360, prior_recent_minutes: null })
    expect(buildRecentMinutes(row)).toEqual([90]) // averageMinutesPerMatch(row) = 360/4 = 90, the old construction exactly
  })

  it(
    'THE NAMED TEST: a five-entry stored window reaches estimateMinutes() intact, most-recent-first, unmodified — ' +
      'never collapsed into one averaged match. Pre-existing test updated by ticket #201 (Part 2 is directly about ' +
      'this exact window — see docs/projection-model-backlog.md and decisions/ticket-201.md): #191 shipped the v2 ' +
      'minutes model AFTER this test was written for #187, and #191 changes expectedMinutes for this window too, ' +
      'not only pSixtyPlus — the two are no longer "the same average either way", so that premise (and the figures ' +
      'below) needed updating to the shipped model\'s actual output. A player who just lost his starting place (his ' +
      'two MOST RECENT matches are 0 minutes) looks IDENTICAL to a nailed starter under the old single-averaged-match ' +
      'construction (40 minutes, pSixtyPlus exactly 0 — a single synthetic match is binary), but is CORRECTLY ' +
      'distinguished once the true five-match window reaches the shipped v2 estimateMinutes() directly (50 minutes, ' +
      'pSixtyPlus 0.5 — hand-computed below, and pinned again on the pre-#191 reconstruction in the "Ticket #201, ' +
      'Part 2" section further down this file).',
    () => {
      // prior_matches = 5 (exactly RECENT_MATCH_COUNT), so prior_minutes/prior_matches
      // and the stored window's own average necessarily coincide.
      const row = featureRow({
        gameweek_id: 9,
        player_code: 7,
        prior_matches: 5,
        prior_minutes: 200, // 90+90+20+0+0 = 200, matching the stored window's own sum exactly
        prior_recent_minutes: [90, 90, 20, 0, 0], // most-recent-first — the two 0s are his two most recent matches
      })

      const recentMinutes = buildRecentMinutes(row)
      expect(recentMinutes).toEqual([90, 90, 20, 0, 0]) // the array that actually reaches estimateMinutes()

      const fixedEstimate = estimateMinutes(recentMinutes, 1)
      const oldFallbackEstimate = estimateMinutes([averageMinutesPerMatch(row)], 1) // what pre-#187 buildRecentMinutes would have fed it

      // Pre-#187 single-averaged-match construction: exactly 40 minutes,
      // binary pSixtyPlus (40 < 60, so exactly 0) — untouched by #191, since
      // a one-element sample never hits the full-window drop/split branch.
      expect(oldFallbackEstimate.expectedMinutes).toBeCloseTo(40, 10)
      expect(oldFallbackEstimate.pSixtyPlus).toBe(0)

      // Shipped v2 (ticket #191): sorted ascending [0,0,20,90,90], the single
      // lowest value dropped -> [0,20,90,90]; featured (>0) = [20,90,90],
      // pFeature = 3/4 = 0.75, minutesGivenFeature = (20+90+90)/3 = 66.667,
      // expectedMinutes = 0.75 x 66.667 = 50; pSixtyGivenFeature = 2/3 (20
      // doesn't reach 60, both 90s do), pSixtyPlus = 0.75 x 2/3 = 0.5. BOTH
      // figures now differ from the pre-#187 construction, not only pSixtyPlus.
      expect(fixedEstimate.expectedMinutes).toBeCloseTo(50, 10)
      expect(fixedEstimate.pSixtyPlus).toBeCloseTo(0.5, 10)
      expect(fixedEstimate.expectedMinutes).not.toBeCloseTo(oldFallbackEstimate.expectedMinutes, 2)
      expect(fixedEstimate.pSixtyPlus).not.toBe(oldFallbackEstimate.pSixtyPlus)
    },
  )

  it('projectRow itself is measurably sensitive to the fix (not just buildRecentMinutes/estimateMinutes in isolation) — the full pipeline reaches a different projection', () => {
    const rowFixed = featureRow({
      gameweek_id: 10,
      player_code: 8,
      element_type: FORWARD,
      prior_matches: 5,
      prior_minutes: 200,
      prior_recent_minutes: [90, 90, 20, 0, 0],
    })
    const rowFallback = featureRow({ ...rowFixed, prior_recent_minutes: null })
    const prior = zeroPrior(FORWARD)

    const fixedProjection = projectRow(rowFixed, FORWARD, prior)
    const fallbackProjection = projectRow(rowFallback, FORWARD, prior)

    // Ticket #201 update: under the shipped v2 minutes model (#191) BOTH
    // expectedMinutes (50 vs 40) AND pSixtyPlus (0.5 vs 0) differ for this
    // window — see the named test above for the hand-computed figures — so
    // the full projection differs on both fronts, not only via pSixtyPlus.
    expect(fixedProjection.expectedMinutes).not.toBeCloseTo(fallbackProjection.expectedMinutes, 2)
    expect(fixedProjection.expectedPoints).not.toBeCloseTo(fallbackProjection.expectedPoints, 10)
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
// resolveRowPosition (ticket #154, Defect 1) — feature_history.element_type
// is the primary source, the `players` fallback map only applies when it is
// null, and a row resolves to neither only when both are unavailable. All
// three named paths, each proven independently.
// ============================================================================

describe('resolveRowPosition — the three named paths (ticket #154)', () => {
  it('path 1: element_type is used when non-null, even when the players fallback map disagrees', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 900, element_type: MIDFIELDER })
    const codeToPosition = new Map<number, typeof FORWARD>([[900, FORWARD]]) // deliberately disagrees
    const result = resolveRowPosition(row, codeToPosition)
    expect(result).toEqual({ position: MIDFIELDER, source: 'elementType' })
  })

  it('path 2: falls back to the players map when element_type is null', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 901, element_type: null })
    const codeToPosition = new Map<number, typeof DEFENDER>([[901, DEFENDER]])
    const result = resolveRowPosition(row, codeToPosition)
    expect(result).toEqual({ position: DEFENDER, source: 'playersFallback' })
  })

  it('path 3: unresolved when element_type is null and the code has no players row either — the 23% this ticket fixes', () => {
    const row = featureRow({ gameweek_id: 1, player_code: 902, element_type: null })
    const codeToPosition = new Map<number, typeof DEFENDER>() // player_code 902 not present -- a player who has left the league
    const result = resolveRowPosition(row, codeToPosition)
    expect(result).toEqual({ position: undefined, source: 'unresolved' })
  })
})

describe('PositionResolutionCounts — emptyPositionResolutionCounts / incrementPositionResolution (ticket #154)', () => {
  it('tallies each of the three sources independently', () => {
    const counts = emptyPositionResolutionCounts()
    incrementPositionResolution(counts, 'elementType')
    incrementPositionResolution(counts, 'elementType')
    incrementPositionResolution(counts, 'playersFallback')
    incrementPositionResolution(counts, 'unresolved')
    expect(counts).toEqual({ fromElementType: 2, fromPlayersFallback: 1, unresolved: 1 })
  })
})

// ============================================================================
// Defensive-contribution counters (ticket #154, Defect 2) — the real
// per-match qualifying/hit counts feed estimateDefconHitRate directly
// (via buildDefconMatchesFromCounts), replacing the single-averaged-match
// approximation that could never carry more than 1/6 weight regardless of
// how much real history a player had.
// ============================================================================

describe('hasDefconCounters / classifyDefconSource (ticket #154)', () => {
  it('is false, and classifies as averagedFallback, when either counter is null', () => {
    expect(hasDefconCounters({ prior_defcon_qualifying_matches: null, prior_defcon_hits: null })).toBe(false)
    expect(hasDefconCounters({ prior_defcon_qualifying_matches: 5, prior_defcon_hits: null })).toBe(false)
    expect(hasDefconCounters({ prior_defcon_qualifying_matches: null, prior_defcon_hits: 0 })).toBe(false)
    expect(classifyDefconSource({ prior_defcon_qualifying_matches: null, prior_defcon_hits: null })).toBe('averagedFallback')
  })

  it('is true, and classifies as storedCounters, when both counters are non-null — including the real zero case', () => {
    expect(hasDefconCounters({ prior_defcon_qualifying_matches: 0, prior_defcon_hits: 0 })).toBe(true)
    expect(hasDefconCounters({ prior_defcon_qualifying_matches: 20, prior_defcon_hits: 5 })).toBe(true)
    expect(classifyDefconSource({ prior_defcon_qualifying_matches: 20, prior_defcon_hits: 5 })).toBe('storedCounters')
  })
})

describe('DefconSourceCounts — emptyDefconSourceCounts / incrementDefconSource (ticket #154)', () => {
  it('tallies each of the two sources independently', () => {
    const counts = emptyDefconSourceCounts()
    incrementDefconSource(counts, 'storedCounters')
    incrementDefconSource(counts, 'storedCounters')
    incrementDefconSource(counts, 'averagedFallback')
    expect(counts).toEqual({ fromStoredCounters: 2, fromAveragedFallback: 1 })
  })
})

describe('buildDefconMatchesFromCounts — reproduces the real qualifying/hit counts exactly (ticket #154)', () => {
  it('builds exactly `hits` qualifying matches that reach the threshold and `qualifyingMatches - hits` that miss it', () => {
    const matches = buildDefconMatchesFromCounts(20, 5)
    expect(matches).toHaveLength(20)
    // Every match is qualifying (90 minutes, well over the 60-minute gate).
    expect(matches.every((m) => m.minutesPlayed >= 60)).toBe(true)
    // Exactly 5 reach even the stricter mid/forward 12-CBIRT threshold, the
    // other 15 register nothing at all — the two extremes buildDefconMatchesFromCounts
    // is documented to build, checked here via the real threshold function
    // rather than assumed.
    const hits = matches.filter((m) => defensiveContributionPoints(FORWARD, m) > 0)
    expect(hits).toHaveLength(5)
  })

  it('is empty for zero qualifying matches, never a phantom entry', () => {
    expect(buildDefconMatchesFromCounts(0, 0)).toEqual([])
  })

  it('clamps a corrupt hits count to the qualifying-matches count, defensively', () => {
    expect(buildDefconMatchesFromCounts(3, 99)).toHaveLength(3)
    expect(buildDefconMatchesFromCounts(3, 99).every((m) => defensiveContributionPoints(DEFENDER, m) > 0)).toBe(true)
  })
})

describe('buildDefconMatches + estimateDefconHitRate — the ticket #154 hand-computed arithmetic', () => {
  it('prior_defcon_qualifying_matches=20, prior_defcon_hits=5, position prior=0.2 gives exactly 0.24', () => {
    // By hand: estimate = (hits + SHRINKAGE_K x positionPrior) / (qualifyingMatches + SHRINKAGE_K)
    //                    = (5 + 5 x 0.2) / (20 + 5)
    //                    = (5 + 1) / 25
    //                    = 6 / 25
    //                    = 0.24
    const row = featureRow({
      gameweek_id: 9,
      player_code: 910,
      prior_matches: 20,
      prior_defcon_qualifying_matches: 20,
      prior_defcon_hits: 5,
    })
    const estimate = estimateDefconHitRate(DEFENDER, buildDefconMatches(row), 0.2)
    expect(estimate).toBeCloseTo(0.24, 10)
  })

  it('the OLD single-synthetic-match path on the SAME evidence yields a materially different, more heavily shrunk value — proving the old behaviour was the defect', () => {
    // Same underlying story as above (20 qualifying matches, 5 of them
    // hits -- a 25% hit rate) but WITHOUT the #146 counters, forcing the
    // pre-#154 fallback: one averaged synthetic match. Averaging 20 real
    // matches where only 5 crossed the defender's 10-CBIT threshold pulls
    // the per-match AVERAGE well under 10 (here: 1 CBIT/match), so the one
    // synthetic match this path builds is itself a miss.
    const oldRow = featureRow({
      gameweek_id: 9,
      player_code: 911,
      prior_matches: 20,
      prior_minutes: 1800, // averages to 90 min/match -- comfortably qualifying (60+)
      prior_clearances: 20, // averages to 1 CBIT/match -- far under the 10 threshold, a clear miss
      // prior_defcon_qualifying_matches / prior_defcon_hits left null (default) -- the pre-#146 case.
    })
    const oldMatches = buildDefconMatches(oldRow)
    expect(oldMatches).toHaveLength(1) // the pre-#154 defect: always <= 1 match, regardless of real history
    const oldEstimate = estimateDefconHitRate(DEFENDER, oldMatches, 0.2)
    // By hand: one miss, n=1, hits=0: estimate = (0 + 5 x 0.2) / (1 + 5) = 1 / 6 = 0.1666...
    expect(oldEstimate).toBeCloseTo(1 / 6, 10)
    expect(oldEstimate).not.toBeCloseTo(0.24, 2) // materially different from the new, counters-driven 0.24
  })

  it('a row with null defcon counters falls back to the averaged-match path rather than throwing or being treated as excluded', () => {
    const row = featureRow({ gameweek_id: 2, player_code: 912, prior_matches: 5, prior_minutes: 450, prior_clearances: 20 })
    expect(hasDefconCounters(row)).toBe(false)
    expect(() => buildDefconMatches(row)).not.toThrow()
    expect(buildDefconMatches(row)).toHaveLength(1) // the existing averaged-match path, unchanged
    expect(classifyDefconSource(row)).toBe('averagedFallback')
  })

  it('goalkeepers still return exactly 0 defensive contribution, even with real stored counters', () => {
    const row = featureRow({
      gameweek_id: 9,
      player_code: 913,
      prior_matches: 20,
      prior_defcon_qualifying_matches: 20,
      prior_defcon_hits: 15, // a high hit rate -- must still be irrelevant for a goalkeeper
    })
    expect(estimateDefconHitRate(GOALKEEPER, buildDefconMatches(row), 0.5)).toBe(0)
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
    // Ticket #159 defaults — 0 for both baselines, overridable per test.
    // Existing tests that predate #159 never set these, so they exercise
    // exactly this default (harmless: they never read either field).
    baselineMinutesPerMatch: 0,
    baselineXgXaPerMatch: 0,
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

  // Ticket #159, Defect 2: this test USED TO assert {overlap:16,n:16} for
  // both top10 and top20 over an 8-row weekly population — exactly the
  // shape this ticket fixes (topNOverlap caps N at 8, so 8/8 = 100% of the
  // population is "the top N" both times, an automatic, meaningless
  // "overlap"). Rewritten with a 15-row weekly population (still well under
  // MIN_BUCKET_SAMPLE_SIZE, so the original "no 50-row gate" claim below
  // still holds) chosen so top-10 and top-20 land on opposite sides of
  // TOP_N_MAX_POPULATION_FRACTION (0.75) — hand-computed, not copied from
  // failing output.
  it('sums top-N overlap per position across gameweeks WITHOUT the 50-row gameweek gate (a per-gameweek goalkeeper population is often under 50) — while refusing a slice whose N is too large a fraction of ITS OWN population (ticket #159)', () => {
    // Two gameweeks of 15 goalkeepers each — under MIN_BUCKET_SAMPLE_SIZE.
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
      ...Array.from({ length: 15 }, (_, i) => measuredRow({ gameweekId: 2, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
    ]
    const byPosition = summarizeRankingByPosition(rows)
    // Each gameweek: topNOverlap(pairs,10) caps n=min(10,15)=10; 10/15 ≈
    // 66.7% <= 75% -> meaningful, perfect agreement -> overlap 10 of 10.
    // Summed across 2 gameweeks: 20 of 20.
    expect(byPosition[GOALKEEPER].top10).toEqual({ overlap: 20, n: 20 })
    expect(byPosition[GOALKEEPER].top10Refused).toBe(false)
    // Each gameweek: topNOverlap(pairs,20) caps n=min(20,15)=15; 15/15 =
    // 100% > 75% -> refused, contributes nothing. Both gameweeks refused ->
    // the position-level figure is empty, not a misleading 30/30 (100%).
    expect(byPosition[GOALKEEPER].top20).toEqual({ overlap: 0, n: 0 })
    expect(byPosition[GOALKEEPER].top20Refused).toBe(true)
  })

  it('the goalkeeper case, reproduced: a 19-row weekly population asked for top-20 is refused, not reported as ~100% (LEARNINGS §14)', () => {
    const rows = [
      ...Array.from({ length: 19 }, (_, i) => measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
    ]
    const byPosition = summarizeRankingByPosition(rows)
    // min(20,19)=19, 19/19=100% > 75% -> refused.
    expect(byPosition[GOALKEEPER].top20).toEqual({ overlap: 0, n: 0 })
    expect(byPosition[GOALKEEPER].top20Refused).toBe(true)
    // min(10,19)=10, 10/19 ≈ 52.6% <= 75% -> NOT refused.
    expect(byPosition[GOALKEEPER].top10).toEqual({ overlap: 10, n: 10 })
    expect(byPosition[GOALKEEPER].top10Refused).toBe(false)
  })

  it('a position with no measured rows at all is n=0, NOT refused — "no data" is a different case from "refused"', () => {
    const rows = [measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: 1, actualPoints: 1 })]
    const byPosition = summarizeRankingByPosition(rows)
    expect(byPosition[FORWARD].top20).toEqual({ overlap: 0, n: 0 })
    expect(byPosition[FORWARD].top20Refused).toBe(false)
  })
})

describe('summarizeRankingByGameweekAndPosition — the per-gameweek × per-position breakdown (ticket #159, Defect 3)', () => {
  it('returns one summary per (gameweek, position) actually present, refusing a cell whose N is too large a fraction of ITS OWN population', () => {
    const rows = [
      ...Array.from({ length: 19 }, (_, i) => measuredRow({ gameweekId: 1, position: GOALKEEPER, projectedPoints: i, actualPoints: i })),
      ...Array.from({ length: 40 }, (_, i) => measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: i, actualPoints: i })),
    ]
    const summaries = summarizeRankingByGameweekAndPosition(rows)
    const gk = summaries.find((s) => s.gameweekId === 1 && s.position === GOALKEEPER)!
    expect(gk.n).toBe(19)
    // top-10: min(10,19)=10, 10/19 ≈ 52.6% <= 75% -> meaningful.
    expect(gk.top10Refused).toBe(false)
    expect(gk.top10).toEqual({ overlap: 10, n: 10 })
    // top-20: min(20,19)=19, 19/19 = 100% > 75% -> refused.
    expect(gk.top20Refused).toBe(true)

    const def = summaries.find((s) => s.gameweekId === 1 && s.position === DEFENDER)!
    // top-20: min(20,40)=20, 20/40 = 50% <= 75% -> meaningful.
    expect(def.top20Refused).toBe(false)
    expect(def.top20).toEqual({ overlap: 20, n: 20 })
  })

  it('includes every position for every gameweek present, even one with zero rows (n=0, not refused)', () => {
    const rows = [measuredRow({ gameweekId: 5, position: MIDFIELDER, projectedPoints: 1, actualPoints: 1 })]
    const summaries = summarizeRankingByGameweekAndPosition(rows)
    expect(summaries).toHaveLength(4) // one per position, gameweek 5 only
    const gk = summaries.find((s) => s.position === GOALKEEPER)!
    expect(gk.n).toBe(0)
    expect(gk.top10Refused).toBe(false)
    expect(gk.top20Refused).toBe(false)
  })
})

describe('topNIsMeaningful / TOP_N_MAX_POPULATION_FRACTION (ticket #159, Defect 2 — the goalkeeper case at the pure-function level)', () => {
  it('TOP_N_MAX_POPULATION_FRACTION is a fraction strictly between 0 and 1', () => {
    expect(TOP_N_MAX_POPULATION_FRACTION).toBeGreaterThan(0)
    expect(TOP_N_MAX_POPULATION_FRACTION).toBeLessThan(1)
  })

  it('a top-20 request over a 19-row population is refused: n caps at 19, 19/19 = 100% > threshold', () => {
    const pairs: RankingPair[] = Array.from({ length: 19 }, (_, i) => ({ projected: i, actual: i }))
    const result = topNOverlap(pairs, 20)
    expect(result).toEqual({ overlap: 19, n: 19 })
    expect(topNIsMeaningful(result, 19)).toBe(false)
  })

  it('a top-10 request over the same 19-row population is NOT refused: n=10, 10/19 ≈ 52.6% <= threshold', () => {
    const pairs: RankingPair[] = Array.from({ length: 19 }, (_, i) => ({ projected: i, actual: i }))
    const result = topNOverlap(pairs, 10)
    expect(result).toEqual({ overlap: 10, n: 10 })
    expect(topNIsMeaningful(result, 19)).toBe(true)
  })

  it('a population of 0 is always refused (nothing to rank)', () => {
    expect(topNIsMeaningful({ overlap: 0, n: 0 }, 0)).toBe(false)
  })
})

describe('checkRankingSanityBounds — Spearman lower bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries(
      [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [
        p,
        { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false },
      ]),
    )

  it('fails, naming the figure, when season Spearman is below -0.2', () => {
    const result = checkRankingSanityBounds(SPEARMAN_LOWER_BOUND - 0.01, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/season/)
    expect(result.failures[0]).toMatch(/Spearman/)
    expect(result.failures[0]).toContain((SPEARMAN_LOWER_BOUND - 0.01).toFixed(3))
  })

  it('passes at exactly the lower bound', () => {
    const result = checkRankingSanityBounds(SPEARMAN_LOWER_BOUND, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })
})

describe('checkRankingSanityBounds — Spearman upper bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries(
      [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [
        p,
        { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false },
      ]),
    )

  it('fails, naming the figure, when season Spearman is above 0.9 — the shape a lookahead leak takes', () => {
    const result = checkRankingSanityBounds(SPEARMAN_UPPER_BOUND + 0.01, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/season/)
    expect(result.failures[0]).toContain((SPEARMAN_UPPER_BOUND + 0.01).toFixed(3))
  })

  it('passes at exactly the upper bound', () => {
    const result = checkRankingSanityBounds(SPEARMAN_UPPER_BOUND, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('fails on a position\'s Spearman too, naming that position', () => {
    const byPosition = emptyByPosition()
    byPosition[DEFENDER] = {
      position: DEFENDER,
      n: 100,
      spearman: 0.95,
      top10: { overlap: 0, n: 0 },
      top20: { overlap: 0, n: 0 },
      top10Refused: false,
      top20Refused: false,
    }
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, byPosition as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/Defender/)
  })
})

describe('checkRankingSanityBounds — top-10 overlap bound', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries(
      [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [
        p,
        { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false },
      ]),
    )

  it('fails, naming the figure, when the season top-10 overlap exceeds 9 of 10', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 10, n: 10 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/top-10 overlap/)
    expect(result.failures[0]).toMatch(/10 of 10/)
  })

  it('passes at exactly 9 of 10 (the bound, not past it)', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 9, n: 10 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('TOP10_OVERLAP_UPPER_BOUND_FRACTION is exactly 9/10', () => {
    expect(TOP10_OVERLAP_UPPER_BOUND_FRACTION).toBeCloseTo(0.9, 10)
  })

  it('an empty population (n=0) never divides by zero and does not fail the bound', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('a null season Spearman and the top-10 bound can both be checked independently — a null Spearman never fails on its own', () => {
    const result = checkRankingSanityBounds(null, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })
})

describe('checkRankingSanityBounds — top-20 overlap bound (ticket #159, Defect 3: LEARNINGS §14 found the leak shape at top-20, which the original #147 bound never checked)', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries(
      [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [
        p,
        { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false },
      ]),
    )

  it('fails, naming the figure, when the SEASON top-20 overlap exceeds 9 of 10 — the season top-10 stays within bound', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 5, n: 10 }, { overlap: 20, n: 20 }, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/season/)
    expect(result.failures[0]).toMatch(/top-20 overlap/)
    expect(result.failures[0]).toMatch(/20 of 20/)
  })

  it('passes at exactly 9 of 10 for top-20 too (the bound, not past it)', () => {
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, { overlap: 9, n: 10 }, emptyByPosition() as never)
    expect(result.ok).toBe(true)
  })

  it('fails on a position\'s top-20 overlap at ~99.7% — reproduces the exact shape LEARNINGS §14 found (696 of 698)', () => {
    const byPosition = emptyByPosition()
    byPosition[GOALKEEPER] = {
      position: GOALKEEPER,
      n: 700,
      spearman: 0.5,
      top10: { overlap: 0, n: 0 },
      top20: { overlap: 696, n: 698 },
      top10Refused: false,
      top20Refused: false,
    }
    const result = checkRankingSanityBounds(0.5, { overlap: 0, n: 0 }, { overlap: 0, n: 0 }, byPosition as never)
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatch(/Goalkeeper/)
    expect(result.failures[0]).toMatch(/top-20 overlap/)
    // Hand-computed: 696 / 698 * 100 = 99.71346990... -> toFixed(1) = "99.7".
    expect(result.failures[0]).toContain('99.7')
  })
})

// ============================================================================
// NAIVE RANKING BASELINES — ticket #159, Defect 1.
// ============================================================================

describe('computeBaselineMinutesPerMatch / computeBaselineXgXaPerMatch — assert prior_matches > 0, never guard defensively (ticket #159)', () => {
  it('computes prior_minutes / prior_matches for a real row', () => {
    expect(computeBaselineMinutesPerMatch({ prior_matches: 4, prior_minutes: 270 })).toBeCloseTo(67.5, 10)
  })

  it('computes (prior_xg + prior_xa) / prior_matches for a real row', () => {
    expect(computeBaselineXgXaPerMatch({ prior_matches: 5, prior_xg: 2.5, prior_xa: 1.0 })).toBeCloseTo(0.7, 10)
  })

  it('throws rather than silently defaulting to 0 when prior_matches <= 0 — the measured population should never reach this function with one (see classifyRow\'s noPriorMatches exclusion)', () => {
    expect(() => computeBaselineMinutesPerMatch({ prior_matches: 0, prior_minutes: 0 })).toThrow()
    expect(() => computeBaselineXgXaPerMatch({ prior_matches: 0, prior_xg: 0, prior_xa: 0 })).toThrow()
    expect(() => computeBaselineMinutesPerMatch({ prior_matches: -1, prior_minutes: 90 })).toThrow()
  })
})

describe('computeConstantBaselineSpearman — the zero-skill floor, and a self-test of the correlation code (ticket #159)', () => {
  it('returns exactly 0 (never a numeric correlation) for a genuinely constant baseline, regardless of the actual points', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 12 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 3 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 8 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 0 }),
    ]
    expect(computeConstantBaselineSpearman(rows)).toBe(0)
  })

  it('CONSTANT_BASELINE_VALUE is a fixed number — every row is assigned the identical value, by construction', () => {
    expect(typeof CONSTANT_BASELINE_VALUE).toBe('number')
  })

  it('self-test: this IS exercising spearmanCorrelation\'s own null-for-zero-variance path, not a hardcoded shortcut — feeding the identical CONSTANT_BASELINE_VALUE through spearmanCorrelation directly returns null', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 12 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 3 }),
    ]
    const raw = spearmanCorrelation(rows.map((r) => ({ projected: CONSTANT_BASELINE_VALUE, actual: r.actualPoints })))
    expect(raw).toBeNull()
  })
})

describe('summarizeBaselines — three baselines, season aggregate and per position (ticket #159)', () => {
  it('reports all three baselines, in ticket order (minutes, xG+xA, constant)', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 5, baselineMinutesPerMatch: 90, baselineXgXaPerMatch: 0.5 }),
      measuredRow({ gameweekId: 1, position: FORWARD, projectedPoints: 0, actualPoints: 2, baselineMinutesPerMatch: 45, baselineXgXaPerMatch: 0.1 }),
    ]
    const baselines = summarizeBaselines(rows)
    expect(baselines.map((b) => b.label)).toEqual([
      PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL,
      PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL,
      CONSTANT_BASELINE_LABEL,
    ])
  })

  it('the minutes-per-match baseline, perfect agreement with actual points, scores exactly 1 at the season aggregate and for the one position present', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 1, baselineMinutesPerMatch: 10 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 2, baselineMinutesPerMatch: 20 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 3, baselineMinutesPerMatch: 30 }),
    ]
    const baselines = summarizeBaselines(rows)
    const minutesBaseline = baselines.find((b) => b.label === PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL)!
    expect(minutesBaseline.seasonSpearman).toBeCloseTo(1, 10)
    expect(minutesBaseline.byPosition[MIDFIELDER]).toBeCloseTo(1, 10)
    expect(minutesBaseline.byPosition[FORWARD]).toBeNull() // no Forward rows -> n<2 -> null, not 0
  })

  // Ties matter (ticket text): the minutes-per-match baseline produces many
  // ties in practice. Reuses the SAME hand-worked numbers as the
  // "spearmanCorrelation — ties" test above, applied through the baseline
  // field this time, to prove the WIRING (not the tie math, already proven
  // there) threads a heavily-tied baseline correctly through
  // spearmanCorrelation's average-rank tie handling.
  it('the minutes-per-match baseline, heavily tied, uses average-rank ties — hand-computed, matching the spearmanCorrelation ties test above', () => {
    // Three rows tied on baselineMinutesPerMatch = 5, then two distinct
    // values 3 and 1. baselineRanks = [2,2,2,4,5] (average of ranks 1,2,3).
    // actual = [4,5,3,2,1] -> actualRanks = [2,1,3,4,5] (no ties).
    // rho = 8 / sqrt(80) = 0.894427191 (worked out in full in the
    // spearmanCorrelation ties test above).
    const rows: MeasuredRow[] = [
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 4, baselineMinutesPerMatch: 5 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 5, baselineMinutesPerMatch: 5 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 3, baselineMinutesPerMatch: 5 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 2, baselineMinutesPerMatch: 3 }),
      measuredRow({ gameweekId: 1, position: MIDFIELDER, projectedPoints: 0, actualPoints: 1, baselineMinutesPerMatch: 1 }),
    ]
    const baselines = summarizeBaselines(rows)
    const minutesBaseline = baselines.find((b) => b.label === PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL)!
    expect(minutesBaseline.seasonSpearman).toBeCloseTo(0.894427191, 6)
  })

  it('the constant baseline reports exactly 0 at the season aggregate and for every position with 2+ rows', () => {
    const rows = [
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 0, actualPoints: 6 }),
      measuredRow({ gameweekId: 1, position: DEFENDER, projectedPoints: 0, actualPoints: 1 }),
    ]
    const baselines = summarizeBaselines(rows)
    const constantBaseline = baselines.find((b) => b.label === CONSTANT_BASELINE_LABEL)!
    expect(constantBaseline.seasonSpearman).toBe(0)
    expect(constantBaseline.byPosition[DEFENDER]).toBe(0)
  })
})

describe('buildBaselineVerdicts — model Spearman minus each baseline\'s, a difference, never a threshold (ticket #159)', () => {
  it('computes modelSpearman - baselineSpearman for each baseline, in order', () => {
    const baselines = [
      { label: 'A', seasonSpearman: 0.1, byPosition: {} as never },
      { label: 'B', seasonSpearman: -0.05, byPosition: {} as never },
    ]
    const verdicts = buildBaselineVerdicts(0.305, baselines)
    expect(verdicts).toEqual([
      { label: 'A', modelSpearman: 0.305, baselineSpearman: 0.1, delta: 0.305 - 0.1 },
      { label: 'B', modelSpearman: 0.305, baselineSpearman: -0.05, delta: 0.305 - -0.05 },
    ])
  })

  it('delta is null when the model\'s season Spearman is null — no verdict can be stated as a number', () => {
    const verdicts = buildBaselineVerdicts(null, [{ label: 'A', seasonSpearman: 0.1, byPosition: {} as never }])
    expect(verdicts[0].delta).toBeNull()
  })

  it('delta is null when the baseline\'s own Spearman is null (e.g. too few rows)', () => {
    const verdicts = buildBaselineVerdicts(0.305, [{ label: 'A', seasonSpearman: null, byPosition: {} as never }])
    expect(verdicts[0].delta).toBeNull()
  })
})

// ============================================================================
// FIVE-GAMEWEEK RANKING TARGET — ticket #183. Mirrors this file's own
// section ordering: the leave-window-out oracle first (the ticket's own
// "most important test"), then the window construction, then the reused
// summarizers, then the report itself.
// ============================================================================

describe('computeOracleRate — THE MOST IMPORTANT TEST IN THIS TICKET: no gameweek inside the window contributes to its own estimate', () => {
  it('excludes every gameweek of a five-gameweek window, even though one of them carries an outrageous point value that would obviously skew the rate if it leaked', () => {
    // Gameweeks 1-4 and 10 (OUTSIDE the window) each score a small, uniform
    // 2 points/match. Gameweeks 5-9 (the window) include gameweek 7 scoring
    // 1000 — a deliberately dramatic, unmissable leak trap.
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 2, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 3, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 4, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 5, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 6, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 7, points: 1000, matches: 1 },
      { playerCode: 1, gameweekId: 8, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 9, points: 2, matches: 1 },
      { playerCode: 1, gameweekId: 10, points: 2, matches: 1 },
    ]
    const rate = computeOracleRate(seasonMatches, new Set([5, 6, 7, 8, 9]))
    // Only gameweeks 1-4 and 10 contribute: 5 matches, 10 points -> rate 2.
    // A leak of gameweek 7's 1000 points would push this far above 2.
    expect(rate).toBe(2)
    expect(rate).toBeLessThan(10)
  })

  it('the one-gameweek exclude set (the one-gameweek oracle) leaves out only that gameweek, not its neighbours', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 3, matches: 1 },
      { playerCode: 1, gameweekId: 2, points: 3, matches: 1 },
      { playerCode: 1, gameweekId: 3, points: 999, matches: 1 }, // the target gameweek — must not leak
      { playerCode: 1, gameweekId: 4, points: 3, matches: 1 },
    ]
    expect(computeOracleRate(seasonMatches, new Set([3]))).toBe(3)
  })

  it('both edges of a five-gameweek window are excluded — an off-by-one would leak the first or last leg', () => {
    // Window is exactly buildFiveGameweekWindow(10) = [10,11,12,13,14].
    // Gameweeks 9 and 15 (just outside) must contribute; 10 and 14 (the
    // window's own edges) must not — each edge carries an outrageous 500.
    const seasonMatches: PlayerSeasonMatch[] = [9, 10, 11, 12, 13, 14, 15].map((gw) => ({
      playerCode: 1,
      gameweekId: gw,
      points: gw === 10 || gw === 14 ? 500 : 4,
      matches: 1,
    }))
    const rate = computeOracleRate(seasonMatches, new Set(buildFiveGameweekWindow(10)))
    expect(rate).toBe(4) // only gw 9 and gw 15 contribute: (4 + 4) / 2
  })

  it('null when the player has zero matches outside the window — no evidence to rank on, never a guessed rate', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 5, points: 10, matches: 1 },
      { playerCode: 1, gameweekId: 6, points: 10, matches: 1 },
    ]
    expect(computeOracleRate(seasonMatches, new Set(buildFiveGameweekWindow(5)))).toBeNull()
  })

  it('sums matches (not gameweek-count) as the denominator, so a double-gameweek outside the window counts twice', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 10, matches: 2 }, // double gameweek
      { playerCode: 1, gameweekId: 5, points: 999, matches: 1 }, // inside window
    ]
    expect(computeOracleRate(seasonMatches, new Set([5]))).toBe(5) // 10 / 2
  })
})

// ============================================================================
// Ticket #187 — the oracle fix. The five-gameweek target is a TOTAL, not a
// rate (computeOracleRate above stays exactly as it was, still correct, and
// still used unmodified for the one-gameweek oracle) — computeOracleFeaturedRate
// / computeOracleAppearanceRate / computeOracleFiveGameweekEstimate below
// build the new leave-window-out TOTAL. Mirrors the computeOracleRate block
// above section-for-section: the leak guard first (both factors), then the
// combining function, then the null/zero edge case the ticket's own notes
// call out explicitly.
// ============================================================================

describe('computeOracleFeaturedRate (ticket #187)', () => {
  it('excludes the window, and only averages over FEATURED out-of-window gameweeks — an unfeatured week must not dilute the rate', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 6, matches: 1, featured: true },
      { playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false }, // unfeatured — must not count toward the featured-rate denominator
      { playerCode: 1, gameweekId: 3, points: 4, matches: 1, featured: true },
      { playerCode: 1, gameweekId: 7, points: 1000, matches: 1, featured: true }, // inside the window — must not leak
    ]
    const rate = computeOracleFeaturedRate(seasonMatches, new Set([5, 6, 7, 8, 9]))
    expect(rate).toBe(5) // (6 + 4) / 2 featured gameweeks — gw2 (unfeatured) and gw7 (in-window) both excluded
  })

  it('null when the player has zero FEATURED matches outside the window — never a guessed rate', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 0, matches: 1, featured: false },
      { playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false },
    ]
    expect(computeOracleFeaturedRate(seasonMatches, new Set([5]))).toBeNull()
  })
})

describe('computeOracleAppearanceRate — THE MOST IMPORTANT TEST IN THIS TICKET: the appearance factor is exactly as leak-guarded as the scoring rate', () => {
  it(
    'is driven ENTIRELY by out-of-window data — an outrageous, unmissable change to the WINDOW\'S OWN featured ' +
      'status (all featured vs all unfeatured) must not move the result at all',
    () => {
      const outsideWindow: readonly PlayerSeasonMatch[] = [
        { playerCode: 1, gameweekId: 1, points: 2, matches: 1, featured: true },
        { playerCode: 1, gameweekId: 2, points: 2, matches: 1, featured: true },
        { playerCode: 1, gameweekId: 3, points: 0, matches: 1, featured: false },
        { playerCode: 1, gameweekId: 4, points: 2, matches: 1, featured: true },
      ] // out-of-window: 3 of 4 featured -> appearance rate 0.75, whatever the window says

      // Variant A: the player features in EVERY window gameweek (5-9) — the
      // spectacular, unmissable leak trap for an appearance-rate leak (if
      // this leaked, the result would rise toward 1.0).
      const allFeaturedInWindow: PlayerSeasonMatch[] = [
        ...outsideWindow,
        ...[5, 6, 7, 8, 9].map((gw) => ({ playerCode: 1, gameweekId: gw, points: 1000, matches: 1, featured: true })),
      ]
      // Variant B: the player NEVER features in the window (if this leaked,
      // the result would fall toward 0).
      const neverFeaturedInWindow: PlayerSeasonMatch[] = [
        ...outsideWindow,
        ...[5, 6, 7, 8, 9].map((gw) => ({ playerCode: 1, gameweekId: gw, points: 0, matches: 1, featured: false })),
      ]

      const excludeGameweeks = new Set([5, 6, 7, 8, 9])
      const rateA = computeOracleAppearanceRate(allFeaturedInWindow, excludeGameweeks)
      const rateB = computeOracleAppearanceRate(neverFeaturedInWindow, excludeGameweeks)

      expect(rateA).toBe(0.75)
      expect(rateB).toBe(0.75)
      expect(rateA).toBe(rateB) // identical regardless of the window's own (huge, unmissable) featured signal
    },
  )

  it('null when there are zero out-of-window entries at all — no evidence, never a guessed rate', () => {
    const seasonMatches: PlayerSeasonMatch[] = [{ playerCode: 1, gameweekId: 5, points: 2, matches: 1, featured: true }]
    expect(computeOracleAppearanceRate(seasonMatches, new Set(buildFiveGameweekWindow(5)))).toBeNull()
  })

  it('a real 0 (out-of-window entries exist, none featured) is returned as exactly 0, not null — a genuine "never plays" signal', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 0, matches: 1, featured: false },
      { playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false },
    ]
    expect(computeOracleAppearanceRate(seasonMatches, new Set([5]))).toBe(0)
  })
})

describe('computeOracleFiveGameweekEstimate — the fix itself: a TOTAL, not a rate (ticket #187)', () => {
  it('multiplies the featured rate by the appearance rate by the horizon width — hand-computed', () => {
    // Out-of-window: gw1 featured 6pts, gw2 unfeatured 0pts, gw3 featured
    // 4pts, gw4 featured 8pts -> featured rate (6+4+8)/3 = 6, appearance
    // rate 3/4 = 0.75. Estimate = 6 * 0.75 * 5 = 22.5.
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 6, matches: 1, featured: true },
      { playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false },
      { playerCode: 1, gameweekId: 3, points: 4, matches: 1, featured: true },
      { playerCode: 1, gameweekId: 4, points: 8, matches: 1, featured: true },
    ]
    const estimate = computeOracleFiveGameweekEstimate(seasonMatches, new Set(buildFiveGameweekWindow(5)), FIVE_GAMEWEEK_HORIZON)
    expect(estimate).toBeCloseTo(22.5, 10)
  })

  it('a player who never features outside the window resolves to EXACTLY 0, not null (appearanceRate 0, featuredRate null -> 0 * 0 * horizon)', () => {
    const seasonMatches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 0, matches: 1, featured: false },
      { playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false },
    ]
    const estimate = computeOracleFiveGameweekEstimate(seasonMatches, new Set([5]), FIVE_GAMEWEEK_HORIZON)
    expect(estimate).toBe(0)
    expect(estimate).not.toBeNull()
  })

  it('null when there is no out-of-window evidence at all', () => {
    const seasonMatches: PlayerSeasonMatch[] = [{ playerCode: 1, gameweekId: 5, points: 10, matches: 1, featured: true }]
    expect(computeOracleFiveGameweekEstimate(seasonMatches, new Set(buildFiveGameweekWindow(5)), FIVE_GAMEWEEK_HORIZON)).toBeNull()
  })

  it(
    'THE FULL LEAK-GUARD TEST, end to end: an outrageous, unmissable change to the WINDOW\'S OWN points AND featured ' +
      'status must not move the five-gameweek TOTAL estimate at all',
    () => {
      const outsideWindow: readonly PlayerSeasonMatch[] = [
        { playerCode: 1, gameweekId: 1, points: 3, matches: 1, featured: true },
        { playerCode: 1, gameweekId: 2, points: 3, matches: 1, featured: true },
        { playerCode: 1, gameweekId: 3, points: 0, matches: 1, featured: false },
        { playerCode: 1, gameweekId: 4, points: 3, matches: 1, featured: true },
      ]
      const excludeGameweeks = new Set(buildFiveGameweekWindow(10))
      const leakTrapHigh: PlayerSeasonMatch[] = [
        ...outsideWindow,
        ...buildFiveGameweekWindow(10).map((gw) => ({ playerCode: 1, gameweekId: gw, points: 999, matches: 1, featured: true })),
      ]
      const leakTrapLow: PlayerSeasonMatch[] = [
        ...outsideWindow,
        ...buildFiveGameweekWindow(10).map((gw) => ({ playerCode: 1, gameweekId: gw, points: 0, matches: 1, featured: false })),
      ]
      const estimateHigh = computeOracleFiveGameweekEstimate(leakTrapHigh, excludeGameweeks, FIVE_GAMEWEEK_HORIZON)
      const estimateLow = computeOracleFiveGameweekEstimate(leakTrapLow, excludeGameweeks, FIVE_GAMEWEEK_HORIZON)
      expect(estimateHigh).toBe(estimateLow) // identical regardless of the window's own (huge, unmissable) points/featured signal
      expect(estimateHigh).toBeCloseTo(3 * 0.75 * FIVE_GAMEWEEK_HORIZON, 10) // = 11.25, driven only by outsideWindow
    },
  )
})

describe('checkOracleCeiling (ticket #187; ticket #201 retired the one-gameweek half — G14 — and extended the five-gameweek half to every position, not only the season aggregate; ticket #209 exempts Goalkeeper from the per-position half at five gameweeks — G16)', () => {
  const emptyByPosition = (): Record<string, PositionRankingSummary> =>
    Object.fromEntries(
      [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD].map((p) => [
        p,
        { position: p, n: 0, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false },
      ]),
    )

  const withPosition = (position: number, spearman: number, n = 100): Record<string, PositionRankingSummary> => {
    const byPosition = emptyByPosition()
    byPosition[position] = { position: position as never, n, spearman, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    return byPosition
  }

  it('ok when the oracle sits strictly above the model at the season aggregate and no position breaches', () => {
    const result = checkOracleCeiling(0.4, 0.48, emptyByPosition() as never, emptyByPosition() as never)
    expect(result).toEqual({ ok: true, failures: [] })
  })

  it('fails when the model meets or beats the five-gameweek SEASON-AGGREGATE oracle — the exact shape ticket #89/#187 was written to catch (model 0.672 vs oracle 0.507)', () => {
    const result = checkOracleCeiling(0.672, 0.507, emptyByPosition() as never, emptyByPosition() as never)
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/five-gameweek/)
    expect(result.failures[0]).toContain('0.672')
    expect(result.failures[0]).toContain('0.507')
  })

  it('null season Spearman on either side skips the aggregate check — insufficient data is not the same failure as a ceiling the model exceeds', () => {
    expect(checkOracleCeiling(null, null, emptyByPosition() as never, emptyByPosition() as never)).toEqual({ ok: true, failures: [] })
    expect(checkOracleCeiling(0.9, null, emptyByPosition() as never, emptyByPosition() as never)).toEqual({ ok: true, failures: [] })
  })

  it('a per-position breach fails while the season aggregate PASSES — the exact defect LEARNINGS-second-build-wave.md §14 recorded: a bound checked only at the aggregate does not protect the breakdown (DEFENDER — not exempt)', () => {
    const modelByPosition = withPosition(DEFENDER, 0.3)
    const oracleByPosition = withPosition(DEFENDER, 0.2)
    // Season aggregate: model 0.35 < oracle 0.5 — passes on its own.
    const result = checkOracleCeiling(0.35, 0.5, modelByPosition as never, oracleByPosition as never)
    // Defender breakdown alone: model 0.3 >= oracle 0.2 — a breach the aggregate-only check would have missed entirely.
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/Defender/)
    expect(result.failures[0]).toContain('0.300')
    expect(result.failures[0]).toContain('0.200')
  })

  // ==========================================================================
  // TICKET #209 — the goalkeeper exemption itself. See
  // docs/projection-model-backlog.md G16 for the full argument.
  // ==========================================================================

  it('pins report 10\'s own goalkeeper figures — the per-position check does NOT fail on model 0.240 vs oracle 0.201, because Goalkeeper is exempt at five gameweeks (ticket #209 / G16)', () => {
    const modelByPosition = withPosition(GOALKEEPER, 0.24, 616)
    const oracleByPosition = withPosition(GOALKEEPER, 0.201, 616)
    // The season aggregate itself passes on report 10 (model 0.397 < oracle 0.506), and the goalkeeper
    // breakdown — a genuine breach in isolation — is now exempt, so this reports ok overall.
    const result = checkOracleCeiling(0.397, 0.506, modelByPosition as never, oracleByPosition as never)
    expect(result).toEqual({ ok: true, failures: [] })
  })

  it('a named test proves every OTHER position still fails on a breach — only Goalkeeper is exempt (ticket #209 DoD)', () => {
    // Same shape of breach as the retired goalkeeper test above (model >= oracle by the same margin),
    // reproduced for every non-goalkeeper position in turn — each must still fail on its own.
    const cases: Array<[number, string]> = [
      [DEFENDER, 'Defender'],
      [MIDFIELDER, 'Midfielder'],
      [FORWARD, 'Forward'],
    ]
    for (const [position, name] of cases) {
      const modelByPosition = withPosition(position, 0.3)
      const oracleByPosition = withPosition(position, 0.2)
      const result = checkOracleCeiling(0.35, 0.5, modelByPosition as never, oracleByPosition as never)
      expect(result.ok).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]).toContain(name)
    }
  })

  it('a goalkeeper breach is silently dropped even when a genuine other-position breach is present alongside it — the exemption is scoped to Goalkeeper only, not a global loosening', () => {
    const modelByPosition = emptyByPosition()
    const oracleByPosition = emptyByPosition()
    modelByPosition[GOALKEEPER] = { position: GOALKEEPER, n: 616, spearman: 0.24, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    oracleByPosition[GOALKEEPER] = { position: GOALKEEPER, n: 616, spearman: 0.201, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    modelByPosition[DEFENDER] = { position: DEFENDER, n: 100, spearman: 0.5, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    oracleByPosition[DEFENDER] = { position: DEFENDER, n: 100, spearman: 0.4, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    const result = checkOracleCeiling(0.6, 0.3, modelByPosition as never, oracleByPosition as never)
    expect(result.ok).toBe(false)
    // Season aggregate (model 0.6 >= oracle 0.3) + Defender (0.5 >= 0.4) = 2. NOT 3 — the goalkeeper
    // breach (0.24 >= 0.201) is real by the same rule but must not appear in `failures` at all.
    expect(result.failures).toHaveLength(2)
    expect(result.failures.some((f) => /Goalkeeper/.test(f))).toBe(false)
    expect(result.failures.some((f) => /Defender/.test(f))).toBe(true)
  })

  it('reports every breaching (non-goalkeeper) position independently, naming each, alongside a season-aggregate failure', () => {
    const modelByPosition = emptyByPosition()
    const oracleByPosition = emptyByPosition()
    modelByPosition[MIDFIELDER] = { position: MIDFIELDER, n: 100, spearman: 0.3, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    oracleByPosition[MIDFIELDER] = { position: MIDFIELDER, n: 100, spearman: 0.2, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    modelByPosition[DEFENDER] = { position: DEFENDER, n: 100, spearman: 0.5, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    oracleByPosition[DEFENDER] = { position: DEFENDER, n: 100, spearman: 0.4, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 }, top10Refused: false, top20Refused: false }
    const result = checkOracleCeiling(0.6, 0.3, modelByPosition as never, oracleByPosition as never)
    expect(result.ok).toBe(false)
    // Season aggregate (model 0.6 >= oracle 0.3) + Midfielder (0.3 >= 0.2) + Defender (0.5 >= 0.4) = 3.
    expect(result.failures).toHaveLength(3)
    expect(result.failures.some((f) => /Midfielder/.test(f))).toBe(true)
    expect(result.failures.some((f) => /Defender/.test(f))).toBe(true)
  })

  it('no longer accepts or asserts anything about the one-gameweek horizon — the one-gameweek oracle and #197\'s neutral-fixture diagnostic stay fully computed and printed elsewhere in the report, but nothing here reads them', () => {
    // The signature is exactly (fiveGwModelSeason, fiveGwOracleSeason, fiveGwModelByPosition, fiveGwOracleByPosition) —
    // four parameters, none of which is a one-gameweek figure any more.
    expect(checkOracleCeiling.length).toBe(4)
  })
})

// ============================================================================
// TICKET #201, PART 2 — the pre-#191 minutes construction, reconstructed for
// REPORTED-ONLY comparison. `src/lib/projection/minutes.ts` is untouched by
// this ticket; every test below exercises only harness-local code. See this
// file's own comment above `estimateMinutesPreTicket191`/
// `projectRowPreTicket191Minutes` (scripts/run-backtest.ts) for the full
// "because", and `git show e652df7 -- src/lib/projection/minutes.ts` for the
// exact diff being reconstructed.
// ============================================================================

describe('estimateMinutesPreTicket191 (ticket #201, Part 2)', () => {
  it(
    'THE NAMED TEST (ticket #201 DoD): reproduces the pre-#191 arithmetic on the worked window [90, 90, 20, 0, 0] — ' +
      'expected minutes 40 and pSixtyPlus 0.4, against the shipped estimateMinutes()\'s 50 and 0.5 on the SAME window. ' +
      'Hand-computed: mean(90,90,20,0,0) = 200/5 = 40; sixtyPlusRate = 2/5 = 0.4 (only the two 90s reach 60) — no ' +
      'single-lowest drop, no start/minutes-given-start split, exactly `git show e652df7`\'s pre-image.',
    () => {
      const recentMinutes = [90, 90, 20, 0, 0]

      const preTicket191 = estimateMinutesPreTicket191(recentMinutes, 1)
      expect(preTicket191.expectedMinutes).toBeCloseTo(40, 10)
      expect(preTicket191.pSixtyPlus).toBeCloseTo(0.4, 10)
      expect(preTicket191.pAppears).toBe(1)

      // Pinned against the SHIPPED model on the exact same window — the DoD's
      // own comparator, not asserted elsewhere in this file for this window.
      const shipped = estimateMinutes(recentMinutes, 1)
      expect(shipped.expectedMinutes).toBeCloseTo(50, 10)
      expect(shipped.pSixtyPlus).toBeCloseTo(0.5, 10)
    },
  )

  it('scales both expectedMinutes and pSixtyPlus by availability, exactly like the shipped model', () => {
    const full = estimateMinutesPreTicket191([90, 90, 20, 0, 0], 1)
    const half = estimateMinutesPreTicket191([90, 90, 20, 0, 0], 0.5)
    expect(half.expectedMinutes).toBeCloseTo(full.expectedMinutes / 2, 10)
    expect(half.pSixtyPlus).toBeCloseTo(full.pSixtyPlus / 2, 10)
    expect(half.pAppears).toBe(0.5)
  })

  it('an empty window returns the SAME no-history baseline the shipped model returns — #191 never touched this branch, so both constructions reuse the identical exported constants', () => {
    const preTicket191 = estimateMinutesPreTicket191([], 1)
    const shipped = estimateMinutes([], 1)
    expect(preTicket191).toEqual(shipped)
  })

  it('a below-full window (fewer than 5 entries) is the plain mean over however many are given — no drop, matching the shipped model\'s own below-full-window behaviour (only a FULL window ever diverges)', () => {
    const preTicket191 = estimateMinutesPreTicket191([90, 0], 1)
    const shipped = estimateMinutes([90, 0], 1)
    expect(preTicket191).toEqual(shipped)
    expect(preTicket191.expectedMinutes).toBeCloseTo(45, 10)
    expect(preTicket191.pSixtyPlus).toBeCloseTo(0.5, 10)
  })
})

describe('projectRowPreTicket191Minutes (ticket #201, Part 2)', () => {
  it(
    'is IDENTICAL to the shipped projectRow when the recent-minutes window has no single-lowest-drop effect (a ' +
      'clean, no-zero full window) — isolates that the reconstruction wires through rates/fixtures/defcon exactly ' +
      'like the shipped combiner (every one of those is the SAME imported pure function on both sides), and only ' +
      'the minutes step can ever differ',
    () => {
      const row = featureRow({
        gameweek_id: 5,
        player_code: 1,
        element_type: FORWARD,
        prior_matches: 5,
        prior_minutes: 450,
        prior_xg: 5,
        prior_xa: 3,
        prior_recent_minutes: [90, 90, 90, 90, 90],
      })
      const prior = zeroPrior(FORWARD)
      const shipped = projectRow(row, FORWARD, prior, 1, [0.6])
      const preTicket191 = projectRowPreTicket191Minutes(row, FORWARD, prior, 1, [0.6])
      expect(preTicket191).toBeCloseTo(shipped.expectedPoints, 10)
    },
  )

  it("diverges from the shipped projectRow on the DoD's own worked window ([90, 90, 20, 0, 0]) — the full combiner, not just the minutes estimate in isolation, is measurably sensitive", () => {
    const row = featureRow({
      gameweek_id: 6,
      player_code: 2,
      element_type: FORWARD,
      prior_matches: 5,
      prior_minutes: 200,
      prior_xg: 4,
      prior_xa: 2,
      prior_recent_minutes: [90, 90, 20, 0, 0],
    })
    const prior = zeroPrior(FORWARD)
    const shipped = projectRow(row, FORWARD, prior)
    const preTicket191 = projectRowPreTicket191Minutes(row, FORWARD, prior)
    // The pre-#191 reconstruction has both a lower expectedMinutes (40 vs 50)
    // and a lower pSixtyPlus (0.4 vs 0.5) on this window — every
    // minutes-scaled component is pulled down, never up.
    expect(preTicket191).toBeLessThan(shipped.expectedPoints)
    expect(preTicket191).not.toBeCloseTo(shipped.expectedPoints, 2)
  })

  it('a fixture count of 0 (no fixture that gameweek) projects 0 points on both constructions — mirrors projectRow\'s own no-fixture behaviour', () => {
    const row = featureRow({ gameweek_id: 7, player_code: 3, element_type: FORWARD, prior_matches: 5, prior_recent_minutes: [90, 90, 90, 90, 90] })
    const prior = zeroPrior(FORWARD)
    expect(projectRowPreTicket191Minutes(row, FORWARD, prior, 0, [])).toBe(0)
  })
})

describe('buildPlayerSeasonMatches / groupSeasonMatchesByPlayer', () => {
  it('reconstructs one points/matches pair per (player, gameweek) via the SAME aggregateActualForGameweek used everywhere else in this file', () => {
    const groups = [
      { playerCode: 1, gameweekId: 1, rows: [actualRow({ minutesPlayed: 90, goals: 1 })] },
      { playerCode: 1, gameweekId: 2, rows: [actualRow({ minutesPlayed: 0 })] },
    ]
    const matches = buildPlayerSeasonMatches(groups, () => FORWARD)
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ playerCode: 1, gameweekId: 1, matches: 1, featured: true })
    expect(matches[0].points).toBeGreaterThan(0) // a goal was scored
    expect(matches[1]).toMatchObject({ playerCode: 1, gameweekId: 2, points: 0, matches: 1, featured: false }) // ticket #187 — a matched row with 0 minutes is NOT featured
  })

  it('skips a (player, gameweek) group whose position cannot be resolved — points cannot be computed without one', () => {
    const groups = [{ playerCode: 1, gameweekId: 1, rows: [actualRow()] }]
    const matches = buildPlayerSeasonMatches(groups, () => undefined)
    expect(matches).toEqual([])
  })

  it('groupSeasonMatchesByPlayer buckets by playerCode, preserving every match', () => {
    const matches: PlayerSeasonMatch[] = [
      { playerCode: 1, gameweekId: 1, points: 1, matches: 1 },
      { playerCode: 1, gameweekId: 2, points: 2, matches: 1 },
      { playerCode: 2, gameweekId: 1, points: 5, matches: 1 },
    ]
    const grouped = groupSeasonMatchesByPlayer(matches)
    expect(grouped.get(1)).toHaveLength(2)
    expect(grouped.get(2)).toHaveLength(1)
    expect(grouped.get(3)).toBeUndefined()
  })
})

describe('buildFiveGameweekWindow / isFiveGameweekWindowTruncated / computeLastGameweekInData', () => {
  it('FIVE_GAMEWEEK_HORIZON is 5, matching build-solver-input.ts\'s horizon and project-points.ts\'s PROJECTION_HORIZON', () => {
    expect(FIVE_GAMEWEEK_HORIZON).toBe(5)
  })

  it('a window is five contiguous gameweeks starting at the given gameweek', () => {
    expect(buildFiveGameweekWindow(10)).toEqual([10, 11, 12, 13, 14])
    expect(buildFiveGameweekWindow(1)).toEqual([1, 2, 3, 4, 5])
  })

  it('a starting gameweek whose window would reach past the last gameweek in data is truncated', () => {
    expect(isFiveGameweekWindowTruncated(35, 38)).toBe(true) // window 35..39
    expect(isFiveGameweekWindowTruncated(34, 38)).toBe(false) // window 34..38, exactly fits
    expect(isFiveGameweekWindowTruncated(1, 38)).toBe(false)
    expect(isFiveGameweekWindowTruncated(38, 38)).toBe(true) // a single-gameweek window is still 4 short
  })

  it('computeLastGameweekInData reads the max gameweek_id, 0 for an empty read', () => {
    expect(computeLastGameweekInData([])).toBe(0)
    expect(
      computeLastGameweekInData([featureRow({ gameweek_id: 3, player_code: 1 }), featureRow({ gameweek_id: 11, player_code: 1 }), featureRow({ gameweek_id: 7, player_code: 2 })]),
    ).toBe(11)
  })
})

describe('buildFeatureHistoryIndex', () => {
  it('keys rows by (player_code, gameweek_id), each row retrievable by projectAndReconstructWindowGameweek', () => {
    const rowA = featureRow({ gameweek_id: 5, player_code: 1, prior_matches: 3 })
    const rowB = featureRow({ gameweek_id: 5, player_code: 2, prior_matches: 7 })
    const index = buildFeatureHistoryIndex([rowA, rowB])
    expect(index.get('1:5')).toBe(rowA)
    expect(index.get('2:5')).toBe(rowB)
    expect(index.get('1:6')).toBeUndefined()
  })
})

describe('projectAndReconstructWindowGameweek', () => {
  // Ticket #193: every leg now resolves its fixture count/opponent(s) from
  // the club schedule keyed on (the START row's team_code, the leg's own
  // gameweek), so a row reaching a projection needs a non-null team_code —
  // hence the explicit `team_code` on rows below that predate this ticket.
  // A one-fixture schedule with an unresolved opponent reproduces exactly
  // the neutral single fixture these tests asserted before it.
  const oneNeutralFixture = (teamCode: number, gameweek: number) =>
    buildClubFixtureSchedule([teamStatsRow({ matchId: `sched-${teamCode}-${gameweek}`, gameweek, teamCode, opponentTeamCode: null })])

  it('missingFeatureHistoryRow when no feature_history row exists for this (player, gameweek) — the density guarantee failing would surface here', () => {
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, new Map(), new Map(), new Map(), [], [], new Map())
    expect(outcome).toEqual({ status: 'missingFeatureHistoryRow' })
  })

  it('unresolvedPosition when neither element_type nor the players-table fallback resolves', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: null })
    const index = buildFeatureHistoryIndex([row])
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, new Map(), new Map(), [], [], new Map())
    expect(outcome).toEqual({ status: 'unresolvedPosition' })
  })

  it('unresolvedTeamCode when the window\'s START row carries no club — the club schedule cannot be resolved for any leg, and a fixture is never guessed (ticket #193)', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: FORWARD, team_code: null, prior_matches: 3, prior_minutes: 270 })
    const index = buildFeatureHistoryIndex([row])
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, new Map(), new Map(), [sourceRow({ player_code: 1, gameweek: 5 })], [], oneNeutralFixture(1, 5))
    expect(outcome).toEqual({ status: 'unresolvedTeamCode' })
  })

  it('actualDataIncomplete when a matched actual row has team_goals_conceded unknown — never silently defaulted to a clean sheet', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: DEFENDER, team_code: 1, prior_matches: 3 })
    const index = buildFeatureHistoryIndex([row])
    const rows = [sourceRow({ player_code: 1, gameweek: 5, team_goals_conceded: null })]
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, new Map(), new Map(), rows, [], oneNeutralFixture(1, 5))
    expect(outcome).toEqual({ status: 'actualDataIncomplete' })
  })

  it('a leg with no matching actual rows at all (no data found) reconstructs to exactly 0 actual points — never excluded ("zeros for non-featuring weeks", ticket text)', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: FORWARD, team_code: 1, prior_matches: 3, prior_minutes: 270, prior_xg: 1 })
    const index = buildFeatureHistoryIndex([row])
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, new Map(), new Map(), [], [], oneNeutralFixture(1, 5))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.actualPoints).toBe(0)
    expect(Number.isFinite(outcome.projectedPoints)).toBe(true)
  })

  it('a leg with a matched but non-featuring row (0 minutes) also reconstructs to exactly 0 actual points', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: FORWARD, team_code: 1, prior_matches: 3, prior_minutes: 270, prior_xg: 1 })
    const index = buildFeatureHistoryIndex([row])
    const rows = [sourceRow({ player_code: 1, gameweek: 5, minutes_played: 0 })]
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, new Map(), new Map(), rows, [], oneNeutralFixture(1, 5))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.actualPoints).toBe(0)
  })

  it('resolves position via element_type first, the players-table fallback only when it is null — same precedence as resolveRowPosition', () => {
    const row = featureRow({ gameweek_id: 5, player_code: 1, element_type: null, team_code: 1, prior_matches: 2 })
    const index = buildFeatureHistoryIndex([row])
    const codeToPosition = new Map([[1, MIDFIELDER]])
    const outcome = projectAndReconstructWindowGameweek(1, 5, 5, index, codeToPosition, new Map(), [], [], oneNeutralFixture(1, 5))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.position).toBe(MIDFIELDER)
  })
})

describe('classifyFiveGameweekRow', () => {
  it('excludes a truncated window without touching any lookup maps', () => {
    const classification = classifyFiveGameweekRow(
      1,
      { gameweekId: 36, position: FORWARD, projectedPoints: 1, actualPoints: 1, baselineMinutesPerMatch: 0, baselineXgXaPerMatch: 0 },
      38,
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      [],
      new Map(),
    )
    expect(classification).toEqual({ kind: 'excluded', reason: 'truncatedWindow' })
  })

  it('missingFeatureHistoryRow when the window\'s START gameweek has no feature_history row — every leg is built from that one row, so its absence excludes the whole window', () => {
    const startRow = { gameweekId: 1, position: FORWARD, projectedPoints: 3, actualPoints: 2, baselineMinutesPerMatch: 90, baselineXgXaPerMatch: 0.2 }
    const classification = classifyFiveGameweekRow(1, startRow, 38, new Map(), new Map(), new Map(), new Map(), [], new Map())
    expect(classification).toEqual({ kind: 'excluded', reason: 'missingFeatureHistoryRow' })
  })

  it('unresolvedTeamCode when the window\'s START row has no club — every leg would need it to resolve the club schedule, so the WHOLE window is excluded by name (ticket #193)', () => {
    const playerCode = 903
    const startRow = { gameweekId: 1, position: FORWARD, projectedPoints: 3, actualPoints: 2, baselineMinutesPerMatch: 90, baselineXgXaPerMatch: 0.2 }
    const index = buildFeatureHistoryIndex([featureRow({ gameweek_id: 1, player_code: playerCode, element_type: FORWARD, team_code: null, prior_matches: 3, prior_minutes: 270 })])
    const classification = classifyFiveGameweekRow(playerCode, startRow, 38, index, new Map(), new Map(), new Map(), [], new Map())
    expect(classification).toEqual({ kind: 'excluded', reason: 'unresolvedTeamCode' })
  })

  it('propagates a window leg\'s own exclusion reason for the WHOLE window — a window is only as good as its worst-resolved leg', () => {
    // The start row resolves fine; leg G+2 (gameweek 3) has an actual row
    // whose team_goals_conceded is unknown — a per-LEG gate, since the
    // actual outcome is the one thing still read at the leg's own gameweek.
    const playerCode = 902
    const startRow = { gameweekId: 1, position: FORWARD, projectedPoints: 3, actualPoints: 2, baselineMinutesPerMatch: 90, baselineXgXaPerMatch: 0.2 }
    const index = buildFeatureHistoryIndex([featureRow({ gameweek_id: 1, player_code: playerCode, element_type: FORWARD, team_code: 1, prior_matches: 3, prior_minutes: 270 })])
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>([
      [`${playerCode}:3`, [sourceRow({ player_code: playerCode, gameweek: 3, team_goals_conceded: null })]],
    ])
    const classification = classifyFiveGameweekRow(playerCode, startRow, 38, index, new Map(), new Map(), actualByPlayerGameweek, [], new Map())
    expect(classification).toEqual({ kind: 'excluded', reason: 'actualDataIncomplete' })
  })

  it('five projections summed, NEVER one projection \u00d7 5 — every leg is built from G\'s feature_history row but its OWN fixture, and the sum matches an independent leg-by-leg reconstruction', () => {
    const playerCode = 900
    const OWN = 1
    const startRow = { gameweekId: 1, position: FORWARD, projectedPoints: 7.5, actualPoints: 6, baselineMinutesPerMatch: 90, baselineXgXaPerMatch: 0.3 }

    // The ONE row every leg is projected from: the window's start gameweek.
    const gRow = featureRow({ gameweek_id: 1, player_code: playerCode, element_type: FORWARD, team_code: OWN, prior_matches: 3, prior_minutes: 270, prior_xg: 1.2 })
    // Rows sitting INSIDE the window, deliberately very different. Nothing
    // may read them — they exist only so this test would notice if a leg
    // started keying its feature lookup on its own gameweek again.
    const insideWindowRows = [2, 3, 4, 5].map((gw) =>
      featureRow({ gameweek_id: gw, player_code: playerCode, element_type: FORWARD, team_code: OWN, prior_matches: gw + 8, prior_minutes: (gw + 8) * 90, prior_xg: gw * 4 }),
    )
    const featureHistoryByPlayerGameweek = buildFeatureHistoryIndex([gRow, ...insideWindowRows])

    // Four DIFFERENT opponents, one per leg, of genuinely different strength
    // — this is what still legitimately varies leg to leg, because the
    // published schedule is known at G.
    const opponentOf = (gw: number) => 10 + gw
    const teamMatchRecords: TeamMatchRecord[] = []
    for (let gw = -8; gw <= 0; gw++) {
      teamMatchRecords.push({ matchId: `own-${gw}`, gameweek: gw, teamCode: OWN, goalsConceded: 1, goalsScored: 1 })
      for (const leg of [2, 3, 4, 5]) {
        // Opponent strength climbs steeply with the leg number.
        teamMatchRecords.push({ matchId: `opp-${leg}-${gw}`, gameweek: gw, teamCode: opponentOf(leg), goalsConceded: 0, goalsScored: leg })
      }
    }

    const legActualRow = (gw: number): ActualSourceRow => sourceRow({ player_code: playerCode, gameweek: gw, team_code: OWN, opponent_team_code: opponentOf(gw) })
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>([2, 3, 4, 5].map((gw) => [`${playerCode}:${gw}`, [legActualRow(gw)]]))
    // Ticket #193 — the leg's fixture comes from the club's published
    // schedule, never from the actual rows above (which now supply the
    // outcome and nothing else).
    const clubFixtureSchedule = buildClubFixtureSchedule(
      [2, 3, 4, 5].map((gw) => teamStatsRow({ matchId: `leg-${gw}`, gameweek: gw, teamCode: OWN, opponentTeamCode: opponentOf(gw) })),
    )

    const classification = classifyFiveGameweekRow(
      playerCode,
      startRow,
      38,
      featureHistoryByPlayerGameweek,
      new Map(),
      new Map(), // positionPriors empty — every leg falls back to fallbackPositionPrior(FORWARD)
      actualByPlayerGameweek,
      teamMatchRecords,
      clubFixtureSchedule,
    )
    expect(classification.kind).toBe('measured')
    if (classification.kind !== 'measured') return

    // Independent reconstruction: G's row and G's team strengths every time,
    // the leg's own opponent every time.
    const prior = fallbackPositionPrior(FORWARD)
    const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, OWN, startRow.gameweekId)
    let expectedProjected = startRow.projectedPoints
    let expectedActual = startRow.actualPoints
    for (const gw of [2, 3, 4, 5]) {
      const oppStrength = computeTeamStrengthAsOf(teamMatchRecords, opponentOf(gw), startRow.gameweekId)
      const es = computeFixtureExpectedScore(ownStrength, oppStrength, SCALE)
      expectedProjected += projectRow(gRow, FORWARD, prior, 1, [es]).expectedPoints
      expectedActual += aggregateActualForGameweek(FORWARD, [toActualMatchStatsInput(legActualRow(gw))]).totalPoints
    }

    expect(classification.row.projectedPoints).toBeCloseTo(expectedProjected, 10)
    expect(classification.row.actualPoints).toBeCloseTo(expectedActual, 10)
    expect(classification.row).toMatchObject({
      playerCode,
      startGameweekId: 1,
      position: FORWARD,
      baselineMinutesPerMatch: 90, // reused verbatim from startRow — never recomputed per leg
      baselineXgXaPerMatch: 0.3,
      // Ticket #193 — all four legs took their fixture from the schedule,
      // none was a blank gameweek, and the player featured in every one.
      legsWithScheduleFixture: 4,
      legsBlankGameweek: 0,
      legsDidNotFeatureButClubHadFixture: 0,
    })

    // The guard has teeth: leg 2's own projection genuinely differs from
    // leg 5's, purely because their fixtures differ.
    const es2 = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, opponentOf(2), 1), SCALE)
    const es5 = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, opponentOf(5), 1), SCALE)
    expect(projectRow(gRow, FORWARD, prior, 1, [es2]).expectedPoints).not.toBeCloseTo(projectRow(gRow, FORWARD, prior, 1, [es5]).expectedPoints, 2)
  })

  it('a non-featuring leg contributes 0 actual points to the sum, never excludes the window ("that risk is part of what a transfer buys")', () => {
    const playerCode = 901
    const OWN = 1
    const startRow = { gameweekId: 10, position: FORWARD, projectedPoints: 4, actualPoints: 3, baselineMinutesPerMatch: 80, baselineXgXaPerMatch: 0.25 }
    const legRows = [10, 11, 12, 13, 14].map((gw) => featureRow({ gameweek_id: gw, player_code: playerCode, element_type: FORWARD, team_code: OWN, prior_matches: 5, prior_minutes: 450, prior_xg: 3 }))
    const featureHistoryByPlayerGameweek = buildFeatureHistoryIndex(legRows)
    // No actual rows at all for any of gameweeks 11-14, and (ticket #193) the
    // club has no scheduled fixture in any of them either — a genuine blank
    // stretch on both sides, a legitimate zero rather than a foreknown one.
    const classification = classifyFiveGameweekRow(playerCode, startRow, 38, featureHistoryByPlayerGameweek, new Map(), new Map(), new Map(), [], new Map())
    expect(classification.kind).toBe('measured')
    if (classification.kind !== 'measured') return
    // Only the starting gameweek's actual (3) contributes — every other leg is 0.
    expect(classification.row.actualPoints).toBe(3)
    expect(classification.row).toMatchObject({ legsWithScheduleFixture: 0, legsBlankGameweek: 4, legsDidNotFeatureButClubHadFixture: 0 })
  })

  it('counts the three club-schedule leg diagnostics separately — a scheduled fixture the player missed is the LEAK, a club with no fixture is a blank gameweek (ticket #193)', () => {
    const playerCode = 904
    const OWN = 1
    const OPPONENT = 2
    const G = 10
    const startRow = { gameweekId: G, position: FORWARD, projectedPoints: 4, actualPoints: 3, baselineMinutesPerMatch: 80, baselineXgXaPerMatch: 0.25 }
    const index = buildFeatureHistoryIndex([featureRow({ gameweek_id: G, player_code: playerCode, element_type: FORWARD, team_code: OWN, prior_matches: 5, prior_minutes: 450, prior_xg: 3 })])

    // The club plays at G+1, G+2 and G+3, and has no fixture at G+4.
    const clubFixtureSchedule = buildClubFixtureSchedule(
      [11, 12, 13].map((gw) => teamStatsRow({ matchId: `m-${gw}`, gameweek: gw, teamCode: OWN, opponentTeamCode: OPPONENT })),
    )
    // The player features at G+1 only: G+2 is a 0-minute row, G+3 has no row
    // at all. Both are legs his club played and he did not — the leak.
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>([
      [`${playerCode}:11`, [sourceRow({ player_code: playerCode, gameweek: 11 })]],
      [`${playerCode}:12`, [sourceRow({ player_code: playerCode, gameweek: 12, minutes_played: 0 })]],
    ])

    const classification = classifyFiveGameweekRow(playerCode, startRow, 38, index, new Map(), new Map(), actualByPlayerGameweek, [], clubFixtureSchedule)
    expect(classification.kind).toBe('measured')
    if (classification.kind !== 'measured') return
    expect(classification.row).toMatchObject({
      legsWithScheduleFixture: 3, // G+1, G+2, G+3
      legsBlankGameweek: 1, // G+4
      legsDidNotFeatureButClubHadFixture: 2, // G+2 (0 minutes) and G+3 (no row at all)
    })
  })
})

describe('sumClubScheduleLegCounts (ticket #193)', () => {
  it('sums each counter across every measured five-gameweek row, 0 for an empty population', () => {
    expect(sumClubScheduleLegCounts([])).toEqual({ legsWithScheduleFixture: 0, legsBlankGameweek: 0, legsDidNotFeatureButClubHadFixture: 0 })

    const totals: ClubScheduleLegCounts = sumClubScheduleLegCounts([
      fiveGwRow({ position: FORWARD, startGameweekId: 1, actualPoints: 5, legsWithScheduleFixture: 4, legsBlankGameweek: 0, legsDidNotFeatureButClubHadFixture: 1 }),
      fiveGwRow({ position: FORWARD, startGameweekId: 2, actualPoints: 5, legsWithScheduleFixture: 3, legsBlankGameweek: 1, legsDidNotFeatureButClubHadFixture: 2 }),
    ])
    expect(totals).toEqual({ legsWithScheduleFixture: 7, legsBlankGameweek: 1, legsDidNotFeatureButClubHadFixture: 3 })
  })
})

describe('FIVE-GAMEWEEK WINDOW — THE LOOKAHEAD GUARD (the defect checkOracleCeiling caught, 3 Sep 2026)', () => {
  // The app plans the whole G..G+4 horizon ONCE, at G. Three lookups inside
  // projectAndReconstructWindowGameweek used to be keyed on the LEG's own
  // gameweek G+i instead of the window's start G — the feature_history row,
  // both computeTeamStrengthAsOf calls, and the position prior. Each one
  // read point-in-time state from INSIDE the target window, which is
  // hindsight the app does not have, and together they lifted the model's
  // five-gameweek Spearman (0.728) above a genuine hindsight oracle's
  // (0.506). Two things legitimately stay on the leg's own gameweek: that
  // leg's actual outcome (the target) and its published fixture. Every test
  // below fixes one of those five facts. See
  // docs/projection-model-backlog.md G13.

  const PLAYER = 950
  const OWN = 1
  const OPPONENT_LEG3 = 2
  const OPPONENT_OTHER = 3
  const G = 10
  const LEG3 = 13 // G + 3

  // Form at G: thin and quiet. Form at G+3: a different player entirely.
  // Only the first may ever reach a projection.
  const rowAtG = () => featureRow({ gameweek_id: G, player_code: PLAYER, element_type: FORWARD, team_code: OWN, prior_matches: 3, prior_minutes: 200, prior_xg: 0.2, prior_xa: 0.1 })
  const rowAtLeg3 = () => featureRow({ gameweek_id: LEG3, player_code: PLAYER, element_type: FORWARD, team_code: OWN, prior_matches: 12, prior_minutes: 1080, prior_xg: 9, prior_xa: 6 })

  /** Ticket #193 — one scheduled fixture for OWN at each named gameweek, against `opponent` (null ⇒ the neutral fallback these tests asserted before the schedule existed). */
  const scheduleFor = (gameweeks: readonly number[], opponent: number | null = null) =>
    buildClubFixtureSchedule(gameweeks.map((gw) => teamStatsRow({ matchId: `sched-${gw}`, gameweek: gw, teamCode: OWN, opponentTeamCode: opponent })))

  it('leg 3 is projected from G\'s feature_history row, NOT from its own — form inside the window is hindsight', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    const legRows = [sourceRow({ player_code: PLAYER, gameweek: LEG3 })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), new Map(), legRows, [], scheduleFor([LEG3]))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const prior = fallbackPositionPrior(FORWARD)
    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, []).expectedPoints, 10)

    // And the two really are materially different — the assertion above is
    // not passing because both rows happen to project the same.
    const fromLeg3Row = projectRow(rowAtLeg3(), FORWARD, prior, 1, []).expectedPoints
    expect(outcome.projectedPoints).not.toBeCloseTo(fromLeg3Row, 1)
    expect(fromLeg3Row).toBeGreaterThan(outcome.projectedPoints)
  })

  it('the same holds end-to-end through classifyFiveGameweekRow — all four legs sum G\'s projection, never their own gameweeks\'', () => {
    const insideWindow = [11, 12, 13, 14].map((gw) =>
      featureRow({ gameweek_id: gw, player_code: PLAYER, element_type: FORWARD, team_code: OWN, prior_matches: 12, prior_minutes: 1080, prior_xg: 9, prior_xa: 6 }),
    )
    const index = buildFeatureHistoryIndex([rowAtG(), ...insideWindow])
    const startRow = { gameweekId: G, position: FORWARD, projectedPoints: 0, actualPoints: 0, baselineMinutesPerMatch: 0, baselineXgXaPerMatch: 0 }
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>([11, 12, 13, 14].map((gw) => [`${PLAYER}:${gw}`, [sourceRow({ player_code: PLAYER, gameweek: gw })]]))

    const classification = classifyFiveGameweekRow(PLAYER, startRow, 38, index, new Map(), new Map(), actualByPlayerGameweek, [], scheduleFor([11, 12, 13, 14]))
    expect(classification.kind).toBe('measured')
    if (classification.kind !== 'measured') return

    const perLeg = projectRow(rowAtG(), FORWARD, fallbackPositionPrior(FORWARD), 1, []).expectedPoints
    expect(classification.row.projectedPoints).toBeCloseTo(4 * perLeg, 10)
  })

  it('leg 3\'s FIXTURE OPPONENT still comes from leg 3\'s published schedule entry — a published schedule is genuinely known at G', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    // Both opponents have ample prior history, of very different quality.
    const teamMatchRecords: TeamMatchRecord[] = []
    for (let gw = 1; gw < G; gw++) {
      teamMatchRecords.push({ matchId: `own-${gw}`, gameweek: gw, teamCode: OWN, goalsConceded: 1, goalsScored: 1 })
      teamMatchRecords.push({ matchId: `weak-${gw}`, gameweek: gw, teamCode: OPPONENT_LEG3, goalsConceded: 3, goalsScored: 0 })
      teamMatchRecords.push({ matchId: `strong-${gw}`, gameweek: gw, teamCode: OPPONENT_OTHER, goalsConceded: 0, goalsScored: 3 })
    }

    const legRows = [sourceRow({ player_code: PLAYER, gameweek: LEG3 })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), new Map(), legRows, teamMatchRecords, scheduleFor([LEG3], OPPONENT_LEG3))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, OWN, G)
    const esVsLeg3Opponent = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, OPPONENT_LEG3, G), SCALE)
    const esVsOtherOpponent = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, OPPONENT_OTHER, G), SCALE)

    const prior = fallbackPositionPrior(FORWARD)
    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, [esVsLeg3Opponent]).expectedPoints, 10)
    // The wrong opponent would have been visibly wrong.
    expect(esVsOtherOpponent).not.toBeCloseTo(esVsLeg3Opponent, 3)
    expect(outcome.projectedPoints).not.toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, [esVsOtherOpponent]).expectedPoints, 2)
  })

  it('BOTH team strengths are measured as of G — results from inside the window never move a fixture', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    const teamMatchRecords: TeamMatchRecord[] = []
    for (let gw = 1; gw < G; gw++) {
      teamMatchRecords.push({ matchId: `own-${gw}`, gameweek: gw, teamCode: OWN, goalsConceded: 1, goalsScored: 1 })
      teamMatchRecords.push({ matchId: `opp-${gw}`, gameweek: gw, teamCode: OPPONENT_LEG3, goalsConceded: 1, goalsScored: 1 })
    }
    // Everything from G onward is deliberately enormous and lopsided: if
    // either strength read were keyed on LEG3 rather than G, these records
    // would land inside the comparison and the expected score would move.
    const withInsideWindowResults: TeamMatchRecord[] = [...teamMatchRecords]
    for (let gw = G; gw < LEG3; gw++) {
      withInsideWindowResults.push({ matchId: `own-in-${gw}`, gameweek: gw, teamCode: OWN, goalsConceded: 0, goalsScored: 40 })
      withInsideWindowResults.push({ matchId: `opp-in-${gw}`, gameweek: gw, teamCode: OPPONENT_LEG3, goalsConceded: 40, goalsScored: 0 })
    }

    const legRows = [sourceRow({ player_code: PLAYER, gameweek: LEG3 })]
    const schedule = scheduleFor([LEG3], OPPONENT_LEG3)
    const without = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), new Map(), legRows, teamMatchRecords, schedule)
    const with_ = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), new Map(), legRows, withInsideWindowResults, schedule)
    expect(without.status).toBe('ok')
    expect(with_.status).toBe('ok')
    if (without.status !== 'ok' || with_.status !== 'ok') return

    // Two identical prior records at G ⇒ exactly the neutral 0.5, and adding
    // in-window results must not budge it.
    expect(computeFixtureExpectedScore(computeTeamStrengthAsOf(withInsideWindowResults, OWN, G), computeTeamStrengthAsOf(withInsideWindowResults, OPPONENT_LEG3, G), SCALE)).toBe(0.5)
    expect(with_.projectedPoints).toBeCloseTo(without.projectedPoints, 10)
  })

  it('the POSITION PRIOR is read at G, never at the leg\'s own gameweek', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    const priorAtG = zeroPrior(FORWARD)
    // A prior filed under LEG3 that is nothing like G's — reading it would
    // change the projection, so this map proves which key was used.
    const priorAtLeg3: PositionPrior = { rate: positionPriorRates([{ minutesPlayed: 900, xg: 12, xa: 9, saves: 0, cbi: 0, recoveries: 0 }]), defconHitRate: 0.9 }
    const positionPriors = new Map<string, PositionPrior>([
      [`${G}:${FORWARD}`, priorAtG],
      [`${LEG3}:${FORWARD}`, priorAtLeg3],
    ])

    const legRows = [sourceRow({ player_code: PLAYER, gameweek: LEG3 })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), positionPriors, legRows, [], scheduleFor([LEG3]))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, priorAtG, 1, []).expectedPoints, 10)
    expect(outcome.projectedPoints).not.toBeCloseTo(projectRow(rowAtG(), FORWARD, priorAtLeg3, 1, []).expectedPoints, 2)
  })

  it('leg 3\'s ACTUAL OUTCOME still comes from leg 3 — that is the target being ranked, not an input', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    const scoredTwice = [sourceRow({ player_code: PLAYER, gameweek: LEG3, goals: 2 })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG3, index, new Map(), new Map(), scoredTwice, [], scheduleFor([LEG3]))
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.actualPoints).toBe(aggregateActualForGameweek(FORWARD, [toActualMatchStatsInput(scoredTwice[0])]).totalPoints)
    expect(outcome.actualPoints).toBeGreaterThan(0)
  })

  it('throws when the two gameweek arguments are swapped — a leg can never precede its own window start', () => {
    const index = buildFeatureHistoryIndex([rowAtG(), rowAtLeg3()])
    expect(() => projectAndReconstructWindowGameweek(PLAYER, LEG3, G, index, new Map(), new Map(), [], [], new Map())).toThrow(/swapped/)
  })
})

describe('THE CLUB-SCHEDULE FIX — the second lookahead leak (ticket #193)', () => {
  // The leg's fixture COUNT and OPPONENT(s) used to be read off the player's
  // OWN player_match_stats rows for that gameweek. A player who did not
  // feature had none, so the leg projected 0 fixtures — exactly 0 points —
  // against an actual of exactly 0. The harness was telling the model, in
  // advance, which of the five weeks the player would miss, and a
  // five-gameweek total is dominated by precisely that. Both tests below fail
  // if the fix is reverted to `outcome.matchesFound`.

  const PLAYER = 960
  const OWN = 1
  const OPPONENT = 2
  const OTHER_OPPONENT = 3
  const G = 10
  const LEG = 12

  const rowAtG = () => featureRow({ gameweek_id: G, player_code: PLAYER, element_type: FORWARD, team_code: OWN, prior_matches: 8, prior_minutes: 700, prior_xg: 3.2, prior_xa: 1.8 })

  it('THE PINNED DEFECT: a leg the player did not feature in, whose CLUB did play, projects a NON-ZERO figure — reverting to matchesFound makes this fail', () => {
    const index = buildFeatureHistoryIndex([rowAtG()])
    const clubFixtureSchedule = buildClubFixtureSchedule([teamStatsRow({ matchId: 'played-without-him', gameweek: LEG, teamCode: OWN, opponentTeamCode: null })])

    // The player has ONE row for the leg and it is a 0-minute row: his club
    // played, he did not. Under the old construction this leg projected 0.
    const didNotFeature = [sourceRow({ player_code: PLAYER, gameweek: LEG, minutes_played: 0 })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG, index, new Map(), new Map(), didNotFeature, [], clubFixtureSchedule)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    // The club had a fixture, so ONE fixture is projected — the same figure
    // the projection would carry if he had played, because whether he plays
    // is exactly what the model is supposed to be estimating, not reading.
    expect(outcome.fixtureCount).toBe(1)
    expect(outcome.featured).toBe(false)
    expect(outcome.projectedPoints).toBeGreaterThan(0)
    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, fallbackPositionPrior(FORWARD), 1, []).expectedPoints, 10)
    // The actual side is untouched by any of this: a leg he missed is still 0.
    expect(outcome.actualPoints).toBe(0)

    // And the same leg with NO row at all — the far commoner shape of a
    // non-appearance in this data — behaves identically.
    const noRowsAtAll = projectAndReconstructWindowGameweek(PLAYER, G, LEG, index, new Map(), new Map(), [], [], clubFixtureSchedule)
    expect(noRowsAtAll.status).toBe('ok')
    if (noRowsAtAll.status !== 'ok') return
    expect(noRowsAtAll.projectedPoints).toBeCloseTo(outcome.projectedPoints, 10)
  })

  it('the leg\'s OPPONENT comes from the club schedule, not the player\'s own rows — proven with a player who has no rows at all for that leg', () => {
    const index = buildFeatureHistoryIndex([rowAtG()])
    // Two possible opponents of very different quality, both with ample
    // prior history so the fixture is priced for real, not neutrally.
    const teamMatchRecords: TeamMatchRecord[] = []
    for (let gw = 1; gw < G; gw++) {
      teamMatchRecords.push({ matchId: `own-${gw}`, gameweek: gw, teamCode: OWN, goalsConceded: 1, goalsScored: 1 })
      teamMatchRecords.push({ matchId: `weak-${gw}`, gameweek: gw, teamCode: OPPONENT, goalsConceded: 3, goalsScored: 0 })
      teamMatchRecords.push({ matchId: `strong-${gw}`, gameweek: gw, teamCode: OTHER_OPPONENT, goalsConceded: 0, goalsScored: 3 })
    }
    const clubFixtureSchedule = buildClubFixtureSchedule([teamStatsRow({ matchId: 'sched', gameweek: LEG, teamCode: OWN, opponentTeamCode: OPPONENT })])

    // NO actual rows whatsoever for this player at this leg — the schedule is
    // the only possible source of an opponent.
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG, index, new Map(), new Map(), [], teamMatchRecords, clubFixtureSchedule)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, OWN, G)
    const esVsScheduled = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, OPPONENT, G), SCALE)
    const esVsOther = computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, OTHER_OPPONENT, G), SCALE)
    const prior = fallbackPositionPrior(FORWARD)

    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, [esVsScheduled]).expectedPoints, 10)
    // The schedule's opponent is genuinely distinguishable from the other
    // one, and from the neutral fallback — this assertion has teeth.
    expect(esVsOther).not.toBeCloseTo(esVsScheduled, 3)
    expect(outcome.projectedPoints).not.toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, [esVsOther]).expectedPoints, 2)
    expect(outcome.projectedPoints).not.toBeCloseTo(projectRow(rowAtG(), FORWARD, prior, 1, []).expectedPoints, 2)
  })

  it('a DOUBLE gameweek in the schedule projects TWO fixtures even for a player who only played one of them — the #140 approximation no longer leaks into the window', () => {
    const index = buildFeatureHistoryIndex([rowAtG()])
    const clubFixtureSchedule = buildClubFixtureSchedule([
      teamStatsRow({ matchId: 'dgw-a', gameweek: LEG, teamCode: OWN, opponentTeamCode: null }),
      teamStatsRow({ matchId: 'dgw-b', gameweek: LEG, teamCode: OWN, opponentTeamCode: null }),
    ])
    // He appears in only one of his club's two fixtures that gameweek.
    const playedOnce = [sourceRow({ player_code: PLAYER, gameweek: LEG })]
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG, index, new Map(), new Map(), playedOnce, [], clubFixtureSchedule)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.fixtureCount).toBe(2) // the club's count, not his own
    expect(outcome.projectedPoints).toBeCloseTo(projectRow(rowAtG(), FORWARD, fallbackPositionPrior(FORWARD), 2, []).expectedPoints, 10)
  })

  it('a leg whose club has NO schedule entry projects exactly zero — the blank gameweek, never a fabricated neutral fixture', () => {
    const index = buildFeatureHistoryIndex([rowAtG()])
    const elsewhere = buildClubFixtureSchedule([teamStatsRow({ matchId: 'other-club', gameweek: LEG, teamCode: 99, opponentTeamCode: 98 })])
    const outcome = projectAndReconstructWindowGameweek(PLAYER, G, LEG, index, new Map(), new Map(), [], [], elsewhere)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.fixtureCount).toBe(0)
    expect(outcome.projectedPoints).toBe(0)
    expect(outcome.actualPoints).toBe(0)
  })
})

describe('emptyFiveGameweekExclusionCounts / incrementFiveGameweekExclusion / totalFiveGameweekExcluded / assertFiveGameweekReconciles', () => {
  it('increments the named reason only', () => {
    const counts = emptyFiveGameweekExclusionCounts()
    incrementFiveGameweekExclusion(counts, 'truncatedWindow')
    incrementFiveGameweekExclusion(counts, 'truncatedWindow')
    incrementFiveGameweekExclusion(counts, 'actualDataIncomplete')
    expect(counts).toEqual({ truncatedWindow: 2, missingFeatureHistoryRow: 0, unresolvedPosition: 0, unresolvedTeamCode: 0, actualDataIncomplete: 1 })
    expect(totalFiveGameweekExcluded(counts)).toBe(3)
  })

  it('ticket #193\'s unresolvedTeamCode reason counts and reconciles like every other one', () => {
    const counts = emptyFiveGameweekExclusionCounts()
    incrementFiveGameweekExclusion(counts, 'unresolvedTeamCode')
    incrementFiveGameweekExclusion(counts, 'unresolvedTeamCode')
    expect(counts.unresolvedTeamCode).toBe(2)
    expect(totalFiveGameweekExcluded(counts)).toBe(2)
    expect(() => assertFiveGameweekReconciles(5, 3, counts)).not.toThrow()
  })

  it('assertFiveGameweekReconciles throws, naming both sides, on a mismatch', () => {
    const counts = emptyFiveGameweekExclusionCounts()
    incrementFiveGameweekExclusion(counts, 'truncatedWindow')
    expect(() => assertFiveGameweekReconciles(5, 3, counts)).toThrow(/five-gameweek reconciliation failed/)
  })

  it('does not throw when measured + excluded exactly equals candidates', () => {
    const counts = emptyFiveGameweekExclusionCounts()
    incrementFiveGameweekExclusion(counts, 'truncatedWindow')
    incrementFiveGameweekExclusion(counts, 'unresolvedPosition')
    expect(() => assertFiveGameweekReconciles(5, 3, counts)).not.toThrow()
  })
})

describe('summarizeGenericRankingByGroup / summarizeGenericSeasonRanking / summarizeGenericRankingByPosition — reused math, new row shape', () => {
  it('gates a group under MIN_BUCKET_SAMPLE_SIZE as "too small to read", same rule as the one-gameweek by-gameweek table', () => {
    const rows: GenericRankingRow[] = Array.from({ length: 10 }, (_, i) => ({ position: FORWARD, groupId: 1, projected: i, actual: i }))
    const byGroup = summarizeGenericRankingByGroup(rows)
    expect(byGroup.get(1)?.tooSmallToRead).toBe(true)
    expect(byGroup.get(1)?.spearman).toBeNull()
  })

  it('a perfectly-ordered set of at least MIN_BUCKET_SAMPLE_SIZE rows scores Spearman exactly 1, at both the group and season level', () => {
    const rows: GenericRankingRow[] = Array.from({ length: 60 }, (_, i) => ({ position: MIDFIELDER, groupId: 7, projected: i, actual: i }))
    const byGroup = summarizeGenericRankingByGroup(rows)
    expect(byGroup.get(7)?.tooSmallToRead).toBe(false)
    expect(byGroup.get(7)?.spearman).toBeCloseTo(1, 10)
    const season = summarizeGenericSeasonRanking(rows, byGroup)
    expect(season.spearman).toBeCloseTo(1, 10)
    expect(season.n).toBe(60)
  })

  it('summarizeGenericRankingByPosition pools one position across every groupId, mirroring summarizeRankingByPosition', () => {
    const rows: GenericRankingRow[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ position: DEFENDER, groupId: 1, projected: i, actual: i })),
      ...Array.from({ length: 30 }, (_, i) => ({ position: DEFENDER, groupId: 2, projected: i, actual: i })),
      { position: MIDFIELDER, groupId: 1, projected: 1, actual: 1 },
    ]
    const byPosition = summarizeGenericRankingByPosition(rows)
    expect(byPosition[DEFENDER].n).toBe(60)
    expect(byPosition[DEFENDER].spearman).toBeCloseTo(1, 10)
    expect(byPosition[MIDFIELDER].n).toBe(1)
  })
})

describe('summarizeFiveGameweekBaselines / computeGenericConstantBaselineSpearman — the SAME self-test as computeConstantBaselineSpearman, reapplied to the five-gameweek target (ticket text: "a constant ranking scores 0 on the five-gameweek target too")', () => {
  it('computeGenericConstantBaselineSpearman returns exactly 0 for a set of five-gameweek actual totals with real variance', () => {
    expect(computeGenericConstantBaselineSpearman([3, 45, 12, 0, 27, 9])).toBe(0)
  })

  it('summarizeFiveGameweekBaselines\' constant-baseline row is exactly 0 at season aggregate and every position it appears in', () => {
    const rows: FiveGameweekRow[] = [
      fiveGwRow({ position: DEFENDER, startGameweekId: 1, actualPoints: 12 }),
      fiveGwRow({ position: DEFENDER, startGameweekId: 2, actualPoints: 30 }),
      fiveGwRow({ position: MIDFIELDER, startGameweekId: 1, actualPoints: 5 }),
    ]
    const baselines = summarizeFiveGameweekBaselines(rows)
    expect(baselines.map((b) => b.label)).toEqual([PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL, PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL, CONSTANT_BASELINE_LABEL])
    const constant = baselines.find((b) => b.label === CONSTANT_BASELINE_LABEL)!
    expect(constant.seasonSpearman).toBe(0)
    expect(constant.byPosition[DEFENDER]).toBe(0)
    expect(constant.byPosition[MIDFIELDER]).toBe(0)
  })

  it('ranks baselineMinutesPerMatch/baselineXgXaPerMatch — the SAME per-row prior quantity as the one-gameweek section, computed at the starting gameweek — against the five-gameweek actual total', () => {
    const rows: FiveGameweekRow[] = Array.from({ length: 20 }, (_, i) =>
      fiveGwRow({
        playerCode: i,
        startGameweekId: 1,
        position: FORWARD,
        projectedPoints: i,
        actualPoints: i, // perfectly correlated with baselineMinutesPerMatch below
        baselineMinutesPerMatch: i,
        baselineXgXaPerMatch: 0,
      }),
    )
    const baselines = summarizeFiveGameweekBaselines(rows)
    const minutesBaseline = baselines.find((b) => b.label === PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL)!
    expect(minutesBaseline.seasonSpearman).toBeCloseTo(1, 10)
    const xgXaBaseline = baselines.find((b) => b.label === PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL)!
    // baselineXgXaPerMatch is constant (0) across all rows — undefined correlation, reported null.
    expect(xgXaBaseline.seasonSpearman).toBeNull()
  })
})

describe('summarizeGenericBaselineSpearman', () => {
  it('mirrors summarizeBaselineSpearman\'s own shape — one BaselineSummary with a season figure and a per-position breakdown', () => {
    const rows: GenericRankingRow[] = [
      { position: FORWARD, groupId: 1, projected: 1, actual: 1 },
      { position: FORWARD, groupId: 1, projected: 2, actual: 2 },
    ]
    const summary = summarizeGenericBaselineSpearman('label', rows)
    expect(summary.label).toBe('label')
    expect(summary.seasonSpearman).toBeCloseTo(1, 10)
    expect(summary.byPosition[FORWARD]).toBeCloseTo(1, 10)
    expect(summary.byPosition[DEFENDER]).toBeNull()
  })
})

// ============================================================================
// generateReportMarkdown — ticket #183's second most important test: the
// existing (pre-#183) report must be byte-identical for the same input.
// PRE_TICKET_183_REPORT below is the EXACT output generateReportMarkdown
// produced for this same ReportData BEFORE ticket #183 touched this file
// (captured by running the pre-#183 commit's generateReportMarkdown,
// verbatim — never hand-typed, never re-derived). Ticket #183 only ever
// APPENDS sections after this point (see generateReportMarkdown's own
// final `sections.push(...buildFiveGameweekSections(data))` call), so
// today's output must start with exactly this string.
// ============================================================================

describe('generateReportMarkdown — the existing (pre-#183) report is byte-identical for the same input', () => {
  const measured: MeasuredRow[] = [
    {
      gameweekId: 1,
      position: FORWARD,
      projectedPoints: 5,
      actualPoints: 4,
      signedError: 1,
      absError: 1,
      projectedComponents: {
        appearancePoints: 2,
        goalPoints: 0,
        assistPoints: 0,
        cleanSheetPoints: 0,
        goalsConcededPoints: 0,
        savePoints: 0,
        defensiveContributionPoints: 0,
      },
      actualComponents: {
        appearancePoints: 2,
        goalPoints: 0,
        assistPoints: 0,
        cleanSheetPoints: 0,
        goalsConcededPoints: 0,
        savePoints: 0,
        defensiveContributionPoints: 0,
      },
      actualMinutes: 90,
      fixtureCount: 1,
      priorMatches: 5,
      baselineMinutesPerMatch: 90,
      baselineXgXaPerMatch: 0.3,
    },
  ]

  const fgRankingRows: GenericRankingRow[] = []
  const fgByGroup = summarizeGenericRankingByGroup(fgRankingRows)
  const fgSeason = summarizeGenericSeasonRanking(fgRankingRows, fgByGroup)
  const fgByPosition = summarizeGenericRankingByPosition(fgRankingRows)
  const fgBaselines = summarizeFiveGameweekBaselines([])

  const data: ReportData = {
    generatedAt: new Date('2026-09-02T00:00:00.000Z'),
    season: '2025-2026',
    measured,
    overall: { n: 1, meanAbsoluteError: 1, meanSignedError: 1 },
    byPosition: {
      [GOALKEEPER]: { n: 0, meanAbsoluteError: null, meanSignedError: null },
      [DEFENDER]: { n: 0, meanAbsoluteError: null, meanSignedError: null },
      [MIDFIELDER]: { n: 0, meanAbsoluteError: null, meanSignedError: null },
      [FORWARD]: { n: 1, meanAbsoluteError: 1, meanSignedError: 1 },
    } as Record<typeof GOALKEEPER | typeof DEFENDER | typeof MIDFIELDER | typeof FORWARD, { n: number; meanAbsoluteError: number | null; meanSignedError: number | null }>,
    byGameweek: new Map([[1, { n: 1, meanAbsoluteError: 1, meanSignedError: 1 }]]),
    cleanSheetRateByPosition: { [GOALKEEPER]: null, [DEFENDER]: null, [MIDFIELDER]: null, [FORWARD]: null },
    sanity: { ok: true, failures: [] },
    exclusions: emptyExclusionCounts(),
    positionResolution: emptyPositionResolutionCounts(),
    defconSource: emptyDefconSourceCounts(),
    recentMinutesSource: emptyRecentMinutesSourceCounts(),
    recentMinutesWindowLengthDistribution: emptyRecentMinutesWindowLengthDistribution(),
    featureHistoryRowsRead: 1,
    actualRowsMatched: 1,
    playersRowCount: 1,
    matchStatsRowCount: 1,
    multiFixtureByGameweek: new Map(),
    multiFixtureDiagnostic: buildMultiFixtureDiagnostic(measured),
    defconBuckets: bucketByPriorMatches(measured, defconSignedError),
    overallBuckets: bucketByPriorMatches(measured, (r) => r.signedError),
    rankingSeason: { n: 1, spearman: null, top10: { overlap: 0, n: 0 }, top20: { overlap: 0, n: 0 } },
    rankingByPosition: summarizeRankingByPosition(measured),
    rankingByGameweek: summarizeRankingByGameweek(measured),
    rankingSanity: { ok: true, failures: [] },
    baselines: summarizeBaselines(measured),
    baselineVerdicts: buildBaselineVerdicts(null, summarizeBaselines(measured)),
    rankingByGameweekAndPosition: summarizeRankingByGameweekAndPosition(measured),
    fixtureCoverage: { realFixture: 1, neutralFallback: 0 },
    fiveGameweek: {
      lastGameweekInData: 38,
      candidateCount: 1,
      measuredCount: 0,
      exclusions: emptyFiveGameweekExclusionCounts(),
      clubSchedule: { legsWithScheduleFixture: 12, legsBlankGameweek: 3, legsDidNotFeatureButClubHadFixture: 5 },
      season: fgSeason,
      byPosition: fgByPosition,
      byStartGameweek: fgByGroup,
      baselines: fgBaselines,
      baselineVerdicts: buildBaselineVerdicts(fgSeason.spearman, fgBaselines),
      oracleOneGw: { season: fgSeason, byPosition: fgByPosition, insufficientData: 0 },
      oracleFiveGw: { season: fgSeason, byPosition: fgByPosition, insufficientData: 0 },
      oracleCeiling: { ok: true, failures: [] },
      oneGwNeutralFixtureModel: { season: fgSeason, byPosition: fgByPosition },
      preTicket191Minutes: {
        oneGw: { season: fgSeason, byPosition: fgByPosition },
        fiveGw: { season: fgSeason, byPosition: fgByPosition },
      },
    },
  }

  it('starts with the exact pre-#183 report content, then continues with the new Five-gameweek section', () => {
    const output = generateReportMarkdown(data)
    expect(output.startsWith(PRE_TICKET_183_REPORT)).toBe(true)
    expect(output).toContain('\n\n## Five-gameweek ranking (ticket #183)')
  })

  it('every pre-#183 section header still appears, in the same order, before the new section', () => {
    const output = generateReportMarkdown(data)
    const preTicketHeaders = [...PRE_TICKET_183_REPORT.matchAll(/^#{1,3} .+$/gm)].map((m) => m[0])
    const outputHeaders = [...output.matchAll(/^#{1,3} .+$/gm)].map((m) => m[0])
    expect(outputHeaders.slice(0, preTicketHeaders.length)).toEqual(preTicketHeaders)
    expect(outputHeaders.length).toBeGreaterThan(preTicketHeaders.length)
  })

  // Ticket #187 — appended strictly after the five-gameweek section (see
  // generateReportMarkdown's own final two pushes). Everything through the
  // end of the five-gameweek section stays byte-identical (proven above);
  // this only proves the #187 additions exist, in the right relative order.
  it('appends the oracle-ceiling check and the minutes-evidence section after the five-gameweek section, in that order', () => {
    const output = generateReportMarkdown(data)
    const fiveGwHeaderIndex = output.indexOf('\n\n## Five-gameweek ranking (ticket #183)')
    const ceilingIndex = output.indexOf('### Oracle-ceiling check: PASSED')
    const minutesIndex = output.indexOf('## Minutes evidence (ticket #187)')
    expect(fiveGwHeaderIndex).toBeGreaterThan(-1)
    expect(ceilingIndex).toBeGreaterThan(fiveGwHeaderIndex)
    expect(minutesIndex).toBeGreaterThan(ceilingIndex)
    expect(output).toContain(`window (ticket #185/#187): ${data.recentMinutesSource.fromStoredWindow}`)
    expect(output).toContain(`read as suspect): ${data.recentMinutesSource.fromAveragedFallback}`)
  })

  it('prints the three club-schedule fixture counters and the new unresolvedTeamCode exclusion line (ticket #193)', () => {
    const output = generateReportMarkdown(data)
    expect(output).toContain('### Club-schedule fixture diagnostics (ticket #193)')
    expect(output).toContain(`came from the club schedule (the schedule had at least one entry that gameweek): ${data.fiveGameweek.clubSchedule.legsWithScheduleFixture}`)
    expect(output).toContain(`a legitimate zero on both sides, never a defect): ${data.fiveGameweek.clubSchedule.legsBlankGameweek}`)
    expect(output).toContain(`**this is the exact size of the leak this ticket closes**: ${data.fiveGameweek.clubSchedule.legsDidNotFeatureButClubHadFixture}`)
    // The approximation is stated in the report itself, not only in the code.
    expect(output).toContain('reconstructed from matches that were actually PLAYED')
    // And the new exclusion reason reconciles by name alongside the others.
    expect(output).toContain(`had no \`team_code\` (ticket #193`)
  })

  it('prints the ticket #197 neutral-fixture diagnostic, after the oracle-ceiling check, never as a check or assertion', () => {
    const output = generateReportMarkdown(data)
    const ceilingIndex = output.indexOf('### Oracle-ceiling check: PASSED')
    const diagnosticIndex = output.indexOf('### Diagnostic (ticket #197): one-gameweek model with every fixture forced neutral')
    expect(diagnosticIndex).toBeGreaterThan(ceilingIndex)
    expect(output).toContain('REPORTED ONLY — never a check, never gates this report, never asserted')
    // fgSeason is built from an empty rows array (spearman null with <2 pairs) — same 'n/a' formatting fmtSpearman uses throughout this file.
    expect(output).toContain('season: Spearman **n/a**')
  })

  it('prints the ticket #201, Part 2 pre-#191-minutes section as its OWN, visually separate section after the #197 diagnostic — never merged with Part 1\'s oracle-ceiling change', () => {
    const output = generateReportMarkdown(data)
    const diagnosticIndex = output.indexOf('### Diagnostic (ticket #197): one-gameweek model with every fixture forced neutral')
    const part2Index = output.indexOf('## Ticket #201, Part 2: the pre-#191 minutes model, reconstructed for comparison')
    expect(part2Index).toBeGreaterThan(diagnosticIndex)
    expect(output).toContain('REPORTED ONLY — never a check, never gates this report, never asserted')
    expect(output).toContain('src/lib/projection/minutes.ts` itself is untouched')
    expect(output.indexOf('### One-gameweek horizon')).toBeGreaterThan(part2Index)
    expect(output.indexOf('### Five-gameweek horizon')).toBeGreaterThan(output.indexOf('### One-gameweek horizon'))
  })

  it('the ticket #201, Part 2 section reads its figures from data.fiveGameweek.preTicket191Minutes, at both horizons, alongside the shipped model and the naive minutes baseline for comparison', () => {
    const output = generateReportMarkdown(data)
    // fgSeason (reused for every ranking summary in this fixture, per this
    // describe block's own setup) is built from an empty rows array — n=0,
    // spearman null — so every occurrence below reads 'n/a', proving the
    // section reads the right field rather than always printing a fixed string.
    const part2Index = output.indexOf('## Ticket #201, Part 2: the pre-#191 minutes model, reconstructed for comparison')
    const part2Section = output.slice(part2Index)
    expect(part2Section).toContain('pre-#191 minutes model, season: Spearman **n/a** (n=0)')
    expect(part2Section).toContain('the shipped model above scores **n/a**')
    expect(part2Section).toContain('"prior minutes per match" baseline above scores **n/a**')
  })

  it('the oracle-ceiling check reports FAILED, with its failure text, when oracleCeiling.ok is false', () => {
    const failingData: ReportData = {
      ...data,
      fiveGameweek: {
        ...data.fiveGameweek,
        oracleCeiling: { ok: false, failures: ['five-gameweek quality oracle (Spearman 0.507) does not sit above the model (0.672) — same reasoning as the one-gameweek check above.'] },
      },
    }
    const output = generateReportMarkdown(failingData)
    expect(output).toContain('### Oracle-ceiling check: FAILED')
    expect(output).toContain('0.672')
    expect(output).toContain('0.507')
  })
})

const PRE_TICKET_183_REPORT = `# Backtest report — point-in-time projection vs actual

Generated: 2026-09-02T00:00:00.000Z · Job: \`run-backtest\` · Season: \`2025-2026\`

Measures the projection only — no transfers, captaincy, solver, or league position (item 32's remaining work). Every projected figure below is built strictly from \`feature_history\` prior-gameweek totals — no later gameweek, no live current-season data. See \`scripts/run-backtest.ts\`'s file header for the full method and its documented approximations, and \`docs/projection-model-backlog.md\` for what this slice does and does not settle.

## Sanity check: PASSED

Overall mean absolute error and every position's derived clean-sheet rate are within their sane bounds.

## Headline

Measured population: **1** player-gameweek row(s). Mean absolute error: **1.000**. Mean signed error: **1.000** — the model is OVER-projecting by 1.000 points per player-gameweek on average.

## The measured population, and what is excluded

- \`feature_history\` rows read (season=2025-2026): 1
- rows with a matching \`player_match_stats\` actual gameweek entry found: 1
- **rows measured (headline population)**: 1
- excluded — no prior matches (\`prior_matches = 0\`, no point-in-time signal): 0
- excluded — player did not feature this gameweek (a correct zero that would flatter the error): 0
- excluded — blank gameweek (player's team had no fixture at all, ticket #140): 0
- excluded — actual data incomplete (\`team_goals_conceded\` null, ~2% known gap, ticket #125): 0
- excluded — unresolved position (neither \`feature_history.element_type\` nor the \`players\` fallback resolves, ticket #154): 0 (0% of rows read)
- excluded — unresolved fixture teams (own club or the opponent faced could not be resolved, ticket #175 — chiefly mid-season transfers, see that ticket's own note): 0 (0% of rows read)

Reconciliation: 1 measured + 0 excluded = 1, against 1 rows read.

## Fixture coverage (ticket #175)

Before this ticket, every measured row below was projected under a neutral fixture (expectedScore exactly 0.5, every multiplier exactly 1.0) — the harness could not see which team a player faced. This ticket reads \`feature_history.team_code\` (the player's own club) and \`player_match_stats.opponent_team_code\` (the club faced) and builds a point-in-time team-strength table from \`player_match_stats\` rows strictly before the row being projected — see \`scripts/run-backtest.ts\`'s file header for the construction and its SCALE constant. A team below 3 prior matches (a JUDGEMENT call, not derived) falls back to the same neutral expectedScore every row used before this ticket — a genuinely resolvable club with too little history yet, never an unresolved one (which is excluded separately above, never silently defaulted to neutral).

- measured rows that used a real, computed fixture: 1
- measured rows that fell back to the neutral fixture (insufficient prior team history): 0


## Position resolution and defensive-contribution evidence (ticket #154)

Ticket #146 added \`element_type\` and the two per-match defcon counters to \`feature_history\`; this is the first slice to read them. Position resolution is a strict 3-way partition of every row read; defcon-evidence source is a strict 2-way partition of the same population (not only the measured rows below — \`buildDefconMatches\` also runs for excluded rows via the position-prior computation).

- position from \`feature_history.element_type\` (primary source): 0
- position from the \`players\` table fallback (row predates ticket #146): 0
- position unresolved (neither source — excluded as \`unresolvedPlayerCode\` above): 0
- defensive-contribution evidence from stored \`prior_defcon_qualifying_matches\`/\`prior_defcon_hits\` counters: 0
- defensive-contribution evidence from the pre-#154 single-averaged-match fallback (row predates ticket #146): 0


## By position

| Position | n | Mean absolute error | Mean signed error | Derived clean-sheet rate |
|---|---|---|---|---|
| Goalkeeper | 0 | n/a | n/a | n/a |
| Defender | 0 | n/a | n/a | n/a |
| Midfielder | 0 | n/a | n/a | n/a |
| Forward | 1 | 1.000 | 1.000 | n/a |

## By gameweek

A bad week is visible here rather than averaged away into the season figure above. "Multi-fixture rows" is how many of that gameweek's measured player-gameweeks had more than one fixture (ticket #140) — a nonzero value flags a candidate double gameweek.

| Gameweek | n | Mean absolute error | Mean signed error | Multi-fixture rows |
|---|---|---|---|---|
| 1 | 1 | 1.000 | 1.000 | 0 |

## Multi-fixture gameweeks (ticket #140)

Player-gameweeks with more than one fixture: **0** of 1 measured.

- Season headline WITH multi-fixture rows (the figure above): n=1, MAE=1.000, mean signed error=1.000
- Season headline WITHOUT multi-fixture rows: n=1, MAE=1.000, mean signed error=1.000

Excluding multi-fixture player-gameweeks moves the season MAE by 0.000 — within the 0.05 threshold, not a material driver of the headline on its own.

## Defensive-contribution signed error, by prior_matches bucket (ticket #140)

Full-season calibration can look correct while point-in-time estimation shrinks hard toward the position prior early in a player's history — this table is what tells a cold-start problem (shrinks toward 0 as the bucket rises) apart from a level problem (stays flat). A bucket under 50 measured rows is reported as "too small to read", never as a number nobody checked.

| prior_matches | n | Mean signed error |
|---|---|---|
| 1–4 | 0 | too small to read |
| 5–9 | 1 | too small to read |
| 10–19 | 0 | too small to read |
| 20+ | 0 | too small to read |

## Overall signed error, by prior_matches bucket (ticket #140)

The same bucketing applied to the overall signed error, for comparison against the defcon-only breakdown above.

| prior_matches | n | Mean signed error |
|---|---|---|
| 1–4 | 0 | too small to read |
| 5–9 | 1 | too small to read |
| 10–19 | 0 | too small to read |
| 20+ | 0 | too small to read |

## By component

Mean actual vs mean projected per component, across the measured population — attributes a gap in the headline to a specific term rather than leaving it only visible in aggregate. Bonus is absent from both sides (see file header) rather than shown as an always-zero row.

| Component | Mean actual | Mean projected | Mean signed error |
|---|---|---|---|
| Appearance | 2.000 | 2.000 | 0.000 |
| Goals | 0.000 | 0.000 | 0.000 |
| Assists | 0.000 | 0.000 | 0.000 |
| Clean sheets | 0.000 | 0.000 | 0.000 |
| Goals conceded | 0.000 | 0.000 | 0.000 |
| Saves | 0.000 | 0.000 | 0.000 |
| Defensive contribution | 0.000 | 0.000 | 0.000 |

## Ranking skill (ticket #147)

The metrics above measure how close the model's numbers are; this measures whether it puts the right players at the top — the only thing a recommendation actually depends on (the captain IS the squad's top-projected player; a transfer IS a claim one player will outscore another). Same measured population as above, no new Supabase read. **Spearman rank correlation** ranks projected and actual points among the same set of rows (tied values share the average rank they would occupy) and reports how well the two orderings agree — 1 is perfect agreement, −1 is perfect reversal, 0 is no relationship. **Top-N overlap** is closer to what the app actually does: of the players ranked in the model's top 10 (or top 20) that gameweek, how many were also in the actual top 10 (or top 20). See \`docs/projection-model-backlog.md\` for what this section does and does not settle — no conclusion about whether the ranking is good is drawn here.

### Ranking sanity check: PASSED

The season aggregate and every position's Spearman correlation and top-10 overlap are within their sane bounds.

### Season aggregate

- Spearman rank correlation: **n/a** (n=1)
- Top-10 overlap: **n/a**
- Top-20 overlap: **n/a**

Top-10/20 figures are summed across every gameweek with at least 50 measured rows (the same threshold the by-gameweek table below applies) — a season-wide overlap RATE, not a single top-10 selected from the whole season pooled together.

### By position

A captain is chosen across positions, but a transfer is usually within one — Spearman is pooled across the whole season for that position (like the by-position table above); top-N overlap is summed across every gameweek that position appears in, uncapped by the 50-row gameweek gate (a per-gameweek goalkeeper population is often under 50 by construction).

| Position | n | Spearman | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| Goalkeeper | 0 | n/a | n/a | n/a |
| Defender | 0 | n/a | n/a | n/a |
| Midfielder | 0 | n/a | n/a | n/a |
| Forward | 1 | n/a | too small to read | too small to read |

### By gameweek

A gameweek with fewer than 50 measured rows is reported "too small to read" rather than as a correlation nobody could trust.

| Gameweek | n | Spearman | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| 1 | 1 | too small to read | too small to read | too small to read |

### By gameweek × position (ticket #159, Defect 3)

The finest grain this report prints — the only place the Defender/Midfielder identical-overlap observation noted in this ticket's decisions file is distinguishable on the next run (not asserted as a bug here). Not gated by the 50-row gameweek threshold above (a per-gameweek, per-position population, goalkeepers especially, is routinely under 50 by construction); IS gated by the top-N-meaningfulness check directly below.

| Gameweek | Position | n | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| 1 | Goalkeeper | 0 | n/a | n/a |
| 1 | Defender | 0 | n/a | n/a |
| 1 | Midfielder | 0 | n/a | n/a |
| 1 | Forward | 1 | too small to read | too small to read |

## Naive ranking baselines (ticket #159, Defect 1)

The season Spearman above has no comparator on its own — an absolute band was previously asserted from general intuition, not derived from anything about weekly FPL scoring. These three baselines are computed over the EXACT SAME measured population as the model's own ranking above (no separate population, no second Supabase read, and never \`players.now_cost\` — a 2026/27 price would be both a cross-season mismatch and a lookahead against these 2025/26 gameweeks). A model with real skill should beat them; one that does not is decoration, not signal.

- **Prior minutes per match** (\`prior_minutes / prior_matches\`) — the player who has played the most, stays.
- **Prior xG+xA per match** (\`(prior_xg + prior_xa) / prior_matches\`) — the player with the best underlying attacking numbers, stays.
- **Constant (zero-skill floor)** — every row ranked identically; the zero-skill floor, and a self-test of the correlation code itself (an implementation that scores a constant ranking WELL, rather than at exactly 0, is broken — see \`computeConstantBaselineSpearman\`).

| Ranking | Season | Goalkeeper | Defender | Midfielder | Forward |
|---|---|---|---|---|---|
| Model (projection) | n/a | n/a | n/a | n/a | n/a |
| Prior minutes per match | n/a | n/a | n/a | n/a | n/a |
| Prior xG+xA per match | n/a | n/a | n/a | n/a | n/a |
| Constant (zero-skill floor) | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |

### Verdict — model Spearman minus each baseline's (season aggregate)

A DIFFERENCE, never checked against an asserted threshold (ticket text) — the report states the number and stops there.

- Model (n/a) minus Prior minutes per match (n/a) = **n/a**
- Model (n/a) minus Prior xG+xA per match (n/a) = **n/a**
- Model (n/a) minus Constant (zero-skill floor) (0.000) = **n/a**

## Provenance

- players rows fetched: 1
- feature_history rows fetched (season=2025-2026): 1
- player_match_stats rows fetched (season=2025-2026, competition=prem): 1
- sanity bounds: mean absolute error in [1, 3.5]; derived clean-sheet rate ≤ 60% per position
- ranking sanity bounds (#147, extended by #159 to top-20): Spearman rank correlation in [-0.2, 0.9]; top-10 AND top-20 overlap ≤ 90%, at the season aggregate and every position
- top-N meaningfulness threshold (#159): a top-N figure is refused ("too small to read") when N exceeds 75% of the population it was drawn from — a judgement, not a derived bound

`


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

  it(
    'imports minutes.ts (availabilityFactor, NO_HISTORY_BASELINE_*) rather than redeclaring them — ticket #201, ' +
      "Part 2's pre-#191 reconstruction reuses the pieces #191 left unchanged, never re-derives them, and never " +
      "forks src/lib/projection/minutes.ts itself",
    () => {
      expect(source).toMatch(/from ['"]\.\.\/src\/lib\/projection\/minutes\.ts['"]/)
      expect(source).toMatch(/availabilityFactor/)
      expect(source).toMatch(/NO_HISTORY_BASELINE_MINUTES/)
      expect(source).toMatch(/NO_HISTORY_BASELINE_SIXTY_PLUS_RATE/)
    },
  )

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
    // Ticket #175 extended this select list with team_code/opponent_team_code
    // (the fixture-identity columns) — updated here, the one exact-string
    // test this ticket's own required scope change could not leave
    // unmodified (every other pre-#175 test in this file is untouched).
    expect(source).toMatch(
      /'player_code, match_id, gameweek, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries, team_code, opponent_team_code'/,
    )
    // A bare "goals_conceded" column in a select list (comma-delimited, not
    // prefixed by "team_") would appear as ", goals_conceded," or end a
    // select string as ", goals_conceded'" — neither pattern occurs.
    expect(source).not.toMatch(/,\s*goals_conceded\s*[,']/)
  })

  it('ticket #175: feature_history select also reads team_code, the player\'s own club', () => {
    expect(source).toMatch(/'gameweek_id, player_code, element_type, team_code, prior_matches/)
  })

  it('ticket #187: feature_history select also reads prior_recent_minutes, the #185 stored last-five-match window', () => {
    expect(source).toMatch(/prior_defcon_qualifying_matches, prior_defcon_hits, prior_recent_minutes'/)
  })

  it('selects match_id from player_match_stats — ticket #140, team-slug inference for blank-gameweek detection only, never used for point reconstruction', () => {
    expect(source).toMatch(/match_id/)
  })
})

describe('run-backtest.ts — the five-gameweek window reads model state at G, fixtures at G+i (the G13 lookahead fix)', () => {
  // A shape test, not a behaviour test: the unit tests above prove the
  // behaviour, this proves nobody reintroduced the leak by editing the three
  // lookups back to the leg's own gameweek. See docs/projection-model-backlog.md G13.
  const fn = source.slice(source.indexOf('export function projectAndReconstructWindowGameweek'), source.indexOf('export interface FiveGameweekRow'))

  it('takes both gameweeks under names that cannot be confused', () => {
    expect(fn).toMatch(/featureGameweekId: number/)
    expect(fn).toMatch(/legGameweekId: number/)
  })

  it('all three point-in-time lookups key on featureGameweekId — the window\'s START', () => {
    expect(fn).toMatch(/featureHistoryByPlayerGameweek\.get\(windowKey\(playerCode, featureGameweekId\)\)/)
    expect(fn).toMatch(/positionPriors\.get\(positionPriorKey\(featureGameweekId, position\)\)/)
    const strengthCalls = fn.match(/computeTeamStrengthAsOf\([^)]*\)/g) ?? []
    expect(strengthCalls.length).toBe(2) // own club and opponent
    for (const call of strengthCalls) expect(call).toMatch(/featureGameweekId\s*\)$/)
  })

  it('no MODEL-STATE lookup keys on legGameweekId — the leg reaches the projection only through its published fixture and its actual outcome', () => {
    expect(fn).not.toMatch(/windowKey\(playerCode, legGameweekId\)/)
    expect(fn).not.toMatch(/positionPriorKey\(legGameweekId/)
    expect(fn).not.toMatch(/computeTeamStrengthAsOf\([^)]*legGameweekId/)
  })

  it('classifyFiveGameweekRow passes the window\'s start gameweek as featureGameweekId, the leg\'s as legGameweekId', () => {
    expect(source).toMatch(/projectAndReconstructWindowGameweek\(\s*\n\s*playerCode,\s*\n\s*startRow\.gameweekId,\s*\n\s*gameweekId,/)
  })

  // Ticket #193 — the second leak. The leg's FIXTURE (count and opponents)
  // is the one thing that must key on legGameweekId, and it must come from
  // the club schedule rather than the player's own matched rows.
  it('the leg\'s fixture comes from the club schedule, keyed on the LEG\'s own gameweek (ticket #193)', () => {
    expect(fn).toMatch(/lookupClubFixtureSchedule\(clubFixtureSchedule, row\.team_code, legGameweekId\)/)
  })

  it('matchesFound appears nowhere in the arguments to projectRow inside this function — the leak that told the model which weeks the player would miss', () => {
    const projectRowCalls = fn.match(/projectRow\([^)]*\)/g) ?? []
    expect(projectRowCalls.length).toBe(1)
    for (const call of projectRowCalls) expect(call).not.toMatch(/matchesFound/)
    expect(fn).toMatch(/projectRow\(row, position, prior, fixtureCount, fixtureExpectedScores\)/)
  })

  it('the fixture opponents are never read off actualRows any more — that array supplies the leg\'s actual points and nothing else', () => {
    expect(fn).not.toMatch(/actualRows\.map\(\(r\) => r\.opponent_team_code\)/)
    // The one remaining use of actualRows: reconstructing the actual side.
    const actualRowsUses = fn.match(/actualRows\.[a-zA-Z]+\(/g) ?? []
    expect(actualRowsUses).toEqual(['actualRows.map('])
    expect(fn).toMatch(/actualRows\.map\(toActualMatchStatsInput\)/)
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
