// Unit tests for scripts/build-training-features.ts and its migration —
// ticket #203. No live Supabase project: every DoD item provable without a
// database is proven here on constructed rows — the strictly-before
// boundary (both directions, for the one genuinely new computation this
// file adds), the "no row for prior_matches = 0" admission rule, and the
// arithmetic reconciliations. What this file cannot prove — that a real run
// against 18,588 feature_history rows and 15,000+ player_match_stats rows
// produces a sane row count and reconciles at that scale — is exactly the
// ticket's own named human check after merge.

import { describe, expect, it } from 'vitest'
import {
  buildTrainingFeatures,
  computePriorShotsOnTarget,
  computeRatePer90,
  computeSeasonAvgMinutes,
  DEFAULT_SEASON,
  resolveOpponentTeamCodes,
  resolveTeamStrength,
  type FeatureHistorySourceRow,
  type MatchStatsSourceRow,
} from './build-training-features.ts'
import { buildClubFixtureSchedule, buildTeamMatchRecords, type TeamMatchRecord } from './run-backtest.ts'

const SEASON = '2025-2026'
const COMPUTED_AT = '2026-09-04T09:00:00.000Z'

/** A fully-specified feature_history row, with every field distinguishable so a test can tell which row is which. */
function fhRow(playerCode: number, gameweekId: number, overrides: Partial<FeatureHistorySourceRow> = {}): FeatureHistorySourceRow {
  return {
    gameweek_id: gameweekId,
    player_code: playerCode,
    element_type: 3,
    team_code: 10,
    prior_matches: 1,
    prior_minutes: 90,
    prior_xg: 0.5,
    prior_xa: 0.3,
    prior_recent_minutes: [90],
    prior_defcon_qualifying_matches: 1,
    prior_defcon_hits: 0,
    ...overrides,
  }
}

/** A fully-specified player_match_stats row (already Premier-League-only — this job's own query filters at that level). */
function msRow(playerCode: number, gameweek: number, overrides: Partial<MatchStatsSourceRow> = {}): MatchStatsSourceRow {
  return {
    player_code: playerCode,
    match_id: `m-${playerCode}-${gameweek}`,
    gameweek,
    shots_on_target: 1,
    team_code: 10,
    opponent_team_code: 20,
    team_goals_conceded: 1,
    ...overrides,
  }
}

// ============================================================================
// computePriorShotsOnTarget — the strictly-before rule, the one genuinely
// new accumulation in this file. Both off-by-one directions, matching
// build-feature-history.test.ts's own convention for feature_history.
// ============================================================================

describe('computePriorShotsOnTarget — strictly-before rule', () => {
  it('the total for gameweek 3 contains gameweeks 1 and 2 only, never gameweek 3 itself', () => {
    const matches = [
      msRow(100, 1, { shots_on_target: 1 }),
      msRow(100, 2, { shots_on_target: 2 }),
      msRow(100, 3, { shots_on_target: 100 }), // if this leaked in, the total would be 103
    ]
    expect(computePriorShotsOnTarget(matches, 3)).toBe(3)
  })

  it('the total for gameweek 2 contains gameweek 1 only, not gameweek 2', () => {
    const matches = [msRow(100, 1, { shots_on_target: 1 }), msRow(100, 2, { shots_on_target: 2 })]
    expect(computePriorShotsOnTarget(matches, 2)).toBe(1)
  })

  it('a null shots_on_target cell contributes 0, never skipped as if the match did not happen', () => {
    const matches = [msRow(100, 1, { shots_on_target: null }), msRow(100, 2, { shots_on_target: 2 })]
    expect(computePriorShotsOnTarget(matches, 3)).toBe(2)
  })

  it('an empty match list returns 0, not an error', () => {
    expect(computePriorShotsOnTarget([], 5)).toBe(0)
  })
})

// ============================================================================
// computeRatePer90 / computeSeasonAvgMinutes — pure arithmetic, plus the
// division-by-zero guards.
// ============================================================================

describe('computeRatePer90', () => {
  it('a normal case: total 4.5 over 5 nineties (450 minutes) is 0.9 per 90', () => {
    expect(computeRatePer90(4.5, 450)).toBeCloseTo(0.9, 10)
  })

  it('zero minutes returns null, never a fabricated 0 or a divide-by-zero NaN/Infinity', () => {
    expect(computeRatePer90(0, 0)).toBeNull()
    expect(computeRatePer90(5, 0)).toBeNull()
  })

  it('negative minutes (defensive — should never occur) also returns null rather than a negative rate', () => {
    expect(computeRatePer90(5, -10)).toBeNull()
  })
})

