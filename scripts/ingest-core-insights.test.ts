// Unit tests for scripts/ingest-core-insights.ts's team-elo join logic —
// ticket #32, extended by ticket #63 (null elo on an unmatched club rather
// than leaving a stale — possibly another club's — rating in place), and
// narrowed by ticket #176 (never null a known rating over a source gap;
// preserve it and record staleness instead — see that file's header for the
// full "because", including why #63's own "genuinely removed" case cannot
// actually reach this job's input).
//
// These exercise buildEloByCode/planTeamEloUpdates directly: pure functions
// with no live Supabase project involved (none is available to this
// Builder's session). They prove the join is on `code`, that a code with no
// matching public.teams row is skipped and counted, that a public.teams row
// whose code has no CSV entry is queued to be PRESERVED and marked stale
// (ticket #176, replacing #63's queue-for-nulling), that a row whose code IS
// present still gets the CSV value exactly as before (#63/#176 must not
// regress this), that a malformed or blank elo cell never overwrites an
// existing rating and is now also queued to be marked stale (ticket #176),
// and that a duplicate code across two public.teams rows updates neither,
// preserves neither, and is counted as a conflict — every testable bullet
// from the ticket's definition of done. It cannot prove what the *live*
// table currently holds, or that the projection fallback then engages;
// that's a human verification step after merge, out of scope here (see
// ticket #63's Notes, still true under #176).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildClubCodeBySlug,
  buildElementTypeMap,
  buildEloByCode,
  buildTeamCodeMap,
  countOpponentsResolvedViaFallback,
  planTeamEloUpdates,
  resolveOpponentTeamCode,
  slugifyClubName,
  tallyOpponentResolution,
  TEAMS_REQUIRED_COLUMNS,
  toMatchStatRow,
  UnknownPositionError,
  type ClubSlugSource,
  type MatchStatRow,
  type TeamIdentityRow,
} from './ingest-core-insights.js'

// ============================================================================
// TEAMS_REQUIRED_COLUMNS — the schema-change guard the DoD says must survive.
// ============================================================================

describe('TEAMS_REQUIRED_COLUMNS', () => {
  it('still requires code and elo', () => {
    expect(TEAMS_REQUIRED_COLUMNS).toContain('code')
    expect(TEAMS_REQUIRED_COLUMNS).toContain('elo')
  })

  // Ticket #167: opponent resolution reads teams.csv's fotmob_name column
  // (see buildClubCodeBySlug) — required here so a season whose teams.csv
  // drops the column entirely fails loudly at parseCsvRecords, rather than
  // silently resolving zero opponents with no explanation.
  it('now also requires fotmob_name (ticket #167)', () => {
    expect(TEAMS_REQUIRED_COLUMNS).toContain('fotmob_name')
  })

  // Ticket #176: name/short_name are now READ (as the fallback slug source
  // when fotmob_name is blank — see buildClubCodeBySlug), so a season whose
  // teams.csv drops either column must fail loudly here too, rather than
  // silently leaving the fallback permanently empty.
  it('now also requires name and short_name (ticket #176)', () => {
    expect(TEAMS_REQUIRED_COLUMNS).toContain('name')
    expect(TEAMS_REQUIRED_COLUMNS).toContain('short_name')
  })
})

// ============================================================================
// buildEloByCode
// ============================================================================

describe('buildEloByCode', () => {
  it('builds a code -> elo map from well-formed rows', () => {
    const result = buildEloByCode([
      { code: '90', elo: '1650.5', name: 'Burnley' },
      { code: '43', elo: '1820.0', name: 'Man City' },
    ])
    expect(result.eloByCode.get(90)).toBe(1650.5)
    expect(result.eloByCode.get(43)).toBe(1820)
    expect(result.seenCodes).toEqual(new Set([90, 43]))
    expect(result.malformedElo).toBe(0)
  })

  it('skips a row with an empty elo cell rather than mapping it to null, and counts it', () => {
    const result = buildEloByCode([{ code: '90', elo: '', name: 'Burnley' }])
    expect(result.eloByCode.has(90)).toBe(false)
    expect(result.malformedElo).toBe(1)
    // The code was still seen — distinguishes "malformed elo" from "code not in CSV at all".
    expect(result.seenCodes.has(90)).toBe(true)
  })

  it('skips a row with a non-numeric elo cell and counts it', () => {
    const result = buildEloByCode([{ code: '90', elo: 'N/A', name: 'Burnley' }])
    expect(result.eloByCode.has(90)).toBe(false)
    expect(result.malformedElo).toBe(1)
  })

  it('ignores a row whose code does not parse (not countable — nothing to join it onto)', () => {
    const result = buildEloByCode([{ code: '', elo: '1650.5', name: 'Burnley' }])
    expect(result.eloByCode.size).toBe(0)
    expect(result.seenCodes.size).toBe(0)
    expect(result.malformedElo).toBe(0)
  })
})

// ============================================================================
// planTeamEloUpdates — the join itself.
// ============================================================================

function team(id: number, code: number | null, eloStaleSince: string | null = null): TeamIdentityRow {
  return { id, code, elo_stale_since: eloStaleSince }
}

