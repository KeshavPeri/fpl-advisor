// Unit tests for scripts/preflight-check.ts's pure assertion functions —
// ticket #69. No Supabase, no filesystem: every DoD item provable without a
// database is proven here. Each check has a named test for its pass path
// AND at least one named test for a fail path (DoD: "a named test for each
// check's fail path, not only its pass path"), plus the warn path where a
// check has one.

import { describe, expect, it } from 'vitest'
import {
  REQUIRED_ENV_VAR_SPECS,
  UNRESOLVED_GAMEWEEK_REASON,
  buildCannotEvaluateResult,
  checkConfiguration,
  checkJobFreshness,
  checkLeagueBaselineGoals,
  checkMatchData,
  checkNextGameweek,
  checkNotifications,
  checkOneJobFreshness,
  checkProjections,
  checkRecommendation,
  checkSolver,
  checkSquad,
  checkTeamRatings,
  classifyZeroProjectionPlayer,
  computeOverallVerdict,
  worstVerdict,
  type CheckResult,
  type JobFreshnessTarget,
  type ZeroProjectionPlayer,
} from './preflight-check.js'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-08-20T12:00:00Z')

// ============================================================================
// worstVerdict / computeOverallVerdict
// ============================================================================

describe('worstVerdict', () => {
  it('is pass when every input is pass', () => {
    expect(worstVerdict(['pass', 'pass'])).toBe('pass')
  })
  it('is warn when the worst input is warn', () => {
    expect(worstVerdict(['pass', 'warn', 'pass'])).toBe('warn')
  })
  it('is fail when the worst input is fail, even alongside warn', () => {
    expect(worstVerdict(['pass', 'warn', 'fail'])).toBe('fail')
  })
  it('is pass for an empty list', () => {
    expect(worstVerdict([])).toBe('pass')
  })
})

describe('computeOverallVerdict', () => {
  it('takes the worst verdict across every CheckResult', () => {
    const checks: CheckResult[] = [
      { id: 'a', verdict: 'pass', reason: '', values: {} },
      { id: 'b', verdict: 'fail', reason: '', values: {} },
      { id: 'c', verdict: 'warn', reason: '', values: {} },
    ]
    expect(computeOverallVerdict(checks)).toBe('fail')
  })
})

describe('buildCannotEvaluateResult', () => {
  it('always returns fail, never pass or warn, with the given reason', () => {
    const result = buildCannotEvaluateResult('some-check', 'a specific reason')
    expect(result.verdict).toBe('fail')
    expect(result.reason).toBe('a specific reason')
    expect(result.id).toBe('some-check')
  })

  it('cascades UNRESOLVED_GAMEWEEK_REASON (main()\'s own reason string for checks 2-5/9 when check 1 could not resolve a target gameweek) into a fail, unchanged', () => {
    const result = buildCannotEvaluateResult('squad', UNRESOLVED_GAMEWEEK_REASON)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toBe(UNRESOLVED_GAMEWEEK_REASON)
    expect(result.reason).toContain('next-gameweek')
  })
})

// ============================================================================
// 1. Next gameweek
// ============================================================================