describe('computeSeasonAvgMinutes', () => {
  it('a normal case: 270 minutes over 3 matches is 90 per match', () => {
    expect(computeSeasonAvgMinutes(270, 3)).toBe(90)
  })

  it('zero matches returns null, not a divide-by-zero', () => {
    expect(computeSeasonAvgMinutes(0, 0)).toBeNull()
  })
})

// ============================================================================
// resolveTeamStrength / resolveOpponentTeamCodes — the null-team_code guard
// around the reused, unmodified scripts/run-backtest.ts functions.
// ============================================================================

describe('resolveTeamStrength', () => {
  const records: TeamMatchRecord[] = [
    { matchId: 'm1', gameweek: 1, teamCode: 10, goalsScored: 2, goalsConceded: 1 },
    { matchId: 'm2', gameweek: 2, teamCode: 10, goalsScored: 0, goalsConceded: 0 },
  ]

  it('a null teamCode returns the same all-zero shape computeTeamStrengthAsOf gives an unresolvable club, never throws', () => {
    expect(resolveTeamStrength(records, null, 5)).toEqual({ matches: 0, goalsScored: 0, goalsConceded: 0 })
  })

  it('a resolved teamCode delegates to computeTeamStrengthAsOf, strictly before the given gameweek', () => {
    expect(resolveTeamStrength(records, 10, 2)).toEqual({ matches: 1, goalsScored: 2, goalsConceded: 1 })
    expect(resolveTeamStrength(records, 10, 3)).toEqual({ matches: 2, goalsScored: 2, goalsConceded: 1 })
  })
})

describe('resolveOpponentTeamCodes', () => {
  const schedule = buildClubFixtureSchedule([
    { matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: null },
    { matchId: 'm2', gameweek: 5, teamCode: 10, opponentTeamCode: 30, teamGoalsConceded: null }, // double gameweek
  ])

  it('a null teamCode returns [], never throws', () => {
    expect(resolveOpponentTeamCodes(schedule, null, 5)).toEqual([])
  })

  it('a double gameweek returns both opponents', () => {
    expect(resolveOpponentTeamCodes(schedule, 10, 5)).toEqual([20, 30])
  })

  it('a gameweek with no scheduled fixture returns [] — the blank-gameweek case', () => {
    expect(resolveOpponentTeamCodes(schedule, 10, 6)).toEqual([])
  })
})

// ============================================================================
// buildTrainingFeatures — the integration-level guarantees the DoD names
// explicitly.
// ============================================================================

describe('buildTrainingFeatures — no row for prior_matches = 0 (unlike feature_history)', () => {
  it('a feature_history row with prior_matches = 0 produces no training_features row at all — not a row of zeros/nulls', () => {
    const result = buildTrainingFeatures([fhRow(100, 1, { prior_matches: 0, prior_minutes: 0, prior_xg: 0, prior_xa: 0 })], [], SEASON, COMPUTED_AT)
    expect(result.rows).toHaveLength(0)
    expect(result.rowsExcludedNoPriorMatches).toBe(1)
  })

  it('a feature_history row with prior_matches > 0 produces exactly one row', () => {
    const result = buildTrainingFeatures([fhRow(100, 3, { prior_matches: 2 })], [], SEASON, COMPUTED_AT)
    expect(result.rows).toHaveLength(1)
    expect(result.rowsExcludedNoPriorMatches).toBe(0)
  })
})