describe('planTeamEloUpdates', () => {
  it('matches a CSV code to the public.teams row with that code, not by array position or id', () => {
    // Deliberately out-of-order ids relative to codes, and ids that do NOT
    // equal the codes — the failure mode this ticket fixes.
    const existingTeams = [team(3, 91), team(12, 40), team(13, 2)]
    const elo = buildEloByCode([
      { code: '91', elo: '1500' },
      { code: '40', elo: '1400' },
      { code: '2', elo: '1300' },
    ])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        { id: 3, elo: 1500 },
        { id: 12, elo: 1400 },
        { id: 13, elo: 1300 },
      ])
    )
    expect(plan.updates).toHaveLength(3)
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
    expect(plan.duplicateCodeConflicts).toBe(0)
    expect(plan.staleMarks).toEqual([])
  })

  it('skips (does not insert) a CSV code with no matching public.teams row, and counts it', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([
      { code: '90', elo: '1650' },
      { code: '999', elo: '1200' }, // relegated club, e.g. — no row in public.teams
    ])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([{ id: 1, elo: 1650 }])
    expect(plan.codesNotInTeams).toBe(1)
    // Nothing to preserve/mark: there is no public.teams row for the missing code.
    expect(plan.staleMarks).toEqual([])
  })

  // Ticket #63/#176 — this is the DoD's central regression guard: a matched
  // code must still take the CSV value exactly as before, unaffected by the
  // preserve-and-mark-stale path, and its elo_stale_since is not part of
  // updates (applyTeamEloUpdates clears it separately — see that function).
  it('sets elo to the CSV value for a row whose code IS present, exactly as before #63/#176', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([{ id: 1, elo: 1650 }])
    expect(plan.staleMarks).toEqual([])
  })

  // Ticket #176 — DoD shape 1 of 3: a club ABSENT from the season file
  // (a promoted club not in the historical CSV, e.g.) is queued to be
  // PRESERVED and marked stale, never nulled.
  it('queues a public.teams row to be preserved and marked stale when its code has no CSV entry, and counts it (ticket #176, replacing #63)', () => {
    const existingTeams = [team(1, 90), team(2, 55)] // team 2's code never appears in the CSV
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([{ id: 1, elo: 1650 }])
    expect(plan.teamsCodesNotInCsv).toBe(1)
    expect(plan.staleMarks).toEqual([{ id: 2, alreadyStale: false }])
  })

  it('counts a public.teams row with a null code as not-in-csv, never crashing the join, and queues it to be preserved and marked stale (#176)', () => {
    const existingTeams = [team(1, null)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.teamsCodesNotInCsv).toBe(1)
    expect(plan.codesNotInTeams).toBe(1) // code 90 also has no matching row
    expect(plan.staleMarks).toEqual([{ id: 1, alreadyStale: false }])
  })

  // Ticket #176 — DoD shape 2 of 3: a club present in the CSV with a BLANK
  // elo cell retains its existing rating and is now also queued to be
  // marked stale (previously silently untouched and uncounted under #63).
  it('preserves the existing rating and queues the row to be marked stale when the elo cell was blank (ticket #176)', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([{ code: '90', elo: '' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.teamsCodeInCsvNoUsableElo).toBe(1)
    expect(plan.staleMarks).toEqual([{ id: 1, alreadyStale: false }])
    // Not counted as codesNotInTeams or teamsCodesNotInCsv — the code
    // matched fine, only the elo value was missing.
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
  })

  // Ticket #176 — DoD shape 3 of 3: a club present in the CSV with a
  // MALFORMED (non-blank, non-numeric) elo cell gets the identical
  // preserve-and-mark-stale treatment as the blank-cell case above.
  it('preserves the existing rating and queues the row to be marked stale when the elo cell was malformed (ticket #63/#176)', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([{ code: '90', elo: 'not-a-number' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.teamsCodeInCsvNoUsableElo).toBe(1)
    expect(plan.staleMarks).toEqual([{ id: 1, alreadyStale: false }])
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
    expect(plan.duplicateCodeConflicts).toBe(0)
  })

  // Ticket #176: a row already marked stale on an earlier run carries that
  // forward as alreadyStale: true, so applyTeamEloStaleMarks knows not to
  // re-stamp elo_stale_since and lose the original moment it first went stale.
  it('carries an already-stale row\'s prior elo_stale_since state through as alreadyStale: true (ticket #176)', () => {
    const existingTeams = [team(2, 55, '2026-08-20T09:00:00.000Z')]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }]) // code 55 absent from CSV
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.staleMarks).toEqual([{ id: 2, alreadyStale: true }])
  })

  it('updates neither row, preserves neither row, and counts a conflict when two public.teams rows share a code', () => {
    const existingTeams = [team(1, 90), team(2, 90)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.staleMarks).toEqual([])
    expect(plan.duplicateCodeConflicts).toBe(1)
    // Not double-counted under the other buckets.
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
  })

  it('produces no updates, no preservations and no false positives against an empty CSV and an empty table', () => {
    const plan = planTeamEloUpdates([], buildEloByCode([]))
    expect(plan).toEqual({
      updates: [],
      staleMarks: [],
      codesNotInTeams: 0,
      teamsCodesNotInCsv: 0,
      teamsCodeInCsvNoUsableElo: 0,
      duplicateCodeConflicts: 0,
    })
  })

  // Ticket #176's own reconciliation requirement: the two new preserved-count
  // buckets sum to the total staleMarks length, for any input.
  it('teamsCodesNotInCsv + teamsCodeInCsvNoUsableElo reconciles exactly against staleMarks.length', () => {
    const existingTeams = [
      team(1, 90), // matched, updates
      team(2, 55), // absent from CSV -> teamsCodesNotInCsv
      team(3, 91), // in CSV, blank elo -> teamsCodeInCsvNoUsableElo
      team(4, null), // null code -> teamsCodesNotInCsv
    ]
    const elo = buildEloByCode([
      { code: '90', elo: '1650' },
      { code: '91', elo: '' },
    ])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.teamsCodesNotInCsv + plan.teamsCodeInCsvNoUsableElo).toBe(plan.staleMarks.length)
    expect(plan.staleMarks).toHaveLength(3)
  })
})

// ============================================================================
// Source invariant — no upsert-into-teams call anywhere in the team code
// path, and no team-identity column written outside TEAMS_REQUIRED_COLUMNS
// or comments. Grepping the actual file rather than re-deriving the same
// logic here in TypeScript keeps this test honest about what shipped.
// ============================================================================

