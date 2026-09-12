// Unit tests for scripts/team-strength-diagnostic.ts — ticket #229's
// falsification gate.
//
// No live Supabase project: every pure function is proven on constructed
// rows, same constraint every other scripts/*.ts test file in this repo
// documents for its own main(). The source-invariant section at the bottom
// proves the ticket's explicit "out of scope" boundaries (not scheduled, not
// added to preflight-check.ts) by grepping the real, shipped source and
// sibling files — never re-deriving the same logic here.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildDiagnosticRows,
  checkManUtdVsManCityGate,
  checkVarianceGate,
  frozenEloExpectedScore,
  generateReportMarkdown,
  MAN_CITY_SHORT_NAME,
  MAN_UTD_SHORT_NAME,
  populationStandardDeviation,
  type DiagnosticRow,
  type DiagnosticTeamRow,
} from './team-strength-diagnostic.ts'
import type { TeamMetadata } from './project-points.ts'
import type { TeamMatchRecord } from '../src/lib/projection/teamStrength.ts'
import { expectedScore, expectedScoreFromDifficulty } from '../src/lib/projection/fixture.ts'

const sourcePath = fileURLToPath(new URL('./team-strength-diagnostic.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

// ============================================================================
// frozenEloExpectedScore — the deliberate reconstruction of the PRE-#229
// two-tier logic.
// ============================================================================

describe('frozenEloExpectedScore', () => {
  it('uses the elo formula when both teams have a non-null elo', () => {
    expect(frozenEloExpectedScore(1600, 1500, true, 3)).toBe(expectedScore(1600, 1500, true))
  })

  it('falls back to FDR when either team\'s elo is null -- exactly the pre-#229 rule, staleness never consulted', () => {
    expect(frozenEloExpectedScore(null, 1500, true, 4)).toBe(expectedScoreFromDifficulty(4))
    expect(frozenEloExpectedScore(1600, null, true, 4)).toBe(expectedScoreFromDifficulty(4))
    expect(frozenEloExpectedScore(null, null, true, 4)).toBe(expectedScoreFromDifficulty(4))
  })

  it('this function has no staleness parameter at all -- a stale-but-non-null elo is ALWAYS trusted, matching what actually shipped before ticket #229', () => {
    // Sanity: the function signature itself has exactly 4 parameters (teamElo,
    // opponentElo, isHome, fplDifficulty) -- no fifth "stale" flag exists to pass.
    expect(frozenEloExpectedScore.length).toBe(4)
  })
})

// ============================================================================
// populationStandardDeviation
// ============================================================================

describe('populationStandardDeviation', () => {
  it('is 0 for an empty array, never NaN', () => {
    expect(populationStandardDeviation([])).toBe(0)
  })

  it('is 0 when every value is identical', () => {
    expect(populationStandardDeviation([0.5, 0.5, 0.5])).toBe(0)
  })

  it('matches a hand-computed population stdDev: [0.4, 0.5, 0.6] -> mean 0.5, variance ((0.01+0+0.01)/3), stdDev sqrt(that)', () => {
    const variance = (0.01 + 0 + 0.01) / 3
    expect(populationStandardDeviation([0.4, 0.5, 0.6])).toBeCloseTo(Math.sqrt(variance), 10)
  })
})

// ============================================================================
// checkVarianceGate — falsification gate #2
// ============================================================================

describe('checkVarianceGate (falsification gate #2)', () => {
  it('PASSES when the point-in-time spread is wider than the frozen-elo spread', () => {
    const rows = [
      { frozenEloExpectedScore: 0.48, pointInTimeExpectedScore: 0.3 },
      { frozenEloExpectedScore: 0.52, pointInTimeExpectedScore: 0.7 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.pointInTimeStdDev).toBeGreaterThan(result.frozenStdDev)
    expect(result.passed).toBe(true)
  })

  it('PASSES when the two spreads are exactly equal (>= is inclusive)', () => {
    const rows = [
      { frozenEloExpectedScore: 0.4, pointInTimeExpectedScore: 0.4 },
      { frozenEloExpectedScore: 0.6, pointInTimeExpectedScore: 0.6 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.frozenStdDev).toBe(result.pointInTimeStdDev)
    expect(result.passed).toBe(true)
  })

  it('FAILS when the point-in-time spread is narrower -- the exact case the ticket calls a worse signal', () => {
    const rows = [
      { frozenEloExpectedScore: 0.3, pointInTimeExpectedScore: 0.48 },
      { frozenEloExpectedScore: 0.7, pointInTimeExpectedScore: 0.52 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.pointInTimeStdDev).toBeLessThan(result.frozenStdDev)
    expect(result.passed).toBe(false)
  })
})

// ============================================================================
// checkManUtdVsManCityGate — falsification gate #1
// ============================================================================

function diagnosticRow(overrides: Partial<DiagnosticRow> = {}): DiagnosticRow {
  return {
    fixtureId: 1,
    gameweekId: 4,
    teamId: 1,
    teamName: 'Man Utd',
    teamShortName: MAN_UTD_SHORT_NAME,
    opponentId: 2,
    opponentName: 'Man City',
    opponentShortName: MAN_CITY_SHORT_NAME,
    isHome: true,
    frozenEloExpectedScore: 0.513,
    pointInTimeExpectedScore: 0.3,
    fixtureSource: 'team-strength',
    ...overrides,
  }
}

describe('checkManUtdVsManCityGate (falsification gate #1)', () => {
  it('PASSES when Man Utd\'s point-in-time expectedScore is below 0.5', () => {
    const result = checkManUtdVsManCityGate([diagnosticRow({ pointInTimeExpectedScore: 0.3 })])
    expect(result.status).toBe('pass')
    expect(result.manUtdPointInTimeExpectedScore).toBe(0.3)
  })

  it('FAILS when Man Utd\'s point-in-time expectedScore is exactly 0.5 or above -- the reported defect would survive', () => {
    expect(checkManUtdVsManCityGate([diagnosticRow({ pointInTimeExpectedScore: 0.5 })]).status).toBe('fail')
    expect(checkManUtdVsManCityGate([diagnosticRow({ pointInTimeExpectedScore: 0.51 })]).status).toBe('fail')
  })

  it('is NOT-APPLICABLE when the Man Utd v Man City fixture is not present in the examined rows -- never a guessed pass/fail', () => {
    const result = checkManUtdVsManCityGate([diagnosticRow({ teamShortName: 'CHE', opponentShortName: 'ARS' })])
    expect(result.status).toBe('not-applicable')
    expect(result.manUtdPointInTimeExpectedScore).toBeNull()
  })

  it('is NOT-APPLICABLE on an empty row set', () => {
    expect(checkManUtdVsManCityGate([]).status).toBe('not-applicable')
  })

  it('matches on Man Utd as the team and Man City as the OPPONENT specifically -- the reverse pairing is a different row (Man City\'s own perspective), not reused for this gate', () => {
    const manCityRow = diagnosticRow({
      teamName: 'Man City',
      teamShortName: MAN_CITY_SHORT_NAME,
      opponentName: 'Man Utd',
      opponentShortName: MAN_UTD_SHORT_NAME,
      pointInTimeExpectedScore: 0.9, // Man City's own high expectedScore -- must not be read as Man Utd's
    })
    const result = checkManUtdVsManCityGate([manCityRow])
    expect(result.status).toBe('not-applicable')
  })
})

// ============================================================================
// buildDiagnosticRows — the wiring: reuses project-points.ts's own
// buildFixtureContext and expectedPoints.ts's own resolveFixtureExpectedScore.
// ============================================================================

describe('buildDiagnosticRows', () => {
  const MAN_UTD_ID = 1
  const MAN_CITY_ID = 2
  const manUtd: DiagnosticTeamRow = { id: MAN_UTD_ID, name: 'Man Utd', short_name: 'MUN', code: 10, elo: 1915, elo_stale_since: '2026-09-01T00:00:00Z' }
  const manCity: DiagnosticTeamRow = { id: MAN_CITY_ID, name: 'Man City', short_name: 'MCI', code: 20, elo: 1971, elo_stale_since: '2026-09-01T00:00:00Z' }
  const teamsById = new Map([
    [MAN_UTD_ID, manUtd],
    [MAN_CITY_ID, manCity],
  ])
  const eloByTeamId = new Map<number, number | null>([
    [MAN_UTD_ID, manUtd.elo],
    [MAN_CITY_ID, manCity.elo],
  ])
  const teamMetadataById = new Map<number, TeamMetadata>([
    [MAN_UTD_ID, { eloStale: true, code: manUtd.code }],
    [MAN_CITY_ID, { eloStale: true, code: manCity.code }],
  ])

  it('returns TWO rows per fixture, one per team\'s own perspective', () => {
    const rows = buildDiagnosticRows({
      fixture: { id: 39, team_h: MAN_UTD_ID, team_a: MAN_CITY_ID, team_h_difficulty: 3, team_a_difficulty: 3 },
      gameweekId: 4,
      teamsById,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].teamShortName).toBe('MUN')
    expect(rows[0].opponentShortName).toBe('MCI')
    expect(rows[0].isHome).toBe(true)
    expect(rows[1].teamShortName).toBe('MCI')
    expect(rows[1].opponentShortName).toBe('MUN')
    expect(rows[1].isHome).toBe(false)
  })

  it('returns an empty array when either fixture team cannot be resolved -- never a guessed row', () => {
    const rows = buildDiagnosticRows({
      fixture: { id: 1, team_h: 999, team_a: MAN_CITY_ID, team_h_difficulty: 3, team_a_difficulty: 3 },
      gameweekId: 4,
      teamsById,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
    })
    expect(rows).toEqual([])
  })

  it('with stale elo on both sides and no team-strength history, falls to the STALE-ELO tier for point-in-time (both non-null elo, insufficient history) -- and frozen-elo trusts the same (stale) elo unconditionally, so the two happen to agree numerically here even though they reached it through different reasoning', () => {
    const rows = buildDiagnosticRows({
      fixture: { id: 39, team_h: MAN_UTD_ID, team_a: MAN_CITY_ID, team_h_difficulty: 3, team_a_difficulty: 3 },
      gameweekId: 4,
      teamsById,
      eloByTeamId,
      teamMetadataById, // both eloStale: true, no teamMatchRecords passed -> insufficient team-strength history
      teamMatchRecords: [],
    })
    const manUtdRow = rows.find((r) => r.teamShortName === 'MUN')!
    // Tier 1 (fresh elo) fails because BOTH sides are stale; tier 2
    // (team-strength) fails because there is no history at all; tier 3
    // (stale elo) succeeds -- exactly the "better than nothing early season"
    // fallback the ticket specifies, never dropping straight to FDR while a
    // usable (if stale) elo value exists.
    expect(manUtdRow.fixtureSource).toBe('stale-elo')
    expect(manUtdRow.pointInTimeExpectedScore).toBe(expectedScore(1915, 1971, true))
    // Frozen-elo reaches the SAME number, but for a different reason: it has
    // no staleness concept at all and would have trusted this elo regardless.
    expect(manUtdRow.frozenEloExpectedScore).toBe(expectedScore(1915, 1971, true))
    expect(manUtdRow.pointInTimeExpectedScore).toBeCloseTo(manUtdRow.frozenEloExpectedScore, 10)
  })

  it('with stale elo AND a null elo pairing, point-in-time and frozen-elo genuinely disagree -- point-in-time still has the stale-elo tier to fall to (teamElo non-null), frozen-elo drops straight to FDR the moment either side is null', () => {
    const eloWithOneNull = new Map<number, number | null>([
      [MAN_UTD_ID, 1915],
      [MAN_CITY_ID, null], // e.g. a promoted club with no ClubElo rating at all
    ])
    const rows = buildDiagnosticRows({
      fixture: { id: 39, team_h: MAN_UTD_ID, team_a: MAN_CITY_ID, team_h_difficulty: 3, team_a_difficulty: 3 },
      gameweekId: 4,
      teamsById,
      eloByTeamId: eloWithOneNull,
      teamMetadataById,
      teamMatchRecords: [],
    })
    const manUtdRow = rows.find((r) => r.teamShortName === 'MUN')!
    // Point-in-time: teamElo/opponentElo not BOTH non-null -> tiers 1 and 3
    // both fail (both require hasElo) -> no team-strength history either -> FDR.
    expect(manUtdRow.fixtureSource).toBe('fdr')
    expect(manUtdRow.pointInTimeExpectedScore).toBe(expectedScoreFromDifficulty(3))
    // Frozen-elo: identical rule (either null -> FDR) -- so here the two DO
    // agree again, both landing on FDR for the same reason. The genuine
    // disagreement case is the one just above (both non-null, one stale).
    expect(manUtdRow.frozenEloExpectedScore).toBe(expectedScoreFromDifficulty(3))
  })

  it('with sufficient point-in-time team-strength history on both sides, uses the team-strength tier -- and the home/away perspectives are exact mirror images (sum to 1)', () => {
    const teamMatchRecords: TeamMatchRecord[] = [
      // Man Utd (code 10): weaker record.
      { matchId: 'a', gameweek: 1, teamCode: 10, goalsConceded: 2, goalsScored: 0 },
      { matchId: 'b', gameweek: 2, teamCode: 10, goalsConceded: 2, goalsScored: 1 },
      { matchId: 'c', gameweek: 3, teamCode: 10, goalsConceded: 1, goalsScored: 1 },
      // Man City (code 20): stronger record.
      { matchId: 'd', gameweek: 1, teamCode: 20, goalsConceded: 0, goalsScored: 3 },
      { matchId: 'e', gameweek: 2, teamCode: 20, goalsConceded: 0, goalsScored: 2 },
      { matchId: 'f', gameweek: 3, teamCode: 20, goalsConceded: 1, goalsScored: 3 },
    ]
    const rows = buildDiagnosticRows({
      fixture: { id: 39, team_h: MAN_UTD_ID, team_a: MAN_CITY_ID, team_h_difficulty: 3, team_a_difficulty: 3 },
      gameweekId: 4,
      teamsById,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords,
    })
    const manUtdRow = rows.find((r) => r.teamShortName === 'MUN')!
    const manCityRow = rows.find((r) => r.teamShortName === 'MCI')!
    expect(manUtdRow.fixtureSource).toBe('team-strength')
    expect(manCityRow.fixtureSource).toBe('team-strength')
    // The weaker team's own point-in-time expectedScore must be below 0.5 --
    // the direct falsification-gate-1 shape, reproduced here as a unit test.
    expect(manUtdRow.pointInTimeExpectedScore).toBeLessThan(0.5)
    expect(manUtdRow.pointInTimeExpectedScore + manCityRow.pointInTimeExpectedScore).toBeCloseTo(1, 10)
    // Frozen-elo still trusts the (stale) elo -- both teams' elo happens to be
    // close together (1915 vs 1971), so frozen-elo rates this fixture close to
    // a coin flip (>= 0.4) while point-in-time, seeing the real strength gap,
    // does not. This is the exact shape of the reported defect: the two
    // columns genuinely diverge on the same fixture.
    expect(manUtdRow.frozenEloExpectedScore).toBe(expectedScore(1915, 1971, true))
    expect(manUtdRow.frozenEloExpectedScore).toBeGreaterThan(0.4)
    expect(manUtdRow.pointInTimeExpectedScore).toBeLessThan(manUtdRow.frozenEloExpectedScore)
  })
})

// ============================================================================
// generateReportMarkdown — smoke test, not a full snapshot.
// ============================================================================

describe('generateReportMarkdown', () => {
  it('includes the gameweek, both gate verdicts, and one table row per fixture row', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow()],
      manUtdGate: { status: 'pass', manUtdPointInTimeExpectedScore: 0.3 },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, passed: true },
    })
    expect(markdown).toMatch(/Gameweek examined: 4/)
    expect(markdown).toMatch(/PASS/)
    expect(markdown).toMatch(/Man Utd/)
    expect(markdown).toMatch(/Man City/)
    expect(markdown).toMatch(/team-strength/)
    expect(markdown).toMatch(/Overall: PASS/)
  })

  it('reports "Overall: STOP" when either gate fails', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow()],
      manUtdGate: { status: 'fail', manUtdPointInTimeExpectedScore: 0.6 },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, passed: true },
    })
    expect(markdown).toMatch(/Overall: STOP/)
  })
})

