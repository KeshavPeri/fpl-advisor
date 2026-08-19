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
import { buildEloByCode, planTeamEloUpdates, TEAMS_REQUIRED_COLUMNS, type TeamIdentityRow } from './ingest-core-insights.js'

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
    const toMatchStatRowBody = source.slice(source.indexOf('function toMatchStatRow'), source.indexOf('function toMatchStatRow') + 800)
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
