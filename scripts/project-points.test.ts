// Source-invariant tests for scripts/project-points.ts — ticket #54.
//
// project-points.ts's Supabase reads live entirely inside main(), which
// needs a live Supabase project to exercise end to end (no such project is
// available to this Builder's session — see scripts/ingest-core-insights.test.ts
// for the same constraint on that job). What CAN be proven without a
// database is the shape of the query construction itself: that the single
// player_match_stats DATA read is filtered to Premier League rows IN THE
// QUERY, that its row-count assertion uses the identical filter as that data
// fetch (the exact bug scripts/lib/paginate.ts's own header warns a
// mismatched filter would reproduce), and that the exclusion-count queries
// correctly separate a known non-Premier-League competition from a null
// one. Grepping the actual source, rather than re-deriving the same logic
// here in TypeScript, keeps this test honest about what shipped — same
// technique scripts/ingest-core-insights.test.ts's "source invariants"
// section already uses.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.js'
// Ticket #113: sortRecentFirst/splitBySeason/classifySeasonCoverage/CURRENT_SEASON
// are plain pure functions with no Supabase call of their own, so (unlike the
// rest of this file) they are imported and exercised directly rather than
// only grepped. Safe to import: main() is guarded behind an isMainModule
// check (see project-points.ts's own footer comment) so this import alone
// never triggers a real run.
import { CURRENT_SEASON, classifySeasonCoverage, sortRecentFirst, splitBySeason } from './project-points.ts'