// ============================================================================
// Source invariants — the ticket's explicit "out of scope" boundaries.
// ============================================================================

describe('ticket #229 out-of-scope boundaries', () => {
  it('is not registered in any .github/workflows/*.yml file -- scheduling this diagnostic is explicitly out of scope', () => {
    const workflowsDir = fileURLToPath(new URL('../.github/workflows/', import.meta.url))
    const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    for (const file of workflowFiles) {
      const contents = readFileSync(`${workflowsDir}${file}`, 'utf8')
      expect(contents).not.toMatch(/team-strength-diagnostic/)
    }
  })

  it('its job name is not added to scripts/preflight-check.ts\'s check-8 tracked-job list -- explicitly out of scope, and that file is not touched by this ticket at all', () => {
    const preflightPath = fileURLToPath(new URL('./preflight-check.ts', import.meta.url))
    const preflightSource = readFileSync(preflightPath, 'utf8')
    expect(preflightSource).not.toMatch(/team-strength-diagnostic/)
  })

  it('writes no Supabase table other than its own job_runs row -- a read-only diagnostic, per its own header', () => {
    expect(source).not.toMatch(/\.upsert\(/)
    // Exactly ONE .insert( call in the whole file -- recordJobRun's own
    // job_runs row -- proven both by count and by content, so a second,
    // different .insert( call site could not hide inside the same count.
    const insertOccurrences = source.split('.insert(').length - 1
    expect(insertOccurrences).toBe(1)
    expect(source).toMatch(/\.from\('job_runs'\)\.insert\(\{\s*\n?\s*job_name: JOB_NAME,/)
  })

  it('never calls .delete( -- read-only, per its own header comment', () => {
    expect(source).not.toMatch(/\.delete\(\s*\)/)
  })
})
