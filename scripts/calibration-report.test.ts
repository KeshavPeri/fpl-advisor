// Unit tests for scripts/calibration-report.ts's pure functions — ticket
// #48. No Supabase: every DoD item provable without a database is proven
// here — the reconstruction arithmetic (per position, appearance points,
// clean sheets), and the by-position aggregation (zero-minute exclusion,
// per-90 scaling, ratio). What this file cannot prove — that the paginated
// reads returned everything, and that the real player_match_stats/
// player_projections data produces a sensible report — is why the row-count
// assertion is a DoD item in its own right and the report itself is the
// deliverable (see the ticket's Notes).

import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import {
  aggregateActualByPosition,
  aggregateProjectedByPosition,
  componentsPer90,
  emptyComponentTotals,
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