const sourcePath = fileURLToPath(new URL('./project-points.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

const PL_FILTER = ".eq('competition', PREMIER_LEAGUE_COMPETITION)"

describe('project-points.ts — Premier League filter (source invariants)', () => {
  it('imports PREMIER_LEAGUE_COMPETITION rather than a hardcoded competition literal', () => {
    expect(source).toMatch(/import\s*\{\s*PREMIER_LEAGUE_COMPETITION\s*\}\s*from\s*['"]\.\/lib\/competition\.ts['"]/)
  })

  it('the data-fetch query and its row-count-check query both filter on the identical competition clause', () => {
    // The exact bug scripts/lib/paginate.ts's own header describes: a count
    // taken under a different filter than the data it verifies would pass
    // even on a truncated or wrongly-filtered read. Both queries must carry
    // the exact same `.eq('competition', PREMIER_LEAGUE_COMPETITION)` text —
    // asserted here as a literal count, not "at least one".
    const occurrences = source.split(PL_FILTER).length - 1
    expect(occurrences).toBe(2) // the paginated data fetch + its count-check — no more, no fewer
  })

  it('never filters player_match_stats with a hardcoded "prem" string literal instead of the constant', () => {
    // Guards against a well-intentioned but wrong shortcut:
    // .eq('competition', 'prem') would still work at runtime but breaks the
    // "one parsed column, one filter" discipline the ticket's Notes insist on.
    expect(source).not.toMatch(/\.eq\(\s*['"]competition['"]\s*,\s*['"]prem['"]\s*\)/)
  })

  it(`PREMIER_LEAGUE_COMPETITION is "${PREMIER_LEAGUE_COMPETITION}"`, () => {
    // Sanity-checks the imported constant matches the migration's documented
    // value, so the grep assertions above are checking against the real
    // thing and not a stale duplicate.
    expect(PREMIER_LEAGUE_COMPETITION).toBe('prem')
  })

  it('counts null-competition rows separately from known non-Premier-League rows', () => {
    // Two distinct query shapes, per the ticket's robustness requirement:
    // .is('competition', null) for "not yet re-stamped", and
    // .not('competition', 'is', null).neq('competition', PREMIER_LEAGUE_COMPETITION)
    // for "a known other competition". Neither may be folded into the other.
    expect(source).toMatch(/\.is\(\s*['"]competition['"]\s*,\s*null\s*\)/)
    expect(source).toMatch(/\.not\(\s*['"]competition['"]\s*,\s*['"]is['"]\s*,\s*null\s*\)\s*\n?\s*\.neq\(\s*['"]competition['"]\s*,\s*PREMIER_LEAGUE_COMPETITION\s*\)/)
  })

  it('reports rows read and both exclusion counts as separate named job_runs.details fields', () => {
    expect(source).toMatch(/matchStatsRowsRead/)
    expect(source).toMatch(/matchStatsRowsExcludedNonPremierLeague/)
    expect(source).toMatch(/matchStatsRowsExcludedNullCompetition/)
  })

  it('issues no Supabase row-removal call anywhere', () => {
    expect(source).not.toMatch(/\.delete\(\s*\)/)
  })
})

// ============================================================================
// Ticket #78 — bonus allocation source invariants. Same technique as above:
// grep the shipped source rather than re-deriving the logic, since main()'s
// Supabase reads cannot be exercised without a live project.
// ============================================================================

describe('project-points.ts — bonus allocation (source invariants, ticket #78)', () => {
  it('imports projectPlayerFixture and allocateFixtureBonus from src/lib/projection/index.ts', () => {
    expect(source).toMatch(/projectPlayerFixture/)
    expect(source).toMatch(/allocateFixtureBonus/)
  })

  it('never imports or calls projectPlayerGameweek -- bonus needs a second, fixture-grouped pass that per-player gameweek aggregation cannot provide (a header comment naming it as the thing NOT used is fine)', () => {
    expect(source).not.toMatch(/\bprojectPlayerGameweek\s*\(/)
    expect(source).not.toMatch(/import\s*\{[^}]*\bprojectPlayerGameweek\b[^}]*\}/)
  })

  it('recomputes expectedPoints via totalMatchPoints -- bonus is never hand-added onto a previously computed total', () => {
    // The exact bug the DoD warns against: `... + bonus` or `+= bonus`-style
    // arithmetic directly on an expectedPoints variable, bypassing
    // totalMatchPoints. Neither pattern (nor a "bonusPoints" variant) may
    // appear anywhere in the file.
    expect(source).not.toMatch(/expectedPoints\s*\+=?\s*bonus/i)
    expect(source).not.toMatch(/\+\s*bonus(Points)?\b/)
    expect(source).toMatch(/totalMatchPoints\(fullComponents\)/)
  })

  it('reports all five ticket #78 counters as separate named job_runs.details fields', () => {
    expect(source).toMatch(/fixturesBonusAllocated/)
    expect(source).toMatch(/fixturesZeroExcess/)
    expect(source).toMatch(/playerFixturesBonusClamped/)
    expect(source).toMatch(/maxProjectedBonusPerPlayerFixture/)
    expect(source).toMatch(/meanProjectedBonusAmongLikelyStarters/)
  })

  it('the likely-starters bonus mean is gated on pSixtyPlus >= 0.5, per the DoD', () => {
    expect(source).toMatch(/pSixtyPlus\s*>=\s*0\.5/)
  })
})

// ============================================================================
// Ticket #113 — two-stage shrinkage wiring. sortRecentFirst, splitBySeason
// and classifySeasonCoverage are pulled out as pure, exported functions
// specifically so this behaviour can be tested directly on constructed
// rows, rather than only by grepping the source the way the rest of this
// file has to (main()'s Supabase reads still can't run without a live
// project).
// ============================================================================

interface FakeMatch {
  season: string
  gameweek: number
  minutesPlayed: number
}

function fakeMatch(season: string, gameweek: number, minutesPlayed = 90): FakeMatch {
  return { season, gameweek, minutesPlayed }
}

const LAST_SEASON = '2025-2026'

describe('sortRecentFirst — ticket #113', () => {
  it('CURRENT_SEASON is "2026-2027", the season the second scheduled-jobs ingest step targets', () => {
    expect(CURRENT_SEASON).toBe('2026-2027')
  })

  it('a player with 2 current-season and 5 historical matches: the 2 current-season matches lead the result', () => {
    const matches = [
      fakeMatch(LAST_SEASON, 5),
      fakeMatch(LAST_SEASON, 4),
      fakeMatch(LAST_SEASON, 3),
      fakeMatch(LAST_SEASON, 2),
      fakeMatch(LAST_SEASON, 1),
      fakeMatch(CURRENT_SEASON, 2),
      fakeMatch(CURRENT_SEASON, 1),
    ]
    const sorted = sortRecentFirst(matches)
    const leading = sorted.slice(0, 2)
    expect(leading.every((m) => m.season === CURRENT_SEASON)).toBe(true)
    // Most recent gameweek first, within the current-season group.
    expect(leading.map((m) => m.gameweek)).toEqual([2, 1])
    // The historical group behind it is still ordered most-recent-first.
    expect(sorted.slice(2).map((m) => m.gameweek)).toEqual([5, 4, 3, 2, 1])
  })

  it('a player with only historical matches: unaffected, still most-recent-gameweek-first', () => {
    const matches = [fakeMatch(LAST_SEASON, 1), fakeMatch(LAST_SEASON, 3), fakeMatch(LAST_SEASON, 2)]
    const sorted = sortRecentFirst(matches)
    expect(sorted.map((m) => m.gameweek)).toEqual([3, 2, 1])
  })

  it('a player with only current-season matches: still most-recent-gameweek-first', () => {
    const matches = [fakeMatch(CURRENT_SEASON, 1), fakeMatch(CURRENT_SEASON, 2)]
    const sorted = sortRecentFirst(matches)
    expect(sorted.map((m) => m.gameweek)).toEqual([2, 1])
  })

  it('does not mutate the input array', () => {
    const matches = [fakeMatch(LAST_SEASON, 1), fakeMatch(CURRENT_SEASON, 2)]
    const original = [...matches]
    sortRecentFirst(matches)
    expect(matches).toEqual(original)
  })
})

describe('splitBySeason — ticket #113', () => {
  it('separates current-season rows from every other season', () => {
    const matches = [
      fakeMatch(CURRENT_SEASON, 2),
      fakeMatch(LAST_SEASON, 5),
      fakeMatch(CURRENT_SEASON, 1),
      fakeMatch('2024-2025', 10), // an older season -- still "historical", not just last season
    ]
    const { current, historical } = splitBySeason(matches)
    expect(current).toHaveLength(2)
    expect(current.every((m) => m.season === CURRENT_SEASON)).toBe(true)
    expect(historical).toHaveLength(2)
    expect(historical.every((m) => m.season !== CURRENT_SEASON)).toBe(true)
  })

  it('an empty match list splits into two empty lists', () => {
    expect(splitBySeason([])).toEqual({ current: [], historical: [] })
  })
})

describe('classifySeasonCoverage — ticket #113 job_runs.details counters', () => {
  it('current-season rows present -> "current", regardless of historical coverage', () => {
    expect(classifySeasonCoverage(true, true)).toBe('current')
    expect(classifySeasonCoverage(true, false)).toBe('current')
  })

  it('no current-season rows but historical rows present -> "historicalOnly"', () => {
    expect(classifySeasonCoverage(false, true)).toBe('historicalOnly')
  })

  it('no rows at either level -> "neither"', () => {
    expect(classifySeasonCoverage(false, false)).toBe('neither')
  })

  it('the three buckets, applied across a population of players, sum exactly to the total player count', () => {
    // A small synthetic population standing in for playerRows: each entry
    // is (hasCurrentSeasonRows, hasHistoricalRows).
    const population: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
      [true, true],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
    ]
    let current = 0
    let historicalOnly = 0
    let neither = 0
    for (const [hasCurrent, hasHistorical] of population) {
      const coverage = classifySeasonCoverage(hasCurrent, hasHistorical)
      if (coverage === 'current') current++
      else if (coverage === 'historicalOnly') historicalOnly++
      else neither++
    }
    expect(current + historicalOnly + neither).toBe(population.length)
    expect(current).toBe(3)
    expect(historicalOnly).toBe(2)
    expect(neither).toBe(3)
  })
})

describe('project-points.ts — season-split source invariants (ticket #113)', () => {
  it('the workflow file runs core-insights ingest with CORE_INSIGHTS_SEASON set to both seasons', () => {
    const workflowPath = fileURLToPath(new URL('../.github/workflows/scheduled-jobs.yml', import.meta.url))
    const workflowSource = readFileSync(workflowPath, 'utf8')
    expect(workflowSource).toMatch(/CORE_INSIGHTS_SEASON:\s*['"]?2025-2026['"]?/)
    expect(workflowSource).toMatch(/CORE_INSIGHTS_SEASON:\s*['"]?2026-2027['"]?/)
    // Literal string check per the DoD.
    expect(workflowSource).toContain('2026-2027')
  })

  it('the player_match_stats data-fetch query selects the season column', () => {
    expect(source).toMatch(/\.select\(\s*\n?\s*['"][^'"]*\bseason\b[^'"]*['"]/)
  })

  it('reports all four ticket #113 counters as separate named job_runs.details fields', () => {
    expect(source).toMatch(/playersWithCurrentSeasonRows/)
    expect(source).toMatch(/playersWithHistoricalOnlyRows/)
    expect(source).toMatch(/playersWithNeitherSeasonRows/)
    expect(source).toMatch(/currentSeasonRowsRead/)
  })

  it('imports the two-stage estimators from src/lib/projection rather than re-deriving a blend inline', () => {
    expect(source).toMatch(/computeTwoStagePlayerRates/)
    expect(source).toMatch(/estimateTwoStageDefconHitRate/)
  })

  it('the sort placing current-season matches first lives in this file, not in minutes.ts', () => {
    const minutesSource = readFileSync(
      fileURLToPath(new URL('../src/lib/projection/minutes.ts', import.meta.url)),
      'utf8',
    )
    expect(minutesSource).not.toMatch(/CURRENT_SEASON/)
    expect(source).toMatch(/function sortRecentFirst/)
  })
})
