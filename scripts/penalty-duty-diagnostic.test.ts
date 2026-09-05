// Unit tests for scripts/penalty-duty-diagnostic.ts's pure functions —
// ticket #215.
//
// No live Supabase project: every DoD item provable without a database is
// proven here on constructed rows — a zero-residual finisher, a genuinely
// flagged surplus, the single-hot-gameweek rejection, the small-population
// refusal, the points-impact conversion, both cross-checks, and the
// penalties_order payload parser (present/absent/malformed). What this file
// cannot prove — that a live run against player_match_stats and
// player_projections produces a specific number — is exactly the same
// limitation scripts/run-backtest.test.ts's own header names for that
// ticket: read docs/projection-model-backlog.md for what a direct
// reproduction of this diagnostic's logic against the real, completed
// 2025-2026 season found.

import { describe, expect, it } from 'vitest'
import { FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { goalPoints } from '../src/lib/projection/pointValues.ts'
import {
  MIN_CAPTAINCY_GAMEWEEKS,
  MIN_CROSSCHECK_POPULATION,
  MIN_QUALIFYING_POPULATION,
  MIN_SEASON_MINUTES,
  PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90,
  FIVE_GAMEWEEK_HORIZON_NINETIES,
  aggregateSeasonTotals,
  computeGoalsMinusXgResidualPerNinety,
  identifyPenaltyDutyCandidates,
  projectedPointsErrorOverHorizon,
  summarizePointsImpact,
  crossCheckAgainstPenaltiesMissed,
  computeTopProjectedPerGameweek,
  computeCaptaincyOverlap,
  parsePenaltiesOrderAvailability,
  type MatchStatsRow,
  type PenaltyDutyCandidate,
  type PlayerSeasonTotals,
} from './penalty-duty-diagnostic.ts'

// ============================================================================
// aggregateSeasonTotals
// ============================================================================

describe('aggregateSeasonTotals', () => {
  it('sums minutes/goals/xg across multiple rows for the same player_code', () => {
    const rows: MatchStatsRow[] = [
      { player_code: 100, minutes_played: 90, goals: 1, xg: 0.5 },
      { player_code: 100, minutes_played: 60, goals: 0, xg: 0.2 },
    ]
    const totals = aggregateSeasonTotals(rows)
    expect(totals.get(100)).toEqual({ minutesPlayed: 150, goals: 1, xg: 0.7 })
  })

  it('skips rows with a null player_code entirely, per D9 (never key on element id)', () => {
    const rows: MatchStatsRow[] = [
      { player_code: null, minutes_played: 90, goals: 5, xg: 0.1 },
      { player_code: 200, minutes_played: 90, goals: 1, xg: 1 },
    ]
    const totals = aggregateSeasonTotals(rows)
    expect(totals.size).toBe(1)
    expect(totals.get(200)).toEqual({ minutesPlayed: 90, goals: 1, xg: 1 })
  })

  it('treats null numeric fields as zero rather than throwing or producing NaN', () => {
    const rows: MatchStatsRow[] = [{ player_code: 300, minutes_played: null, goals: null, xg: null }]
    const totals = aggregateSeasonTotals(rows)
    expect(totals.get(300)).toEqual({ minutesPlayed: 0, goals: 0, xg: 0 })
  })
})

// ============================================================================
// computeGoalsMinusXgResidualPerNinety
// ============================================================================

describe('computeGoalsMinusXgResidualPerNinety', () => {
  it('DoD: a player whose goals match his xG scores a residual near zero', () => {
    const totals: PlayerSeasonTotals = { minutesPlayed: 1800, goals: 10, xg: 10 }
    expect(computeGoalsMinusXgResidualPerNinety(totals)).toBeCloseTo(0, 10)
  })

  it('is positive when goals exceed xG, scaled per 90', () => {
    // 20 nineties (1800 minutes), 5 goals of surplus over xG -> 5/20 = 0.25 per 90.
    const totals: PlayerSeasonTotals = { minutesPlayed: 1800, goals: 15, xg: 10 }
    expect(computeGoalsMinusXgResidualPerNinety(totals)).toBeCloseTo(0.25, 10)
  })

  it('is negative when xG exceeds goals (a player under-performing his chances)', () => {
    const totals: PlayerSeasonTotals = { minutesPlayed: 900, goals: 2, xg: 5 }
    expect(computeGoalsMinusXgResidualPerNinety(totals)).toBeCloseTo(-0.3, 10)
  })

  it('returns null for zero minutes rather than dividing by zero', () => {
    expect(computeGoalsMinusXgResidualPerNinety({ minutesPlayed: 0, goals: 0, xg: 0 })).toBeNull()
  })
})

// ============================================================================
// identifyPenaltyDutyCandidates — the separation rule + sample-size gates
// ============================================================================

describe('identifyPenaltyDutyCandidates', () => {
  /** Builds a population of `count` bystander players, each with a residual of exactly 0, to pad qualifying population above MIN_QUALIFYING_POPULATION without themselves being flagged. */
  function paddingTotals(count: number, startCode: number): Map<number, PlayerSeasonTotals> {
    const totals = new Map<number, PlayerSeasonTotals>()
    for (let i = 0; i < count; i++) {
      totals.set(startCode + i, { minutesPlayed: MIN_SEASON_MINUTES, goals: 5, xg: 5 })
    }
    return totals
  }

  function paddingPositions(count: number, startCode: number): Map<number, 1 | 2 | 3 | 4> {
    const positions = new Map<number, 1 | 2 | 3 | 4>()
    for (let i = 0; i < count; i++) positions.set(startCode + i, MIDFIELDER)
    return positions
  }

  it('DoD: a player with a large persistent surplus, over a full qualifying season, is identified', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION, 1)
    // A genuine full-season taker: 1800 minutes (20 nineties), 15 goals against 10 xG -> 0.25/90 residual, well above the threshold.
    totals.set(9001, { minutesPlayed: 1800, goals: 15, xg: 10 })
    positions.set(9001, FORWARD)

    const result = identifyPenaltyDutyCandidates(totals, positions)
    expect(result.tooSmallToRead).toBe(false)
    expect(result.candidates.map((c) => c.playerCode)).toContain(9001)
    const flagged = result.candidates.find((c) => c.playerCode === 9001)
    expect(flagged?.residualPerNinety).toBeCloseTo(0.25, 10)
  })

  it('DoD: a single high-scoring gameweek does not qualify a player on its own', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION, 1)
    // One hot match: 90 minutes, 3 goals against 0.2 xG -> residual per 90 is huge (2.8),
    // comfortably over PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 -- but minutesPlayed is
    // far below MIN_SEASON_MINUTES, so the minutes gate must reject it before the
    // threshold is ever consulted.
    totals.set(9002, { minutesPlayed: 90, goals: 3, xg: 0.2 })
    positions.set(9002, FORWARD)
    expect(computeGoalsMinusXgResidualPerNinety(totals.get(9002)!)).toBeGreaterThan(PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90)

    const result = identifyPenaltyDutyCandidates(totals, positions)
    expect(result.candidates.map((c) => c.playerCode)).not.toContain(9002)
  })

  it('does not flag a player whose residual sits below the separation threshold', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION, 1)
    // 1800 minutes, residual of exactly 0.05/90 -- below PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 (0.10).
    totals.set(9003, { minutesPlayed: 1800, goals: 11, xg: 10 })
    positions.set(9003, MIDFIELDER)

    const result = identifyPenaltyDutyCandidates(totals, positions)
    expect(result.candidates.map((c) => c.playerCode)).not.toContain(9003)
  })

  it('DoD: refuses (too small to read) rather than guesses when the qualifying population is small', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION - 1, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION - 1, 1)
    const result = identifyPenaltyDutyCandidates(totals, positions)
    expect(result.tooSmallToRead).toBe(true)
    expect(result.candidates).toEqual([])
    expect(result.qualifyingPopulation).toBe(MIN_QUALIFYING_POPULATION - 1)
  })

  it('sorts candidates by residual, largest first', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION, 1)
    totals.set(9010, { minutesPlayed: 1800, goals: 14, xg: 10 }) // 0.20/90
    totals.set(9011, { minutesPlayed: 1800, goals: 16, xg: 10 }) // 0.30/90
    positions.set(9010, FORWARD)
    positions.set(9011, FORWARD)

    const result = identifyPenaltyDutyCandidates(totals, positions)
    const codes = result.candidates.map((c) => c.playerCode)
    expect(codes.indexOf(9011)).toBeLessThan(codes.indexOf(9010))
  })

  it('excludes a qualifying player with no known position, rather than guessing one', () => {
    const totals = paddingTotals(MIN_QUALIFYING_POPULATION, 1)
    const positions = paddingPositions(MIN_QUALIFYING_POPULATION, 1)
    totals.set(9020, { minutesPlayed: 1800, goals: 15, xg: 10 })
    // Deliberately no positions.set(9020, ...)
    const result = identifyPenaltyDutyCandidates(totals, positions)
    expect(result.candidates.map((c) => c.playerCode)).not.toContain(9020)
  })
})

