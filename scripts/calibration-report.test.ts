// Unit tests for scripts/calibration-report.ts's pure functions — ticket
// #48. No Supabase: every DoD item provable without a database is proven
// here — the reconstruction arithmetic (per position, appearance points,
// clean sheets), and the by-position aggregation (zero-minute exclusion,
// per-90 scaling, ratio). What this file cannot prove — that the paginated
// reads returned everything, and that the real player_match_stats/
// player_projections data produces a sensible report — is why the row-count
// assertion is a DoD item in its own right and the report itself is the
// deliverable (see the ticket's Notes).
//
// Ticket #54 (Premier-League-only filter) appends its own tests at the
// bottom of this file rather than replacing it — #54 does not touch the
// reconstruction/aggregation arithmetic above (explicitly out of scope: no
// fix to the clean-sheet reconstruction), only which ROWS reach it. Its
// tests are source-invariant (grep) tests, since main()'s Supabase reads
// need a live project this Builder's session does not have — same technique
// scripts/ingest-core-insights.test.ts's "source invariants" section and
// scripts/project-points.test.ts already use.
//
// Ticket #127 (restore like-for-like: exclude bonus from the projected
// side) appends its own tests at the bottom too, same reason and same
// technique where main()'s I/O would otherwise be needed.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import {
  aggregateActualByPosition,
  aggregateProjectedByPosition,
  checkExcludedBonusBound,
  componentsPer90,
  EXCLUDED_BONUS_LOWER_BOUND,
  EXCLUDED_BONUS_UPPER_BOUND,
  emptyComponentTotals,
  excludeBonusFromProjection,
  ratio,
  reconstructActualMatchPoints,
  sumComponents,
  topActualScorersByPosition,
  topProjectedPlayersByPosition,
  type ActualAggregationInput,
  type ProjectedAggregationInput,
} from './calibration-report.ts'

// ============================================================================
// reconstructActualMatchPoints — appearance points.
// ============================================================================

