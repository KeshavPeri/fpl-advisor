// Unit tests for scripts/bonus-validation-report.ts — ticket #224.
//
// This job's Supabase reads can't be exercised without a live Supabase project holding real
// gameweek_live_stats/player_projections rows (same limitation every scripts/*.ts test file
// already documents). Every function this file exports is pure, so each is exercised directly on
// constructed rows instead.

import { describe, expect, it } from 'vitest'
import { MAX_BONUS_POINTS_PER_PLAYER_FIXTURE } from '../src/lib/projection/bonus.ts'
import {
  buildGameweekBonusReport,
  computeBonusComparisonStats,
  computeFixtureAllocationRaw,
  extractFixtureIds,
  extractProjectedBonus,
  extractProjectedRowsWithBonus,
  extractSingleFixtureBonusRows,
  matchRowsToActual,
  poolGameweekReports,
  renderGameweekSection,
  renderSeasonSection,
  summarizeFixtureAllocation,
  topByExpectedPoints,
  type ActualLiveStatRow,
  type GameweekBonusReport,
  type ProjectedRowWithBonus,
  type RawProjectedRow,
} from './bonus-validation-report.ts'

/** A components blob shaped exactly like scripts/project-points.ts's own row construction: `{ playerLevel, points: { bonusPoints }, fixtures: [{ fixtureId, ... }] }`. */
function componentsWithFixtures(bonusPoints: number, fixtureIds: number[]): unknown {
  return { points: { bonusPoints }, fixtures: fixtureIds.map((fixtureId) => ({ fixtureId })) }
}

describe('extractProjectedBonus', () => {
  it('reads components.points.bonusPoints, the exact shape scripts/project-points.ts writes', () => {
    expect(extractProjectedBonus({ points: { bonusPoints: 1.42 } })).toBe(1.42)
  })

  it('reads a real, measured zero bonus verbatim', () => {
    expect(extractProjectedBonus({ points: { bonusPoints: 0 } })).toBe(0)
  })

  it('returns null (never 0) when components is not an object', () => {
    expect(extractProjectedBonus('not-an-object')).toBeNull()
    expect(extractProjectedBonus(null)).toBeNull()
    expect(extractProjectedBonus(undefined)).toBeNull()
  })

  it('returns null when components.points is missing', () => {
    expect(extractProjectedBonus({ playerLevel: {} })).toBeNull()
  })

  it('returns null when components.points.bonusPoints is missing or non-numeric', () => {
    expect(extractProjectedBonus({ points: {} })).toBeNull()
    expect(extractProjectedBonus({ points: { bonusPoints: 'a lot' } })).toBeNull()
    expect(extractProjectedBonus({ points: { bonusPoints: NaN } })).toBeNull()
  })
})

describe('extractProjectedRowsWithBonus', () => {
  it('keeps rows with a readable bonus figure and counts the rest', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 5, components: { points: { bonusPoints: 0.4 } } },
      { playerCode: 2, expectedPoints: 3, components: { points: {} } }, // no bonusPoints
      { playerCode: 3, expectedPoints: 4, components: null },
    ]
    const result = extractProjectedRowsWithBonus(rows)
    expect(result.rows).toEqual([{ playerCode: 1, expectedPoints: 5, projectedBonus: 0.4 }])
    expect(result.skippedNoStoredBonus).toBe(2)
  })
})

describe('topByExpectedPoints', () => {
  it('returns the top N rows by expected_points, descending', () => {
    const rows: ProjectedRowWithBonus[] = [
      { playerCode: 1, expectedPoints: 4, projectedBonus: 0.1 },
      { playerCode: 2, expectedPoints: 8, projectedBonus: 0.5 },
      { playerCode: 3, expectedPoints: 6, projectedBonus: 0.3 },
    ]
    expect(topByExpectedPoints(rows, 2).map((r) => r.playerCode)).toEqual([2, 3])
  })

  it('returns every row when n exceeds the input length', () => {
    const rows: ProjectedRowWithBonus[] = [{ playerCode: 1, expectedPoints: 4, projectedBonus: 0.1 }]
    expect(topByExpectedPoints(rows, 20)).toHaveLength(1)
  })

  it('does not mutate the input array', () => {
    const rows: ProjectedRowWithBonus[] = [
      { playerCode: 1, expectedPoints: 4, projectedBonus: 0.1 },
      { playerCode: 2, expectedPoints: 8, projectedBonus: 0.5 },
    ]
    const original = [...rows]
    topByExpectedPoints(rows, 1)
    expect(rows).toEqual(original)
  })
})