// ============================================================================
// projectedPointsErrorOverHorizon / summarizePointsImpact
// ============================================================================

describe('projectedPointsErrorOverHorizon', () => {
  it('hand-computed: residual x horizon x goalPoints(position)', () => {
    const candidate: Pick<PenaltyDutyCandidate, 'residualPerNinety' | 'position'> = {
      residualPerNinety: 0.2,
      position: FORWARD,
    }
    // 0.2 * 5 * goalPoints(FORWARD=4) = 0.2 * 5 * 4 = 4.0
    expect(goalPoints(FORWARD)).toBe(4)
    expect(projectedPointsErrorOverHorizon(candidate)).toBeCloseTo(4.0, 10)
  })

  it('scales with position value -- a goalkeeper residual is worth more per goal than a forward one', () => {
    const gk: Pick<PenaltyDutyCandidate, 'residualPerNinety' | 'position'> = { residualPerNinety: 0.1, position: GOALKEEPER }
    const fwd: Pick<PenaltyDutyCandidate, 'residualPerNinety' | 'position'> = { residualPerNinety: 0.1, position: FORWARD }
    expect(projectedPointsErrorOverHorizon(gk)).toBeGreaterThan(projectedPointsErrorOverHorizon(fwd))
  })

  it('respects a custom horizon', () => {
    const candidate: Pick<PenaltyDutyCandidate, 'residualPerNinety' | 'position'> = { residualPerNinety: 0.1, position: MIDFIELDER }
    expect(projectedPointsErrorOverHorizon(candidate, 1)).toBeCloseTo(0.1 * 1 * goalPoints(MIDFIELDER), 10)
    expect(projectedPointsErrorOverHorizon(candidate, FIVE_GAMEWEEK_HORIZON_NINETIES)).toBeCloseTo(0.1 * 5 * goalPoints(MIDFIELDER), 10)
  })
})

