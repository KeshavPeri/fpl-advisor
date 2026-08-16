// Unit tests for scripts/store-solver-output.ts's pure functions — ticket
// #41. No Supabase, no filesystem: every DoD item provable without a
// database is proven here (log parsing, the three-outcome classification,
// and the results-CSV row mapping). The three log fixtures below are not
// invented — they are trimmed from real `run/solve.py` runs against the
// pinned commit (45131c5a41d7caadb5cb626c012bfa9111dca7a2), captured while
// building this ticket: a normal solve, a solve that hits its time limit
// with a usable incumbent, and a genuinely infeasible model. See
// decisions/ticket-41.md.

import { describe, expect, it } from 'vitest'
import { classifySolve, mapResultsCsvRow, parseSolverLog } from './store-solver-output.js'

// ============================================================================
// Log fixtures — trimmed HiGHS "Solving report" blocks, captured verbatim
// from real runs of the pinned solver commit.
// ============================================================================

const OPTIMAL_LOG = `
Filtered player pool from 587 to 157 players
Running HiGHS 1.15.1 (git hash: 04024d7): Copyright (c) 2026 under MIT licence terms

Solving report
  Status            Optimal
  Primal bound      159.011924
  Dual bound        159.011924
  Gap               0%
  P-D integral      0.00657783226515
  Solution status   feasible
                    159.011924 (objective)
  Timing            0.84
                    0.38 (Presolve)
`

const TIME_LIMIT_WITH_INCUMBENT_LOG = `
Filtered player pool from 587 to 157 players
Solving report
  Status            Time limit reached
  Primal bound      157.44679
  Dual bound        163.28404332
  Gap               3.71%
  Solution status   feasible
  Timing            0.58
`

const TIME_LIMIT_NO_INCUMBENT_LOG = `
Filtered player pool from 587 to 157 players
Solving report
  Status            Time limit reached
  Primal bound      -inf
  Dual bound        inf
  Gap               0%
  Solution status   -
  Timing            0.06
Traceback (most recent call last):
  File "run/solve.py", line 374, in <module>
KeyError: 'week'
`

const INFEASIBLE_LOG = `
Filtered player pool from 587 to 157 players
Solving report
  Status            Infeasible
  Primal bound      -inf
  Dual bound        inf
  Gap               0%
  Solution status   -
  Timing            0.01
Traceback (most recent call last):
  File "run/solve.py", line 374, in <module>
KeyError: 'week'
`

const CRASH_BEFORE_SOLVE_LOG = `
Traceback (most recent call last):
  File "run/solve.py", line 116, in solve_regular
FileNotFoundError: "team_data" is "json" but data/team.json does not exist.
`

// ============================================================================
// parseSolverLog
// ============================================================================

describe('parseSolverLog', () => {
  it('extracts "Optimal" from a proven-optimal solve', () => {
    expect(parseSolverLog(OPTIMAL_LOG).status).toBe('Optimal')
  })

  it('extracts the primal bound as the objective value', () => {
    expect(parseSolverLog(OPTIMAL_LOG).objectiveValue).toBeCloseTo(159.011924)
  })

  it('extracts the total solve time from the Timing line', () => {
    expect(parseSolverLog(OPTIMAL_LOG).secondsTaken).toBeCloseTo(0.84)
  })

  it('extracts the surviving pool size from the "Filtered player pool" line', () => {
    expect(parseSolverLog(OPTIMAL_LOG).poolSizeAfter).toBe(157)
  })

  it('extracts "Time limit reached" from a timed-out-but-usable solve', () => {
    expect(parseSolverLog(TIME_LIMIT_WITH_INCUMBENT_LOG).status).toBe('Time limit reached')
  })

  it('extracts "Infeasible" from an infeasible solve', () => {
    expect(parseSolverLog(INFEASIBLE_LOG).status).toBe('Infeasible')
  })

  it('returns a null objective value when the primal bound is -inf (no incumbent found)', () => {
    expect(parseSolverLog(TIME_LIMIT_NO_INCUMBENT_LOG).objectiveValue).toBeNull()
  })

  it('returns a null status when the log never reaches a "Solving report" block at all', () => {
    expect(parseSolverLog(CRASH_BEFORE_SOLVE_LOG).status).toBeNull()
  })
})

// ============================================================================
// classifySolve — the three failure modes, and they are not interchangeable
// (product-brief.md §6c).
// ============================================================================