describe('matchRowsToActual', () => {
  it('matches a projected row to its actual by player_code and carries both bonus figures', () => {
    const projected: ProjectedRowWithBonus[] = [{ playerCode: 1, expectedPoints: 5, projectedBonus: 0.5 }]
    const actualByCode = new Map<number, ActualLiveStatRow>([[1, { playerCode: 1, bonus: 1, bps: 20 }]])
    const result = matchRowsToActual(projected, actualByCode)
    expect(result.matched).toEqual([{ playerCode: 1, expectedPoints: 5, projectedBonus: 0.5, actualBonus: 1 }])
    expect(result.unmatchedCount).toBe(0)
  })

  it('excludes (never guesses) a projected row with no matching actual', () => {
    const projected: ProjectedRowWithBonus[] = [{ playerCode: 99, expectedPoints: 5, projectedBonus: 0.5 }]
    const result = matchRowsToActual(projected, new Map())
    expect(result.matched).toEqual([])
    expect(result.unmatchedCount).toBe(1)
  })
})

describe('computeBonusComparisonStats', () => {
  it('returns null for every figure on an empty input, never a fabricated zero', () => {
    expect(computeBonusComparisonStats([])).toEqual({ sampleSize: 0, meanProjectedBonus: null, meanActualBonus: null, meanSignedError: null })
  })

  it('computes the mean projected bonus, mean actual bonus and signed error (actual - projected)', () => {
    const rows = [
      { projectedBonus: 1, actualBonus: 2 }, // signed error +1 (under-projected)
      { projectedBonus: 2, actualBonus: 1 }, // signed error -1 (over-projected)
    ]
    const stats = computeBonusComparisonStats(rows)
    expect(stats).toEqual({ sampleSize: 2, meanProjectedBonus: 1.5, meanActualBonus: 1.5, meanSignedError: 0 })
  })

  it('a positive mean signed error means the model under-projects bonus on average', () => {
    const stats = computeBonusComparisonStats([{ projectedBonus: 0, actualBonus: 3 }])
    expect(stats.meanSignedError).toBe(3)
  })
})

describe('buildGameweekBonusReport', () => {
  const projected: RawProjectedRow[] = [
    { playerCode: 1, expectedPoints: 9, components: { points: { bonusPoints: 2 } } }, // top scorer, matched
    { playerCode: 2, expectedPoints: 7, components: { points: { bonusPoints: 1 } } }, // matched
    { playerCode: 3, expectedPoints: 5, components: { points: { bonusPoints: 0 } } }, // no actual row
    { playerCode: 4, expectedPoints: 3, components: null }, // unreadable bonus
  ]
  const actual: ActualLiveStatRow[] = [
    { playerCode: 1, bonus: 3, bps: 40 },
    { playerCode: 2, bonus: 0, bps: 15 },
    { playerCode: 5, bonus: 1, bps: 12 }, // no matching projection
  ]

  it('reconciles: overall matched + no-stored-bonus + no-actual accounts for every projected row', () => {
    const report = buildGameweekBonusReport(1, projected, actual)
    expect(report.overall.sampleSize + report.projectedWithNoStoredBonus + report.projectedWithNoActual).toBe(projected.length)
  })

  it('counts the live stats row with no matching projection', () => {
    const report = buildGameweekBonusReport(1, projected, actual)
    expect(report.actualWithNoProjected).toBe(1)
  })

  it('restricts the top-N figures to a smaller topN than the full matched population', () => {
    const report = buildGameweekBonusReport(1, projected, actual, 1)
    expect(report.top20.sampleSize).toBe(1)
    // The single top-by-expected_points row with a readable bonus AND a matching actual is player 1.
    expect(report.top20.meanProjectedBonus).toBe(2)
    expect(report.top20.meanActualBonus).toBe(3)
  })

  it('computes overall stats across every matched player, not just the top N', () => {
    const report = buildGameweekBonusReport(1, projected, actual, 1)
    expect(report.overall.sampleSize).toBe(2) // players 1 and 2 both matched
  })

  it('flags topProjectedUnmatched when a nominally top-ranked player has no actual row', () => {
    // Player 3 (expectedPoints 5) is only "top" if topN is large enough to include it; it has no
    // actual row (bonus 0 is a distinct, unrelated player_code from the fixture's actual set).
    const report = buildGameweekBonusReport(1, projected, actual, 3)
    expect(report.topProjectedUnmatched).toBe(1)
  })
})