describe('summarizePointsImpact', () => {
  it('returns null for an empty candidate list -- never a mean of zero rows', () => {
    expect(summarizePointsImpact([])).toBeNull()
  })

  it('hand-computed mean and total across two candidates', () => {
    const candidates: PenaltyDutyCandidate[] = [
      { playerCode: 1, position: FORWARD, minutesPlayed: 1800, goals: 15, xg: 10, residualPerNinety: 0.25 },
      { playerCode: 2, position: MIDFIELDER, minutesPlayed: 1800, goals: 14, xg: 10, residualPerNinety: 0.2 },
    ]
    // c1: 0.25 * 5 * 4 = 5.0 ; c2: 0.2 * 5 * 5 = 5.0 ; total 10.0, mean 5.0
    const summary = summarizePointsImpact(candidates)
    expect(summary).not.toBeNull()
    expect(summary!.n).toBe(2)
    expect(summary!.totalPointsImpact).toBeCloseTo(10.0, 10)
    expect(summary!.meanPointsImpact).toBeCloseTo(5.0, 10)
  })
})

// ============================================================================
// crossCheckAgainstPenaltiesMissed
// ============================================================================

describe('crossCheckAgainstPenaltiesMissed', () => {
  function makeCandidates(n: number): PenaltyDutyCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      playerCode: i + 1,
      position: FORWARD,
      minutesPlayed: 1800,
      goals: 15,
      xg: 10,
      residualPerNinety: 0.25,
    }))
  }

  it('DoD: refuses a too-small candidate population rather than reporting a rate nobody could trust', () => {
    const candidates = makeCandidates(MIN_CROSSCHECK_POPULATION - 1)
    const result = crossCheckAgainstPenaltiesMissed(candidates, new Map())
    expect(result.tooSmallToRead).toBe(true)
    expect(result.n).toBe(MIN_CROSSCHECK_POPULATION - 1)
  })

  it('counts candidates with a positive penalties_missed on record', () => {
    const candidates = makeCandidates(MIN_CROSSCHECK_POPULATION)
    const penaltiesMissedByCode = new Map<number, number>([
      [1, 1],
      [2, 0],
      [3, 2],
    ])
    const result = crossCheckAgainstPenaltiesMissed(candidates, penaltiesMissedByCode)
    expect(result.tooSmallToRead).toBe(false)
    expect(result.n).toBe(MIN_CROSSCHECK_POPULATION)
    expect(result.withPenaltiesMissedOnRecord).toBe(2) // codes 1 and 3
  })

  it('a candidate absent from the map counts as zero, not as evidence either way', () => {
    const candidates = makeCandidates(MIN_CROSSCHECK_POPULATION)
    const result = crossCheckAgainstPenaltiesMissed(candidates, new Map())
    expect(result.withPenaltiesMissedOnRecord).toBe(0)
  })
})

