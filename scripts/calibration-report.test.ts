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
//
// Ticket #132, defect 2 (clean sheets/goals conceded must read
// team_goals_conceded, never the goalkeeper-only goals_conceded, plus the
// impossible-rate bound) appends its own tests at the very bottom, same
// reason and technique again.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import {
  aggregateActualByPosition,
  aggregateProjectedByPosition,
  APPEARANCE_POINTS_ARITHMETIC_MAXIMUM,
  APPEARANCE_POINTS_PER_90_LOWER_BOUND,
  APPEARANCE_POINTS_PER_90_UPPER_BOUND,
  appearanceWeightedPer90,
  assertAppearancePointsPlausible,
  assertCleanSheetRatesPlausible,
  checkExcludedBonusBound,
  CLEAN_SHEET_RATE_UPPER_BOUND,
  componentsPer90,
  computeCleanSheetRate,
  CalibrationReportError,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: null,
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
    teamGoalsConceded: 0,
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
    const result = reconstructActualMatchPoints(DEFENDER, { ...cleanSheetStats, teamGoalsConceded: 1 })
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
    teamGoalsConceded: 2,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: 0,
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
      teamGoalsConceded: 0,
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

  it('a row with no pAppears falls back to the pre-#155 unweighted construction, tracked as rowsFallbackUnweighted', () => {
    const records: ProjectedAggregationInput[] = [
      { position: DEFENDER, playerId: 1, expectedPoints: 5, expectedMinutes: 90, components: emptyComponentTotals() },
    ]
    const result = aggregateProjectedByPosition(records)
    expect(result[DEFENDER].rowsFallbackUnweighted).toBe(1)
    expect(result[DEFENDER].rowsAppearanceWeighted).toBe(0)
    // Falls back to the plain ratio: 5 / 90 * 90 = 5.
    expect(result[DEFENDER].meanPointsPer90).toBeCloseTo(5, 6)
  })

  it('a row with pAppears is counted as rowsAppearanceWeighted, not fallback', () => {
    const records: ProjectedAggregationInput[] = [
      { position: DEFENDER, playerId: 1, expectedPoints: 5, expectedMinutes: 90, components: emptyComponentTotals(), pAppears: 0.9 },
    ]
    const result = aggregateProjectedByPosition(records)
    expect(result[DEFENDER].rowsAppearanceWeighted).toBe(1)
    expect(result[DEFENDER].rowsFallbackUnweighted).toBe(0)
  })
})

// ============================================================================
// appearanceWeightedPer90 / aggregateProjectedByPosition — appearance
// weighting, ticket #155. The named test the ticket's DoD asks for: one
// nailed starter and one substitute, proving BY HAND that the projected
// appearance figure lands near 2.0 rather than being dragged upward by the
// substitute. Passing case first (LEARNINGS-second-build-wave.md §10) — the
// bound-failure reproduction of the 2.84 goalkeeper defect lives in its own
// section further down this file, once the passing arithmetic is proven.
// ============================================================================

