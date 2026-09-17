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
// Ticket #213: same reasoning -- computeSeasonMinutesPerMatch is a plain pure
// function (no Supabase call of its own), imported and exercised directly.
import { computeSeasonMinutesPerMatch } from './project-points.ts'
// Ticket #119: same reasoning -- effectiveRatePositionPrior and
// medianNowCostByPosition are plain pure functions, imported and exercised
// directly.
import { effectiveRatePositionPrior, medianNowCostByPosition } from './project-points.ts'
// Ticket #177: same reasoning -- resolvePriorRowPosition and
// buildPositionPriorMatches are plain pure functions (no Supabase call of
// their own), imported and exercised directly so the survivorship-bias fix
// is provable on constructed rows, not only grepped.
import { resolvePriorRowPosition, buildPositionPriorMatches, type MatchStatsRow } from './project-points.ts'
// Ticket #229: same reasoning -- buildFixtureContext is a plain pure
// function (no Supabase call of its own), imported and exercised directly so
// the resolveFixtureExpectedScore wiring is provable on constructed rows,
// not only grepped.
import { buildFixtureContext, type TeamMetadata } from './project-points.ts'
// Ticket #238: same reasoning -- buildMarketOddsContext and latestOddsByFixtureId are plain pure
// functions (no Supabase call of their own), imported and exercised directly.
import { buildMarketOddsContext, latestOddsByFixtureId, type FixtureOddsRow } from './project-points.ts'
// Ticket #235: same reasoning -- toFixtureResultRows and teamCodeByIdFrom
// are plain pure functions (no Supabase call of their own), imported and
// exercised directly so the fixtures -> team-strength wiring is provable on
// constructed rows, not only grepped. Replaces buildCurrentSeasonTeamMatchRecords
// (deleted this ticket -- see git history and teamStrength.ts's own header).
import { toFixtureResultRows, teamCodeByIdFrom, type FixtureRow } from './project-points.ts'
import { GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD } from '../src/lib/scoring/types.ts'
import { computeTwoStagePlayerRates } from '../src/lib/projection/rates.ts'
import { MIN_TEAM_PRIOR_MATCHES, type TeamMatchRecord } from '../src/lib/projection/teamStrength.ts'

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

