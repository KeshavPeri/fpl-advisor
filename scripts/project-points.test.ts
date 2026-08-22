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