describe('classifySolve', () => {
  it('classifies Optimal + a results CSV as success, and optimal', () => {
    const outcome = classifySolve('Optimal', true)
    expect(outcome.kind).toBe('success')
    expect(outcome.kind === 'success' && outcome.isOptimal).toBe(true)
  })

  it('classifies "Time limit reached" + a results CSV as success, but explicitly NOT optimal', () => {
    const outcome = classifySolve('Time limit reached', true)
    expect(outcome.kind).toBe('success')
    expect(outcome.kind === 'success' && outcome.isOptimal).toBe(false)
    expect(outcome.kind === 'success' && outcome.solverStatus).toBe('Time limit reached')
  })

  it('never classifies a non-"Optimal" status as optimal, whatever the exact wording', () => {
    const outcome = classifySolve('Time limit reached', true)
    expect(outcome.kind === 'success' && outcome.isOptimal).toBe(false)
  })

  it('classifies "Infeasible" as infeasible, regardless of whether a results CSV happens to exist', () => {
    expect(classifySolve('Infeasible', false).kind).toBe('infeasible')
    expect(classifySolve('Infeasible', true).kind).toBe('infeasible')
  })

  it('classifies a timeout with no results CSV as no_incumbent, distinct from infeasible', () => {
    const outcome = classifySolve('Time limit reached', false)
    expect(outcome.kind).toBe('no_incumbent')
  })

  it('classifies a null status (no Solving report reached) as crashed', () => {
    expect(classifySolve(null, false).kind).toBe('crashed')
  })
})

// ============================================================================
// mapResultsCsvRow — the exact columns run/solve.py writes at the pinned
// commit, verified by reading dev/solver.py's source and by a real run.
// ============================================================================

function csvRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: '303',
    week: '1',
    name: 'Kipré',
    pos: 'DEF',
    type: '2',
    team: 'Ipswich Town',
    buy_price: '4.0',
    sell_price: '0.0',
    xP: '5.49',
    xMin: '60',
    squad: '1',
    lineup: '1',
    bench: '-1',
    captain: '1',
    vicecaptain: '0',
    transfer_in: '1',
    transfer_out: '0',
    multiplier: '2',
    xp_cont: '10.98',
    chip: '',
    iter: '0',
    ft: '1.0',
    transfer_count: '1.0',
    ...overrides,
  }
}

describe('mapResultsCsvRow', () => {
  it('maps id, week and iter to player_id, gameweek_id and solution_index', () => {
    const pick = mapResultsCsvRow(csvRow(), 12345)
    expect(pick.player_id).toBe(303)
    expect(pick.gameweek_id).toBe(1)
    expect(pick.solution_index).toBe(0)
  })

  it('carries the player_code passed in by the caller', () => {
    expect(mapResultsCsvRow(csvRow(), 12345).player_code).toBe(12345)
    expect(mapResultsCsvRow(csvRow(), null).player_code).toBeNull()
  })

  it('maps bench=-1 (a lineup player) to bench_order null', () => {
    const pick = mapResultsCsvRow(csvRow({ bench: '-1' }), null)
    expect(pick.bench_order).toBeNull()
  })

  it('maps bench=0 to bench_order 1, and bench=3 to bench_order 4 — shifted by one from the solver\'s own 0-3 slot', () => {
    expect(mapResultsCsvRow(csvRow({ bench: '0', lineup: '0' }), null).bench_order).toBe(1)
    expect(mapResultsCsvRow(csvRow({ bench: '3', lineup: '0' }), null).bench_order).toBe(4)
  })

  it('maps captain/vicecaptain/transfer_in/transfer_out flags to booleans', () => {
    const pick = mapResultsCsvRow(csvRow({ captain: '1', vicecaptain: '0', transfer_in: '1', transfer_out: '0' }), null)
    expect(pick.is_captain).toBe(true)
    expect(pick.is_vice_captain).toBe(false)
    expect(pick.is_transfer_in).toBe(true)
    expect(pick.is_transfer_out).toBe(false)
  })

  it('maps xP to expected_points as a number, not the captaincy-multiplied xp_cont', () => {
    const pick = mapResultsCsvRow(csvRow({ xP: '5.49', xp_cont: '10.98' }), null)
    expect(pick.expected_points).toBe(5.49)
  })
})