describe('reconstructActualMatchPoints — appearance points', () => {
  it('scores 0 appearance points for a zero-minute row', () => {
    const result = reconstructActualMatchPoints(MIDFIELDER, {
      minutesPlayed: 0,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    expect(result.components.appearancePoints).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.totalPoints).toBe(0)
  })

  it('scores 1 appearance point for 1-59 minutes', () => {
    const result = reconstructActualMatchPoints(MIDFIELDER, {
      minutesPlayed: 45,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    expect(result.components.appearancePoints).toBe(1)
  })

  it('scores 2 appearance points for 60+ minutes', () => {
    const result = reconstructActualMatchPoints(MIDFIELDER, {
      minutesPlayed: 60,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    expect(result.components.appearancePoints).toBe(2)
  })

  it('treats a null minutes_played as zero, not a crash', () => {
    const result = reconstructActualMatchPoints(MIDFIELDER, {
      minutesPlayed: null,
      goals: null,
      assists: null,
      goalsConceded: null,
      saves: null,
      clearances: null,
      blocks: null,
      interceptions: null,
      tackles: null,
      recoveries: null,
    })
    expect(result.minutes).toBe(0)
    expect(result.totalPoints).toBe(0)
  })
})

// ============================================================================
// reconstructActualMatchPoints — clean sheets, named per position.
// ============================================================================

describe('reconstructActualMatchPoints — clean sheet points, per position', () => {
  const cleanSheetStats = {
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    goalsConceded: 0,
    saves: 0,
    clearances: 0,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
  }

  it('goalkeeper: 4 points for a clean sheet at 90 minutes', () => {
    expect(reconstructActualMatchPoints(GOALKEEPER, cleanSheetStats).components.cleanSheetPoints).toBe(4)
  })

  it('defender: 4 points for a clean sheet at 90 minutes', () => {
    expect(reconstructActualMatchPoints(DEFENDER, cleanSheetStats).components.cleanSheetPoints).toBe(4)
  })

  it('midfielder: 1 point for a clean sheet at 90 minutes', () => {
    expect(reconstructActualMatchPoints(MIDFIELDER, cleanSheetStats).components.cleanSheetPoints).toBe(1)
  })

  it('forward: 0 points even with a qualifying clean sheet — forwards never score for it', () => {
    expect(reconstructActualMatchPoints(FORWARD, cleanSheetStats).components.cleanSheetPoints).toBe(0)
  })

  it('does not award a clean sheet below 60 minutes even with zero goals conceded', () => {
    const result = reconstructActualMatchPoints(DEFENDER, { ...cleanSheetStats, minutesPlayed: 59 })
    expect(result.components.cleanSheetPoints).toBe(0)
  })

  it('does not award a clean sheet at 60+ minutes if a goal was conceded', () => {
    const result = reconstructActualMatchPoints(DEFENDER, { ...cleanSheetStats, goalsConceded: 1 })
    expect(result.components.cleanSheetPoints).toBe(0)
  })
})

// ============================================================================
// reconstructActualMatchPoints — goals conceded and saves, position-gated.
// ============================================================================

describe('reconstructActualMatchPoints — goals-conceded and save points are position-gated', () => {
  const base = {
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    goalsConceded: 2,
    saves: 4,
    clearances: 0,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
  }

  it('goalkeeper loses 1 point per 2 goals conceded and earns floor(saves/3) save points', () => {
    const result = reconstructActualMatchPoints(GOALKEEPER, base)
    expect(result.components.goalsConcededPoints).toBe(-1)
    expect(result.components.savePoints).toBe(1)
  })

  it('defender loses goals-conceded points but earns no save points', () => {
    const result = reconstructActualMatchPoints(DEFENDER, base)
    expect(result.components.goalsConcededPoints).toBe(-1)
    expect(result.components.savePoints).toBe(0)
  })

  it('midfielder and forward are exempt from goals-conceded and save points entirely', () => {
    const mid = reconstructActualMatchPoints(MIDFIELDER, base)
    const fwd = reconstructActualMatchPoints(FORWARD, base)
    expect(mid.components.goalsConcededPoints).toBe(0)
    expect(mid.components.savePoints).toBe(0)
    expect(fwd.components.goalsConcededPoints).toBe(0)
    expect(fwd.components.savePoints).toBe(0)
  })
})

// ============================================================================
// reconstructActualMatchPoints — defensive contribution, delegated (not
// reimplemented) — a light smoke test; the cap/threshold arithmetic itself
// is src/lib/scoring/defensiveContribution.test.ts's job, not this file's.
// ============================================================================

describe('reconstructActualMatchPoints — defensive contribution is delegated to src/lib/scoring/', () => {
  it('a defender reaching the 10-CBIT threshold scores the capped 2 points, not more', () => {
    const result = reconstructActualMatchPoints(DEFENDER, {
      minutesPlayed: 90,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 5,
      blocks: 5,
      interceptions: 5,
      tackles: 5,
      recoveries: 0,
    })
    expect(result.components.defensiveContributionPoints).toBe(2)
  })

  it('a defender below the threshold scores 0 defensive-contribution points', () => {
    const result = reconstructActualMatchPoints(DEFENDER, {
      minutesPlayed: 90,
      goals: 0,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 1,
      blocks: 1,
      interceptions: 1,
      tackles: 1,
      recoveries: 0,
    })
    expect(result.components.defensiveContributionPoints).toBe(0)
  })
})

// ============================================================================
// reconstructActualMatchPoints — goals and assists.
// ============================================================================

describe('reconstructActualMatchPoints — goals and assists', () => {
  it('a forward scores 4 points per goal and 3 per assist', () => {
    const result = reconstructActualMatchPoints(FORWARD, {
      minutesPlayed: 90,
      goals: 2,
      assists: 1,
      goalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    expect(result.components.goalPoints).toBe(8)
    expect(result.components.assistPoints).toBe(3)
  })

  it('a goalkeeper scores 10 points per goal — the 2026/27 published figure, not the historical 6', () => {
    const result = reconstructActualMatchPoints(GOALKEEPER, {
      minutesPlayed: 90,
      goals: 1,
      assists: 0,
      goalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    expect(result.components.goalPoints).toBe(10)
  })
})

// ============================================================================
// sumComponents / componentsPer90
// ============================================================================

describe('sumComponents and componentsPer90', () => {
  it('sums componentwise across an empty list to the empty totals', () => {
    expect(sumComponents([])).toEqual(emptyComponentTotals())
  })

  it('scales a components total to a per-90 rate', () => {
    const totals = { ...emptyComponentTotals(), goalPoints: 4 }
    const per90 = componentsPer90(totals, 45) // 4 points in 45 minutes -> 8 per 90
    expect(per90?.goalPoints).toBeCloseTo(8)
  })

  it('returns null (not a divide-by-zero) when total minutes is zero', () => {
    expect(componentsPer90(emptyComponentTotals(), 0)).toBeNull()
  })
})

// ============================================================================
// aggregateActualByPosition — the named "zero-minute rows excluded from
// per-appearance mean" requirement.
// ============================================================================

describe('aggregateActualByPosition — zero-minute player-matches are excluded from the per-appearance mean', () => {
  it('a zero-minute row lowers no per-appearance mean, but is still counted in playerMatchCount', () => {
    const records: ActualAggregationInput[] = [
      { position: MIDFIELDER, playerCode: 1, minutes: 90, totalPoints: 10, components: emptyComponentTotals() },
      { position: MIDFIELDER, playerCode: 2, minutes: 0, totalPoints: 0, components: emptyComponentTotals() },
    ]

    const result = aggregateActualByPosition(records)

    expect(result[MIDFIELDER].playerMatchCount).toBe(2)
    expect(result[MIDFIELDER].appearanceCount).toBe(1)
    // If the zero-minute row were wrongly included, the mean would be 5, not 10.
    expect(result[MIDFIELDER].meanPointsPerAppearance).toBe(10)
  })

  it('a position with no rows at all reports null means, not NaN or zero', () => {
    const result = aggregateActualByPosition([])
    expect(result[GOALKEEPER].meanPointsPerAppearance).toBeNull()
    expect(result[GOALKEEPER].meanPointsPer90).toBeNull()
    expect(result[GOALKEEPER].componentPer90).toBeNull()
  })

  it('computes distinct player counts, not row counts, for the same player appearing twice', () => {
    const records: ActualAggregationInput[] = [
      { position: DEFENDER, playerCode: 7, minutes: 90, totalPoints: 6, components: emptyComponentTotals() },
      { position: DEFENDER, playerCode: 7, minutes: 90, totalPoints: 2, components: emptyComponentTotals() },
    ]
    const result = aggregateActualByPosition(records)
    expect(result[DEFENDER].playerMatchCount).toBe(2)
    expect(result[DEFENDER].distinctPlayerCount).toBe(1)
  })

  it('computes points per 90 from total points and total minutes, not from the per-appearance mean', () => {
    const records: ActualAggregationInput[] = [
      { position: FORWARD, playerCode: 1, minutes: 45, totalPoints: 9, components: emptyComponentTotals() },
    ]
    const result = aggregateActualByPosition(records)
    // 9 points in 45 minutes -> 18 pts/90.
    expect(result[FORWARD].meanPointsPer90).toBeCloseTo(18)
  })
})

// ============================================================================
// aggregateProjectedByPosition
// ============================================================================

describe('aggregateProjectedByPosition', () => {
  it('computes per-90 from summed expected points and expected minutes', () => {
    const records: ProjectedAggregationInput[] = [
      { position: DEFENDER, playerId: 1, expectedPoints: 5, expectedMinutes: 90, components: emptyComponentTotals() },
      { position: DEFENDER, playerId: 2, expectedPoints: 2, expectedMinutes: 45, components: emptyComponentTotals() },
    ]
    const result = aggregateProjectedByPosition(records)
    // (5 + 2) / (90 + 45) * 90 = 7 / 135 * 90 = 4.666...
    expect(result[DEFENDER].meanPointsPer90).toBeCloseTo(4.6667, 3)
    expect(result[DEFENDER].rowCount).toBe(2)
    expect(result[DEFENDER].distinctPlayerCount).toBe(2)
  })

  it('a position with no rows reports null, not zero', () => {
    const result = aggregateProjectedByPosition([])
    expect(result[FORWARD].meanPointsPer90).toBeNull()
  })
})

// ============================================================================
// ratio
// ============================================================================

describe('ratio', () => {
  it('divides projected by actual', () => {
    expect(ratio(6, 3)).toBe(2)
  })

  it('is null when either side is null', () => {
    expect(ratio(null, 3)).toBeNull()
    expect(ratio(6, null)).toBeNull()
  })

  it('is null (not Infinity) when the actual side is exactly zero', () => {
    expect(ratio(6, 0)).toBeNull()
  })
})

// ============================================================================
// Top-N helpers
// ============================================================================

describe('topActualScorersByPosition / topProjectedPlayersByPosition', () => {
  it('sorts descending and truncates to n, per position', () => {
    const actual = [
      { playerCode: 1, webName: 'Low', position: DEFENDER, totalPoints: 10, matchCount: 5 },
      { playerCode: 2, webName: 'High', position: DEFENDER, totalPoints: 90, matchCount: 5 },
      { playerCode: 3, webName: 'Mid', position: DEFENDER, totalPoints: 50, matchCount: 5 },
    ]
    const result = topActualScorersByPosition(actual, 2)
    expect(result[DEFENDER].map((r) => r.webName)).toEqual(['High', 'Mid'])
  })

  it('projected ranking sorts by mean expected points descending', () => {
    const projected = [
      { playerId: 1, webName: 'A', position: FORWARD, meanExpectedPoints: 3, rowCount: 5 },
      { playerId: 2, webName: 'B', position: FORWARD, meanExpectedPoints: 6, rowCount: 5 },
    ]
    const result = topProjectedPlayersByPosition(projected, 20)
    expect(result[FORWARD].map((r) => r.webName)).toEqual(['B', 'A'])
  })
})

// ============================================================================
// Ticket #54 — Premier League filter (source invariants).
//
// main()'s Supabase reads need a live project this Builder's session does
// not have (same constraint scripts/ingest-core-insights.test.ts's "source
// invariants" section and scripts/project-points.test.ts already document).
// What CAN be proven without a database is the shape of the query
// construction itself — grepping the actual shipped source rather than
// re-deriving the same logic here in TypeScript.
// ============================================================================

const sourcePath = fileURLToPath(new URL('./calibration-report.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

// Whitespace-insensitive: the data-fetch query sits one indent level deeper
// (inside the fetchAllPages callback) than its count-check, so the two
// occurrences are not byte-identical even though the filter is.
const SEASON_AND_PL_FILTER_RE =
  /\.eq\(\s*['"]season['"]\s*,\s*TARGET_SEASON\s*\)\s*\n\s*\.eq\(\s*['"]competition['"]\s*,\s*PREMIER_LEAGUE_COMPETITION\s*\)/g

describe('calibration-report.ts — Premier League filter (source invariants, ticket #54)', () => {
  it('imports PREMIER_LEAGUE_COMPETITION rather than a hardcoded competition literal', () => {
    expect(source).toMatch(/import\s*\{\s*PREMIER_LEAGUE_COMPETITION\s*\}\s*from\s*['"]\.\/lib\/competition\.ts['"]/)
  })

  it('the data-fetch query and its row-count-check query both filter on the identical season + competition clause', () => {
    // Same failure mode scripts/lib/paginate.ts's header describes and
    // scripts/project-points.test.ts guards on its own read: a count taken
    // under a different filter than the data it verifies would pass even on
    // a truncated or wrongly-filtered read.
    const occurrences = source.match(SEASON_AND_PL_FILTER_RE) ?? []
    expect(occurrences.length).toBe(2) // the paginated data fetch + its count-check — no more, no fewer
  })

  it('never filters player_match_stats with a hardcoded "prem" string literal instead of the constant', () => {
    expect(source).not.toMatch(/\.eq\(\s*['"]competition['"]\s*,\s*['"]prem['"]\s*\)/)
  })

  it(`PREMIER_LEAGUE_COMPETITION is "${PREMIER_LEAGUE_COMPETITION}"`, () => {
    expect(PREMIER_LEAGUE_COMPETITION).toBe('prem')
  })

  it('counts null-competition rows separately from known non-Premier-League rows, both scoped to TARGET_SEASON', () => {
    expect(source).toMatch(/\.eq\(\s*['"]season['"]\s*,\s*TARGET_SEASON\s*\)\s*\n\s*\.is\(\s*['"]competition['"]\s*,\s*null\s*\)/)
    expect(source).toMatch(
      /\.eq\(\s*['"]season['"]\s*,\s*TARGET_SEASON\s*\)\s*\n\s*\.not\(\s*['"]competition['"]\s*,\s*['"]is['"]\s*,\s*null\s*\)\s*\n\s*\.neq\(\s*['"]competition['"]\s*,\s*PREMIER_LEAGUE_COMPETITION\s*\)/,
    )
  })

  it('reports rows read and both exclusion counts as separate named job_runs.details fields', () => {
    expect(source).toMatch(/matchStatsRowsRead/)
    expect(source).toMatch(/matchStatsRowsExcludedNonPremierLeague/)
    expect(source).toMatch(/matchStatsRowsExcludedNullCompetition/)
  })

  it('reports both exclusion counts in the generated report body, not just job_runs', () => {
    expect(source).toMatch(/rows excluded as non-Premier-League/)
    expect(source).toMatch(/rows excluded for a null competition/)
  })

  it('issues no Supabase row-removal call anywhere', () => {
    expect(source).not.toMatch(/\.delete\(\s*\)/)
  })

  it('does not touch the clean-sheet reconstruction — out of scope for this ticket', () => {
    // reconstructActualMatchPoints' clean-sheet gate must still read
    // goals_conceded (not a team_goals_conceded column this ticket does not
    // add) — a grep guard against silently doing the folded-in scope from
    // the newer tickets/drafts/ file that this ticket's own issue text
    // explicitly excludes.
    expect(source).not.toMatch(/team_goals_conceded/)
  })
})

// ============================================================================
// Ticket #127 — restore like-for-like: exclude bonus from the projected
// side inside the report only. Nothing under src/ changes and
// player_projections is never written to; this file only tests the report's
// own pure adjustment functions plus source invariants for what main()
// wires up.
// ============================================================================

describe('excludeBonusFromProjection — ticket #127', () => {
  it('subtracts bonus from the projected total: a 5.79 projection with 0.22 bonus is compared as 5.57', () => {
    const result = excludeBonusFromProjection(5.79, 0.22)
    expect(result.comparedPoints).toBeCloseTo(5.57, 6)
    expect(result.excludedBonus).toBe(0.22)
  })

  it('treats a projection whose components carry no bonusPoints key as zero bonus, compared unchanged', () => {
    // Rows written before ticket #78 have no bonusPoints component at all —
    // this must not drop the row or throw, and must not change its total.
    const result = excludeBonusFromProjection(4.1, undefined)
    expect(result.comparedPoints).toBe(4.1)
    expect(result.excludedBonus).toBe(0)
  })

  it('subtracts a zero bonus without changing the total, for a row that explicitly projects no bonus', () => {
    const result = excludeBonusFromProjection(3.0, 0)
    expect(result.comparedPoints).toBe(3.0)
    expect(result.excludedBonus).toBe(0)
  })
})

describe('checkExcludedBonusBound — ticket #127, the headline bound (0.05–1.00)', () => {
  it(`passes exactly AT the lower bound, ${EXCLUDED_BONUS_LOWER_BOUND}`, () => {
    const result = checkExcludedBonusBound([EXCLUDED_BONUS_LOWER_BOUND])
    expect(result.meanExcludedBonusPerAppearance).toBeCloseTo(EXCLUDED_BONUS_LOWER_BOUND, 6)
    expect(result.withinBound).toBe(true)
  })

  it(`passes exactly AT the upper bound, ${EXCLUDED_BONUS_UPPER_BOUND}`, () => {
    const result = checkExcludedBonusBound([EXCLUDED_BONUS_UPPER_BOUND])
    expect(result.meanExcludedBonusPerAppearance).toBeCloseTo(EXCLUDED_BONUS_UPPER_BOUND, 6)
    expect(result.withinBound).toBe(true)
  })

  it('fails just BELOW the lower bound rather than silently passing', () => {
    const result = checkExcludedBonusBound([EXCLUDED_BONUS_LOWER_BOUND - 0.01])
    expect(result.withinBound).toBe(false)
  })

  it('fails just ABOVE the upper bound rather than silently passing', () => {
    const result = checkExcludedBonusBound([EXCLUDED_BONUS_UPPER_BOUND + 0.01])
    expect(result.withinBound).toBe(false)
  })

  it('computes the mean over multiple rows, not just the first', () => {
    // (0.05 + 0.15 + 0.40) / 3 = 0.2 — inside bound.
    const result = checkExcludedBonusBound([0.05, 0.15, 0.4])
    expect(result.meanExcludedBonusPerAppearance).toBeCloseTo(0.2, 6)
    expect(result.withinBound).toBe(true)
    expect(result.rowCount).toBe(3)
  })

  it('reports a null mean (not NaN or zero) and fails the bound when there are no rows at all', () => {
    const result = checkExcludedBonusBound([])
    expect(result.meanExcludedBonusPerAppearance).toBeNull()
    expect(result.withinBound).toBe(false)
    expect(result.rowCount).toBe(0)
  })
})

describe('calibration-report.ts — bonus exclusion restored to like-for-like (source invariants, ticket #127)', () => {
  it('does not contain the obsolete "hardcodes bonusPoints to 0" claim any more', () => {
    expect(source).not.toMatch(/hardcodes bonusPoints to 0/)
  })

  it('states that the projected side models bonus but the comparison excludes it', () => {
    expect(source).toMatch(/excludes it|excludes projected bonus|report excludes it/)
  })

  it('states that the actual side has no bonus column, verified', () => {
    expect(source).toMatch(/no `bonus` column/)
    expect(source).toMatch(/verified directly from the source CSV header on 28 Aug 2026/)
  })

  it('prints the excluded bonus alongside the projected total in the by-position table', () => {
    expect(source).toMatch(/Excluded bonus pts\/90/)
  })

  it('prints the excluded bonus alongside the projected total in the Top-N table', () => {
    expect(source).toMatch(/Excluded bonus/)
    expect(source).toMatch(/meanExcludedBonus/)
  })

  it('never writes (upsert, insert or update) to player_projections — report-side only, per the ticket', () => {
    // The one .insert( call in this file targets job_runs (recordJobRun),
    // never player_projections — checked directly rather than assuming.
    expect(source).not.toMatch(/\.upsert\(/)
    expect(source).not.toMatch(/\.update\(/)
    const insertCalls = source.match(/\.from\(\s*['"][a-z_]+['"]\s*\)\s*\n?\s*\.insert\(/g) ?? []
    for (const call of insertCalls) {
      expect(call).toMatch(/job_runs/)
    }
    expect(source).not.toMatch(/\.from\(\s*['"]player_projections['"]\s*\)\s*\n?\s*\.insert\(/)
  })

  it('imports and uses the bound constants rather than hardcoded 0.05/1.00 literals at the call site', () => {
    expect(source).toMatch(/EXCLUDED_BONUS_LOWER_BOUND\s*=\s*0\.05/)
    expect(source).toMatch(/EXCLUDED_BONUS_UPPER_BOUND\s*=\s*1(\.0+)?/)
  })
})