describe('source invariants (grep-based, matching the DoD wording exactly)', () => {
  const sourcePath = fileURLToPath(new URL('./ingest-core-insights.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it("contains no .from('teams').upsert( call", () => {
    expect(source).not.toMatch(/\.from\(['"]teams['"]\)\.upsert\(/)
  })

  it("never writes onConflict: 'id' anywhere (the team code path's old upsert target)", () => {
    expect(source).not.toMatch(/onConflict:\s*['"]id['"]/)
  })

  // Ticket #176's own DoD line, replacing #63's teamsEloNulled: job_runs.details
  // must carry a named count of teams PRESERVED rather than nulled, alongside
  // the pre-existing counters.
  it('reports teamsEloPreserved as a named job_runs.details field (ticket #176, replacing #63\'s teamsEloNulled)', () => {
    expect(source).toMatch(/teamsEloPreserved/)
  })

  // Ticket #176's own central DoD line: no code path anywhere in this file
  // may set teams.elo to null. The old nulling behaviour (#63) has been
  // replaced, not merely deprioritized.
  it('never sets elo: null anywhere in the file (ticket #176 — #63\'s nulling is replaced)', () => {
    expect(source).not.toMatch(/elo:\s*null/)
  })

  it('references identity columns this job never writes only inside TEAMS_REQUIRED_COLUMNS/comments, never as a write', () => {
    // Strip whole-line and trailing "// ..." comments (not URLs — those are
    // never preceded by whitespace) so what's left is code only. The DoD's
    // own wording permits these words in comments; TEAMS_REQUIRED_COLUMNS no
    // longer lists them (asserted above), so any remaining appearance in the
    // stripped code would mean a write path, which is what this actually guards.
    // `short_name` and `name` are deliberately NOT in this list any more
    // (ticket #176) — see the dedicated test below, which proves the
    // narrower thing that is actually still true: they are READ from the
    // source CSV (the club-slug fallback) but never WRITTEN to public.teams.
    const codeOnly = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .map((line) => line.replace(/\s\/\/.*$/, ''))
      .join('\n')
    for (const forbidden of ['strength_overall_home', 'strength_attack_home', 'strength_defence_home', 'pulse_id']) {
      expect(codeOnly.includes(forbidden)).toBe(false)
    }
  })

  // Ticket #176: name/short_name are now legitimately READ from teams.csv
  // (the club-slug fallback, buildClubCodeBySlug), but the DoD's underlying
  // invariant — this job never WRITES team identity to public.teams; that
  // stays scripts/ingest-fpl.ts's alone — must still hold. Every
  // .update(...)/.upsert(...) call against 'teams' in this file is checked
  // directly rather than re-deriving the same string-matching logic above,
  // which no longer catches this (name/short_name now appear in legitimate
  // read paths).
  it('never writes name or short_name to public.teams (ticket #176 — read-only use of both columns)', () => {
    const teamsWriteCalls = source.match(/\.from\(\s*['"]teams['"]\s*\)\s*\.(update|upsert)\([^)]*\)/gs) ?? []
    expect(teamsWriteCalls.length).toBeGreaterThan(0) // sanity: this job does write teams.elo/elo_stale_since somewhere
    for (const call of teamsWriteCalls) {
      expect(call).not.toMatch(/\bname\b/)
      expect(call).not.toMatch(/\bshort_name\b/)
    }
  })
})

// ============================================================================
// competition (ticket #54) — source invariants. The actual parsing is
// scripts/lib/competition.test.ts's job; what belongs here is proving THIS
// file uses it the way the ticket requires: derived once via the shared
// parser, written on every row, and never caught or defaulted past on an
// unknown token. Grepping the shipped source, same technique as the
// invariants above.
// ============================================================================

describe('competition (ticket #54) — source invariants', () => {
  const sourcePath = fileURLToPath(new URL('./ingest-core-insights.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it('imports parseCompetition from the shared module rather than pattern-matching match_id locally', () => {
    expect(source).toMatch(/import\s*\{\s*parseCompetition\s*\}\s*from\s*['"]\.\/lib\/competition\.js['"]/)
    expect(source).not.toMatch(/match_id.*\.includes\(/) // no LIKE-style local pattern match on match_id
  })

  it('never defaults an unrecognized competition to "prem"', () => {
    // The ticket's own most-important line. A hardcoded fallback like
    // `?? 'prem'` or `|| 'prem'` right after parseCompetition would silently
    // reproduce the bug this ticket exists to fix.
    expect(source).not.toMatch(/parseCompetition\([^)]*\)\s*(\?\?|\|\|)\s*['"]prem['"]/)
  })

  it('does not wrap parseCompetition in a try/catch that would swallow UnknownCompetitionError', () => {
    // toMatchStatRow calls parseCompetition() with no try around it, so the
    // throw propagates out of the per-row loop in upsertPlayerMatchStats and
    // all the way to main()'s own catch block — which is what turns an
    // unknown token into a failed job_runs row rather than a skipped row.
    // Widened from 800 to 2200 chars by ticket #146, which added a fifth
    // parameter (elementTypeByPlayerId) and its doc comment ahead of the
    // parseCompetition() call this test looks for — the function itself is
    // ~2100 chars end to end; 2200 covers it with headroom rather than
    // re-deriving an exact boundary.
    const toMatchStatRowBody = source.slice(source.indexOf('function toMatchStatRow'), source.indexOf('function toMatchStatRow') + 2200)
    expect(toMatchStatRowBody).toMatch(/parseCompetition\(/)
    expect(toMatchStatRowBody).not.toMatch(/try\s*\{/)
  })

  it('writes competition on the upserted row, not just an in-memory field', () => {
    expect(source).toMatch(/competition[,\s]*$/m)
  })

  it('reports rows written and rows now carrying a non-null competition as named job_runs.details fields', () => {
    expect(source).toMatch(/matchRowsWithCompetition/)
  })
})

// ============================================================================
// team_goals_conceded (ticket #125) — toMatchStatRow exercised directly, the
// same technique buildEloByCode/planTeamEloUpdates above use to prove
// behaviour without a live Supabase project.
// ============================================================================

/** A well-formed source CSV row with every MATCH_STATS_REQUIRED_COLUMNS column present, so a single test only has to override the cell(s) it cares about. */
function matchStatsRecord(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    player_id: '10',
    match_id: '25-26-prem-arsenal-vs-chelsea',
    minutes_played: '90',
    goals: '0',
    assists: '0',
    xg: '0.1',
    xa: '0.05',
    xgot: '0.2',
    shots_on_target: '1',
    tackles: '2',
    tackles_won: '1',
    interceptions: '1',
    recoveries: '3',
    blocks: '1',
    clearances: '4',
    headed_clearances: '1',
    saves: '0',
    goals_conceded: '1',
    goals_prevented: '0.3',
    team_goals_conceded: '2',
    ...overrides,
  }
}

describe('toMatchStatRow — team_goals_conceded (ticket #125)', () => {
  it('reads team_goals_conceded from the CSV row and writes it', () => {
    const row = toMatchStatRow(matchStatsRecord({ team_goals_conceded: '3' }), '2025-2026', 1, new Map())
    expect(row?.team_goals_conceded).toBe(3)
  })

  // DoD: "goals_conceded is still ingested and still written, unchanged."
  it('still ingests and writes goals_conceded unchanged, alongside the new team_goals_conceded', () => {
    const row = toMatchStatRow(matchStatsRecord({ goals_conceded: '1', team_goals_conceded: '3' }), '2025-2026', 1, new Map())
    expect(row?.goals_conceded).toBe(1)
    expect(row?.team_goals_conceded).toBe(3)
    // The two must never be conflated — different stats, different cells.
    expect(row?.goals_conceded).not.toBe(row?.team_goals_conceded)
  })

  // DoD: "A source row with a blank/missing team_goals_conceded cell writes
  // null, not 0." — the most important test in the ingest half.
  it('writes null, not 0, for a blank team_goals_conceded cell', () => {
    const row = toMatchStatRow(matchStatsRecord({ team_goals_conceded: '' }), '2025-2026', 1, new Map())
    expect(row?.team_goals_conceded).toBeNull()
    expect(row?.team_goals_conceded).not.toBe(0)
  })

  it('writes null, not 0, when the team_goals_conceded column is absent from the row object entirely', () => {
    const record = matchStatsRecord()
    delete record.team_goals_conceded
    const row = toMatchStatRow(record, '2025-2026', 1, new Map())
    expect(row?.team_goals_conceded).toBeNull()
    expect(row?.team_goals_conceded).not.toBe(0)
  })

  it('writes a real zero (not null) when the source cell genuinely reads 0 — a team that conceded nothing', () => {
    const row = toMatchStatRow(matchStatsRecord({ team_goals_conceded: '0' }), '2025-2026', 1, new Map())
    expect(row?.team_goals_conceded).toBe(0)
    expect(row?.team_goals_conceded).not.toBeNull()
  })
})

// ============================================================================
// buildElementTypeMap / toMatchStatRow — element_type (ticket #146). Same
// "exercise the pure function directly" technique buildPlayerCodeMap's own
// (untested-in-isolation, but toMatchStatRow-exercised) counterpart uses —
// this one is exported and tested directly since it is the piece the
// backtest and feature_history depend on getting exactly right.
// ============================================================================

describe('buildElementTypeMap', () => {
  it('maps every known FPL-Core-Insights position word to the plain FPL position code', () => {
    const map = buildElementTypeMap([
      { player_id: '1', position: 'Goalkeeper' },
      { player_id: '2', position: 'Defender' },
      { player_id: '3', position: 'Midfielder' },
      { player_id: '4', position: 'Forward' },
    ])
    expect(map.get(1)).toBe(1)
    expect(map.get(2)).toBe(2)
    expect(map.get(3)).toBe(3)
    expect(map.get(4)).toBe(4)
  })

  it('leaves a blank position cell out of the map — the same "small, expected gap" treatment as an unparseable player_code', () => {
    const map = buildElementTypeMap([{ player_id: '5', position: '' }])
    expect(map.has(5)).toBe(false)
  })

  it('leaves a row whose player_id does not parse out of the map', () => {
    const map = buildElementTypeMap([{ player_id: '', position: 'Defender' }])
    expect(map.size).toBe(0)
  })

  // DoD's central "fail loudly on schema drift" case, mirroring
  // scripts/lib/competition.ts's parseCompetition().
  it('throws UnknownPositionError, naming the player_id and the bad value, on a non-blank position outside the known four words', () => {
    expect(() => buildElementTypeMap([{ player_id: '7', position: 'Wing-back' }])).toThrow(UnknownPositionError)
    try {
      buildElementTypeMap([{ player_id: '7', position: 'Wing-back' }])
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownPositionError)
      expect((err as UnknownPositionError).playerId).toBe(7)
      expect((err as UnknownPositionError).position).toBe('Wing-back')
      expect((err as Error).message).toMatch(/Wing-back/)
      expect((err as Error).message).toMatch(/7/)
    }
  })
})

describe('toMatchStatRow — element_type (ticket #146)', () => {
  it('reads element_type from the supplied player_id -> code map', () => {
    const elementTypeByPlayerId = new Map([[10, 2]])
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), elementTypeByPlayerId)
    expect(row?.element_type).toBe(2)
  })

  it('writes null, not a default position, for a player_id absent from the map', () => {
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map())
    expect(row?.element_type).toBeNull()
  })

  // The DoD's own signature: this is the exact 4-argument call every existing
  // call site made before this ticket. It must still write element_type:
  // null, not throw and not require every caller to be updated.
  it('defaults elementTypeByPlayerId to an empty map when the 5th argument is omitted entirely', () => {
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map())
    expect(row?.element_type).toBeNull()
  })
})

describe('MATCH_STATS_REQUIRED_COLUMNS / row mapping — source invariants (ticket #125)', () => {
  const sourcePath = fileURLToPath(new URL('./ingest-core-insights.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it('team_goals_conceded appears in the required-columns list', () => {
    const listBody = source.slice(
      source.indexOf('const MATCH_STATS_REQUIRED_COLUMNS'),
      source.indexOf(']', source.indexOf('const MATCH_STATS_REQUIRED_COLUMNS')),
    )
    expect(listBody).toMatch(/'team_goals_conceded'/)
  })

  it('team_goals_conceded appears in the row mapping, read via toInt like every other integer counting stat', () => {
    expect(source).toMatch(/team_goals_conceded:\s*toInt\(record\.team_goals_conceded\)/)
  })

  it('reports a named non-null-team_goals_conceded count in job_runs.details', () => {
    expect(source).toMatch(/matchRowsWithTeamGoalsConceded/)
  })
})

// ============================================================================
// supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql
// and supabase/README.md — grep-checkable DoD items against the real shipped
// files (ticket #125).
// ============================================================================

describe('supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql', import.meta.url),
  )
  const migrationSource = readFileSync(migrationPath, 'utf8')

  it('adds team_goals_conceded as a nullable integer column with no default', () => {
    expect(migrationSource).toMatch(/ADD COLUMN IF NOT EXISTS team_goals_conceded integer;/)
    // No "NOT NULL" and no "DEFAULT" on that same statement — nullable,
    // undefaulted, deliberately (see the file's own header).
    const columnLine = migrationSource.match(/ALTER TABLE public\.player_match_stats ADD COLUMN IF NOT EXISTS team_goals_conceded integer;/)
    expect(columnLine).not.toBeNull()
  })

  it('is idempotent: ADD COLUMN IF NOT EXISTS', () => {
    expect(migrationSource).toMatch(/ADD COLUMN IF NOT EXISTS/)
  })

  it('carries a COMMENT ON COLUMN naming this the clean-sheet source and goals_conceded as goalkeeper-only', () => {
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.player_match_stats\.team_goals_conceded IS/)
    expect(migrationSource).toMatch(/goalkeeper-only/i)
  })

  it('issues no GRANT statement — table-level grants from the #12 migration already cover this column', () => {
    // Strip comment lines (-- ...) so mentioning "GRANT" in prose (e.g.
    // "table-level grants already cover this") doesn't false-positive; what
    // this actually guards is an executable GRANT statement.
    const codeOnly = migrationSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bGRANT\b/)
  })
})

describe('supabase/README.md (ticket #125)', () => {
  const readmePath = fileURLToPath(new URL('../supabase/README.md', import.meta.url))
  const readmeSource = readFileSync(readmePath, 'utf8')

  it('the 20260818100000 row no longer claims to add team_goals_conceded, and states it was added later by this ticket', () => {
    const rowMatch = readmeSource.match(/\| `20260818100000_player_match_stats_competition\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).not.toMatch(/Adds `competition`.*and `team_goals_conceded`/)
    expect(rowMatch![0]).toMatch(/does not add `team_goals_conceded`/i)
  })

  it('lists the new migration, marked not yet applied', () => {
    expect(readmeSource).toMatch(/20260828090000_player_match_stats_team_goals_conceded\.sql/)
    const rowMatch = readmeSource.match(/\| `20260828090000_player_match_stats_team_goals_conceded\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toMatch(/not yet applied/i)
  })
})

// ============================================================================
// element_type (ticket #146) — source invariants, same grep-on-real-source
// technique as the competition and team_goals_conceded sections above.
// ============================================================================

describe('element_type (ticket #146) — source invariants', () => {
  const sourcePath = fileURLToPath(new URL('./ingest-core-insights.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it('position appears in the required-columns list', () => {
    const listBody = source.slice(
      source.indexOf('const PLAYERS_REQUIRED_COLUMNS'),
      source.indexOf(']', source.indexOf('const PLAYERS_REQUIRED_COLUMNS')),
    )
    expect(listBody).toMatch(/'position'/)
  })

  it('element_type appears in the row mapping (toMatchStatRow), read from the supplied map rather than a literal', () => {
    expect(source).toMatch(/element_type:\s*elementTypeByPlayerId\.get\(playerId\)\s*\?\?\s*null/)
  })

  it('the row shape sent to the upsert carries element_type as one of MatchStatRow\'s own fields', () => {
    const interfaceBody = source.slice(source.indexOf('interface MatchStatRow'), source.indexOf('interface MatchStatRow') + 900)
    expect(interfaceBody).toMatch(/element_type:\s*number\s*\|\s*null/)
  })

  it('reports a named non-null-element_type count in job_runs.details', () => {
    expect(source).toMatch(/matchRowsWithElementType/)
  })

  it('does not wrap buildElementTypeMap in a try/catch that would swallow UnknownPositionError in main()', () => {
    const mainBody = source.slice(source.indexOf('async function main'))
    const callSite = mainBody.slice(
      mainBody.indexOf('buildElementTypeMap('),
      mainBody.indexOf('buildElementTypeMap(') + 60,
    )
    expect(callSite).toMatch(/buildElementTypeMap\(/)
    // The call itself sits inside main()'s own try block (same as every other
    // step in main()) but not inside any NESTED try — a second, local
    // try/catch immediately around the call would swallow the throw before it
    // reaches main()'s catch. None of the ~60 chars right around the call site
    // contain another try.
    expect(callSite).not.toMatch(/try\s*\{/)
  })

  it('never defaults an unrecognized position past the map — no catch of UnknownPositionError anywhere in the file', () => {
    expect(source).not.toMatch(/catch[^{]*\{[^}]*UnknownPositionError/s)
  })
})

// ============================================================================
// supabase/migrations/20260829090000_feature_history_position_and_defcon.sql
// and supabase/README.md — grep-checkable DoD items against the real shipped
// files (ticket #146). The migration's feature_history-side columns are
// asserted in scripts/build-feature-history.test.ts, which owns that table;
// this file owns the player_match_stats.element_type side, since it is the
// column this file's own job populates.
// ============================================================================

describe('supabase/migrations/20260829090000_feature_history_position_and_defcon.sql — player_match_stats side', () => {
  const migrationPath = fileURLToPath(
    new URL('../supabase/migrations/20260829090000_feature_history_position_and_defcon.sql', import.meta.url),
  )
  const migrationSource = readFileSync(migrationPath, 'utf8')

  it('adds player_match_stats.element_type as a nullable smallint with no default', () => {
    expect(migrationSource).toMatch(/ALTER TABLE public\.player_match_stats ADD COLUMN IF NOT EXISTS element_type smallint;/)
  })

  it('is idempotent: ADD COLUMN IF NOT EXISTS', () => {
    expect(migrationSource).toMatch(/ADD COLUMN IF NOT EXISTS/)
  })

  it('carries a COMMENT ON COLUMN for player_match_stats.element_type', () => {
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.player_match_stats\.element_type IS/)
  })

  it('issues no GRANT statement — table-level grants already cover both tables (see file header)', () => {
    const codeOnly = migrationSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bGRANT\b/)
  })
})

describe('supabase/README.md (ticket #146)', () => {
  const readmePath = fileURLToPath(new URL('../supabase/README.md', import.meta.url))
  const readmeSource = readFileSync(readmePath, 'utf8')

  it('lists the new migration, marked not yet applied', () => {
    expect(readmeSource).toMatch(/20260829090000_feature_history_position_and_defcon\.sql/)
    const rowMatch = readmeSource.match(/\| `20260829090000_feature_history_position_and_defcon\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toMatch(/not yet applied/i)
  })
})

// ============================================================================
// slugifyClubName — ticket #167. Verified directly against real
// FPL-Core-Insights fetched data (2025-2026 teams.csv fotmob_name column vs
// real match_id club slugs, 31 Aug 2026): every case below is a real pairing
// observed in the source, not a hypothetical.
// ============================================================================

describe('slugifyClubName — real fotmob_name -> match_id-slug pairings', () => {
  it('lowercases and hyphenates a simple two-word name', () => {
    expect(slugifyClubName('Manchester United')).toBe('manchester-united')
    expect(slugifyClubName('Aston Villa')).toBe('aston-villa')
  })

  it('drops "&" entirely, matching the source\'s own hyphenated club slug', () => {
    expect(slugifyClubName('Brighton & Hove Albion')).toBe('brighton-hove-albion')
  })

  it('leaves an already-single-word (or acronym-free) name lowercased', () => {
    expect(slugifyClubName('Arsenal')).toBe('arsenal')
  })

  it('handles a three-word name with no punctuation', () => {
    expect(slugifyClubName('AFC Bournemouth')).toBe('afc-bournemouth')
    expect(slugifyClubName('Nottingham Forest')).toBe('nottingham-forest')
    expect(slugifyClubName('Wolverhampton Wanderers')).toBe('wolverhampton-wanderers')
    expect(slugifyClubName('Newcastle United')).toBe('newcastle-united')
    expect(slugifyClubName('Tottenham Hotspur')).toBe('tottenham-hotspur')
  })
})

// ============================================================================
// buildClubCodeBySlug — ticket #167.
// ============================================================================

describe('buildClubCodeBySlug', () => {
  it('builds a slug -> code map from well-formed rows, using fotmob_name (never name/short_name)', () => {
    const result = buildClubCodeBySlug([
      { code: '3', name: 'Arsenal', short_name: 'ARS', fotmob_name: 'Arsenal' },
      { code: '36', name: 'Brighton', short_name: 'BHA', fotmob_name: 'Brighton & Hove Albion' },
    ])
    expect(result.codeBySlug.get('arsenal')).toBe(3)
    expect(result.codeBySlug.get('brighton-hove-albion')).toBe(36)
    expect(result.blankFotmobName).toBe(0)
    expect(result.duplicateSlugs).toBe(0)
  })

  // Ticket #176: this REVERSES the pre-#176 rule (a blank fotmob_name used to
  // leave the club out of the map entirely, with no fallback at all — see
  // Defect 2 in the ticket). A blank fotmob_name cell now falls back to this
  // same row's own `name` column, single-word case.
  it('falls back to name when fotmob_name is blank — a single-word club (ticket #176)', () => {
    const result = buildClubCodeBySlug([{ code: '3', name: 'Arsenal', short_name: 'ARS', fotmob_name: '' }])
    expect(result.codeBySlug.get('arsenal')).toBe(3)
    expect(result.slugSource.get('arsenal')).toBe('name_or_short_name_fallback')
    expect(result.blankFotmobName).toBe(1)
    expect(result.fallbackSlugsResolved).toBe(1)
    expect(result.fallbackSlugUnresolvable).toBe(0)
  })

  // Ticket #176's own named DoD case: a multi-word club name.
  it('falls back to name when fotmob_name is blank — a multi-word club, wolverhampton-wanderers (ticket #176)', () => {
    const result = buildClubCodeBySlug([{ code: '39', name: 'Wolverhampton Wanderers', short_name: 'WOL', fotmob_name: '' }])
    expect(result.codeBySlug.get('wolverhampton-wanderers')).toBe(39)
    expect(result.slugSource.get('wolverhampton-wanderers')).toBe('name_or_short_name_fallback')
    expect(result.fallbackSlugsResolved).toBe(1)
  })

  // Ticket #176: falls back a level further, to short_name, only when name
  // itself is also blank.
  it('falls back to short_name when both fotmob_name and name are blank (ticket #176)', () => {
    const result = buildClubCodeBySlug([{ code: '3', name: '', short_name: 'ARS', fotmob_name: '' }])
    expect(result.codeBySlug.get('ars')).toBe(3)
    expect(result.slugSource.get('ars')).toBe('name_or_short_name_fallback')
    expect(result.fallbackSlugsResolved).toBe(1)
  })

  // Ticket #176's own named DoD case: a club whose derived slug matches no
  // fixture must be counted, never guessed. buildClubCodeBySlug itself does
  // add the derived slug to the map (it has no fixture data to check
  // against) — the "matches no fixture" failure surfaces one layer up, at
  // resolveOpponentTeamCode, which returns its existing named reason rather
  // than guessing. See the dedicated resolveOpponentTeamCode/toMatchStatRow
  // test below for that half; this test covers what buildClubCodeBySlug
  // itself does: derives "man-utd" from the source's own abbreviated `name`
  // column, which does not match match_id's actual "manchester-united" slug
  // — verified directly against real fetched data, 1 Sept 2026 (see this
  // file's header).
  it('derives a slug from an abbreviated name that will not match any real fixture — added to the map, not guessed at here', () => {
    const result = buildClubCodeBySlug([{ code: '1', name: 'Man Utd', short_name: 'MUN', fotmob_name: '' }])
    expect(result.codeBySlug.get('man-utd')).toBe(1)
    expect(result.codeBySlug.has('manchester-united')).toBe(false)
    expect(result.fallbackSlugsResolved).toBe(1)
  })

  // Ticket #176: neither name nor short_name is usable — no slug can be
  // derived for this club at all this run. Counted, not guessed.
  it('counts a row as fallback-unresolvable when fotmob_name, name and short_name are all blank (ticket #176)', () => {
    const result = buildClubCodeBySlug([{ code: '3', name: '', short_name: '', fotmob_name: '' }])
    expect(result.codeBySlug.size).toBe(0)
    expect(result.blankFotmobName).toBe(1)
    expect(result.fallbackSlugsResolved).toBe(0)
    expect(result.fallbackSlugUnresolvable).toBe(1)
  })

  // Ticket #176's own reconciliation requirement.
  it('blankFotmobName reconciles exactly against fallbackSlugsResolved + fallbackSlugUnresolvable', () => {
    const result = buildClubCodeBySlug([
      { code: '3', name: 'Arsenal', short_name: 'ARS', fotmob_name: '' },
      { code: '39', name: 'Wolverhampton Wanderers', short_name: 'WOL', fotmob_name: '' },
      { code: '4', name: '', short_name: '', fotmob_name: '' },
    ])
    expect(result.blankFotmobName).toBe(3)
    expect(result.fallbackSlugsResolved + result.fallbackSlugUnresolvable).toBe(3)
  })

  // The real, observed 2026-2027 case (verified 31 Aug 2026): every row's
  // fotmob_name is blank. This must not be treated as a bug — see the job's
  // own header comment.
  it('an entire teams.csv with every fotmob_name blank resolves an empty map, not an error', () => {
    const result = buildClubCodeBySlug([
      { code: '3', fotmob_name: '' },
      { code: '7', fotmob_name: '' },
    ])
    expect(result.codeBySlug.size).toBe(0)
    expect(result.blankFotmobName).toBe(2)
  })

  it('a row whose code does not parse is skipped, uncounted (nothing to join it onto)', () => {
    const result = buildClubCodeBySlug([{ code: '', fotmob_name: 'Arsenal' }])
    expect(result.codeBySlug.size).toBe(0)
    expect(result.blankFotmobName).toBe(0)
    expect(result.duplicateSlugs).toBe(0)
  })

  it('a slug shared by two codes is removed from the map (never guessed) and counted as a conflict', () => {
    const result = buildClubCodeBySlug([
      { code: '3', fotmob_name: 'Arsenal' },
      { code: '99', fotmob_name: 'Arsenal' },
    ])
    expect(result.codeBySlug.has('arsenal')).toBe(false)
    expect(result.duplicateSlugs).toBe(1)
  })
})

// ============================================================================
// buildTeamCodeMap — ticket #167. Same shape/behaviour as buildPlayerCodeMap.
// ============================================================================

describe('buildTeamCodeMap', () => {
  it('maps player_id -> team_code from players.csv', () => {
    const map = buildTeamCodeMap([
      { player_id: '10', team_code: '3' },
      { player_id: '20', team_code: '36' },
    ])
    expect(map.get(10)).toBe(3)
    expect(map.get(20)).toBe(36)
  })

  it('leaves a row whose team_code does not parse out of the map — the same small, expected gap as player_code', () => {
    const map = buildTeamCodeMap([{ player_id: '10', team_code: '' }])
    expect(map.has(10)).toBe(false)
  })

  it('leaves a row whose player_id does not parse out of the map', () => {
    const map = buildTeamCodeMap([{ player_id: '', team_code: '3' }])
    expect(map.size).toBe(0)
  })
})

// ============================================================================
// resolveOpponentTeamCode — ticket #167's own central DoD line: "Opponent
// resolution is exact, not inferred... A slug that does not resolve to
// exactly two known clubs is counted and reported, never guessed." Named
// tests below cover exactly the DoD's own three named cases: a normal slug,
// a hyphenated club name, and an unresolvable slug.
// ============================================================================

describe('resolveOpponentTeamCode — a normal slug', () => {
  it('resolves the OTHER club as the opponent, whichever position it is in', () => {
    const codeBySlug = new Map([
      ['manchester-united', 1],
      ['arsenal', 3],
    ])
    // Player is on Man Utd (team_code 1); away side (arsenal) is the opponent.
    expect(resolveOpponentTeamCode('25-26-prem-manchester-united-vs-arsenal', 'prem', 1, codeBySlug)).toEqual({
      opponentTeamCode: 3,
      reason: null,
    })
    // Player is on Arsenal (team_code 3); home side (manchester-united) is the opponent.
    expect(resolveOpponentTeamCode('25-26-prem-manchester-united-vs-arsenal', 'prem', 3, codeBySlug)).toEqual({
      opponentTeamCode: 1,
      reason: null,
    })
  })
})

describe('resolveOpponentTeamCode — a hyphenated club name (brighton-hove-albion)', () => {
  it('resolves correctly when the OTHER club\'s slug itself contains hyphens', () => {
    const codeBySlug = new Map([
      ['brighton-hove-albion', 36],
      ['fulham', 54],
    ])
    expect(resolveOpponentTeamCode('25-26-prem-brighton-hove-albion-vs-fulham', 'prem', 54, codeBySlug)).toEqual({
      opponentTeamCode: 36,
      reason: null,
    })
  })

  it('resolves correctly when the PLAYER\'S OWN club is the hyphenated one', () => {
    const codeBySlug = new Map([
      ['brighton-hove-albion', 36],
      ['fulham', 54],
    ])
    expect(resolveOpponentTeamCode('25-26-prem-brighton-hove-albion-vs-fulham', 'prem', 36, codeBySlug)).toEqual({
      opponentTeamCode: 54,
      reason: null,
    })
  })
})

describe('resolveOpponentTeamCode — an unresolvable slug', () => {
  it('a club slug not present in codeBySlug (e.g. a season with no fotmob_name) resolves null, with a named reason — never guessed', () => {
    const result = resolveOpponentTeamCode('25-26-prem-manchester-united-vs-arsenal', 'prem', 1, new Map())
    expect(result.opponentTeamCode).toBeNull()
    expect(result.reason).not.toBeNull()
    expect(typeof result.reason).toBe('string')
  })

  it('an own team_code of null (unresolved in players.csv) resolves null with a named reason', () => {
    const codeBySlug = new Map([
      ['manchester-united', 1],
      ['arsenal', 3],
    ])
    const result = resolveOpponentTeamCode('25-26-prem-manchester-united-vs-arsenal', 'prem', null, codeBySlug)
    expect(result.opponentTeamCode).toBeNull()
    expect(result.reason).toBe('own team_code not resolved from players.csv')
  })

  it('an own team_code that matches NEITHER resolved club resolves null with a named reason — never guessed', () => {
    const codeBySlug = new Map([
      ['manchester-united', 1],
      ['arsenal', 3],
    ])
    // team_code 999 belongs to neither club in this match.
    const result = resolveOpponentTeamCode('25-26-prem-manchester-united-vs-arsenal', 'prem', 999, codeBySlug)
    expect(result.opponentTeamCode).toBeNull()
    expect(result.reason).toBe("own team_code not found among the match_id's two club slugs")
  })

  it('throws (never returns a guess) on a match_id whose slug shape is unrecognizable', () => {
    expect(() => resolveOpponentTeamCode('25-26-prem-arsenal-chelsea', 'prem', 3, new Map())).toThrow()
  })
})

// ============================================================================
// tallyOpponentResolution — ticket #167's own "the counts reconcile
// arithmetically against rows written" DoD line, proven directly: for ANY
// input, withOpponentTeamCode + the sum of every opponentUnresolvedByReason
// value equals rows.length.
// ============================================================================

describe('tallyOpponentResolution — reconciliation', () => {
  function row(overrides: Partial<MatchStatRow> = {}): MatchStatRow {
    return {
      player_id: 1,
      player_code: null,
      element_type: null,
      team_code: 3,
      opponent_team_code: null,
      match_id: '25-26-prem-arsenal-vs-chelsea',
      competition: 'prem',
      season: '2025-2026',
      gameweek: 1,
      minutes_played: 90,
      goals: 0,
      assists: 0,
      xg: 0,
      xa: 0,
      xgot: 0,
      shots_on_target: 0,
      tackles: 0,
      tackles_won: 0,
      interceptions: 0,
      recoveries: 0,
      blocks: 0,
      clearances: 0,
      headed_clearances: 0,
      saves: 0,
      goals_conceded: 0,
      goals_prevented: 0,
      team_goals_conceded: 0,
      updated_at: '2026-08-31T00:00:00.000Z',
      ...overrides,
    }
  }

  it('a mix of resolved and unresolved-for-different-reasons rows reconciles exactly against rows.length', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const rows = [
      row({ team_code: 3, opponent_team_code: 8 }), // resolved
      row({ team_code: 3, opponent_team_code: 8 }), // resolved
      row({ team_code: null, opponent_team_code: null }), // own team_code unresolved
      row({ team_code: 999, opponent_team_code: null }), // team_code not among match's own clubs
      row({ match_id: '25-26-prem-manchester-united-vs-arsenal', team_code: 3, opponent_team_code: null }), // slug not in (this) codeBySlug
    ]
    const result = tallyOpponentResolution(rows, codeBySlug)
    const reasonTotal = Object.values(result.opponentUnresolvedByReason).reduce((a, b) => a + b, 0)
    expect(result.withOpponentTeamCode).toBe(2)
    expect(reasonTotal).toBe(3)
    expect(result.withOpponentTeamCode + reasonTotal).toBe(rows.length)
  })

  it('an empty row list reconciles trivially', () => {
    const result = tallyOpponentResolution([], new Map())
    expect(result.withOpponentTeamCode).toBe(0)
    expect(Object.values(result.opponentUnresolvedByReason).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('every row resolved leaves opponentUnresolvedByReason empty', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const rows = [row({ team_code: 3, opponent_team_code: 8 }), row({ team_code: 8, opponent_team_code: 3 })]
    const result = tallyOpponentResolution(rows, codeBySlug)
    expect(result.withOpponentTeamCode).toBe(2)
    expect(Object.keys(result.opponentUnresolvedByReason)).toHaveLength(0)
  })
})

// ============================================================================
// toMatchStatRow — team_code / opponent_team_code (ticket #167). Exercises
// the full row-building path, the way the #146 element_type section above
// does. Reuses matchStatsRecord's default match_id
// ("25-26-prem-arsenal-vs-chelsea") for the plain case, and a dedicated
// hyphenated-slug record for the brighton-hove-albion case.
// ============================================================================

describe('toMatchStatRow — team_code (ticket #167)', () => {
  it('reads team_code from the supplied player_id -> code map', () => {
    const teamCodeByPlayerId = new Map([[10, 3]])
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map(), teamCodeByPlayerId)
    expect(row?.team_code).toBe(3)
  })

  it('writes null, not a default team, for a player_id absent from the map', () => {
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map(), new Map())
    expect(row?.team_code).toBeNull()
  })

  it('defaults teamCodeByPlayerId (and codeBySlug) to empty when the 6th/7th arguments are omitted — the pre-#167 4/5-argument call sites', () => {
    expect(toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map())?.team_code).toBeNull()
    expect(toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map())?.team_code).toBeNull()
  })
})

describe('toMatchStatRow — opponent_team_code, a normal slug (ticket #167)', () => {
  it('resolves the opponent when both clubs are known and the player is on one of them', () => {
    // matchStatsRecord()'s default match_id is "25-26-prem-arsenal-vs-chelsea".
    const teamCodeByPlayerId = new Map([[10, 3]]) // player_id 10 is on Arsenal (code 3)
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
    expect(row?.team_code).toBe(3)
    expect(row?.opponent_team_code).toBe(8)
  })
})

describe('toMatchStatRow — opponent_team_code, a hyphenated club name (ticket #167)', () => {
  it('resolves correctly when a club slug in match_id is itself hyphenated (brighton-hove-albion)', () => {
    const record = matchStatsRecord({ match_id: '25-26-prem-brighton-hove-albion-vs-fulham' })
    const teamCodeByPlayerId = new Map([[10, 54]]) // player_id 10 is on Fulham (code 54)
    const codeBySlug = new Map([
      ['brighton-hove-albion', 36],
      ['fulham', 54],
    ])
    const row = toMatchStatRow(record, '2025-2026', 1, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
    expect(row?.opponent_team_code).toBe(36)
  })
})

describe('toMatchStatRow — opponent_team_code, an unresolvable slug (ticket #167)', () => {
  it('writes null, never a guess, when the club-slug map has no entry for either club (e.g. a season with no fotmob_name)', () => {
    const teamCodeByPlayerId = new Map([[10, 3]])
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map(), teamCodeByPlayerId, new Map())
    expect(row?.opponent_team_code).toBeNull()
  })

  it('writes null when team_code itself could not be resolved for the player', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const row = toMatchStatRow(matchStatsRecord(), '2025-2026', 1, new Map(), new Map(), new Map(), codeBySlug)
    expect(row?.team_code).toBeNull()
    expect(row?.opponent_team_code).toBeNull()
  })
})

// ============================================================================
// team_code / opponent_team_code (ticket #167) — source invariants, same
// grep-on-real-source technique as the competition/team_goals_conceded/
// element_type sections above.
// ============================================================================

describe('team_code / opponent_team_code (ticket #167) — source invariants', () => {
  const sourcePath = fileURLToPath(new URL('./ingest-core-insights.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it('team_code appears in the row mapping, read from the supplied map rather than a literal', () => {
    expect(source).toMatch(/team_code:\s*teamCode,/)
  })

  it('opponent_team_code appears in the row mapping, read from resolveOpponentTeamCode rather than a literal', () => {
    expect(source).toMatch(/opponent_team_code:\s*opponentTeamCode,/)
  })

  it("the row shape sent to the upsert carries both fields as one of MatchStatRow's own fields", () => {
    const interfaceBody = source.slice(source.indexOf('interface MatchStatRow'), source.indexOf('interface MatchStatRow') + 1400)
    expect(interfaceBody).toMatch(/team_code:\s*number\s*\|\s*null/)
    expect(interfaceBody).toMatch(/opponent_team_code:\s*number\s*\|\s*null/)
  })

  it('reports named non-null-team_code and non-null-opponent_team_code counts in job_runs.details', () => {
    expect(source).toMatch(/matchRowsWithTeamCode/)
    expect(source).toMatch(/matchRowsWithOpponentTeamCode/)
  })

  it('reports a named per-reason breakdown for unresolved opponents in job_runs.details', () => {
    expect(source).toMatch(/matchRowsOpponentUnresolvedByReason/)
  })

  it('never reads the live public.players or public.teams tables to resolve team_code — only players.csv / teams.csv', () => {
    // Every .from('players')/.from('teams') call in this file is the
    // pre-existing teams.elo path (fetchTeamIdentities/applyTeamElo*), which
    // reads only `id, code` — never team_code, never for player identity.
    expect(source).not.toMatch(/\.from\(\s*['"]players['"]\s*\)/)
  })

  it('resolveOpponentTeamCode calls parseMatchClubSlugs uncaught — a slug SHAPE failure propagates to main()\'s catch block', () => {
    const fnBody = source.slice(
      source.indexOf('export function resolveOpponentTeamCode'),
      source.indexOf('export function resolveOpponentTeamCode') + 1200,
    )
    expect(fnBody).toMatch(/parseMatchClubSlugs\(/)
    expect(fnBody).not.toMatch(/try\s*\{/)
  })
})

// ============================================================================
// countOpponentsResolvedViaFallback — ticket #176's own new counter: among
// rows already carrying a resolved opponent_team_code, how many resolved via
// a club slug that came from the name/short_name fallback rather than
// fotmob_name.
// ============================================================================

describe('countOpponentsResolvedViaFallback', () => {
  function row(overrides: Partial<MatchStatRow> = {}): MatchStatRow {
    return {
      player_id: 1,
      player_code: null,
      element_type: null,
      team_code: 3,
      opponent_team_code: null,
      match_id: '26-27-prem-arsenal-vs-chelsea',
      competition: 'prem',
      season: '2026-2027',
      gameweek: 1,
      minutes_played: 90,
      goals: 0,
      assists: 0,
      xg: 0,
      xa: 0,
      xgot: 0,
      shots_on_target: 0,
      tackles: 0,
      tackles_won: 0,
      interceptions: 0,
      recoveries: 0,
      blocks: 0,
      clearances: 0,
      headed_clearances: 0,
      saves: 0,
      goals_conceded: 0,
      goals_prevented: 0,
      team_goals_conceded: 0,
      updated_at: '2026-09-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('counts a row whose resolved opponent came from the fallback slug source', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const slugSource = new Map<string, ClubSlugSource>([
      ['arsenal', 'fotmob_name'],
      ['chelsea', 'name_or_short_name_fallback'],
    ])
    const rows = [row({ team_code: 3, opponent_team_code: 8 })]
    expect(countOpponentsResolvedViaFallback(rows, codeBySlug, slugSource)).toBe(1)
  })

  it('does not count a row whose resolved opponent came from fotmob_name', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const slugSource = new Map<string, ClubSlugSource>([
      ['arsenal', 'fotmob_name'],
      ['chelsea', 'fotmob_name'],
    ])
    const rows = [row({ team_code: 3, opponent_team_code: 8 })]
    expect(countOpponentsResolvedViaFallback(rows, codeBySlug, slugSource)).toBe(0)
  })

  it('does not count an unresolved row (opponent_team_code null)', () => {
    const rows = [row({ team_code: 3, opponent_team_code: null })]
    expect(countOpponentsResolvedViaFallback(rows, new Map(), new Map())).toBe(0)
  })

  it('is always <= the number of resolved rows in the batch (reconciliation)', () => {
    const codeBySlug = new Map([
      ['arsenal', 3],
      ['chelsea', 8],
    ])
    const slugSource = new Map<string, ClubSlugSource>([
      ['arsenal', 'fotmob_name'],
      ['chelsea', 'name_or_short_name_fallback'],
    ])
    const rows = [
      row({ team_code: 3, opponent_team_code: 8 }),
      row({ team_code: 8, opponent_team_code: 3 }),
      row({ team_code: null, opponent_team_code: null }),
    ]
    const resolvedCount = rows.filter((r) => r.opponent_team_code !== null).length
    const viaFallback = countOpponentsResolvedViaFallback(rows, codeBySlug, slugSource)
    expect(viaFallback).toBeLessThanOrEqual(resolvedCount)
  })
})

// ============================================================================
// End-to-end: buildClubCodeBySlug's fallback feeding resolveOpponentTeamCode
// / toMatchStatRow, ticket #176's own named DoD cases — a single-word club,
// wolverhampton-wanderers (multi-word), and a club whose derived slug
// matches no fixture (counted, never guessed).
// ============================================================================

describe('opponent resolution via the name/short_name fallback, end to end (ticket #176)', () => {
  it('resolves an opponent for a 2026-2027-shaped season whose teams.csv has blank fotmob_name for every club, single-word clubs', () => {
    // Mirrors the real 2026-2027 data/teams.csv shape verified 1 Sept 2026:
    // fotmob_name blank for every row, name populated.
    const teamRecords = [
      { code: '3', name: 'Arsenal', short_name: 'ARS', fotmob_name: '' },
      { code: '11', name: 'Everton', short_name: 'EVE', fotmob_name: '' },
    ]
    const { codeBySlug, slugSource } = buildClubCodeBySlug(teamRecords)
    const teamCodeByPlayerId = new Map([[10, 3]]) // player on Arsenal
    const record = {
      player_id: '10',
      match_id: '26-27-prem-arsenal-vs-everton',
      minutes_played: '90',
    }
    const matchRow = toMatchStatRow(record, '2026-2027', 1, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
    expect(matchRow?.opponent_team_code).toBe(11)
    expect(countOpponentsResolvedViaFallback([matchRow as MatchStatRow], codeBySlug, slugSource)).toBe(1)
  })

  it("resolves an opponent for a multi-word club name, wolverhampton-wanderers", () => {
    const teamRecords = [
      { code: '39', name: 'Wolverhampton Wanderers', short_name: 'WOL', fotmob_name: '' },
      { code: '54', name: 'Fulham', short_name: 'FUL', fotmob_name: '' },
    ]
    const { codeBySlug } = buildClubCodeBySlug(teamRecords)
    const teamCodeByPlayerId = new Map([[20, 54]]) // player on Fulham
    const record = {
      player_id: '20',
      match_id: '26-27-prem-wolverhampton-wanderers-vs-fulham',
      minutes_played: '90',
    }
    const matchRow = toMatchStatRow(record, '2026-2027', 1, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
    expect(matchRow?.opponent_team_code).toBe(39)
  })

  it('a club whose derived slug matches no fixture resolves null and is counted, never guessed', () => {
    // Mirrors the real observed mismatch: teams.csv's own `name` for
    // Manchester United is the abbreviated "Man Utd", which slugifies to
    // "man-utd" — match_id's actual slug is "manchester-united". The
    // fallback must not correct or fuzzy-match this; it is counted under
    // resolveOpponentTeamCode's existing named reason.
    const teamRecords = [
      { code: '1', name: 'Man Utd', short_name: 'MUN', fotmob_name: '' },
      { code: '9', name: 'Hull City', short_name: 'HUL', fotmob_name: '' },
    ]
    const { codeBySlug } = buildClubCodeBySlug(teamRecords)
    const teamCodeByPlayerId = new Map([[30, 9]]) // player on Hull City
    const record = {
      player_id: '30',
      match_id: '26-27-prem-hull-city-vs-manchester-united',
      minutes_played: '90',
    }
    const matchRow = toMatchStatRow(record, '2026-2027', 1, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
    expect(matchRow?.opponent_team_code).toBeNull()
    const tally = tallyOpponentResolution([matchRow as MatchStatRow], codeBySlug)
    expect(tally.opponentUnresolvedByReason['club slug not found among known team codes']).toBe(1)
  })
})

// ============================================================================
// supabase/migrations/20260901090000_teams_elo_stale_since.sql and
// supabase/README.md — grep-checkable DoD items (ticket #176).
// ============================================================================

describe('supabase/migrations/20260901090000_teams_elo_stale_since.sql', () => {
  const migrationPath = fileURLToPath(new URL('../supabase/migrations/20260901090000_teams_elo_stale_since.sql', import.meta.url))
  const migrationSource = readFileSync(migrationPath, 'utf8')

  it('adds teams.elo_stale_since as a nullable timestamptz column with no default', () => {
    const statementLine = migrationSource
      .split('\n')
      .find((line) => line.includes('ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS elo_stale_since timestamptz;'))
    expect(statementLine).toBeDefined()
    expect(statementLine).not.toMatch(/NOT NULL/)
    expect(statementLine).not.toMatch(/DEFAULT/)
  })

  it('is idempotent: ADD COLUMN IF NOT EXISTS', () => {
    expect(migrationSource).toMatch(/ADD COLUMN IF NOT EXISTS/)
  })

  it('carries a COMMENT ON COLUMN for elo_stale_since', () => {
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.teams\.elo_stale_since IS/)
  })

  it('issues no GRANT statement — table-level grants on teams already cover new columns', () => {
    const codeOnly = migrationSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bGRANT\b/)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(migrationSource).toMatch(/^BEGIN;/m)
    expect(migrationSource).toMatch(/^COMMIT;/m)
  })
})

describe('supabase/README.md (ticket #176)', () => {
  const readmePath = fileURLToPath(new URL('../supabase/README.md', import.meta.url))
  const readmeSource = readFileSync(readmePath, 'utf8')

  it('lists the new migration, marked not yet applied', () => {
    expect(readmeSource).toMatch(/20260901090000_teams_elo_stale_since\.sql/)
    const rowMatch = readmeSource.match(/\| `20260901090000_teams_elo_stale_since\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toMatch(/not yet applied/i)
  })
})

// ============================================================================
// supabase/migrations/20260831090000_team_and_opponent.sql and
// supabase/README.md — grep-checkable DoD items (ticket #167).
// ============================================================================

describe('supabase/migrations/20260831090000_team_and_opponent.sql', () => {
  const migrationPath = fileURLToPath(new URL('../supabase/migrations/20260831090000_team_and_opponent.sql', import.meta.url))
  const migrationSource = readFileSync(migrationPath, 'utf8')

  it('adds player_match_stats.team_code and opponent_team_code as nullable integer columns with no default', () => {
    for (const column of ['team_code', 'opponent_team_code']) {
      const statementLine = migrationSource
        .split('\n')
        .find((line) => line.includes(`ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS ${column} integer;`))
      expect(statementLine).toBeDefined()
      expect(statementLine).not.toMatch(/NOT NULL/)
      expect(statementLine).not.toMatch(/DEFAULT/)
    }
  })

  it('adds feature_history.team_code as a nullable integer column with no default', () => {
    const statementLine = migrationSource
      .split('\n')
      .find((line) => line.includes('ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS team_code integer;'))
    expect(statementLine).toBeDefined()
    expect(statementLine).not.toMatch(/NOT NULL/)
    expect(statementLine).not.toMatch(/DEFAULT/)
  })

  it('is idempotent: every column addition uses ADD COLUMN IF NOT EXISTS', () => {
    const addColumnStatements = migrationSource.match(/ALTER TABLE public\.\w+ ADD COLUMN[^;]*;/g) ?? []
    expect(addColumnStatements.length).toBeGreaterThanOrEqual(3)
    for (const statement of addColumnStatements) {
      expect(statement).toMatch(/ADD COLUMN IF NOT EXISTS/)
    }
  })

  it('carries a COMMENT ON COLUMN for all three new columns', () => {
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.player_match_stats\.team_code IS/)
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.player_match_stats\.opponent_team_code IS/)
    expect(migrationSource).toMatch(/COMMENT ON COLUMN public\.feature_history\.team_code IS/)
  })

  it('issues no GRANT statement — table-level grants on both tables already cover new columns (see file header)', () => {
    const codeOnly = migrationSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bGRANT\b/)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(migrationSource).toMatch(/^BEGIN;/m)
    expect(migrationSource).toMatch(/^COMMIT;/m)
  })
})

describe('supabase/README.md (ticket #167)', () => {
  const readmePath = fileURLToPath(new URL('../supabase/README.md', import.meta.url))
  const readmeSource = readFileSync(readmePath, 'utf8')

  it('lists the new migration, marked not yet applied', () => {
    expect(readmeSource).toMatch(/20260831090000_team_and_opponent\.sql/)
    const rowMatch = readmeSource.match(/\| `20260831090000_team_and_opponent\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toMatch(/not yet applied/i)
  })
})