describe('poolGameweekReports', () => {
  it('pools matched rows across gameweeks and computes ONE mean, not a mean of means', () => {
    // Gameweek A: 1 matched row, projected 0, actual 4 (signed error +4).
    // Gameweek B: 3 matched rows, projected 0, actual 0 (signed error 0) each.
    // A naive mean-of-means would read (4 + 0) / 2 = 2. Pooling by row reads 4 / 4 = 1.
    const reportA: GameweekBonusReport = buildGameweekBonusReport(
      1,
      [{ playerCode: 1, expectedPoints: 5, components: { points: { bonusPoints: 0 } } }],
      [{ playerCode: 1, bonus: 4, bps: 10 }],
    )
    const reportB: GameweekBonusReport = buildGameweekBonusReport(
      2,
      [
        { playerCode: 2, expectedPoints: 5, components: { points: { bonusPoints: 0 } } },
        { playerCode: 3, expectedPoints: 5, components: { points: { bonusPoints: 0 } } },
        { playerCode: 4, expectedPoints: 5, components: { points: { bonusPoints: 0 } } },
      ],
      [
        { playerCode: 2, bonus: 0, bps: 5 },
        { playerCode: 3, bonus: 0, bps: 5 },
        { playerCode: 4, bonus: 0, bps: 5 },
      ],
    )
    const season = poolGameweekReports([reportA, reportB])
    expect(season.gameweeksMeasured).toBe(2)
    expect(season.overall.sampleSize).toBe(4)
    expect(season.overall.meanSignedError).toBe(1)
  })

  it('returns null figures for an empty list of reports', () => {
    const season = poolGameweekReports([])
    expect(season.gameweeksMeasured).toBe(0)
    expect(season.overall).toEqual({ sampleSize: 0, meanProjectedBonus: null, meanActualBonus: null, meanSignedError: null })
    expect(season.top20).toEqual({ sampleSize: 0, meanProjectedBonus: null, meanActualBonus: null, meanSignedError: null })
  })
})

// ============================================================================
// Per-fixture reconstruction (ticket #237) -- clamped count + mean per-fixture allocated total.
// ============================================================================

describe('extractFixtureIds', () => {
  it('reads components.fixtures[].fixtureId, one entry per fixture', () => {
    expect(extractFixtureIds(componentsWithFixtures(1.5, [501]))).toEqual([501])
  })

  it('reads two fixture ids for a double gameweek', () => {
    expect(extractFixtureIds(componentsWithFixtures(2, [501, 502]))).toEqual([501, 502])
  })

  it('returns [] (a genuine blank gameweek), never null, for an empty fixtures array', () => {
    expect(extractFixtureIds({ points: { bonusPoints: 0 }, fixtures: [] })).toEqual([])
  })

  it('returns null (not []) when components itself is unreadable', () => {
    expect(extractFixtureIds(null)).toBeNull()
    expect(extractFixtureIds('nope')).toBeNull()
  })

  it('returns null when components.fixtures is missing or not an array', () => {
    expect(extractFixtureIds({ points: { bonusPoints: 1 } })).toBeNull()
    expect(extractFixtureIds({ points: { bonusPoints: 1 }, fixtures: 'nope' })).toBeNull()
  })

  it('returns null when a fixture entry has no readable fixtureId', () => {
    expect(extractFixtureIds({ points: { bonusPoints: 1 }, fixtures: [{ notFixtureId: 501 }] })).toBeNull()
    expect(extractFixtureIds({ points: { bonusPoints: 1 }, fixtures: [{ fixtureId: 'five-oh-one' }] })).toBeNull()
  })
})