describe('checkNextGameweek', () => {
  it('pass: exactly one gameweek marked is_next with a future deadline', () => {
    const result = checkNextGameweek({
      nextGameweeks: [{ id: 5, name: 'Gameweek 5', deadlineTimeMs: NOW + 48 * HOUR }],
      nowMs: NOW,
    })
    expect(result.verdict).toBe('pass')
    expect(result.reason).toContain('Gameweek 5')
    expect(result.values.hoursRemaining).toBeCloseTo(48, 5)
  })

  it('fail: no gameweek marked is_next', () => {
    const result = checkNextGameweek({ nextGameweeks: [], nowMs: NOW })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "gameweeks" row is marked is_next')
  })

  it('fail: more than one gameweek marked is_next', () => {
    const result = checkNextGameweek({
      nextGameweeks: [
        { id: 5, name: 'Gameweek 5', deadlineTimeMs: NOW + 48 * HOUR },
        { id: 6, name: 'Gameweek 6', deadlineTimeMs: NOW + 96 * HOUR },
      ],
      nowMs: NOW,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('2 "gameweeks" rows are marked is_next')
  })

  it('fail: deadline already passed but still marked is_next', () => {
    const result = checkNextGameweek({
      nextGameweeks: [{ id: 4, name: 'Gameweek 4', deadlineTimeMs: NOW - 2 * HOUR }],
      nowMs: NOW,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('already passed')
  })
})

// ============================================================================
// 2. Squad
// ============================================================================

function fullValidSquad() {
  const picks = Array.from({ length: 15 }, (_, i) => ({ isStarting: i < 11, isCaptain: false, isViceCaptain: false }))
  picks[0].isCaptain = true
  picks[1].isViceCaptain = true
  return picks
}

describe('checkSquad', () => {
  it('pass: 15 picks, 11 starting, exactly one captain and one vice-captain', () => {
    const result = checkSquad({ gameweekId: 5, squadExists: true, picks: fullValidSquad() })
    expect(result.verdict).toBe('pass')
  })

  it('fail: no squads row for the gameweek', () => {
    const result = checkSquad({ gameweekId: 5, squadExists: false, picks: [] })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "squads" row exists')
  })

  it('fail: fewer than 15 squad_picks rows', () => {
    const picks = fullValidSquad().slice(0, 14)
    const result = checkSquad({ gameweekId: 5, squadExists: true, picks })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('14 squad_picks row(s)')
  })

  it('fail: wrong number of starters', () => {
    const picks = fullValidSquad()
    picks[10].isStarting = false // 10 starters instead of 11
    const result = checkSquad({ gameweekId: 5, squadExists: true, picks })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('10 starting')
  })

  it('fail: zero captains', () => {
    const picks = fullValidSquad()
    picks[0].isCaptain = false
    const result = checkSquad({ gameweekId: 5, squadExists: true, picks })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('0 captain(s)')
  })

  it('fail: two vice-captains', () => {
    const picks = fullValidSquad()
    picks[2].isViceCaptain = true
    const result = checkSquad({ gameweekId: 5, squadExists: true, picks })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('2 vice-captain(s)')
  })
})

// ============================================================================
// 3. Projections
// ============================================================================

// ============================================================================
// classifyZeroProjectionPlayer — the per-row rule, ticket #89. Order:
// unavailability first, no-fixture second, everything remaining ("available")
// is the failing population.
// ============================================================================

function zeroPlayer(overrides: Partial<ZeroProjectionPlayer> = {}): ZeroProjectionPlayer {
  return { playerId: 1, webName: 'Test Player', status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: true, ...overrides }
}

describe('classifyZeroProjectionPlayer', () => {
  it.each(['i', 's', 'u', 'd'])('status %s (with no published chance) is "unavailable"', (status) => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status }))).toBe('unavailable')
  })

  it('an available player (status a) with chance_of_playing_next_round below 100 is "unavailable"', () => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status: 'a', chanceOfPlayingNextRound: 75 }))).toBe('unavailable')
  })

  it('status a with chance exactly 100 is fully available, not "unavailable"', () => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status: 'a', chanceOfPlayingNextRound: 100, teamHasFixture: true }))).toBe('available')
  })

  it('status a with a null chance and a fixtured team is "no-fixture" when the team has no fixture', () => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: false }))).toBe('no-fixture')
  })

  it('status a, chance null or 100, team fixtured — the only "available" (failing) case', () => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: true }))).toBe('available')
  })

  it('an unresolved team_id (teamHasFixture null) is folded into "available", not a fourth bucket — cannot prove innocent', () => {
    expect(classifyZeroProjectionPlayer(zeroPlayer({ status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: null }))).toBe('available')
  })
})

// ============================================================================
// checkProjections
// ============================================================================

