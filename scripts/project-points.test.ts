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
// Ticket #119: same reasoning -- effectiveRatePositionPrior and
// medianNowCostByPosition are plain pure functions, imported and exercised
// directly.
import { effectiveRatePositionPrior, medianNowCostByPosition } from './project-points.ts'
import { GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD } from '../src/lib/scoring/types.ts'
import { computeTwoStagePlayerRates } from '../src/lib/projection/rates.ts'

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

// ============================================================================
// Ticket #119 — price as a weak prior for players with no Premier League
// history at either level. medianNowCostByPosition and
// effectiveRatePositionPrior are pulled out as pure, exported functions
// (same technique as the #113 helpers above) specifically so the "any
// player with real minutes is completely unaffected" guarantee — the
// ticket's most important test — is provable on constructed inputs, without
// a live Supabase project.
// ============================================================================

const zeroPrior = { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }
const samplePrior = { xgPer90: 0.3, xaPer90: 0.15, savesPer90: 2, cbiPer90: 5, recoveriesPer90: 6 }

describe('medianNowCostByPosition — ticket #119', () => {
  it('computes the median now_cost per position independently', () => {
    const players = [
      { element_type: FORWARD, now_cost: 140 },
      { element_type: FORWARD, now_cost: 60 },
      { element_type: FORWARD, now_cost: 100 }, // FORWARD median: 100 (middle of 60,100,140)
      { element_type: GOALKEEPER, now_cost: 40 },
      { element_type: GOALKEEPER, now_cost: 50 }, // GOALKEEPER median: 45 (even count, average of two middle)
    ]
    const medians = medianNowCostByPosition(players)
    expect(medians[FORWARD]).toBe(100)
    expect(medians[GOALKEEPER]).toBe(45)
  })

  it('a position with no players returns a median of 0, not NaN or undefined', () => {
    const medians = medianNowCostByPosition([{ element_type: FORWARD, now_cost: 100 }])
    expect(medians[GOALKEEPER]).toBe(0)
    expect(medians[DEFENDER]).toBe(0)
    expect(medians[MIDFIELDER]).toBe(0)
  })

  it('an entirely empty player list returns 0 for every position', () => {
    const medians = medianNowCostByPosition([])
    expect(medians[GOALKEEPER]).toBe(0)
    expect(medians[DEFENDER]).toBe(0)
    expect(medians[MIDFIELDER]).toBe(0)
    expect(medians[FORWARD]).toBe(0)
  })

  it('does not mutate the input array or its order', () => {
    const players = [
      { element_type: MIDFIELDER, now_cost: 100 },
      { element_type: MIDFIELDER, now_cost: 50 },
    ]
    const original = [...players]
    medianNowCostByPosition(players)
    expect(players).toEqual(original)
  })

  it('source: computes the median from the data passed in -- no numeric price literal anywhere in the function body', () => {
    const match = source.match(/export function medianNowCostByPosition[\s\S]*?\n}\n/)
    expect(match).not.toBeNull()
    const body = match![0]
    // GOALKEEPER/DEFENDER/MIDFIELDER/FORWARD are Position CONSTANTS, not
    // numeric literals in source text -- the only characters that could
    // match \d here would be an actual hardcoded number.
    expect(body).not.toMatch(/\d/)
  })
})

describe('effectiveRatePositionPrior — ticket #119', () => {
  it('a player with current-season rows (coverage "current") is completely unaffected by price, regardless of how extreme the price is', () => {
    const withoutAdjustment = samplePrior
    const forCheapPlayer = effectiveRatePositionPrior('current', samplePrior, 40, 100)
    const forExpensivePlayer = effectiveRatePositionPrior('current', samplePrior, 150, 100)
    expect(forCheapPlayer).toEqual(withoutAdjustment)
    expect(forExpensivePlayer).toEqual(withoutAdjustment)
  })

  it('a player with only historical rows (coverage "historicalOnly") is completely unaffected by price', () => {
    const forCheapPlayer = effectiveRatePositionPrior('historicalOnly', samplePrior, 40, 100)
    const forExpensivePlayer = effectiveRatePositionPrior('historicalOnly', samplePrior, 150, 100)
    expect(forCheapPlayer).toEqual(samplePrior)
    expect(forExpensivePlayer).toEqual(samplePrior)
  })

  it('a player with no rows at any level (coverage "neither") IS price-adjusted', () => {
    const adjusted = effectiveRatePositionPrior('neither', samplePrior, 150, 100)
    expect(adjusted.xgPer90).not.toBe(samplePrior.xgPer90)
    expect(adjusted.xgPer90).toBeCloseTo(samplePrior.xgPer90 * 1.5, 10)
  })

  it('zero prior with any coverage stays exactly zero -- no hidden floor introduced by the price adjustment', () => {
    expect(effectiveRatePositionPrior('current', zeroPrior, 150, 100)).toEqual(zeroPrior)
    expect(effectiveRatePositionPrior('neither', zeroPrior, 150, 100)).toEqual(zeroPrior)
  })
})