describe('computeSeasonMinutesPerMatch — ticket #213', () => {
  it('a player with current-season matches: total minutes / match count', () => {
    expect(computeSeasonMinutesPerMatch(360, 5)).toBeCloseTo(72, 10)
    expect(computeSeasonMinutesPerMatch(90, 1)).toBeCloseTo(90, 10)
  })

  it('zero current-season matches -> undefined, never 0 or NaN (the fallback case, counted by main() as playersMinutesSeasonFigureFallback)', () => {
    expect(computeSeasonMinutesPerMatch(0, 0)).toBeUndefined()
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

  it('reports the ticket #213 minutes-shrinkage fallback as its own named job_runs.details field, never silently', () => {
    expect(source).toMatch(/playersMinutesSeasonFigureFallback/)
    expect(source).toMatch(/seasonMinutesPerMatch/)
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
    // The only digits allowed here are the 1-4 Position codes used as
    // Record<Position, ...> initializer keys (same style as
    // rateMatchesByPosition/defconMatchesByPosition above them in this
    // file) -- a real price literal (players.now_cost values run from
    // roughly 40 to 150+) would always be two or more digits.
    expect(body).not.toMatch(/\b\d{2,}\b/)
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

// ============================================================================
// Ticket #177 — position priors from every qualifying row, not survivors
// onto the current roster only. resolvePriorRowPosition and
// buildPositionPriorMatches are pulled out as plain pure functions (same
// technique as the #113/#119 helpers above) specifically so the
// survivorship-bias fix #168 measured is provable on constructed rows,
// without a live Supabase project.
// ============================================================================

/** Builds a MatchStatsRow with sensible defaults, overridable per field -- keeps each test's arrange step to only the fields it actually cares about. */
function matchRow(overrides: Partial<MatchStatsRow> = {}): MatchStatsRow {
  return {
    player_code: 1,
    season: '2025-2026',
    gameweek: 1,
    minutes_played: 90,
    xg: 0.2,
    xa: 0.1,
    saves: 0,
    clearances: 1,
    blocks: 1,
    interceptions: 1,
    tackles: 1,
    recoveries: 2,
    element_type: null,
    ...overrides,
  }
}

function rosterOf(entries: ReadonlyArray<[number, number]>): Map<number, { element_type: number }> {
  return new Map(entries.map(([code, elementType]) => [code, { element_type: elementType }]))
}

describe('resolvePriorRowPosition — ticket #177', () => {
  it('element_type is the PRIMARY source when present, regardless of what the roster says', () => {
    const row = matchRow({ player_code: 1, element_type: FORWARD })
    const roster = rosterOf([[1, GOALKEEPER]]) // deliberately contradicts element_type
    const resolution = resolvePriorRowPosition(row, roster)
    expect(resolution).toEqual({ position: FORWARD, source: 'elementType' })
  })

  it('falls back to the roster only when element_type is null', () => {
    const row = matchRow({ player_code: 1, element_type: null })
    const roster = rosterOf([[1, DEFENDER]])
    const resolution = resolvePriorRowPosition(row, roster)
    expect(resolution).toEqual({ position: DEFENDER, source: 'playersFallback' })
  })

  it('unresolved when element_type is null and the player has no roster entry -- the exact row the pre-#177 join silently dropped', () => {
    const row = matchRow({ player_code: 999, element_type: null })
    const roster = rosterOf([]) // empty roster -- player_code 999 not found
    const resolution = resolvePriorRowPosition(row, roster)
    expect(resolution).toEqual({ position: undefined, source: 'unresolved' })
  })

  it('unresolved (not a thrown error) when player_code is null and element_type is also null', () => {
    const row = matchRow({ player_code: null, element_type: null })
    const roster = rosterOf([])
    const resolution = resolvePriorRowPosition(row, roster)
    expect(resolution).toEqual({ position: undefined, source: 'unresolved' })
  })

  it('a row with element_type set still resolves even when player_code is null -- the two failure modes are independent', () => {
    const row = matchRow({ player_code: null, element_type: MIDFIELDER })
    const roster = rosterOf([])
    const resolution = resolvePriorRowPosition(row, roster)
    expect(resolution).toEqual({ position: MIDFIELDER, source: 'elementType' })
  })
})

describe('buildPositionPriorMatches — a historical row for a player NOT on the current roster now contributes, and did not before (ticket #177)', () => {
  it('the OLD behaviour: a roster-only join drops this row outright', () => {
    // This is the exact line ticket #177 replaces (see project-points.ts's
    // header and git history): `codeToPlayer.get(row.player_code)` with no
    // element_type fallback. Reproduced here, standalone, to prove the
    // "did not before" half of the DoD item -- not just asserted in prose.
    const roster = rosterOf([]) // the 44 forwards #168 found dropped from the roster
    const oldJoinResult = roster.get(999) // player_code 999 -- no entry
    expect(oldJoinResult).toBeUndefined() // pre-#177: `if (!player) continue` -- row silently skipped, contributes to no prior
  })

  it('the NEW behaviour: the same row, with element_type populated, contributes to its position prior', () => {
    const roster = rosterOf([]) // same empty roster -- player_code 999 still absent
    const rows = [matchRow({ player_code: 999, element_type: FORWARD, xg: 0.4, xa: 0.3, minutes_played: 90 })]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.rateMatchesByPosition[FORWARD]).toHaveLength(1)
    expect(result.rateMatchesByPosition[FORWARD][0]).toMatchObject({ xg: 0.4, xa: 0.3, minutesPlayed: 90 })
    expect(result.priorRowsContributing).toBe(1)
    expect(result.priorRowsContributingNoRosterEntry).toBe(1) // the recovered population
  })

  it('the defcon position prior is fixed by the SAME change -- built from the same loop, same row', () => {
    const roster = rosterOf([])
    const rows = [
      matchRow({ player_code: 999, element_type: FORWARD, clearances: 3, blocks: 2, interceptions: 1, tackles: 4, recoveries: 5 }),
    ]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.defconMatchesByPosition[FORWARD]).toHaveLength(1)
    expect(result.defconMatchesByPosition[FORWARD][0]).toMatchObject({
      clearances: 3,
      blocks: 2,
      interceptions: 1,
      tackles: 4,
      recoveries: 5,
    })
  })

  it('a player who IS on the current roster still contributes, and is not double-counted as "no roster entry"', () => {
    const roster = rosterOf([[1, FORWARD]])
    const rows = [matchRow({ player_code: 1, element_type: FORWARD })]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.priorRowsContributing).toBe(1)
    expect(result.priorRowsContributingNoRosterEntry).toBe(0)
  })

  it('a row with neither a stored element_type nor a roster entry is skipped, counted, and contributes to no prior', () => {
    const roster = rosterOf([])
    const rows = [matchRow({ player_code: 999, element_type: null })]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.rateMatchesByPosition[FORWARD]).toHaveLength(0)
    expect(result.rateMatchesByPosition[GOALKEEPER]).toHaveLength(0)
    expect(result.rateMatchesByPosition[DEFENDER]).toHaveLength(0)
    expect(result.rateMatchesByPosition[MIDFIELDER]).toHaveLength(0)
    expect(result.priorRowsContributing).toBe(0)
    expect(result.priorRowsSkippedNoPosition).toBe(1)
  })

  it('a row with no player_code at all is skipped under its OWN counter, separate from "no resolvable position"', () => {
    const roster = rosterOf([])
    const rows = [matchRow({ player_code: null, element_type: null })]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.priorRowsSkippedNoPlayerCode).toBe(1)
    expect(result.priorRowsSkippedNoPosition).toBe(0)
  })

  it('the four counters reconcile arithmetically against the rows read, over a mixed population', () => {
    const roster = rosterOf([[1, FORWARD], [2, DEFENDER]])
    const rows = [
      matchRow({ player_code: 1, element_type: FORWARD }), // contributes, on roster
      matchRow({ player_code: 999, element_type: MIDFIELDER }), // contributes, NOT on roster -- recovered
      matchRow({ player_code: 2, element_type: null }), // contributes via roster fallback
      matchRow({ player_code: 888, element_type: null }), // skipped -- no position resolvable
      matchRow({ player_code: null, element_type: null }), // skipped -- no player_code
    ]
    const result = buildPositionPriorMatches(rows, roster)
    expect(result.priorRowsContributing).toBe(3)
    expect(result.priorRowsContributingNoRosterEntry).toBe(1)
    expect(result.priorRowsSkippedNoPosition).toBe(1)
    expect(result.priorRowsSkippedNoPlayerCode).toBe(1)
    expect(
      result.priorRowsContributing + result.priorRowsSkippedNoPosition + result.priorRowsSkippedNoPlayerCode,
    ).toBe(rows.length)
  })

  it('an empty input produces empty priors and all-zero counters, not an error', () => {
    const result = buildPositionPriorMatches([], rosterOf([]))
    for (const position of [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]) {
      expect(result.rateMatchesByPosition[position]).toEqual([])
      expect(result.defconMatchesByPosition[position]).toEqual([])
    }
    expect(result.priorRowsContributing).toBe(0)
    expect(result.priorRowsContributingNoRosterEntry).toBe(0)
    expect(result.priorRowsSkippedNoPosition).toBe(0)
    expect(result.priorRowsSkippedNoPlayerCode).toBe(0)
  })
})

describe('project-points.ts — position-prior source invariants (ticket #177)', () => {
  it('the prior-building loop no longer skips a row solely because its player_code is absent from the live roster', () => {
    // The exact line this ticket replaces (see git history): `const player =
    // codeToPlayer.get(row.player_code); if (!player) continue`. Neither
    // that skip nor its accompanying old comment may remain anywhere in the
    // file.
    expect(source).not.toMatch(/if\s*\(\s*!player\s*\)\s*continue/)
    expect(source).not.toMatch(/contributes no position prior/)
  })

  it('imports element_type in the player_match_stats select, alongside the existing columns', () => {
    expect(source).toMatch(/\.select\(\s*\n?\s*['"][^'"]*\bplayer_code\b[^'"]*\belement_type\b[^'"]*['"]/)
  })

  it('resolvePriorRowPosition and buildPositionPriorMatches are used to build the position priors', () => {
    expect(source).toMatch(/function resolvePriorRowPosition/)
    expect(source).toMatch(/function buildPositionPriorMatches/)
    expect(source).toMatch(/buildPositionPriorMatches\(matchStatsRows,\s*codeToPlayer\)/)
  })

  it('reports all four ticket #177 counters as separate named job_runs.details fields', () => {
    expect(source).toMatch(/priorRowsContributing\b/)
    expect(source).toMatch(/priorRowsContributingNoRosterEntry/)
    expect(source).toMatch(/priorRowsSkippedNoPosition/)
    expect(source).toMatch(/priorRowsSkippedNoPlayerCode/)
  })

  it('never introduces a second assist-conversion constant -- #168 explicitly refused this, and this ticket must not either', () => {
    // Guards against the exact temptation the ticket's Notes call out: a
    // 0.67-shaped multiplier applied to an assist figure to "correct" it on
    // top of the recovered priors, rather than letting the wider source
    // population speak for itself. The diagnostic figure itself is fine in
    // a comment (this file's own header cites it) -- what must never appear
    // is it used as an operand.
    expect(source).not.toMatch(/0\.67\s*\*/)
    expect(source).not.toMatch(/\*\s*0\.67/)
    expect(source).not.toMatch(/assist\w*\s*\*=?\s*0\.67/i)
  })
})

// ============================================================================
// Ticket #177 — the PROJECTED population (which players receive a
// player_projections row) must be unchanged: only the position priors move,
// never who gets projected. This is the item that stops the ticket leaking
// into the solver's player pool. main()'s per-player loop can't be
// exercised without a live Supabase project (see file header), so this is
// proven the same way the rest of this file proves main()'s untestable
// behaviour: by grepping the shipped source for the exact structural
// guarantee.
// ============================================================================

describe('project-points.ts — projected population unchanged (ticket #177)', () => {
  it('the per-player projection loop still iterates playerRows -- the live current-roster read from section 2 -- unconditionally', () => {
    expect(source).toMatch(/for \(const player of playerRows\) \{/)
  })

  it('resolvePriorRowPosition and buildPositionPriorMatches are called only once, to build the position priors, never inside the per-player projection loop that stages playerGwKeys/stagedFixtures', () => {
    // `for (const player of playerRows) {` appears TWICE: once building
    // codeToPlayer (section 2/4 boundary) and once as section 5's actual
    // per-player projection loop, which runs through to section 5b's
    // bonus-allocation comment. lastIndexOf targets the second (real
    // projection loop) -- neither position-prior helper's name may appear
    // inside it; if one did, a historical-only player_code could leak into
    // the projected population, exactly what this ticket must not do.
    const loopStart = source.lastIndexOf('for (const player of playerRows) {')
    expect(loopStart).toBeGreaterThan(-1)
    const loopEnd = source.indexOf('5b. Bonus allocation', loopStart)
    expect(loopEnd).toBeGreaterThan(loopStart)
    const loopBody = source.slice(loopStart, loopEnd)
    expect(loopBody).not.toMatch(/buildPositionPriorMatches|resolvePriorRowPosition/)
    // Sanity: the slice actually captured section 5's loop body, not an
    // empty or trivial span -- it must contain playerGwKeys.push, which
    // only exists in that loop.
    expect(loopBody).toMatch(/playerGwKeys\.push\(/)
  })

  it('buildPositionPriorMatches is called exactly once in the whole file -- the position priors are computed a single time, not per player', () => {
    const occurrences = source.split('buildPositionPriorMatches(matchStatsRows, codeToPlayer)').length - 1
    expect(occurrences).toBe(1)
  })

  it('rowsToUpsert (and therefore player_projections) is built by iterating playerGwKeys, which is populated only inside the playerRows loop above', () => {
    expect(source).toMatch(/for \(const key of playerGwKeys\)/)
    expect(source).toMatch(/playerGwKeys\.push\(/)
  })
})

// ============================================================================
// Ticket #229 — point-in-time team strength replaces frozen ClubElo whenever
// the elo table cannot be trusted. buildFixtureContext is a plain pure
// function, imported and exercised directly (same technique as every
// #113/#119/#177 helper above).
//
// Ticket #235 — the RECORDS that feed buildFixtureContext's
// teamMatchRecords parameter now come from public.fixtures (real results),
// not from player_match_stats' match_id-derived opponent columns. The pure
// record-building function itself (buildTeamMatchRecordsFromFixtures) is
// tested in src/lib/projection/teamStrength.test.ts, alongside its sibling
// buildTeamMatchRecords; this file tests only the WIRING this file owns --
// toFixtureResultRows and teamCodeByIdFrom -- the same split this file
// already uses for buildFixtureContext vs. the primitives it calls.
// ============================================================================

/** Builds a FixtureRow with sensible defaults, overridable per field. */
function fixtureRow(overrides: Partial<FixtureRow> & Pick<FixtureRow, 'id' | 'team_h' | 'team_a'>): FixtureRow {
  return {
    event_id: 1,
    team_h_difficulty: 3,
    team_a_difficulty: 3,
    team_h_score: null,
    team_a_score: null,
    finished: false,
    ...overrides,
  }
}

describe('toFixtureResultRows (ticket #235)', () => {
  it('maps id/event_id/team_h/team_a/team_h_score/team_a_score/finished onto the pure module\'s FixtureResultRow shape', () => {
    const rows = toFixtureResultRows([
      fixtureRow({ id: 39, event_id: 4, team_h: 1, team_a: 2, team_h_score: 2, team_a_score: 1, finished: true }),
    ])
    expect(rows).toEqual([{ fixtureId: 39, gameweek: 4, homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 1, finished: true }])
  })

  it('drops a row whose event_id is null (a blank-gameweek fixture) -- never guessed into a gameweek', () => {
    const rows = toFixtureResultRows([fixtureRow({ id: 1, event_id: null, team_h: 1, team_a: 2 })])
    expect(rows).toEqual([])
  })

  it('an empty input produces an empty output, not an error', () => {
    expect(toFixtureResultRows([])).toEqual([])
  })
})

describe('teamCodeByIdFrom (ticket #235)', () => {
  it('maps teams.id -> teams.code straight off teamMetadataById', () => {
    const teamMetadataById = new Map<number, TeamMetadata>([
      [1, { eloStale: false, code: 10 }],
      [2, { eloStale: true, code: 20 }],
    ])
    const result = teamCodeByIdFrom(teamMetadataById)
    expect(result.get(1)).toBe(10)
    expect(result.get(2)).toBe(20)
  })

  it('a club with no resolvable code (code: null) maps to null, not dropped from the map entirely', () => {
    const teamMetadataById = new Map<number, TeamMetadata>([[1, { eloStale: false, code: null }]])
    const result = teamCodeByIdFrom(teamMetadataById)
    expect(result.has(1)).toBe(true)
    expect(result.get(1)).toBeNull()
  })

  it('an empty input produces an empty map, not an error', () => {
    expect(teamCodeByIdFrom(new Map())).toEqual(new Map())
  })
})

describe('buildFixtureContext (ticket #229)', () => {
  const OWN_TEAM_ID = 1
  const OPPONENT_TEAM_ID = 2
  const eloByTeamId = new Map<number, number | null>([
    [OWN_TEAM_ID, 1700],
    [OPPONENT_TEAM_ID, 1500],
  ])
  const freshMetadata: TeamMetadata = { eloStale: false, code: 100 }
  const staleMetadata: TeamMetadata = { eloStale: true, code: 100 }
  const opponentMetadata: TeamMetadata = { eloStale: false, code: 200 }

  it('passes teamElo/opponentElo/isHome/fplDifficulty/leagueBaselineGoals through unchanged', () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, freshMetadata],
      [OPPONENT_TEAM_ID, opponentMetadata],
    ])
    const ctx = buildFixtureContext({
      fixtureId: 42,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
    })
    expect(ctx.fixtureId).toBe(42)
    expect(ctx.isHome).toBe(true)
    expect(ctx.fplDifficulty).toBe(3)
    expect(ctx.leagueBaselineGoals).toBe(1.45)
    expect(ctx.teamElo).toBe(1700)
    expect(ctx.opponentElo).toBe(1500)
  })

  it('teamEloStale/opponentEloStale reflect each club\'s own teamMetadataById entry', () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, staleMetadata],
      [OPPONENT_TEAM_ID, opponentMetadata],
    ])
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
    })
    expect(ctx.teamEloStale).toBe(true)
    expect(ctx.opponentEloStale).toBe(false)
  })

  it('a club missing from teamMetadataById defaults to eloStale=false and an unresolved code (never a guessed strength record)', () => {
    const teamMetadataById = new Map<number, TeamMetadata>() // neither club resolves
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId: new Map(),
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
    })
    expect(ctx.teamElo).toBeNull()
    expect(ctx.opponentElo).toBeNull()
    expect(ctx.teamEloStale).toBe(false)
    expect(ctx.opponentEloStale).toBe(false)
    expect(ctx.teamStrength).toBeUndefined()
    expect(ctx.opponentTeamStrength).toBeUndefined()
  })

  it("teamStrength/opponentTeamStrength are computed from teamMatchRecords via each club's OWN code, strictly before gameweekId", () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, freshMetadata], // code 100
      [OPPONENT_TEAM_ID, opponentMetadata], // code 200
    ])
    const teamMatchRecords: TeamMatchRecord[] = [
      // Own club (code 100): MIN_TEAM_PRIOR_MATCHES prior matches, all before gameweek 5.
      ...Array.from({ length: MIN_TEAM_PRIOR_MATCHES }, (_, i) => ({ matchId: `own-${i}`, gameweek: i + 1, teamCode: 100, goalsConceded: 0, goalsScored: 2 })),
      // A LATER match for the own club -- must NOT be counted (the lookahead guard).
      { matchId: 'own-later', gameweek: 5, teamCode: 100, goalsConceded: 9, goalsScored: 0 },
      // Opponent (code 200): only ONE prior match -- insufficient history.
      { matchId: 'opp-1', gameweek: 1, teamCode: 200, goalsConceded: 1, goalsScored: 1 },
    ]
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId: new Map(),
      teamMetadataById,
      teamMatchRecords,
      gameweekId: 5,
    })
    expect(ctx.teamStrength).toEqual({ matches: MIN_TEAM_PRIOR_MATCHES, goalsScored: MIN_TEAM_PRIOR_MATCHES * 2, goalsConceded: 0 })
    expect(ctx.opponentTeamStrength).toEqual({ matches: 1, goalsScored: 1, goalsConceded: 1 })
  })

  // ==========================================================================
  // Ticket #238 -- market odds wiring.
  // ==========================================================================

  const oddsRow: FixtureOddsRow = { fixture_id: 1, fetched_at: new Date(1000).toISOString(), book_count: 21, p_home: 0.5, p_draw: 0.3, p_away: 0.2, overround: 1.05 }

  it('marketOdds is undefined when no oddsRow is supplied -- an exact no-op for every pre-#238 caller', () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, freshMetadata],
      [OPPONENT_TEAM_ID, opponentMetadata],
    ])
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
    })
    expect(ctx.marketOdds).toBeUndefined()
  })

  it('marketOdds is undefined when oddsRow is supplied but nowMs is not (freshness cannot be judged without a clock)', () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, freshMetadata],
      [OPPONENT_TEAM_ID, opponentMetadata],
    ])
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
      oddsRow,
    })
    expect(ctx.marketOdds).toBeUndefined()
  })

  it('marketOdds is built via buildMarketOddsContext when both oddsRow and nowMs are supplied', () => {
    const teamMetadataById = new Map([
      [OWN_TEAM_ID, freshMetadata],
      [OPPONENT_TEAM_ID, opponentMetadata],
    ])
    const ctx = buildFixtureContext({
      fixtureId: 1,
      isHome: true,
      fplDifficulty: 3,
      leagueBaselineGoals: 1.45,
      ownTeamId: OWN_TEAM_ID,
      opponentTeamId: OPPONENT_TEAM_ID,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords: [],
      gameweekId: 5,
      oddsRow,
      nowMs: 2000,
    })
    expect(ctx.marketOdds).toEqual(buildMarketOddsContext(oddsRow, true, 2000))
  })
})