describe('appearanceWeightedPer90 / aggregateProjectedByPosition — nailed starter + substitute (ticket #155)', () => {
  // Hand computation, matching src/lib/projection/minutes.ts's own
  // definitions (expectedMinutes = avgMin × pAppears,
  // pSixtyPlus = sixtyRate × pAppears) and pointValues.ts's
  // expectedAppearancePoints (appearancePoints = pAppears × 1 + pSixtyPlus × 1
  // at today's point values), and appearanceWeightedPer90's own formula
  // (weight each row's contribution to BOTH numerator and denominator by
  // its own pAppears, on top of expectedMinutes):
  //
  // Nailed starter: avgMin = 90, sixtyRate = 1.0, pAppears = 0.98.
  //   pSixtyPlus       = 1.0 × 0.98 = 0.98
  //   appearancePoints = 0.98 × 1 + 0.98 × 1 = 1.96
  //   expectedMinutes  = 90 × 0.98 = 88.2
  //   (local ratio, for reference only — 1.96 / 88.2 × 90 = 2.0 exactly,
  //    matching the ticket's own reduction (1 + sixtyRate) / avgMin × 90)
  //
  // Substitute: avgMin = 20, sixtyRate = 0, pAppears = 0.02 (rarely expected
  // to appear at all).
  //   pSixtyPlus       = 0 × 0.02 = 0
  //   appearancePoints = 0.02 × 1 + 0 × 1 = 0.02
  //   expectedMinutes  = 20 × 0.02 = 0.4
  //   (local ratio, for reference only — 0.02 / 0.4 × 90 = 4.5, matching the
  //    ticket's own worked substitute example exactly)
  //
  // appearanceWeightedPer90:
  //   numerator   = (0.98 × 1.96) + (0.02 × 0.02) = 1.9208 + 0.0004 = 1.9212
  //   denominator = (0.98 × 88.2) + (0.02 × 0.4)  = 86.436 + 0.008  = 86.444
  //   result      = 1.9212 / 86.444 × 90 = 2.00023... ≈ 2.0
  //
  // Contrast: a NAIVE unweighted mean of the two rows' own local ratios —
  // treating the rare substitute as equally significant as the nailed
  // starter, exactly the bug the ticket diagnoses ("the widest backup
  // population relative to its starters") — gives (2.0 + 4.5) / 2 = 3.25,
  // dragged well above the arithmetic ceiling of 2 points per appearance.
  // appearanceWeightedPer90 keeps the estimate at ~2.0: essentially the
  // starter's own local ratio, not pulled toward the substitute's 4.5 — see
  // this file's calibration-report.ts header for why a naive mean-of-ratios
  // weighted only by pAppears was tried and rejected in favour of this
  // construction.
  const starter: ProjectedAggregationInput = {
    position: GOALKEEPER,
    playerId: 1,
    expectedPoints: 1.96,
    expectedMinutes: 88.2,
    components: { ...emptyComponentTotals(), appearancePoints: 1.96 },
    pAppears: 0.98,
  }
  const substitute: ProjectedAggregationInput = {
    position: GOALKEEPER,
    playerId: 2,
    expectedPoints: 0.02,
    expectedMinutes: 0.4,
    components: { ...emptyComponentTotals(), appearancePoints: 0.02 },
    pAppears: 0.02,
  }

  it('lands near 2.0 (2.00023, hand-computed above) rather than being dragged toward the substitute\'s 4.5', () => {
    const result = appearanceWeightedPer90([starter, substitute], (r) => r.components.appearancePoints)
    expect(result).toBeCloseTo(2.00023136, 6)
    // Sanity: comfortably inside the plausible bound this ticket also adds.
    expect(result).toBeGreaterThanOrEqual(APPEARANCE_POINTS_PER_90_LOWER_BOUND)
    expect(result).toBeLessThanOrEqual(APPEARANCE_POINTS_PER_90_UPPER_BOUND)
  })

  it('is far below the naive unweighted mean of the two rows\' own local ratios (3.25) — the drag this ticket removes', () => {
    const result = appearanceWeightedPer90([starter, substitute], (r) => r.components.appearancePoints)
    const naiveUnweightedMean = (2.0 + 4.5) / 2
    expect(result).not.toBeNull()
    expect(result as number).toBeLessThan(naiveUnweightedMean)
  })

  it('aggregateProjectedByPosition reports the same ~2.0 for both meanPointsPer90 and componentPer90.appearancePoints', () => {
    const result = aggregateProjectedByPosition([starter, substitute])
    expect(result[GOALKEEPER].meanPointsPer90).toBeCloseTo(2.00023136, 6)
    expect(result[GOALKEEPER].componentPer90?.appearancePoints).toBeCloseTo(2.00023136, 6)
    expect(result[GOALKEEPER].rowsAppearanceWeighted).toBe(2)
    expect(result[GOALKEEPER].rowsFallbackUnweighted).toBe(0)
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

  // The "does not touch the clean-sheet reconstruction" assertion that used
  // to live here — asserting the source NEVER references
  // team_goals_conceded — is REMOVED by ticket #132 (defect 2 DoD, its own
  // words): reading the clean-sheet/goals-conceded figures from
  // team_goals_conceded instead of the goalkeeper-only goals_conceded column
  // is now exactly what this report must do. See the "clean-sheet reads from
  // team_goals_conceded" describe block below for the replacement coverage.
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

// ============================================================================
// Ticket #132, defect 2 — clean sheets and goals conceded must read
// team_goals_conceded, never the goalkeeper-only goals_conceded column, and
// an impossible derived clean-sheet rate (>60% for any position) must fail
// the report rather than print it. Same file, same reason main()'s I/O
// needs a live project the Builder's session does not have — pure functions
// tested directly, source invariants grepped for what only main() wires up.
// ============================================================================

describe('reconstructActualMatchPoints — team_goals_conceded null (ticket #132, defect 2)', () => {
  const base = {
    minutesPlayed: 90,
    goals: 2,
    assists: 1,
    teamGoalsConceded: null,
    saves: 0,
    clearances: 0,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
  }

  it('scores 0 clean-sheet points and 0 goals-conceded points when team_goals_conceded is null — never read as zero conceded', () => {
    const result = reconstructActualMatchPoints(DEFENDER, base)
    expect(result.components.cleanSheetPoints).toBe(0)
    expect(result.components.goalsConcededPoints).toBe(0)
    expect(result.teamGoalsConcededKnown).toBe(false)
  })

  it('still scores goals and assists normally — only the clean-sheet/goals-conceded figures are affected by the null', () => {
    const result = reconstructActualMatchPoints(FORWARD, base)
    expect(result.components.goalPoints).toBe(8) // 2 goals * 4 pts (forward)
    expect(result.components.assistPoints).toBe(3) // 1 assist * 3 pts
    expect(result.components.appearancePoints).toBe(2) // 90 minutes
  })

  it('flags teamGoalsConcededKnown true (and awards the clean sheet) when the value is a real number, including 0', () => {
    const result = reconstructActualMatchPoints(DEFENDER, { ...base, teamGoalsConceded: 0 })
    expect(result.teamGoalsConcededKnown).toBe(true)
    expect(result.components.cleanSheetPoints).toBe(4)
  })

  it('a known non-zero team_goals_conceded still scores goals-conceded points normally, not 0', () => {
    const result = reconstructActualMatchPoints(GOALKEEPER, { ...base, teamGoalsConceded: 2 })
    expect(result.teamGoalsConcededKnown).toBe(true)
    expect(result.components.goalsConcededPoints).toBe(-1) // floor(2/2) * -1
    expect(result.components.cleanSheetPoints).toBe(0)
  })
})

describe('aggregateActualByPosition — team_goals_conceded-null rows are excluded from the clean-sheet/goals-conceded per-90 denominator only (ticket #132, defect 2)', () => {
  it('excludes ineligible minutes from cleanSheetPoints/goalsConcededPoints per-90, but not from other components', () => {
    const eligible = reconstructActualMatchPoints(DEFENDER, {
      minutesPlayed: 90,
      goals: 0,
      assists: 0,
      teamGoalsConceded: 0,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })
    const ineligible = reconstructActualMatchPoints(DEFENDER, {
      minutesPlayed: 90,
      goals: 1,
      assists: 0,
      teamGoalsConceded: null,
      saves: 0,
      clearances: 0,
      blocks: 0,
      interceptions: 0,
      tackles: 0,
      recoveries: 0,
    })

    const records: ActualAggregationInput[] = [
      {
        position: DEFENDER,
        playerCode: 1,
        minutes: eligible.minutes,
        totalPoints: eligible.totalPoints,
        components: eligible.components,
        teamGoalsConcededKnown: eligible.teamGoalsConcededKnown,
      },
      {
        position: DEFENDER,
        playerCode: 2,
        minutes: ineligible.minutes,
        totalPoints: ineligible.totalPoints,
        components: ineligible.components,
        teamGoalsConcededKnown: ineligible.teamGoalsConcededKnown,
      },
    ]
    const result = aggregateActualByPosition(records)

    // Eligible clean sheet: 4 points in 90 minutes -> 4 pts/90, using ONLY
    // the eligible row's own 90 minutes as the denominator, not both rows'
    // combined 180 — the ineligible row must not dilute this figure.
    expect(result[DEFENDER].componentPer90?.cleanSheetPoints).toBeCloseTo(4, 6)
    expect(result[DEFENDER].cleanSheetEligibleMinutes).toBe(90)
    expect(result[DEFENDER].cleanSheetEligibleMatchCount).toBe(1)
    // Goal points are UNAFFECTED by team_goals_conceded: 6 points (1 goal *
    // 6 for a defender) over the FULL 180 minutes -> 3 pts/90.
    expect(result[DEFENDER].componentPer90?.goalPoints).toBeCloseTo(3, 6)
    expect(result[DEFENDER].totalMinutes).toBe(180)
    expect(result[DEFENDER].playerMatchCount).toBe(2)
  })

  it('a record with teamGoalsConcededKnown omitted is treated as known (true) — pre-existing fixtures continue to pass unmodified', () => {
    const records: ActualAggregationInput[] = [
      { position: MIDFIELDER, playerCode: 1, minutes: 90, totalPoints: 5, components: { ...emptyComponentTotals(), cleanSheetPoints: 1 } },
    ]
    const result = aggregateActualByPosition(records)
    expect(result[MIDFIELDER].cleanSheetEligibleMatchCount).toBe(1)
    expect(result[MIDFIELDER].cleanSheetEligibleMinutes).toBe(90)
  })
})

describe('computeCleanSheetRate (ticket #132, defect 2)', () => {
  it('derives ~27% for the goalkeeper example from the ticket (1.09 actual clean-sheet pts/90, 4 pts per clean sheet)', () => {
    expect(computeCleanSheetRate(1.09, GOALKEEPER)).toBeCloseTo(0.2725, 3)
  })

  it('reproduces the impossible ~95% figure the bug produced (3.81 pts/90 for a defender), before the bound catches it', () => {
    expect(computeCleanSheetRate(3.81, DEFENDER)).toBeCloseTo(0.9525, 3)
  })

  it('is null for forwards, whose clean-sheet point value is 0 — a rate cannot be derived from a zero denominator', () => {
    expect(computeCleanSheetRate(2, FORWARD)).toBeNull()
  })

  it('is null when there is no per-90 figure at all (no data)', () => {
    expect(computeCleanSheetRate(null, DEFENDER)).toBeNull()
  })
})

describe('assertCleanSheetRatesPlausible — the bound that would have caught the ~95% bug three times over (ticket #132, defect 2)', () => {
  it(`passes exactly at the bound, ${CLEAN_SHEET_RATE_UPPER_BOUND}`, () => {
    expect(() => assertCleanSheetRatesPlausible(new Map([[DEFENDER, CLEAN_SHEET_RATE_UPPER_BOUND]]))).not.toThrow()
  })

  it('passes at 59% — implausibly high, but not impossible', () => {
    expect(() => assertCleanSheetRatesPlausible(new Map([[DEFENDER, 0.59]]))).not.toThrow()
  })

  it('fails at 61%, naming both the position and the rate — the report must fail, not warn', () => {
    expect(() => assertCleanSheetRatesPlausible(new Map([[DEFENDER, 0.61]]))).toThrow(CalibrationReportError)
    try {
      assertCleanSheetRatesPlausible(new Map([[DEFENDER, 0.61]]))
      expect.unreachable('assertCleanSheetRatesPlausible should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('Defender')
      expect(message).toContain('61')
    }
  })

  it('a null rate (no data) never violates the bound', () => {
    expect(() => assertCleanSheetRatesPlausible(new Map([[FORWARD, null]]))).not.toThrow()
  })

  it('checks every position in the map, not just the first', () => {
    expect(() =>
      assertCleanSheetRatesPlausible(
        new Map([
          [GOALKEEPER, 0.3],
          [DEFENDER, 0.28],
          [MIDFIELDER, 0.92], // the impossible reading from the ticket's own component table
          [FORWARD, null],
        ]),
      ),
    ).toThrow(/Midfielder/)
  })
})

describe('calibration-report.ts — clean-sheet reads from team_goals_conceded, never goals_conceded (source invariants, ticket #132, defect 2)', () => {
  it('goals_conceded appears in the source only as part of the string "team_goals_conceded" (DoD, grep-checkable)', () => {
    const bareOccurrences = source.match(/goals_conceded/g) ?? []
    const teamOccurrences = source.match(/team_goals_conceded/g) ?? []
    // Every "goals_conceded" substring must be embedded inside
    // "team_goals_conceded" — if a standalone "goals_conceded" existed
    // anywhere else in the file, the first count would exceed the second.
    expect(bareOccurrences.length).toBe(teamOccurrences.length)
    expect(teamOccurrences.length).toBeGreaterThan(0)
  })

  it('selects team_goals_conceded from player_match_stats, not goals_conceded', () => {
    expect(source).toMatch(/\.select\(\s*\n?\s*['"][^'"]*team_goals_conceded[^'"]*['"]/)
  })

  it('the excluded-row count for a null team_goals_conceded is reported in the provenance section', () => {
    expect(source).toMatch(/matchStatsRowsNullTeamGoalsConceded/)
    expect(source).toMatch(/null team_goals_conceded/)
  })

  it('the clean-sheet rate bound throws (via CalibrationReportError) rather than merely warning', () => {
    expect(source).toMatch(/assertCleanSheetRatesPlausible/)
    expect(source).toMatch(/throw new CalibrationReportError\(\s*\n\s*`\$\{POSITION_NAMES\[position\]\}'s derived clean-sheet rate/)
  })

  it('the clean-sheet rate is printed per position as a percentage in the report body', () => {
    expect(source).toMatch(/Implied clean-sheet rate/)
    expect(source).toMatch(/fmtPercent/)
  })

  it('the assertion runs before the report is written to disk — an impossible rate must never reach the file', () => {
    const assertIndex = source.indexOf('assertCleanSheetRatesPlausible(cleanSheetRatesByPosition)')
    const writeIndex = source.indexOf('await writeFile(reportPath')
    expect(assertIndex).toBeGreaterThan(-1)
    expect(writeIndex).toBeGreaterThan(-1)
    expect(assertIndex).toBeLessThan(writeIndex)
  })
})

// ============================================================================
// Ticket #155 — appearance-weighted projected side, and the sanity bound
// that would have caught the population-mismatch defect. Same technique as
// every other ticket appended to this file: pure functions tested directly,
// source invariants grepped for what only main()'s Supabase I/O wires up
// (main() itself needs a live project this Builder's session does not have).
// ============================================================================

describe('assertAppearancePointsPlausible — the bound that would have caught the population-mismatch defect (ticket #155)', () => {
  it(`passes exactly AT the lower bound, ${APPEARANCE_POINTS_PER_90_LOWER_BOUND}`, () => {
    expect(() => assertAppearancePointsPlausible(new Map([[GOALKEEPER, APPEARANCE_POINTS_PER_90_LOWER_BOUND]]))).not.toThrow()
  })

  it(`passes exactly AT the upper bound, ${APPEARANCE_POINTS_PER_90_UPPER_BOUND}`, () => {
    expect(() => assertAppearancePointsPlausible(new Map([[GOALKEEPER, APPEARANCE_POINTS_PER_90_UPPER_BOUND]]))).not.toThrow()
  })

  it('passes at the arithmetic ceiling itself, 2.0', () => {
    expect(() => assertAppearancePointsPlausible(new Map([[DEFENDER, APPEARANCE_POINTS_ARITHMETIC_MAXIMUM]]))).not.toThrow()
  })

  it('fails just BELOW the lower bound rather than silently passing', () => {
    expect(() => assertAppearancePointsPlausible(new Map([[GOALKEEPER, APPEARANCE_POINTS_PER_90_LOWER_BOUND - 0.01]]))).toThrow(
      CalibrationReportError,
    )
  })

  it('fails just ABOVE the upper bound rather than silently passing', () => {
    expect(() => assertAppearancePointsPlausible(new Map([[GOALKEEPER, APPEARANCE_POINTS_PER_90_UPPER_BOUND + 0.01]]))).toThrow(
      CalibrationReportError,
    )
  })

  it("reproduces and catches the 29 Aug 2026 run's impossible 2.84 goalkeeper figure — the exact defect this ticket fixes", () => {
    expect(() => assertAppearancePointsPlausible(new Map([[GOALKEEPER, 2.84]]))).toThrow(CalibrationReportError)
    try {
      assertAppearancePointsPlausible(new Map([[GOALKEEPER, 2.84]]))
      expect.unreachable('assertAppearancePointsPlausible should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('Goalkeeper')
      expect(message).toContain('2.84')
    }
  })

  it('a null figure (no data) never violates the bound', () => {
    expect(() => assertAppearancePointsPlausible(new Map([[FORWARD, null]]))).not.toThrow()
  })

  it('checks every position in the map, not just the first', () => {
    expect(() =>
      assertAppearancePointsPlausible(
        new Map([
          [GOALKEEPER, 2.0],
          [DEFENDER, 1.9],
          [MIDFIELDER, 2.59], // the impossible reading this ticket's own diagnosis names for defenders — reused here for midfielder
          [FORWARD, null],
        ]),
      ),
    ).toThrow(/Midfielder/)
  })
})

describe('calibration-report.ts — appearance-weighted projected side (source invariants, ticket #155)', () => {
  it('reads pAppears from components.fixtures[0], not components.fixtures[].modelInputs — the verified, not assumed, shape', () => {
    expect(source).toMatch(/row\.components\?\.fixtures\?\.\[0\]\?\.pAppears/)
  })

  it('the appearance-points bound assertion runs before the report is written to disk', () => {
    const assertIndex = source.indexOf('assertAppearancePointsPlausible(appearancePer90ByPosition)')
    const writeIndex = source.indexOf('await writeFile(reportPath')
    expect(assertIndex).toBeGreaterThan(-1)
    expect(writeIndex).toBeGreaterThan(-1)
    expect(assertIndex).toBeLessThan(writeIndex)
  })

  it('checks the bound per position, not only in aggregate', () => {
    expect(source).toMatch(/POSITIONS\.map\(\s*\(position\)\s*=>\s*\[\s*position,\s*projectedByPosition\[position\]\.componentPer90\?\.appearancePoints/)
  })

  it('states in the report body that the projected side is appearance-weighted, where the totals and component tables print it', () => {
    expect(source).toMatch(/Projected pts\/90 is appearance-weighted \(ticket #155\)/)
    expect(source).toMatch(/Every projected component is appearance-weighted \(ticket #155\)/)
  })

  it('states which population each side is drawn from, in the caveats section', () => {
    expect(source).toMatch(/actual side is a sample of real, realized player-matches/)
    expect(source).toMatch(/projected side is an expectation over every projected player-gameweek/)
  })

  it('reports rowsAppearanceWeighted/rowsFallbackUnweighted counts in the provenance section', () => {
    expect(source).toMatch(/rows appearance-weighted, pAppears present/)
    expect(source).toMatch(/rows using the pre-#155 unweighted fallback/)
  })

  it('marks the bound range as a judgement call in its own code comment, distinguishing the arithmetic upper end from the guessed lower end', () => {
    expect(source).toMatch(/JUDGEMENT CALL/)
    expect(source).toMatch(/upper end is arithmetic, not a guess/)
  })

  it('never touches src/, only imports from it — no write, no edit of anything under src/', () => {
    // This file already imports from src/lib/scoring and src/lib/projection
    // (see the file header) — the invariant is that this ticket added no
    // NEW import path outside scripts/calibration-report.ts and its test.
    expect(source).not.toMatch(/from ['"]\.\.\/src\/lib\/projection\/minutes\.ts['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/src\/lib\/projection\/expectedPoints\.ts['"]/)
  })
})