describe('extractSingleFixtureBonusRows', () => {
  it('keeps a row with exactly one fixture, carrying its fixtureId and projected bonus', () => {
    const rows: RawProjectedRow[] = [{ playerCode: 1, expectedPoints: 5, components: componentsWithFixtures(1.5, [501]) }]
    const result = extractSingleFixtureBonusRows(rows)
    expect(result.rows).toEqual([{ playerCode: 1, fixtureId: 501, projectedBonus: 1.5 }])
    expect(result.zeroFixtureRows).toBe(0)
    expect(result.multiFixtureRows).toBe(0)
    expect(result.incompleteData).toBe(0)
  })

  it('excludes and counts a zero-fixture (blank gameweek) row', () => {
    const rows: RawProjectedRow[] = [{ playerCode: 1, expectedPoints: 0, components: componentsWithFixtures(0, []) }]
    const result = extractSingleFixtureBonusRows(rows)
    expect(result.rows).toEqual([])
    expect(result.zeroFixtureRows).toBe(1)
  })

  it('excludes and counts a multi-fixture (double gameweek) row -- bonusPoints is their sum, not attributable to one fixture', () => {
    const rows: RawProjectedRow[] = [{ playerCode: 1, expectedPoints: 8, components: componentsWithFixtures(2.5, [501, 502]) }]
    const result = extractSingleFixtureBonusRows(rows)
    expect(result.rows).toEqual([])
    expect(result.multiFixtureRows).toBe(1)
  })

  it('excludes and counts a row with unreadable bonus or fixture data, never guessing', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 5, components: null },
      { playerCode: 2, expectedPoints: 5, components: { points: { bonusPoints: 1 } } }, // no fixtures field at all
    ]
    const result = extractSingleFixtureBonusRows(rows)
    expect(result.rows).toEqual([])
    expect(result.incompleteData).toBe(2)
  })
})

describe('computeFixtureAllocationRaw', () => {
  it('groups single-fixture rows by real fixtureId and sums each fixture\'s allocated total', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(1.5, [501]) },
      { playerCode: 2, expectedPoints: 7, components: componentsWithFixtures(1.0, [501]) },
      { playerCode: 3, expectedPoints: 6, components: componentsWithFixtures(0.5, [502]) }, // different fixture
    ]
    const raw = computeFixtureAllocationRaw(rows)
    expect(raw.fixtureTotals.sort((a, b) => a - b)).toEqual([0.5, 2.5])
  })

  it('infers a player-fixture as clamped when its stored bonusPoints is at MAX_BONUS_POINTS_PER_PLAYER_FIXTURE', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(MAX_BONUS_POINTS_PER_PLAYER_FIXTURE, [501]) },
      { playerCode: 2, expectedPoints: 7, components: componentsWithFixtures(1.0, [501]) },
    ]
    const raw = computeFixtureAllocationRaw(rows)
    expect(raw.clampedPlayerFixtureCount).toBe(1)
  })

  it('does not infer clamping for a value well below the cap', () => {
    const rows: RawProjectedRow[] = [{ playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(2.9, [501]) }]
    expect(computeFixtureAllocationRaw(rows).clampedPlayerFixtureCount).toBe(0)
  })

  it('reports zero-fixture, multi-fixture and incomplete-data exclusions separately, never conflated', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 0, components: componentsWithFixtures(0, []) },
      { playerCode: 2, expectedPoints: 8, components: componentsWithFixtures(2, [501, 502]) },
      { playerCode: 3, expectedPoints: 5, components: null },
    ]
    const raw = computeFixtureAllocationRaw(rows)
    expect(raw.fixtureTotals).toEqual([])
    expect(raw.zeroFixtureRowsExcluded).toBe(1)
    expect(raw.multiFixtureRowsExcluded).toBe(1)
    expect(raw.incompleteDataExcluded).toBe(1)
  })

  it('a fixture with a player nobody projected any excess for still sums correctly (zero contributes zero)', () => {
    const rows: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(3, [501]) },
      { playerCode: 2, expectedPoints: 1, components: componentsWithFixtures(0, [501]) }, // zero-excess squad player
    ]
    const raw = computeFixtureAllocationRaw(rows)
    expect(raw.fixtureTotals).toEqual([3])
  })
})

