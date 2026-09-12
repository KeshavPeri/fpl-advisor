// Unit tests for scripts/bonus-validation-report.ts — ticket #224.
//
// This job's Supabase reads can't be exercised without a live Supabase project holding real
// gameweek_live_stats/player_projections rows (same limitation every scripts/*.ts test file
// already documents). Every function this file exports is pure, so each is exercised directly on
// constructed rows instead.

import { describe, expect, it } from 'vitest'
import {
  buildGameweekBonusReport,
  computeBonusComparisonStats,
  extractProjectedBonus,
  extractProjectedRowsWithBonus,
  matchRowsToActual,
  poolGameweekReports,
  topByExpectedPoints,
  type ActualLiveStatRow,
  type GameweekBonusReport,
  type ProjectedRowWithBonus,
  type RawProjectedRow,
} from './bonus-validation-report.ts'

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