describe('project-points.ts — full-pipeline equivalence proof for the "unaffected by minutes" DoD item (ticket #119)', () => {
  // This is the ticket's most important test: a player with ANY minutes at
  // either level must project identically, to the last decimal, to how they
  // projected before this ticket -- i.e. as if effectiveRatePositionPrior did
  // not exist and the plain position prior were always used.
  const positionPrior = { xgPer90: 0.25, xaPer90: 0.12, savesPer90: 0, cbiPer90: 4, recoveriesPer90: 5 }

  const currentSeasonOnly = { minutesPlayed: 450, totalXg: 3, totalXa: 1, totalSaves: 0, totalCbi: 20, totalRecoveries: 25 }
  const historicalOnly = { minutesPlayed: 3000, totalXg: 15, totalXa: 8, totalSaves: 0, totalCbi: 90, totalRecoveries: 110 }
  const zeroHistory = { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 }

  it('current-season-only player: identical with or without the price-prior wiring', () => {
    const priorWithPriceWiring = effectiveRatePositionPrior('current', positionPrior, 150, 100) // extreme price -- would matter a lot if wrongly applied
    const withPriceWiring = computeTwoStagePlayerRates(currentSeasonOnly, zeroHistory, priorWithPriceWiring)
    const withoutPriceWiring = computeTwoStagePlayerRates(currentSeasonOnly, zeroHistory, positionPrior)
    expect(withPriceWiring).toEqual(withoutPriceWiring)
  })

  it('historical-only player: identical with or without the price-prior wiring', () => {
    const priorWithPriceWiring = effectiveRatePositionPrior('historicalOnly', positionPrior, 40, 100) // extreme price the other way
    const withPriceWiring = computeTwoStagePlayerRates(zeroHistory, historicalOnly, priorWithPriceWiring)
    const withoutPriceWiring = computeTwoStagePlayerRates(zeroHistory, historicalOnly, positionPrior)
    expect(withPriceWiring).toEqual(withoutPriceWiring)
  })

  it('player with rows at both levels: identical with or without the price-prior wiring', () => {
    const priorWithPriceWiring = effectiveRatePositionPrior('current', positionPrior, 150, 100)
    const withPriceWiring = computeTwoStagePlayerRates(currentSeasonOnly, historicalOnly, priorWithPriceWiring)
    const withoutPriceWiring = computeTwoStagePlayerRates(currentSeasonOnly, historicalOnly, positionPrior)
    expect(withPriceWiring).toEqual(withoutPriceWiring)
  })

  it('a player with no rows at either level DOES change -- proving the test above is meaningful, not a tautology', () => {
    const priorWithPriceWiring = effectiveRatePositionPrior('neither', positionPrior, 150, 100)
    const withPriceWiring = computeTwoStagePlayerRates(zeroHistory, zeroHistory, priorWithPriceWiring)
    const withoutPriceWiring = computeTwoStagePlayerRates(zeroHistory, zeroHistory, positionPrior)
    expect(withPriceWiring.xgPer90).not.toBeCloseTo(withoutPriceWiring.xgPer90, 6)
  })
})

describe('project-points.ts — price-prior source invariants (ticket #119)', () => {
  it('selects now_cost from the players table', () => {
    expect(source).toMatch(/\.select\(\s*['"][^'"]*\bnow_cost\b[^'"]*['"]/)
  })

  it('imports priceAdjustedPositionPrior and priceAdjustmentScale from src/lib/projection rather than re-deriving the scale inline', () => {
    expect(source).toMatch(/priceAdjustedPositionPrior/)
    expect(source).toMatch(/priceAdjustmentScale/)
  })

  it('reports all three ticket #119 counters as separate named job_runs.details fields', () => {
    expect(source).toMatch(/playersPriceAdjustedPrior/)
    expect(source).toMatch(/playersPriceAdjustedScaledUp/)
    expect(source).toMatch(/playersPriceAdjustedScaledDown/)
  })

  it('never substitutes the price-adjusted prior for computePlayerRates\'s historical stage-1 call except via effectiveRatePositionPrior -- no direct ratePriorByPosition reference remains inside the per-player loop', () => {
    // Guards against a regression where a future edit re-introduces
    // `ratePriorByPosition[position]` directly into the two rate-computation
    // call sites instead of going through `effectivePrior`.
    expect(source).toMatch(/computePlayerRates\(historicalRateHistory,\s*effectivePrior\)/)
    expect(source).toMatch(/computeTwoStagePlayerRates\(currentRateHistory,\s*historicalRateHistory,\s*effectivePrior\)/)
  })

  it('the price-adjusted counter equals the "neither" counter exactly -- asserted arithmetically over a synthetic population', () => {
    // Mirrors the #113 "buckets sum to the total" test above, but for the
    // #119 counters: main() increments playersPriceAdjustedPrior precisely
    // when effectiveRatePositionPrior takes its price-adjusting branch.
    // effectiveRatePositionPrior returns the ORIGINAL positionPrior object
    // (by reference) for 'current'/'historicalOnly', and a freshly
    // constructed object (from priceAdjustedPositionPrior) for 'neither' --
    // even when the price exactly equals the median and every numeric value
    // comes out equal. Reference identity is therefore an exact,
    // independent proxy for "did this player get counted", used here to
    // prove the two counters cannot drift apart.
    const population: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
    ]
    let playersWithNeitherSeasonRows = 0
    let playersPriceAdjustedPrior = 0
    for (const [hasCurrent, hasHistorical] of population) {
      const coverage = classifySeasonCoverage(hasCurrent, hasHistorical)
      if (coverage === 'neither') playersWithNeitherSeasonRows++
      const adjusted = effectiveRatePositionPrior(coverage, samplePrior, 100, 100) // price == median, on purpose
      if (adjusted !== samplePrior) playersPriceAdjustedPrior++
    }
    expect(playersPriceAdjustedPrior).toBe(playersWithNeitherSeasonRows)
    expect(playersPriceAdjustedPrior).toBe(3)
  })
})