describe('buildMarketOddsContext (ticket #238)', () => {
  const row: FixtureOddsRow = { fixture_id: 1, fetched_at: new Date(0).toISOString(), book_count: 21, p_home: 0.5, p_draw: 0.3, p_away: 0.2, overround: 1.05 }

  it('orients expectedScoreValue as pHome + 0.5*pDraw for the home side', () => {
    const ctx = buildMarketOddsContext(row, true, 0)
    expect(ctx.expectedScoreValue).toBeCloseTo(0.5 + 0.5 * 0.3, 10)
  })

  it('orients expectedScoreValue as pAway + 0.5*pDraw for the away side', () => {
    const ctx = buildMarketOddsContext(row, false, 0)
    expect(ctx.expectedScoreValue).toBeCloseTo(0.2 + 0.5 * 0.3, 10)
  })

  it('carries bookCount and overround through unchanged', () => {
    const ctx = buildMarketOddsContext(row, true, 0)
    expect(ctx.bookCount).toBe(21)
    expect(ctx.overround).toBe(1.05)
  })

  it('isFresh reflects the 48h window between fetched_at and nowMs', () => {
    const fortyEightHoursMs = 48 * 60 * 60 * 1000
    expect(buildMarketOddsContext(row, true, fortyEightHoursMs).isFresh).toBe(true)
    expect(buildMarketOddsContext(row, true, fortyEightHoursMs + 1).isFresh).toBe(false)
  })
})

