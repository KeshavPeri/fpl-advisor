// Unit tests for scripts/store-chip-advisory.ts's pure function — ticket
// #126. No Supabase, no filesystem: buildChipAdvisoryRows is exercised
// directly against SolverSolution fixtures, matching this codebase's
// convention of proving every DoD item provable without a database here.

import { describe, expect, it } from 'vitest'
import type { SolverSolution } from './lib/solver-output.js'
import { buildChipAdvisoryRows, ChipAdvisoryBuildError } from './store-chip-advisory.js'

describe('buildChipAdvisoryRows — one row per (gameweek, solution_index, chip_code)', () => {
  it('produces one row per chip played, sharing the same objective/delta inputs for a multi-chip solution', () => {
    const chipSolutions: SolverSolution[] = [
      {
        solutionIndex: 0,
        chips: [
          { chipCode: 'TC', gameweekId: 2 },
          { chipCode: 'BB', gameweekId: 4 },
        ],
        score: 256.48,
      },
    ]
    const chipFreeSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250.0 }]

    const rows = buildChipAdvisoryRows({
      gameweekId: 2,
      solverRunId: 42,
      chipSolutions,
      chipFreeSolutions,
    })

    expect(rows).toHaveLength(2)
    expect(rows).toEqual([
      {
        gameweek_id: 2,
        solution_index: 0,
        chip_code: 'TC',
        chip_gameweek_id: 2,
        chip_enabled_objective: 256.48,
        chip_free_objective: 250.0,
        solver_run_id: 42,
      },
      {
        gameweek_id: 2,
        solution_index: 0,
        chip_code: 'BB',
        chip_gameweek_id: 4,
        chip_enabled_objective: 256.48,
        chip_free_objective: 250.0,
        solver_run_id: 42,
      },
    ])
  })
})

describe('buildChipAdvisoryRows — a chip-free solution produces no row', () => {
  it('skips solutions with an empty chips array, without error', () => {
    const chipSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250.0 }]
    const chipFreeSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250.0 }]

    const rows = buildChipAdvisoryRows({ gameweekId: 2, solverRunId: 1, chipSolutions, chipFreeSolutions })
    expect(rows).toEqual([])
  })
})

describe('buildChipAdvisoryRows — the delta is always chip-enabled minus chip-free of the SAME solver_run_id, never a different run', () => {
  it('pairs each chip-enabled solution with its OWN solution_index in the chip-free set, never a different index', () => {
    const chipSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [{ chipCode: 'TC', gameweekId: 2 }], score: 256.48 },
      { solutionIndex: 1, chips: [{ chipCode: 'TC', gameweekId: 2 }], score: 256.29 },
    ]
    // Chip-free scores deliberately differ per solution_index — if the
    // pairing were positional-but-wrong (or grabbed a single shared value),
    // this test would catch it: solution 0 must pair with 250.0, solution 1
    // with 248.0, never swapped.
    const chipFreeSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 250.0 },
      { solutionIndex: 1, chips: [], score: 248.0 },
    ]

    const rows = buildChipAdvisoryRows({ gameweekId: 2, solverRunId: 99, chipSolutions, chipFreeSolutions })

    const row0 = rows.find((r) => r.solution_index === 0)!
    const row1 = rows.find((r) => r.solution_index === 1)!
    expect(row0.chip_free_objective).toBe(250.0)
    expect(row1.chip_free_objective).toBe(248.0)
    expect(row0.solver_run_id).toBe(99)
    expect(row1.solver_run_id).toBe(99)
  })

  it('stamps every row with the single solverRunId passed in — never a value read from elsewhere', () => {
    const chipSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'BB', gameweekId: 4 }], score: 100 }]
    const chipFreeSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 90 }]
    const rows = buildChipAdvisoryRows({ gameweekId: 5, solverRunId: 777, chipSolutions, chipFreeSolutions })
    expect(rows.every((r) => r.solver_run_id === 777)).toBe(true)
  })

  it('throws when a chip-enabled solution has no matching solution_index in the chip-free set — refuses to compare against a missing baseline', () => {
    const chipSolutions: SolverSolution[] = [{ solutionIndex: 2, chips: [{ chipCode: 'TC', gameweekId: 2 }], score: 256 }]
    const chipFreeSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250 }]

    expect(() =>
      buildChipAdvisoryRows({ gameweekId: 2, solverRunId: 1, chipSolutions, chipFreeSolutions }),
    ).toThrow(ChipAdvisoryBuildError)
    expect(() =>
      buildChipAdvisoryRows({ gameweekId: 2, solverRunId: 1, chipSolutions, chipFreeSolutions }),
    ).toThrow(/no matching solution_index/)
  })
})
