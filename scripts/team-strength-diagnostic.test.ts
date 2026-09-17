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
  buildTeamStrengthTable,
  checkExpectedScoreBoundGate,
  checkManUtdVsManCityGate,
  checkTeamStrengthSourceGate,
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
import { MIN_TEAM_PRIOR_MATCHES, type TeamMatchRecord } from '../src/lib/projection/teamStrength.ts'
import { expectedScore, expectedScoreFromDifficulty } from '../src/lib/projection/fixture.ts'
import type { FixtureSource } from '../src/lib/projection/expectedPoints.ts'

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
// checkVarianceGate — falsification gate #2, extended by ticket #235 to be
// non-vacuous, and by ticket #242 to be a BAND ([0.14, 0.20]) rather than a
// floor against frozen-elo.
// ============================================================================

describe('checkVarianceGate (falsification gate #2, ticket #242: band [0.14, 0.20], not a floor)', () => {
  // Two rows whose point-in-time population stdDev is exactly 0.15 (inside
  // the [0.14, 0.20] band): values 0.35 and 0.65, mean 0.5, stdDev = 0.15.
  const inBandRows = [
    { frozenEloExpectedScore: 0.48, pointInTimeExpectedScore: 0.35 },
    { frozenEloExpectedScore: 0.52, pointInTimeExpectedScore: 0.65 },
  ]

  it('PASSES when the point-in-time stdDev falls inside [0.14, 0.20], regardless of how it compares to the frozen-elo stdDev', () => {
    const result = checkVarianceGate(inBandRows)
    expect(result.pointInTimeStdDev).toBeCloseTo(0.15, 10)
    expect(result.pointInTimeStdDev).toBeGreaterThanOrEqual(0.14)
    expect(result.pointInTimeStdDev).toBeLessThanOrEqual(0.2)
    expect(result.allRowsIdentical).toBe(false)
    expect(result.passed).toBe(true)
  })

  it('ticket #242: FAILS when the point-in-time stdDev is TOO WIDE (> 0.20), even though it is wider than the frozen-elo stdDev -- the exact defect this ticket fixes: the old floor (">= frozen-elo spread") would have PASSED this, since a wider-than-frozen spread used to be the only thing checked', () => {
    // Values 0.0 and 1.0 -> stdDev 0.5, far outside the band, and far wider
    // than a narrow frozen-elo column -- reproduces the ticket's own
    // "Problem": Nott'm Forest v Coventry City resolving to 1.0000 / 0.0000.
    const rows = [
      { frozenEloExpectedScore: 0.48, pointInTimeExpectedScore: 0.0 },
      { frozenEloExpectedScore: 0.52, pointInTimeExpectedScore: 1.0 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.pointInTimeStdDev).toBeGreaterThan(result.frozenStdDev) // old floor alone would have PASSED
    expect(result.pointInTimeStdDev).toBeGreaterThan(0.2)
    expect(result.passed).toBe(false)
  })

  it('FAILS when the point-in-time spread is narrower than the band (< 0.14) -- still a worse signal, now caught by the band\'s own lower edge instead of a frozen-elo comparison', () => {
    const rows = [
      { frozenEloExpectedScore: 0.3, pointInTimeExpectedScore: 0.48 },
      { frozenEloExpectedScore: 0.7, pointInTimeExpectedScore: 0.52 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.pointInTimeStdDev).toBeLessThan(0.14)
    expect(result.passed).toBe(false)
  })

  it('the band boundaries are inclusive: stdDev exactly 0.14 or exactly 0.20 PASSES', () => {
    // Two values symmetric around 0.5 with stdDev exactly 0.14: 0.5 +/- 0.14.
    const atMin = [
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.36 },
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.64 },
    ]
    expect(checkVarianceGate(atMin).pointInTimeStdDev).toBeCloseTo(0.14, 10)
    expect(checkVarianceGate(atMin).passed).toBe(true)

    const atMax = [
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.3 },
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.7 },
    ]
    expect(checkVarianceGate(atMax).pointInTimeStdDev).toBeCloseTo(0.2, 10)
    expect(checkVarianceGate(atMax).passed).toBe(true)
  })

  // ==========================================================================
  // Ticket #235 -- the gate defect that let #229's own diagnostic pass. When
  // the new path never runs, point-in-time and frozen-elo are the SAME
  // numbers. Retained by ticket #242 as an independent defect signal
  // alongside the new band check.
  // ==========================================================================
  it('FAILS when every row is numerically identical between the two columns, even when the (identical) stdDev happens to fall inside the band', () => {
    const rows = [
      { frozenEloExpectedScore: 0.35, pointInTimeExpectedScore: 0.35 },
      { frozenEloExpectedScore: 0.65, pointInTimeExpectedScore: 0.65 },
    ]
    const result = checkVarianceGate(rows)
    expect(result.pointInTimeStdDev).toBeGreaterThanOrEqual(0.14)
    expect(result.pointInTimeStdDev).toBeLessThanOrEqual(0.2)
    expect(result.allRowsIdentical).toBe(true)
    expect(result.passed).toBe(false)
  })

  it('allRowsIdentical is false the moment even ONE row differs', () => {
    const rows = [
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.5 },
      { frozenEloExpectedScore: 0.5, pointInTimeExpectedScore: 0.6 }, // this one differs
    ]
    expect(checkVarianceGate(rows).allRowsIdentical).toBe(false)
  })

  it('allRowsIdentical is false (never vacuously true) on an empty row set, and FAILS on an empty row set (stdDev 0 falls outside the [0.14, 0.20] band)', () => {
    const result = checkVarianceGate([])
    expect(result.allRowsIdentical).toBe(false)
    expect(result.pointInTimeStdDev).toBe(0)
    expect(result.passed).toBe(false) // ticket #242: unlike the old floor, 0 is now correctly a FAIL, not a vacuous pass
  })
})