describe('buildTrainingFeatures — strictly-before rule, end to end', () => {
  it('the row for gameweek 5 carries prior_shots_on_target and team_strength built only from matches strictly before gameweek 5', () => {
    const featureHistoryRows = [fhRow(100, 5, { prior_matches: 2, team_code: 10 })]
    // Both sides of each match share the SAME match_id — buildTeamMatchRecords
    // resolves goalsScored by looking up the opponent's own row under the
    // identical matchId, so a real fixture's two rows must agree on it (a
    // mismatched match_id here would silently make the match unresolvable).
    const matchStatsRows = [
      msRow(100, 1, { match_id: 'gw1', shots_on_target: 1, team_code: 10, opponent_team_code: 20, team_goals_conceded: 0 }),
      msRow(200, 1, { match_id: 'gw1', shots_on_target: 0, team_code: 20, opponent_team_code: 10, team_goals_conceded: 3 }),
      msRow(100, 2, { match_id: 'gw2', shots_on_target: 2, team_code: 10, opponent_team_code: 20, team_goals_conceded: 0 }),
      msRow(200, 2, { match_id: 'gw2', shots_on_target: 0, team_code: 20, opponent_team_code: 10, team_goals_conceded: 1 }),
      // Gameweek 5's own match — must NOT be folded into the row for gameweek 5.
      msRow(100, 5, { match_id: 'gw5', shots_on_target: 999, team_code: 10, opponent_team_code: 30, team_goals_conceded: 0 }),
      msRow(300, 5, { match_id: 'gw5', shots_on_target: 0, team_code: 30, opponent_team_code: 10, team_goals_conceded: 5 }),
    ]

    const result = buildTrainingFeatures(featureHistoryRows, matchStatsRows, SEASON, COMPUTED_AT)
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]

    // Direction 1: gameweek 5's own 999-shots match is excluded.
    expect(row.prior_shots_on_target).toBe(3) // 1 + 2, never + 999
    expect(row.prior_shots_on_target).not.toBe(3 + 999)

    // Direction 2: both prior gameweeks (1 and 2) are included, not just the
    // immediately preceding one. Team 10 conceded 0 both matches
    // (goalsConceded = 0+0) and scored what team 20 conceded each match
    // (3 in gw1, 1 in gw2 -> goalsScored = 4) — gameweek 5's own 5-goal
    // match against team 30 must NOT be in either total.
    expect(row.team_strength_matches).toBe(2)
    expect(row.team_strength_goals_scored).toBe(4)
    expect(row.team_strength_goals_conceded).toBe(0)

    // Gameweek 5's own opponent (team 30) IS surfaced — that is schedule
    // identity for gameweek_id itself, not prior-gameweek form (see
    // migration file header, "OPPONENT IDENTITY IS SCHEDULE, NOT RESULT").
    expect(row.opponent_team_codes).toEqual([30])
  })

  it('team_strength_goals_scored/conceded reconcile against an independently-built TeamMatchRecord set for the same rows', () => {
    const matchStatsRows = [
      msRow(100, 1, { match_id: 'gw1', team_code: 10, opponent_team_code: 20, team_goals_conceded: 2 }),
      msRow(200, 1, { match_id: 'gw1', team_code: 20, opponent_team_code: 10, team_goals_conceded: 1 }),
    ]
    const featureHistoryRows = [fhRow(100, 2, { prior_matches: 1, team_code: 10 })]
    const result = buildTrainingFeatures(featureHistoryRows, matchStatsRows, SEASON, COMPUTED_AT)

    const independentRecords = buildTeamMatchRecords(
      matchStatsRows.map((r) => ({ matchId: r.match_id, gameweek: r.gameweek, teamCode: r.team_code, opponentTeamCode: r.opponent_team_code, teamGoalsConceded: r.team_goals_conceded })),
    )
    const team10Record = independentRecords.find((r) => r.teamCode === 10)!

    expect(result.rows[0].team_strength_goals_scored).toBe(team10Record.goalsScored)
    expect(result.rows[0].team_strength_goals_conceded).toBe(team10Record.goalsConceded)
  })
})

describe('buildTrainingFeatures — pass-through columns copied verbatim from feature_history', () => {
  it('element_type, team_code, prior_recent_minutes, and the two defcon counters are copied unchanged, including null', () => {
    const featureHistoryRows = [
      fhRow(100, 3, {
        prior_matches: 2,
        element_type: 4,
        team_code: 55,
        prior_recent_minutes: [90, 45],
        prior_defcon_qualifying_matches: 2,
        prior_defcon_hits: 1,
      }),
      fhRow(200, 3, {
        prior_matches: 1,
        element_type: null,
        team_code: null,
        prior_recent_minutes: null,
        prior_defcon_qualifying_matches: null,
        prior_defcon_hits: null,
      }),
    ]
    const result = buildTrainingFeatures(featureHistoryRows, [], SEASON, COMPUTED_AT)
    const row100 = result.rows.find((r) => r.player_code === 100)!
    const row200 = result.rows.find((r) => r.player_code === 200)!

    expect(row100.element_type).toBe(4)
    expect(row100.team_code).toBe(55)
    expect(row100.prior_recent_minutes).toEqual([90, 45])
    expect(row100.prior_defcon_qualifying_matches).toBe(2)
    expect(row100.prior_defcon_hits).toBe(1)

    expect(row200.element_type).toBeNull()
    expect(row200.team_code).toBeNull()
    expect(row200.prior_recent_minutes).toBeNull()
    expect(row200.prior_defcon_qualifying_matches).toBeNull()
    expect(row200.prior_defcon_hits).toBeNull()
    // A null team_code still resolves to the honest zero shape, never a guess.
    expect(row200.team_strength_matches).toBe(0)
    expect(row200.opponent_team_codes).toEqual([])
  })
})