describe('latestOddsByFixtureId (ticket #238)', () => {
  it('keeps the FIRST row seen per fixture_id -- callers must supply rows most-recent-first', () => {
    const rows: FixtureOddsRow[] = [
      { fixture_id: 1, fetched_at: new Date(2000).toISOString(), book_count: 5, p_home: 0.5, p_draw: 0.3, p_away: 0.2, overround: 1.0 },
      { fixture_id: 1, fetched_at: new Date(1000).toISOString(), book_count: 5, p_home: 0.4, p_draw: 0.3, p_away: 0.3, overround: 1.0 },
      { fixture_id: 2, fetched_at: new Date(1500).toISOString(), book_count: 5, p_home: 0.6, p_draw: 0.2, p_away: 0.2, overround: 1.0 },
    ]
    const result = latestOddsByFixtureId(rows)
    expect(result.size).toBe(2)
    expect(result.get(1)?.fetched_at).toBe(new Date(2000).toISOString())
    expect(result.get(2)?.fetched_at).toBe(new Date(1500).toISOString())
  })

  it('an empty input produces an empty map', () => {
    expect(latestOddsByFixtureId([])).toEqual(new Map())
  })
})

describe('project-points.ts — ticket #229 source invariants', () => {
  it('the teams select reads elo_stale_since and code alongside the existing elo/id columns -- no extra Supabase round trip, same select', () => {
    expect(source).toMatch(/\.from\('teams'\)\s*\n?\s*\.select\(\s*['"][^'"]*\bid\b[^'"]*\belo\b[^'"]*\belo_stale_since\b[^'"]*\bcode\b[^'"]*['"]/)
  })

  it('the fixture-context construction calls buildFixtureContext, not a hand-built object literal -- the wiring this file owns is tested above, not duplicated inline', () => {
    expect(source).toMatch(/return buildFixtureContext\(\{/)
  })

  it('job_runs.details carries the new fixtureSourceCounts breakdown alongside the pre-existing fixtureEloFallbackCount', () => {
    expect(source).toMatch(/fixtureEloFallbackCount/)
    expect(source).toMatch(/fixtureSourceCounts/)
  })
})

// ============================================================================
// Ticket #235 — team strength sourced from public.fixtures (real results),
// not player_match_stats' match_id-derived opponent columns. Source
// invariants only: main()'s Supabase reads can't be exercised without a live
// project (see file header); toFixtureResultRows/teamCodeByIdFrom are
// exercised directly above.
// ============================================================================

describe('project-points.ts — ticket #235 source invariants', () => {
  it('the player_match_stats select no longer reads match_id, team_code, opponent_team_code or team_goals_conceded -- that construction is replaced by public.fixtures', () => {
    const matchStatsSelectMatch = source.match(/\.from\('player_match_stats'\)[\s\S]{0,10}\.select\(\s*\n?\s*['"][^'"]*['"]/)
    expect(matchStatsSelectMatch).not.toBeNull()
    const matchStatsSelectText = matchStatsSelectMatch![0]
    expect(matchStatsSelectText).not.toMatch(/\bmatch_id\b/)
    expect(matchStatsSelectText).not.toMatch(/\bteam_code\b/)
    expect(matchStatsSelectText).not.toMatch(/\bopponent_team_code\b/)
    expect(matchStatsSelectText).not.toMatch(/\bteam_goals_conceded\b/)
  })

  it('buildCurrentSeasonTeamMatchRecords no longer exists anywhere in the file', () => {
    expect(source).not.toMatch(/buildCurrentSeasonTeamMatchRecords/)
  })

  it('the fixtures select reads team_h_score, team_a_score and finished alongside the existing columns -- the SAME select already reading team_h_difficulty/team_a_difficulty, per the ticket\'s "no additional Supabase round trip" requirement', () => {
    const fixturesSelectMatch = source.match(/\.from\('fixtures'\)[\s\S]{0,10}\.select\(\s*\n?\s*['"][^'"]*['"]/)
    expect(fixturesSelectMatch).not.toBeNull()
    const fixturesSelectText = fixturesSelectMatch![0]
    expect(fixturesSelectText).toMatch(/\bteam_h_difficulty\b/)
    expect(fixturesSelectText).toMatch(/\bteam_a_difficulty\b/)
    expect(fixturesSelectText).toMatch(/\bteam_h_score\b/)
    expect(fixturesSelectText).toMatch(/\bteam_a_score\b/)
    expect(fixturesSelectText).toMatch(/\bfinished\b/)
  })

  it('there is exactly ONE fixtures DATA select in the whole file -- the ticket #229 horizon-only read and the separate finished-only read are merged into one, never two', () => {
    const occurrences = source.split(/\.from\('fixtures'\)/).length - 1
    expect(occurrences).toBe(1)
  })

  it('the fixtures read is no longer filtered to the horizon gameweeks -- team strength needs the WHOLE season\'s results, not just the upcoming ones', () => {
    expect(source).not.toMatch(/\.in\('event_id',\s*horizonGwIds\)/)
  })

  it('the point-in-time team-strength table is built from buildTeamMatchRecordsFromFixtures, fed by toFixtureResultRows(allFixtureRows) and teamCodeByIdFrom(teamMetadataById) -- never a second Supabase read', () => {
    expect(source).toMatch(/buildTeamMatchRecordsFromFixtures\(\s*toFixtureResultRows\(allFixtureRows\),\s*teamCodeById\s*\)/)
  })

  it('teamMatchRecords is built exactly once in the whole file -- not per player, not per gameweek', () => {
    const occurrences = source.split('buildTeamMatchRecordsFromFixtures(').length - 1
    expect(occurrences).toBe(1)
  })

  it('job_runs.details and the console message both carry the new team-strength counters (ticket #235 "Report what happened")', () => {
    expect(source).toMatch(/teamMatchRecordsBuilt/)
    expect(source).toMatch(/clubsMeetingMinTeamPriorMatches/)
    expect(source).toMatch(/teamStrengthUnresolvableTeamCodeCount/)
    // The console message (the `const message =` string built for
    // console.log, not just job_runs.details) must ALSO surface these --
    // ticket text: "must print, in its console summary AND in
    // job_runs.details". Checked by grepping inside the message template
    // literal specifically, not just anywhere in the file.
    const messageStart = source.indexOf('const message =\n      `${JOB_NAME}: projected')
    expect(messageStart).toBeGreaterThan(-1)
    const messageEnd = source.indexOf('console.log(message)', messageStart)
    const messageText = source.slice(messageStart, messageEnd)
    expect(messageText).toMatch(/team-match record/)
    expect(messageText).toMatch(/MIN_TEAM_PRIOR_MATCHES/)
    expect(messageText).toMatch(/Fixture source breakdown/)
  })

  it('MIN_TEAM_PRIOR_MATCHES is imported from teamStrength.ts, not re-declared', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bMIN_TEAM_PRIOR_MATCHES\b[^}]*\}\s*from\s*['"]\.\.\/src\/lib\/projection\/index\.ts['"]/)
  })
})