describe('summarizeFixtureAllocation', () => {
  it('computes the mean allocated total across fixtures', () => {
    const stats = summarizeFixtureAllocation([6, 5.7, 4.5], 2)
    expect(stats.fixturesMeasured).toBe(3)
    expect(stats.meanAllocatedTotal).toBeCloseTo((6 + 5.7 + 4.5) / 3, 10)
    expect(stats.clampedPlayerFixtureCount).toBe(2)
  })

  it('returns null (never 0) for the mean when no fixture was measured, matching computeBonusComparisonStats\'s convention', () => {
    const stats = summarizeFixtureAllocation([], 0)
    expect(stats).toEqual({ fixturesMeasured: 0, meanAllocatedTotal: null, clampedPlayerFixtureCount: 0 })
  })
})

describe('buildGameweekBonusReport: fixture allocation is wired through end to end', () => {
  it('carries a per-gameweek fixtureAllocation derived from the same projected rows', () => {
    const projected: RawProjectedRow[] = [
      { playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(3, [501]) }, // clamped
      { playerCode: 2, expectedPoints: 7, components: componentsWithFixtures(2.5, [501]) },
      { playerCode: 3, expectedPoints: 1, components: componentsWithFixtures(0, [501]) },
    ]
    const actual: ActualLiveStatRow[] = [
      { playerCode: 1, bonus: 3, bps: 40 },
      { playerCode: 2, bonus: 2, bps: 20 },
      { playerCode: 3, bonus: 0, bps: 5 },
    ]
    const report = buildGameweekBonusReport(1, projected, actual)
    expect(report.fixtureAllocation.fixturesMeasured).toBe(1)
    expect(report.fixtureAllocation.meanAllocatedTotal).toBeCloseTo(5.5, 10)
    expect(report.fixtureAllocation.clampedPlayerFixtureCount).toBe(1)
  })

  it('renderGameweekSection includes the fixture-allocation line without throwing', () => {
    const projected: RawProjectedRow[] = [{ playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(3, [501]) }]
    const actual: ActualLiveStatRow[] = [{ playerCode: 1, bonus: 3, bps: 40 }]
    const report = buildGameweekBonusReport(1, projected, actual)
    const section = renderGameweekSection(report)
    expect(section).toContain('Fixture allocation (ticket #237)')
    expect(section).toContain('1 player-fixture(s) inferred clamped')
  })
})

describe('poolGameweekReports: fixture allocation pools fixtures across gameweeks, not a mean of means', () => {
  it('sums fixtureTotals and clamped counts across gameweeks', () => {
    const reportA = buildGameweekBonusReport(
      1,
      [
        { playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(3, [501]) },
        { playerCode: 2, expectedPoints: 5, components: componentsWithFixtures(2, [501]) },
      ],
      [
        { playerCode: 1, bonus: 3, bps: 40 },
        { playerCode: 2, bonus: 2, bps: 20 },
      ],
    )
    const reportB = buildGameweekBonusReport(
      2,
      [{ playerCode: 3, expectedPoints: 5, components: componentsWithFixtures(1, [601]) }],
      [{ playerCode: 3, bonus: 1, bps: 10 }],
    )
    const season = poolGameweekReports([reportA, reportB])
    expect(season.fixtureAllocation.fixturesMeasured).toBe(2)
    expect(season.fixtureAllocation.meanAllocatedTotal).toBeCloseTo((5 + 1) / 2, 10)
    expect(season.fixtureAllocation.clampedPlayerFixtureCount).toBe(1)
  })

  it('renderSeasonSection includes the pooled fixture-allocation line without throwing', () => {
    const reportA = buildGameweekBonusReport(
      1,
      [{ playerCode: 1, expectedPoints: 9, components: componentsWithFixtures(3, [501]) }],
      [{ playerCode: 1, bonus: 3, bps: 40 }],
    )
    const season = poolGameweekReports([reportA])
    const pooledRaw = reportA.fixtureAllocationRaw
    const section = renderSeasonSection(season, pooledRaw)
    expect(section).toContain('Fixture allocation (ticket #237)')
  })
})