describe('checkProjections', () => {
  const base = { gameweekId: 5, modelVersion: 'baseline-v1', coverageWarnThreshold: 0.95, coverageFailThreshold: 0.5 }

  it('pass: full coverage, no all-zero rows at all', () => {
    const result = checkProjections({ ...base, projectionRowCount: 600, playersCount: 600, zeroProjectionPlayers: [] })
    expect(result.verdict).toBe('pass')
  })

  it('fail: zero projection rows at all', () => {
    const result = checkProjections({ ...base, projectionRowCount: 0, playersCount: 600, zeroProjectionPlayers: [] })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "player_projections" rows')
  })

  // ----------------------------------------------------------------------
  // The narrowed assertion itself.
  // ----------------------------------------------------------------------

  it('fail: a single fit, fixtured, all-zero player among otherwise healthy data — and the reason NAMES the player', () => {
    const result = checkProjections({
      ...base,
      projectionRowCount: 600,
      playersCount: 600,
      zeroProjectionPlayers: [zeroPlayer({ webName: 'Erling Haaland', status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: true })],
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('Erling Haaland')
    expect(result.values.availableZeroRowCount).toBe(1)
  })

  it.each(['i', 's', 'u', 'd'] as const)('does not fail on an all-zero row for a player whose status is %s', (status) => {
    const result = checkProjections({
      ...base,
      projectionRowCount: 600,
      playersCount: 600,
      zeroProjectionPlayers: [zeroPlayer({ status, chanceOfPlayingNextRound: null, teamHasFixture: true })],
    })
    expect(result.verdict).not.toBe('fail')
  })

  it('does not fail on an all-zero row for an available player whose chance_of_playing_next_round is below 100', () => {
    const result = checkProjections({
      ...base,
      projectionRowCount: 600,
      playersCount: 600,
      zeroProjectionPlayers: [zeroPlayer({ status: 'a', chanceOfPlayingNextRound: 25, teamHasFixture: true })],
    })
    expect(result.verdict).not.toBe('fail')
  })

  it('does not fail on an all-zero row for a player whose team has no fixture in the gameweek', () => {
    const result = checkProjections({
      ...base,
      projectionRowCount: 600,
      playersCount: 600,
      zeroProjectionPlayers: [zeroPlayer({ status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: false })],
    })
    expect(result.verdict).not.toBe('fail')
  })

  // ----------------------------------------------------------------------
  // The two observed live shapes — both must pass, and both breakdowns
  // must reconcile exactly to the stated total.
  // ----------------------------------------------------------------------

  function liveComposition(counts: { i: number; u: number; s: number; a: number }): ZeroProjectionPlayer[] {
    const players: ZeroProjectionPlayer[] = []
    let id = 1
    for (const status of ['i', 'u', 's'] as const) {
      for (let n = 0; n < counts[status]; n++) {
        players.push(zeroPlayer({ playerId: id++, webName: `Unavailable Player ${id}`, status, chanceOfPlayingNextRound: null, teamHasFixture: true }))
      }
    }
    for (let n = 0; n < counts.a; n++) {
      players.push(zeroPlayer({ playerId: id++, webName: `Available Player ${id}`, status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: true }))
    }
    return players
  }

  it('pass: the 20 Aug 2026 live composition — 47 i / 37 u / 3 s / 0 a, 87 rows, reconciling exactly', () => {
    const zeroProjectionPlayers = liveComposition({ i: 47, u: 37, s: 3, a: 0 })
    expect(zeroProjectionPlayers).toHaveLength(87)
    const result = checkProjections({ ...base, projectionRowCount: 595, playersCount: 595, zeroProjectionPlayers })
    expect(result.verdict).toBe('pass')
    expect(result.values.allZeroRowCount).toBe(87)
    expect(result.values.unavailableZeroRowCount).toBe(87)
    expect(result.values.noFixtureZeroRowCount).toBe(0)
    expect(result.values.availableZeroRowCount).toBe(0)
    expect((result.values.unavailableZeroRowCount as number) + (result.values.noFixtureZeroRowCount as number) + (result.values.availableZeroRowCount as number)).toBe(
      result.values.allZeroRowCount,
    )
    expect(result.reason).toContain('87')
  })

  it('pass: the 21 Aug 2026 live composition — 56 i / 39 u / 3 s / 0 a, 98 rows, reconciling exactly', () => {
    const zeroProjectionPlayers = liveComposition({ i: 56, u: 39, s: 3, a: 0 })
    expect(zeroProjectionPlayers).toHaveLength(98)
    const result = checkProjections({ ...base, projectionRowCount: 600, playersCount: 600, zeroProjectionPlayers })
    expect(result.verdict).toBe('pass')
    expect(result.values.allZeroRowCount).toBe(98)
    expect(result.values.unavailableZeroRowCount).toBe(98)
    expect(result.values.noFixtureZeroRowCount).toBe(0)
    expect(result.values.availableZeroRowCount).toBe(0)
    expect((result.values.unavailableZeroRowCount as number) + (result.values.noFixtureZeroRowCount as number) + (result.values.availableZeroRowCount as number)).toBe(
      result.values.allZeroRowCount,
    )
    expect(result.reason).toContain('98')
  })

  // ----------------------------------------------------------------------
  // Reporting: the breakdown stays visible even on a pass.
  // ----------------------------------------------------------------------

  it('states the all-zero breakdown in the reason even on a pass', () => {
    const zeroProjectionPlayers = liveComposition({ i: 2, u: 1, s: 0, a: 0 })
    const result = checkProjections({ ...base, projectionRowCount: 600, playersCount: 600, zeroProjectionPlayers })
    expect(result.verdict).toBe('pass')
    expect(result.reason).toContain('all-zero breakdown')
    expect(result.reason).toContain('3 total')
  })

  it('a player whose team_id does not resolve to any known team is not given a pass — folded into the failing population', () => {
    const result = checkProjections({
      ...base,
      projectionRowCount: 600,
      playersCount: 600,
      zeroProjectionPlayers: [zeroPlayer({ webName: 'Orphaned Team Player', status: 'a', chanceOfPlayingNextRound: null, teamHasFixture: null })],
    })
    expect(result.verdict).toBe('fail')
    expect(result.values.unresolvedTeamRowCount).toBe(1)
    expect(result.values.availableZeroRowCount).toBe(1)
    expect(result.reason).toContain('Orphaned Team Player')
  })

  // ----------------------------------------------------------------------
  // The unchanged coverage assertion.
  // ----------------------------------------------------------------------

  it('fail: coverage catastrophically below the players count', () => {
    const result = checkProjections({ ...base, projectionRowCount: 100, playersCount: 600, zeroProjectionPlayers: [] })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('below the 50% floor')
  })

  it('warn: coverage slightly below the players count', () => {
    const result = checkProjections({ ...base, projectionRowCount: 560, playersCount: 600, zeroProjectionPlayers: [] })
    expect(result.verdict).toBe('warn')
    expect(result.reason).toContain('below the 95% target')
  })
})

// ============================================================================
// 4. Recommendation
// ============================================================================

describe('checkRecommendation', () => {
  const staleToleranceMs = 5 * 60 * 1000

  it('pass: recommendation updated at or after the last solver run', () => {
    const result = checkRecommendation({
      gameweekId: 5,
      recommendation: { planIndex: 0, updatedAtMs: NOW },
      lastSolverRunAtMs: NOW - HOUR,
      staleToleranceMs,
    })
    expect(result.verdict).toBe('pass')
  })

  it('fail: no recommendations row at plan_index 0', () => {
    const result = checkRecommendation({ gameweekId: 5, recommendation: null, lastSolverRunAtMs: NOW, staleToleranceMs })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "recommendations" row at plan_index 0')
  })

  it('fail: no solver_runs row to compare freshness against', () => {
    const result = checkRecommendation({
      gameweekId: 5,
      recommendation: { planIndex: 0, updatedAtMs: NOW },
      lastSolverRunAtMs: null,
      staleToleranceMs,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "solver_runs" row')
  })

  it('fail: recommendation predates the most recent solver run — stale', () => {
    const result = checkRecommendation({
      gameweekId: 5,
      recommendation: { planIndex: 0, updatedAtMs: NOW - 2 * HOUR },
      lastSolverRunAtMs: NOW,
      staleToleranceMs,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('stale')
  })

  it('pass: within the clock-skew tolerance even if nominally slightly earlier', () => {
    const result = checkRecommendation({
      gameweekId: 5,
      recommendation: { planIndex: 0, updatedAtMs: NOW - 60_000 },
      lastSolverRunAtMs: NOW,
      staleToleranceMs,
    })
    expect(result.verdict).toBe('pass')
  })
})

// ============================================================================
// 5. Solver
// ============================================================================

describe('checkSolver', () => {
  it('pass: most recent run is for the target gameweek and Optimal', () => {
    const result = checkSolver({ targetGameweekId: 5, latestRun: { gameweekId: 5, solverStatus: 'Optimal', createdAtMs: NOW } })
    expect(result.verdict).toBe('pass')
  })

  it('fail: no solver_runs row exists', () => {
    const result = checkSolver({ targetGameweekId: 5, latestRun: null })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no "solver_runs" row exists')
  })

  it('fail: most recent run is for a different gameweek', () => {
    const result = checkSolver({ targetGameweekId: 5, latestRun: { gameweekId: 4, solverStatus: 'Optimal', createdAtMs: NOW } })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('for gameweek 4, not the next gameweek 5')
  })

  it('fail: most recent run is not a proven optimum (time limit reached)', () => {
    const result = checkSolver({ targetGameweekId: 5, latestRun: { gameweekId: 5, solverStatus: 'Time limit reached', createdAtMs: NOW } })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('not a proven optimum')
  })

  it('fail: infeasible is not a warn, it is a fail', () => {
    const result = checkSolver({ targetGameweekId: 5, latestRun: { gameweekId: 5, solverStatus: 'Infeasible', createdAtMs: NOW } })
    expect(result.verdict).toBe('fail')
  })
})

// ============================================================================
// 6. Team ratings — never an automatic failure.
// ============================================================================

describe('checkTeamRatings', () => {
  it('pass: every team rated, no fallback fixtures', () => {
    const result = checkTeamRatings({ nullEloTeamsCount: 0, totalTeamsCount: 20, fixturesFallbackCount: 0, totalFixturesInHorizon: 25 })
    expect(result.verdict).toBe('pass')
  })

  it('warn (never fail): some teams have no ClubElo rating', () => {
    const result = checkTeamRatings({ nullEloTeamsCount: 3, totalTeamsCount: 20, fixturesFallbackCount: 0, totalFixturesInHorizon: 25 })
    expect(result.verdict).toBe('warn')
    expect(result.reason).toContain('3/20')
  })

  it('warn (never fail): some horizon fixtures fall back to FPL difficulty', () => {
    const result = checkTeamRatings({ nullEloTeamsCount: 0, totalTeamsCount: 20, fixturesFallbackCount: 4, totalFixturesInHorizon: 25 })
    expect(result.verdict).toBe('warn')
    expect(result.reason).toContain('4/25')
  })
})

// ============================================================================
// 7. Match data
// ============================================================================

describe('checkMatchData', () => {
  it('pass: every row has a competition, nobody over the season cap', () => {
    const result = checkMatchData({
      totalRows: 15000,
      nullCompetitionRows: 0,
      maxMatchesForAnyPlayerSeason: { playerCode: 123, season: '2025-2026', count: 38 },
      maxAllowedMatchesPerSeason: 38,
    })
    expect(result.verdict).toBe('pass')
  })

  it('fail: some rows have no competition value — the cup-matches-as-league-form bug this ticket exists to catch', () => {
    const result = checkMatchData({
      totalRows: 15000,
      nullCompetitionRows: 42,
      maxMatchesForAnyPlayerSeason: { playerCode: 123, season: '2025-2026', count: 38 },
      maxAllowedMatchesPerSeason: 38,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('42/15000')
  })

  it('fail: a player exceeds the season cap', () => {
    const result = checkMatchData({
      totalRows: 15000,
      nullCompetitionRows: 0,
      maxMatchesForAnyPlayerSeason: { playerCode: 999, season: '2025-2026', count: 41 },
      maxAllowedMatchesPerSeason: 38,
    })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('player_code 999 has 41 Premier League matches')
  })

  it('pass: no rows at all for the group-by (null maxMatchesForAnyPlayerSeason) is not itself a failure', () => {
    const result = checkMatchData({ totalRows: 0, nullCompetitionRows: 0, maxMatchesForAnyPlayerSeason: null, maxAllowedMatchesPerSeason: 38 })
    expect(result.verdict).toBe('pass')
  })
})

// ============================================================================
// 8. Job freshness
// ============================================================================

describe('checkOneJobFreshness', () => {
  it('pass: recent successful run', () => {
    const result = checkOneJobFreshness({ id: 'ingest-fpl', row: { status: 'success', startedAtMs: NOW - 2 * HOUR } }, NOW, 36)
    expect(result.verdict).toBe('pass')
  })

  it('fail: no job_runs row found at all', () => {
    const result = checkOneJobFreshness({ id: 'ingest-fpl', row: null }, NOW, 36)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no job_runs row found')
  })

  it('fail: most recent run failed', () => {
    const result = checkOneJobFreshness({ id: 'ingest-fpl', row: { status: 'failure', startedAtMs: NOW - HOUR } }, NOW, 36)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('run failed')
  })

  it('fail: most recent successful run is older than the staleness threshold', () => {
    const result = checkOneJobFreshness({ id: 'ingest-fpl', row: { status: 'success', startedAtMs: NOW - 40 * HOUR } }, NOW, 36)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('past the 36h staleness threshold')
  })

  it('fail: a read error is reported verbatim, not as "no row found"', () => {
    const result = checkOneJobFreshness({ id: 'ingest-fpl', row: null, fetchError: 'cannot evaluate — table gone' }, NOW, 36)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toBe('cannot evaluate — table gone')
  })
})

describe('checkJobFreshness', () => {
  it('pass: every tracked job is healthy', () => {
    const targets: JobFreshnessTarget[] = [
      { id: 'a', row: { status: 'success', startedAtMs: NOW - HOUR } },
      { id: 'b', row: { status: 'success', startedAtMs: NOW - 2 * HOUR } },
    ]
    const result = checkJobFreshness(targets, NOW, 36)
    expect(result.verdict).toBe('pass')
  })

  it('fail: the aggregate is the worst of the seven, even when only one job is unhealthy', () => {
    const targets: JobFreshnessTarget[] = [
      { id: 'a', row: { status: 'success', startedAtMs: NOW - HOUR } },
      { id: 'b', row: null },
      { id: 'c', row: { status: 'success', startedAtMs: NOW - HOUR } },
    ]
    const result = checkJobFreshness(targets, NOW, 36)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('b')
    expect((result.values.jobs as Record<string, unknown>).a).toBeDefined()
  })
})

// ============================================================================
// 9. Notifications
// ============================================================================

describe('checkNotifications', () => {
  it('pass: well before either window, nothing due yet', () => {
    const result = checkNotifications({ gameweekId: 5, deadlineMs: NOW + 40 * HOUR, nowMs: NOW, sentTriggers: new Set() })
    expect(result.verdict).toBe('pass')
    expect(result.values.deadline24hReachable).toBe(true)
  })

  it('pass: deadline_10h sent before the deadline passed', () => {
    const result = checkNotifications({
      gameweekId: 5,
      deadlineMs: NOW - HOUR,
      nowMs: NOW,
      sentTriggers: new Set(['deadline_10h']),
    })
    expect(result.verdict).toBe('pass')
  })

  it('fail: deadline passed and deadline_10h was never sent — the notification never arrived', () => {
    const result = checkNotifications({ gameweekId: 5, deadlineMs: NOW - HOUR, nowMs: NOW, sentTriggers: new Set() })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('never arrived')
  })

  it('fail: deadline passed, only deadline_24h was sent (not deadline_10h)', () => {
    const result = checkNotifications({
      gameweekId: 5,
      deadlineMs: NOW - HOUR,
      nowMs: NOW,
      sentTriggers: new Set(['deadline_24h']),
    })
    expect(result.verdict).toBe('fail')
  })

  it('pass, deadline_24h window closed and correctly unreachable inside the 10h window', () => {
    const result = checkNotifications({ gameweekId: 5, deadlineMs: NOW + 5 * HOUR, nowMs: NOW, sentTriggers: new Set() })
    expect(result.verdict).toBe('pass')
    expect(result.values.deadline24hReachable).toBe(false)
    expect(result.values.deadline10hReachable).toBe(true)
  })
})

// ============================================================================
// 10. Configuration — presence/absence only, never values.
// ============================================================================

describe('checkConfiguration', () => {
  it('pass: every tracked variable is set', () => {
    const env = Object.fromEntries(REQUIRED_ENV_VAR_SPECS.map((s) => [s.name, 'set-value']))
    const result = checkConfiguration(env)
    expect(result.verdict).toBe('pass')
  })

  it('fail: a fail-severity variable (e.g. TELEGRAM_BOT_TOKEN) is missing', () => {
    const env = Object.fromEntries(REQUIRED_ENV_VAR_SPECS.map((s) => [s.name, 'set-value']))
    delete env.TELEGRAM_BOT_TOKEN
    const result = checkConfiguration(env)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('TELEGRAM_BOT_TOKEN')
  })

  it('warn: only a warn-severity variable (FPL_ENTRY_ID) is missing', () => {
    const env = Object.fromEntries(REQUIRED_ENV_VAR_SPECS.map((s) => [s.name, 'set-value']))
    delete env.FPL_ENTRY_ID
    const result = checkConfiguration(env)
    expect(result.verdict).toBe('warn')
    expect(result.reason).toContain('FPL_ENTRY_ID')
  })

  it('treats an empty string the same as unset', () => {
    const env = Object.fromEntries(REQUIRED_ENV_VAR_SPECS.map((s) => [s.name, 'set-value']))
    env.SUPABASE_URL = ''
    const result = checkConfiguration(env)
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('SUPABASE_URL')
  })

  // DoD (Safety): "No environment variable value appears in the report, the
  // log, or job_runs. Only names and whether each is set. Verifiable by
  // test." This is that test: a distinctive secret-shaped value is fed in,
  // and the entire serialized CheckResult — reason AND values — is asserted
  // never to contain it, for every variable this check tracks, present or
  // missing.
  it('never leaks a variable value into its reason or values, present or missing', () => {
    const SECRET_MARKER = 'xyzzy-secret-should-never-appear-anywhere-in-output-42'
    const env = Object.fromEntries(REQUIRED_ENV_VAR_SPECS.map((s) => [s.name, `${SECRET_MARKER}-${s.name}`]))
    delete env.FPL_ENTRY_ID // exercise both the present AND missing branches in one call
    const result = checkConfiguration(env)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(SECRET_MARKER)
    // Sanity check the test itself isn't vacuous — the variable NAMES must
    // still appear (that is the whole point of the check).
    expect(serialized).toContain('SUPABASE_URL')
    expect(serialized).toContain('FPL_ENTRY_ID')
  })
})

// ============================================================================
// 11. League baseline goals — ticket #115.
// ============================================================================

describe('checkLeagueBaselineGoals', () => {
  const base = { minFinishedFixturesForBaseline: 20, minPlausibleValue: 1.0, maxPlausibleValue: 2.5 }

  it('fail: no successful "project-points" job_runs row can be found', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: null, finishedFixtureCount: 5 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no successful "project-points" job_runs row exists')
  })

  it('pass: source is "fallback" with fewer than 20 finished fixtures (correct pre-season state)', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'fallback', leagueBaselineGoals: null }, finishedFixtureCount: 5 })
    expect(result.verdict).toBe('pass')
    expect(result.reason).toContain('fallback')
    expect(result.reason).toContain('5 finished fixture')
  })

  it('fail: source is "fallback" but 20 or more finished fixtures exist — reason names both numbers', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'fallback', leagueBaselineGoals: null }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('finished fixtures are not reaching the projection job')
    expect(result.reason).toContain('34')
    expect(result.reason).toContain('20')
  })

  it('boundary: exactly 19 finished fixtures on fallback still passes', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'fallback', leagueBaselineGoals: null }, finishedFixtureCount: 19 })
    expect(result.verdict).toBe('pass')
  })

  it('boundary: exactly 20 finished fixtures on fallback fails', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'fallback', leagueBaselineGoals: null }, finishedFixtureCount: 20 })
    expect(result.verdict).toBe('fail')
  })

  it('pass: source is "computed" with a value inside the plausible range, value quoted in the reason', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 1.47 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('pass')
    expect(result.reason).toContain('1.470')
    expect(result.reason).toContain('34 finished fixture')
  })

  it('fail: computed value below 1.0, value quoted', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 0.6 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('0.600')
    expect(result.reason).toContain('outside the plausible range')
  })

  it('fail: computed value above 2.5, value quoted', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 3.1 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('3.100')
    expect(result.reason).toContain('outside the plausible range')
  })

  it('boundary: computed value exactly at 1.0 (the low bound) passes', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 1.0 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('pass')
  })

  it('boundary: computed value just below 1.0 fails', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 0.99 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
  })

  it('boundary: computed value exactly at 2.5 (the high bound) passes', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 2.5 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('pass')
  })

  it('boundary: computed value just above 2.5 fails', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 2.51 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
  })

  it('fail: source is "computed" but no leagueBaselineGoals value was recorded alongside it', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: null }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('no leagueBaselineGoals value was recorded')
  })

  it('fail: an unrecognised source string is treated as unevaluable, not silently passed', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'mystery', leagueBaselineGoals: 1.5 }, finishedFixtureCount: 34 })
    expect(result.verdict).toBe('fail')
    expect(result.reason).toContain('mystery')
  })

  it('states the finished-fixture count in the reason on a pass, not only on a failure', () => {
    const result = checkLeagueBaselineGoals({ ...base, jobRun: { source: 'computed', leagueBaselineGoals: 1.5 }, finishedFixtureCount: 42 })
    expect(result.verdict).toBe('pass')
    expect(result.reason).toContain('42')
  })
})