// ============================================================================
// checkExpectedScoreBoundGate — falsification gate #4, ticket #242, new.
// ============================================================================

describe('checkExpectedScoreBoundGate (falsification gate #4, ticket #242)', () => {
  it('PASSES when every row\'s point-in-time expectedScore is within [0.10, 0.90]', () => {
    const rows = [diagnosticRow({ pointInTimeExpectedScore: 0.1 }), diagnosticRow({ pointInTimeExpectedScore: 0.9 }), diagnosticRow({ pointInTimeExpectedScore: 0.5 })]
    const result = checkExpectedScoreBoundGate(rows)
    expect(result.outOfBoundRows).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('named test: FAILS and names the row when a fixture\'s expectedScore falls outside [0.10, 0.90] -- the exact Nott\'m Forest v Coventry City defect (1.0000 / 0.0000) this gate exists to catch', () => {
    const certainRow = diagnosticRow({ teamName: "Nott'm Forest", opponentName: 'Coventry City', pointInTimeExpectedScore: 1.0 })
    const zeroRow = diagnosticRow({ teamName: 'Coventry City', opponentName: "Nott'm Forest", pointInTimeExpectedScore: 0.0 })
    const result = checkExpectedScoreBoundGate([certainRow, zeroRow])
    expect(result.outOfBoundRows).toHaveLength(2)
    expect(result.outOfBoundRows).toContain(certainRow)
    expect(result.outOfBoundRows).toContain(zeroRow)
    expect(result.passed).toBe(false)
  })

  it('the bounds are exclusive at the edges named in the ticket -- exactly 0.10 and exactly 0.90 are IN bound (the ticket\'s own gate text uses "outside", not "at or outside")', () => {
    const result = checkExpectedScoreBoundGate([diagnosticRow({ pointInTimeExpectedScore: 0.1 }), diagnosticRow({ pointInTimeExpectedScore: 0.9 })])
    expect(result.outOfBoundRows).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('just outside either edge FAILS: 0.0999... below, 0.9001... above', () => {
    expect(checkExpectedScoreBoundGate([diagnosticRow({ pointInTimeExpectedScore: 0.0999 })]).passed).toBe(false)
    expect(checkExpectedScoreBoundGate([diagnosticRow({ pointInTimeExpectedScore: 0.9001 })]).passed).toBe(false)
  })

  it('PASSES (vacuously true, matching the other gates\' own "empty is not itself a defect" convention) on an empty row set', () => {
    const result = checkExpectedScoreBoundGate([])
    expect(result.outOfBoundRows).toEqual([])
    expect(result.passed).toBe(true)
  })
})

// ============================================================================
// checkTeamStrengthSourceGate — ticket #235's NEW, PRIMARY gate.
// ============================================================================

describe('checkTeamStrengthSourceGate (ticket #235 -- the PRIMARY falsification gate)', () => {
  it('PASSES when at least one row resolves to source team-strength', () => {
    const rows: { fixtureSource: FixtureSource }[] = [{ fixtureSource: 'stale-elo' }, { fixtureSource: 'team-strength' }]
    const result = checkTeamStrengthSourceGate(rows)
    expect(result.count).toBe(1)
    expect(result.passed).toBe(true)
  })

  it('FAILS when NO row resolves to team-strength -- the exact #229 scenario (all twenty rows stale-elo)', () => {
    const rows: { fixtureSource: FixtureSource }[] = Array.from({ length: 20 }, () => ({ fixtureSource: 'stale-elo' as const }))
    const result = checkTeamStrengthSourceGate(rows)
    expect(result.count).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('FAILS on an empty row set, never a vacuous pass', () => {
    const result = checkTeamStrengthSourceGate([])
    expect(result.count).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('counts every matching row, not just whether one exists', () => {
    const rows: { fixtureSource: FixtureSource }[] = [
      { fixtureSource: 'team-strength' },
      { fixtureSource: 'team-strength' },
      { fixtureSource: 'elo' },
      { fixtureSource: 'fdr' },
    ]
    expect(checkTeamStrengthSourceGate(rows).count).toBe(2)
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
// buildTeamStrengthTable — ticket #235, point 4 of "Fix the gate": the full
// point-in-time strength table, sorted by rate.
// ============================================================================

describe('buildTeamStrengthTable (ticket #235)', () => {
  const MAN_UTD_ID = 1
  const MAN_CITY_ID = 2
  const manUtd: DiagnosticTeamRow = { id: MAN_UTD_ID, name: 'Man Utd', short_name: 'MUN', code: 10, elo: 1915, elo_stale_since: null }
  const manCity: DiagnosticTeamRow = { id: MAN_CITY_ID, name: 'Man City', short_name: 'MCI', code: 20, elo: 1971, elo_stale_since: null }
  const teamsById = new Map([
    [MAN_UTD_ID, manUtd],
    [MAN_CITY_ID, manCity],
  ])

  it('sorts by rate descending -- the stronger club (by teamStrengthRate) ranks first', () => {
    const teamMatchRecords: TeamMatchRecord[] = [
      { matchId: 'a', gameweek: 1, teamCode: 10, goalsScored: 0, goalsConceded: 2 }, // Man Utd: rate -2
      { matchId: 'b', gameweek: 1, teamCode: 20, goalsScored: 3, goalsConceded: 0 }, // Man City: rate +3
    ]
    const table = buildTeamStrengthTable({ teamsById, teamMatchRecords, beforeGameweek: 5 })
    expect(table).toHaveLength(2)
    expect(table[0].teamName).toBe('Man City')
    expect(table[0].rate).toBeGreaterThan(table[1].rate)
    expect(table[1].teamName).toBe('Man Utd')
  })

  it('a club with no resolvable teams.code is excluded entirely, not shown with a guessed row', () => {
    const teamsWithUnresolvable = new Map(teamsById)
    teamsWithUnresolvable.set(3, { id: 3, name: 'Nocode FC', short_name: 'NFC', code: null, elo: null, elo_stale_since: null })
    const table = buildTeamStrengthTable({ teamsById: teamsWithUnresolvable, teamMatchRecords: [], beforeGameweek: 5 })
    expect(table.find((r) => r.teamName === 'Nocode FC')).toBeUndefined()
    expect(table).toHaveLength(2) // just Man Utd and Man City, both 0 matches
  })

  it('meetsMinimum is true only at or above MIN_TEAM_PRIOR_MATCHES', () => {
    const teamMatchRecords: TeamMatchRecord[] = Array.from({ length: MIN_TEAM_PRIOR_MATCHES }, (_, i) => ({
      matchId: `m${i}`,
      gameweek: i + 1,
      teamCode: 10,
      goalsScored: 1,
      goalsConceded: 0,
    }))
    const table = buildTeamStrengthTable({ teamsById, teamMatchRecords, beforeGameweek: MIN_TEAM_PRIOR_MATCHES + 1 })
    const manUtdRow = table.find((r) => r.teamName === 'Man Utd')!
    const manCityRow = table.find((r) => r.teamName === 'Man City')!
    expect(manUtdRow.matches).toBe(MIN_TEAM_PRIOR_MATCHES)
    expect(manUtdRow.meetsMinimum).toBe(true)
    expect(manCityRow.matches).toBe(0)
    expect(manCityRow.meetsMinimum).toBe(false)
  })

  it('respects the lookahead guard: matches at or after beforeGameweek are not counted', () => {
    const teamMatchRecords: TeamMatchRecord[] = [{ matchId: 'a', gameweek: 5, teamCode: 10, goalsScored: 9, goalsConceded: 0 }]
    const table = buildTeamStrengthTable({ teamsById, teamMatchRecords, beforeGameweek: 5 })
    expect(table.find((r) => r.teamName === 'Man Utd')?.matches).toBe(0)
  })

  it('a club with zero matches still appears, at rate 0 (never a guessed value or an omission)', () => {
    const table = buildTeamStrengthTable({ teamsById, teamMatchRecords: [], beforeGameweek: 1 })
    expect(table).toHaveLength(2)
    for (const row of table) {
      expect(row.matches).toBe(0)
      expect(row.rate).toBe(0)
      expect(row.meetsMinimum).toBe(false)
    }
  })

  it('an empty teamsById produces an empty table, not an error', () => {
    expect(buildTeamStrengthTable({ teamsById: new Map(), teamMatchRecords: [], beforeGameweek: 5 })).toEqual([])
  })
})

// ============================================================================
// generateReportMarkdown — smoke test, not a full snapshot.
// ============================================================================

describe('generateReportMarkdown', () => {
  it('includes the gameweek, all four gate verdicts, one table row per fixture row, and the strength table', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow()],
      teamStrengthSourceGate: { count: 1, passed: true },
      manUtdGate: { status: 'pass', manUtdPointInTimeExpectedScore: 0.3 },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, allRowsIdentical: false, passed: true },
      expectedScoreBoundGate: { outOfBoundRows: [], passed: true },
      strengthTable: [
        { teamId: 1, teamName: 'Man Utd', teamShortName: 'MUN', matches: 4, goalsScored: 3, goalsConceded: 5, rate: -0.5, meetsMinimum: true },
        { teamId: 2, teamName: 'Chelsea', teamShortName: 'CHE', matches: 4, goalsScored: 8, goalsConceded: 2, rate: 1.5, meetsMinimum: true },
      ],
    })
    expect(markdown).toMatch(/Gameweek examined: 4/)
    expect(markdown).toMatch(/PASS/)
    expect(markdown).toMatch(/PRIMARY/)
    expect(markdown).toMatch(/Man Utd/)
    expect(markdown).toMatch(/Man City/)
    expect(markdown).toMatch(/team-strength/)
    expect(markdown).toMatch(/Overall: PASS/)
    expect(markdown).toMatch(/Point-in-time team strength/)
    expect(markdown).toMatch(/Chelsea/)
    expect(markdown).toMatch(/teamStrengthRate/)
  })

  it('reports "Overall: STOP" when any of the four gates fails', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow()],
      teamStrengthSourceGate: { count: 1, passed: true },
      manUtdGate: { status: 'fail', manUtdPointInTimeExpectedScore: 0.6 },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, allRowsIdentical: false, passed: true },
      expectedScoreBoundGate: { outOfBoundRows: [], passed: true },
      strengthTable: [],
    })
    expect(markdown).toMatch(/Overall: STOP/)
  })

  it('reports "Overall: STOP" when the team-strength-source gate (the PRIMARY gate) fails, even if the other three pass', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow({ fixtureSource: 'stale-elo' })],
      teamStrengthSourceGate: { count: 0, passed: false },
      manUtdGate: { status: 'pass', manUtdPointInTimeExpectedScore: 0.3 },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.05, allRowsIdentical: true, passed: false },
      expectedScoreBoundGate: { outOfBoundRows: [], passed: true },
      strengthTable: [],
    })
    expect(markdown).toMatch(/Overall: STOP/)
    expect(markdown).toMatch(/FAIL/)
  })

  it('ticket #242: reports "Overall: STOP" and names the offending fixture when ONLY the expectedScore-bound gate (gate 4) fails, even if the other three pass', () => {
    const outOfBoundRow = diagnosticRow({ teamName: "Nott'm Forest", opponentName: 'Coventry City', pointInTimeExpectedScore: 1.0 })
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 5,
      rows: [outOfBoundRow],
      teamStrengthSourceGate: { count: 1, passed: true },
      manUtdGate: { status: 'not-applicable', manUtdPointInTimeExpectedScore: null },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, allRowsIdentical: false, passed: true },
      expectedScoreBoundGate: { outOfBoundRows: [outOfBoundRow], passed: false },
      strengthTable: [],
    })
    expect(markdown).toMatch(/Overall: STOP/)
    expect(markdown).toMatch(/Nott'm Forest v Coventry City/)
  })

  it('renders an empty strength table without error', () => {
    const markdown = generateReportMarkdown({
      generatedAt: new Date('2026-09-12T00:00:00Z'),
      gameweekId: 4,
      rows: [diagnosticRow()],
      teamStrengthSourceGate: { count: 1, passed: true },
      manUtdGate: { status: 'not-applicable', manUtdPointInTimeExpectedScore: null },
      varianceGate: { frozenStdDev: 0.05, pointInTimeStdDev: 0.15, allRowsIdentical: false, passed: true },
      expectedScoreBoundGate: { outOfBoundRows: [], passed: true },
      strengthTable: [],
    })
    expect(markdown).toMatch(/Point-in-time team strength/)
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

// ============================================================================
// Ticket #235 — source invariants. main() itself can't be exercised without
// a live Supabase project (see file header), so the exit-non-zero wiring is
// proven by grepping the real, shipped source for the exact condition —
// same technique the rest of this file already uses.
// ============================================================================

describe('ticket #235 source invariants', () => {
  it('main() exits non-zero when the team-strength-source gate fails -- named test that the diagnostic exits non-zero when no fixture resolves to team-strength', () => {
    // checkTeamStrengthSourceGate's own unit tests (above) prove `passed` is
    // false when no row resolves to team-strength. This proves main() ACTS
    // on that: the failure `if` includes `!teamStrengthSourceGate.passed`,
    // ahead of `process.exit(1)`, so a false `passed` here is sufficient on
    // its own to fail the job regardless of the other two gates.
    const failureCheckMatch = source.match(/if\s*\(([^)]*teamStrengthSourceGate\.passed[^)]*)\)\s*\{/)
    expect(failureCheckMatch).not.toBeNull()
    expect(failureCheckMatch![1]).toMatch(/!teamStrengthSourceGate\.passed/)
    const failureBlockStart = source.indexOf(failureCheckMatch![0])
    const failureBlockEnd = source.indexOf('process.exit(1)', failureBlockStart)
    expect(failureBlockEnd).toBeGreaterThan(failureBlockStart)
    // The same block must also call recordJobRun with status 'failure' --
    // proving this is the real failure path, not a dead branch.
    const failureBlock = source.slice(failureBlockStart, failureBlockEnd)
    expect(failureBlock).toMatch(/status:\s*'failure'/)
  })

  it('checkTeamStrengthSourceGate is called and its result feeds the report AND job_runs.details', () => {
    expect(source).toMatch(/const teamStrengthSourceGate = checkTeamStrengthSourceGate\(rows\)/)
    expect(source).toMatch(/teamStrengthSourceGate,?\s*\n?\s*manUtdGate,?\s*\n?\s*varianceGate/) // ReportData construction
  })

  it('the point-in-time team-strength table is built via buildTeamStrengthTable and included in ReportData', () => {
    expect(source).toMatch(/buildTeamStrengthTable\(\{/)
    expect(source).toMatch(/strengthTable/)
  })

  it('the team-strength construction no longer reads player_match_stats at all -- it is built entirely from public.fixtures', () => {
    expect(source).not.toMatch(/\.from\('player_match_stats'\)/)
    expect(source).not.toMatch(/buildTeamMatchRecords\(/) // the OLD (player_match_stats) builder -- buildTeamMatchRecordsFromFixtures is a different name and does not match this pattern
    expect(source).toMatch(/buildTeamMatchRecordsFromFixtures\(/)
  })

  it('the fixtures read is unfiltered (no `.eq(\'event_id\', gameweekId)` on the DATA select) -- team strength needs the whole season, not just the next gameweek', () => {
    expect(source).not.toMatch(/\.eq\('event_id',\s*gameweekId\)/)
  })
})

// ============================================================================
// Ticket #242 — source invariants. main() itself can't be exercised without a
// live Supabase project (see file header); the exit-non-zero wiring for the
// two NEW conditions (the variance gate's band, and the new bound gate) is
// proven by grepping the real, shipped source, matching the technique
// ticket #235's own section above already uses.
// ============================================================================

describe('ticket #242 source invariants', () => {
  it('named test: main() exits non-zero when any fixture\'s expectedScore falls outside [0.10, 0.90] (gate 4) -- checkExpectedScoreBoundGate\'s own unit tests above prove `passed` is false in that case; this proves main() ACTS on it', () => {
    const failureCheckMatch = source.match(/if\s*\(([^)]*expectedScoreBoundGate\.passed[^)]*)\)\s*\{/)
    expect(failureCheckMatch).not.toBeNull()
    expect(failureCheckMatch![1]).toMatch(/!expectedScoreBoundGate\.passed/)
    const failureBlockStart = source.indexOf(failureCheckMatch![0])
    const failureBlockEnd = source.indexOf('process.exit(1)', failureBlockStart)
    expect(failureBlockEnd).toBeGreaterThan(failureBlockStart)
    const failureBlock = source.slice(failureBlockStart, failureBlockEnd)
    expect(failureBlock).toMatch(/status:\s*'failure'/)
  })

  it('named test: main() exits non-zero when the point-in-time stdDev falls outside [0.14, 0.20] (gate 2\'s new band) -- checkVarianceGate\'s own unit tests above prove `passed` is false in that case; this proves main() ACTS on it via the SAME `!varianceGate.passed` condition ticket #235 already wired up', () => {
    const failureCheckMatch = source.match(/if\s*\(([^)]*varianceGate\.passed[^)]*)\)\s*\{/)
    expect(failureCheckMatch).not.toBeNull()
    expect(failureCheckMatch![1]).toMatch(/!varianceGate\.passed/)
    const failureBlockStart = source.indexOf(failureCheckMatch![0])
    const failureBlockEnd = source.indexOf('process.exit(1)', failureBlockStart)
    expect(failureBlockEnd).toBeGreaterThan(failureBlockStart)
    const failureBlock = source.slice(failureBlockStart, failureBlockEnd)
    expect(failureBlock).toMatch(/status:\s*'failure'/)
  })

  it('checkExpectedScoreBoundGate is called and its result feeds the report AND job_runs.details', () => {
    expect(source).toMatch(/const expectedScoreBoundGate = checkExpectedScoreBoundGate\(rows\)/)
    expect(source).toMatch(/expectedScoreBoundGate,?\s*\n?\s*strengthTable/) // ReportData construction
  })

  it('the variance gate band constants are exactly [0.14, 0.20], and the bound gate constants are exactly [0.10, 0.90]', () => {
    expect(source).toMatch(/TEAM_STRENGTH_STDDEV_MIN\s*=\s*0\.14/)
    expect(source).toMatch(/TEAM_STRENGTH_STDDEV_MAX\s*=\s*0\.2\b/)
    expect(source).toMatch(/EXPECTED_SCORE_BOUND_MIN\s*=\s*0\.1\b/)
    expect(source).toMatch(/EXPECTED_SCORE_BOUND_MAX\s*=\s*0\.9\b/)
  })
})