// ============================================================================
// computeTopProjectedPerGameweek / computeCaptaincyOverlap
// ============================================================================

describe('computeTopProjectedPerGameweek', () => {
  it('picks the highest expected_points row per gameweek', () => {
    const rows = [
      { gameweekId: 1, playerCode: 10, expectedPoints: 5.0 },
      { gameweekId: 1, playerCode: 20, expectedPoints: 7.5 },
      { gameweekId: 2, playerCode: 10, expectedPoints: 6.0 },
      { gameweekId: 2, playerCode: 30, expectedPoints: 4.0 },
    ]
    const top = computeTopProjectedPerGameweek(rows)
    expect(top.get(1)).toBe(20)
    expect(top.get(2)).toBe(10)
    expect(top.size).toBe(2)
  })
})

describe('computeCaptaincyOverlap', () => {
  it('DoD: refuses when too few gameweeks are measured', () => {
    const top = new Map<number, number>()
    for (let gw = 1; gw < MIN_CAPTAINCY_GAMEWEEKS; gw++) top.set(gw, 100)
    const result = computeCaptaincyOverlap(new Set([100]), top)
    expect(result.tooSmallToRead).toBe(true)
  })

  it('hand-computed overlap rate: 2 of 5 gameweeks topped by a flagged candidate', () => {
    const top = new Map<number, number>([
      [1, 100], // candidate
      [2, 200],
      [3, 100], // candidate
      [4, 300],
      [5, 400],
    ])
    const result = computeCaptaincyOverlap(new Set([100]), top)
    expect(result.tooSmallToRead).toBe(false)
    expect(result.gameweeksMeasured).toBe(5)
    expect(result.gameweeksWithCandidateOnTop).toBe(2)
    expect(result.rate).toBeCloseTo(0.4, 10)
  })

  it('rate is 0 when no candidate ever tops a gameweek', () => {
    const top = new Map<number, number>([
      [1, 200],
      [2, 300],
      [3, 400],
      [4, 500],
      [5, 600],
    ])
    const result = computeCaptaincyOverlap(new Set([100]), top)
    expect(result.gameweeksWithCandidateOnTop).toBe(0)
    expect(result.rate).toBe(0)
  })
})

// ============================================================================
// parsePenaltiesOrderAvailability — the live-payload yes/no check
// ============================================================================

describe('parsePenaltiesOrderAvailability', () => {
  it('reports available with a non-null count when the field is present', () => {
    const payload = {
      elements: [{ id: 1, penalties_order: 1 }, { id: 2, penalties_order: null }, { id: 3, penalties_order: 2 }],
    }
    const result = parsePenaltiesOrderAvailability(payload)
    expect(result.available).toBe(true)
    expect(result.totalElements).toBe(3)
    expect(result.nonNullCount).toBe(2)
  })

  it('reports unavailable when the field does not exist on elements at all', () => {
    const payload = { elements: [{ id: 1, goals_scored: 5 }] }
    const result = parsePenaltiesOrderAvailability(payload)
    expect(result.available).toBe(false)
    expect(result.nonNullCount).toBe(0)
  })

  it('fails closed (unavailable) on a malformed payload rather than throwing', () => {
    expect(parsePenaltiesOrderAvailability(null).available).toBe(false)
    expect(parsePenaltiesOrderAvailability(undefined).available).toBe(false)
    expect(parsePenaltiesOrderAvailability('not an object').available).toBe(false)
    expect(parsePenaltiesOrderAvailability({}).available).toBe(false)
    expect(parsePenaltiesOrderAvailability({ elements: [] }).available).toBe(false)
    expect(parsePenaltiesOrderAvailability({ elements: 'not an array' }).available).toBe(false)
  })
})