describe('buildTrainingFeatures — rates computed from feature_history totals', () => {
  it('xg_rate_per90/xa_rate_per90/season_avg_minutes are derived, not copied', () => {
    const result = buildTrainingFeatures([fhRow(100, 3, { prior_matches: 2, prior_minutes: 180, prior_xg: 1.8, prior_xa: 0.9 })], [], SEASON, COMPUTED_AT)
    const row = result.rows[0]
    expect(row.xg_rate_per90).toBeCloseTo(0.9, 10) // 1.8 / (180/90)
    expect(row.xa_rate_per90).toBeCloseTo(0.45, 10)
    expect(row.season_avg_minutes).toBe(90) // 180 / 2
  })

  it('prior_matches > 0 but prior_minutes = 0 (every prior row an unused-substitute cameo) — rates are null, never a fabricated 0', () => {
    const result = buildTrainingFeatures([fhRow(100, 3, { prior_matches: 2, prior_minutes: 0, prior_xg: 0, prior_xa: 0 })], [], SEASON, COMPUTED_AT)
    const row = result.rows[0]
    expect(row.xg_rate_per90).toBeNull()
    expect(row.xa_rate_per90).toBeNull()
    // season_avg_minutes is still a real, honest 0 — prior_matches > 0 so the
    // division is well-defined; a 0-minute average is a true fact here.
    expect(row.season_avg_minutes).toBe(0)
  })
})

// ============================================================================
// The counters reconcile arithmetically — the DoD's own named requirement.
// ============================================================================

describe('buildTrainingFeatures — counters reconcile', () => {
  it('featureHistoryRowsRead === rowsWritten + rowsExcludedNoPriorMatches', () => {
    const featureHistoryRows = [
      fhRow(100, 1, { prior_matches: 0 }),
      fhRow(100, 2, { prior_matches: 1 }),
      fhRow(200, 1, { prior_matches: 0 }),
      fhRow(200, 2, { prior_matches: 0 }),
      fhRow(300, 5, { prior_matches: 4 }),
    ]
    const result = buildTrainingFeatures(featureHistoryRows, [], SEASON, COMPUTED_AT)
    expect(result.featureHistoryRowsRead).toBe(5)
    expect(result.rowsExcludedNoPriorMatches).toBe(3)
    expect(result.rowsWritten).toBe(2)
    expect(result.featureHistoryRowsRead).toBe(result.rowsWritten + result.rowsExcludedNoPriorMatches)
  })

  it('matchStatsRowsRead accounts for every row, whether or not player_code resolved', () => {
    const matchStatsRows = [msRow(100, 1), msRow(100, 2, { player_code: null }), msRow(200, 1, { player_code: null })]
    const result = buildTrainingFeatures([], matchStatsRows, SEASON, COMPUTED_AT)
    expect(result.matchStatsRowsRead).toBe(3)
    expect(result.matchStatsRowsWithUnresolvedPlayerCode).toBe(2)
  })

  it('rowsWithScheduledFixture + rowsWithBlankGameweek === rowsWritten', () => {
    const featureHistoryRows = [
      fhRow(100, 5, { prior_matches: 1, team_code: 10 }), // has a gameweek-5 fixture below
      fhRow(200, 5, { prior_matches: 1, team_code: 99 }), // no gameweek-5 fixture for team 99 at all
    ]
    const matchStatsRows = [msRow(100, 5, { team_code: 10, opponent_team_code: 20 }), msRow(999, 5, { team_code: 20, opponent_team_code: 10 })]
    const result = buildTrainingFeatures(featureHistoryRows, matchStatsRows, SEASON, COMPUTED_AT)
    expect(result.rowsWritten).toBe(2)
    expect(result.rowsWithScheduledFixture).toBe(1)
    expect(result.rowsWithBlankGameweek).toBe(1)
    expect(result.rowsWithScheduledFixture + result.rowsWithBlankGameweek).toBe(result.rowsWritten)
  })

  it('rowsWithXgRate/rowsWithXaRate count only rows with a real (non-null) rate', () => {
    const featureHistoryRows = [
      fhRow(100, 3, { prior_matches: 1, prior_minutes: 90, prior_xg: 0.5, prior_xa: 0.3 }),
      fhRow(200, 3, { prior_matches: 1, prior_minutes: 0, prior_xg: 0, prior_xa: 0 }),
    ]
    const result = buildTrainingFeatures(featureHistoryRows, [], SEASON, COMPUTED_AT)
    expect(result.rowsWithXgRate).toBe(1)
    expect(result.rowsWithXaRate).toBe(1)
  })
})

// ============================================================================
// DEFAULT_SEASON — sanity, matching build-feature-history.ts's own default.
// ============================================================================

describe('DEFAULT_SEASON', () => {
  it('is 2025-2026, matching every other season-scoped job\'s own default', () => {
    expect(DEFAULT_SEASON).toBe('2025-2026')
  })
})
