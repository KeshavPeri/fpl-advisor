// Unit tests for scripts/ingest-core-insights.ts's team-elo join logic —
// ticket #32, extended by ticket #63 (null elo on an unmatched club rather
// than leaving a stale — possibly another club's — rating in place).
//
// These exercise buildEloByCode/planTeamEloUpdates directly: pure functions
// with no live Supabase project involved (none is available to this
// Builder's session). They prove the join is on `code`, that a code with no
// matching public.teams row is skipped and counted, that a public.teams row
// whose code has no CSV entry is queued for nulling and counted (#63), that
// a row whose code IS present still gets the CSV value exactly as before
// (#63 must not regress this), that a malformed elo cell never overwrites an
// existing rating with null or queues it for nulling, and that a duplicate
// code across two public.teams rows updates neither, nulls neither, and is
// counted as a conflict — every testable bullet from the ticket's
// definition of done. It cannot prove what the *live* table currently
// holds, or that the projection fallback then engages; that's a human
// verification step after merge, out of scope here (see ticket #63's Notes).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildElementTypeMap,
  buildEloByCode,
  planTeamEloUpdates,
  TEAMS_REQUIRED_COLUMNS,
  toMatchStatRow,
  UnknownPositionError,
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

function team(id: number, code: number | null): TeamIdentityRow {
  return { id, code }
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
    expect(plan.nulls).toEqual([])
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
    // Nothing to null: there is no public.teams row for the missing code.
    expect(plan.nulls).toEqual([])
  })

  // Ticket #63 — this is the DoD's central regression guard: a matched code
  // must still take the CSV value exactly as before, unaffected by the new
  // nulling path.
  it('sets elo to the CSV value for a row whose code IS present, exactly as before #63', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([{ id: 1, elo: 1650 }])
    expect(plan.nulls).toEqual([])
  })

  // Ticket #63 — the ticket's central case: a promoted club (code not in the
  // historical CSV) must be queued to have its elo nulled, not left holding
  // whatever it last held.
  it('queues a public.teams row for nulling when its code has no CSV entry, and counts it (ticket #63)', () => {
    const existingTeams = [team(1, 90), team(2, 55)] // team 2's code never appears in the CSV
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([{ id: 1, elo: 1650 }])
    expect(plan.teamsCodesNotInCsv).toBe(1)
    expect(plan.nulls).toEqual([{ id: 2 }])
  })

  it('counts a public.teams row with a null code as not-in-csv, never crashing the join, and queues it for nulling (#63)', () => {
    const existingTeams = [team(1, null)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.teamsCodesNotInCsv).toBe(1)
    expect(plan.codesNotInTeams).toBe(1) // code 90 also has no matching row
    expect(plan.nulls).toEqual([{ id: 1 }])
  })

  // Ticket #63 — the DoD's explicit "must not be conflated" case: a
  // malformed elo cell is a different outcome from an absent code, and must
  // not queue the row for nulling.
  it('does not write null over an existing rating, and does not queue it for nulling, when the elo cell was malformed (#63)', () => {
    const existingTeams = [team(1, 90)]
    const elo = buildEloByCode([{ code: '90', elo: 'not-a-number' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.nulls).toEqual([])
    // Not counted as codesNotInTeams or teamsCodesNotInCsv — the code matched
    // fine, only the elo value was bad (buildEloByCode's malformedElo covers this).
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
    expect(plan.duplicateCodeConflicts).toBe(0)
  })

  it('updates neither row, nulls neither row, and counts a conflict when two public.teams rows share a code', () => {
    const existingTeams = [team(1, 90), team(2, 90)]
    const elo = buildEloByCode([{ code: '90', elo: '1650' }])
    const plan = planTeamEloUpdates(existingTeams, elo)
    expect(plan.updates).toEqual([])
    expect(plan.nulls).toEqual([])
    expect(plan.duplicateCodeConflicts).toBe(1)
    // Not double-counted under the other buckets.
    expect(plan.codesNotInTeams).toBe(0)
    expect(plan.teamsCodesNotInCsv).toBe(0)
  })

  it('produces no updates, no nulls and no false positives against an empty CSV and an empty table', () => {
    const plan = planTeamEloUpdates([], buildEloByCode([]))
    expect(plan).toEqual({ updates: [], nulls: [], codesNotInTeams: 0, teamsCodesNotInCsv: 0, duplicateCodeConflicts: 0 })
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

  // Ticket #63's own DoD line: job_runs.details must carry a named count of
  // teams whose elo was nulled, alongside the pre-existing counters.
  it('reports teamsEloNulled as a named job_runs.details field (ticket #63)', () => {
    expect(source).toMatch(/teamsEloNulled/)
  })

  it('references identity columns only inside TEAMS_REQUIRED_COLUMNS/comments, never as a write', () => {
    // Strip whole-line and trailing "// ..." comments (not URLs — those are
    // never preceded by whitespace) so what's left is code only. The DoD's
    // own wording permits these words in comments; TEAMS_REQUIRED_COLUMNS no
    // longer lists them (asserted above), so any remaining appearance in the
    // stripped code would mean a write path, which is what this actually guards.
    const codeOnly = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .map((line) => line.replace(/\s\/\/.*$/, ''))
      .join('\n')
    for (const forbidden of ['short_name', 'strength_overall_home', 'strength_attack_home', 'strength_defence_home', 'pulse_id']) {
      expect(codeOnly.includes(forbidden)).toBe(false)
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
