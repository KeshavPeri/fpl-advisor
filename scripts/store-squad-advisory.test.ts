// Unit tests for scripts/store-squad-advisory.ts's pure function — ticket
// #134. No Supabase, no filesystem, and — deliberately — no raw solver log
// text either: buildSquadAdvisoryRow is exercised directly against
// SolverSolution fixtures, the same pattern scripts/store-chip-advisory.test.ts
// already establishes for the sibling chip-timing advisory. This keeps these
// tests independent of scripts/lib/solver-output.ts's own raw-log parsing
// behaviour (out of this ticket's scope — see this file's header note below
// and the ticket's own Notes on ticket #132).
//
// A NOTE ON #132: scripts/lib/solver-output.ts's parser for chip-free
// Results-table rows (the shape this ticket's BASELINE solve produces) has a
// known bug being fixed concurrently by ticket #132, not yet on `main` as of
// this ticket. This file never calls parseSolverOutput() at all — every
// fixture below is a plain, already-parsed SolverSolution[] array
// constructed by hand, so nothing here depends on which side of that fix
// scripts/lib/solver-output.ts happens to be on. The rebuild solve's own log
// shape (every row plays the requested wc/fh chip) is unaffected by #132
// either way — see scripts/store-squad-advisory.ts's own file header.

import { describe, expect, it } from 'vitest'
import type { SolverSolution } from './lib/solver-output.js'
import { SquadAdvisoryBuildError, buildSquadAdvisoryRow } from './store-squad-advisory.js'

describe('buildSquadAdvisoryRow — one row per run, always solution_index 0', () => {
  it('builds a WC row from the primary (solution_index 0) solution of each solve, delta = rebuild objective - baseline objective', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 7 }], score: 320.5 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 273.2 }]

    const row = buildSquadAdvisoryRow({
      gameweekId: 7,
      solverRunId: 42,
      variant: 'wc',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row).toEqual({
      gameweek_id: 7,
      solution_index: 0,
      chip_code: 'WC',
      chip_gameweek_id: 7,
      chip_enabled_objective: 320.5,
      chip_free_objective: 273.2,
      solver_run_id: 42,
    })

    // The ticket's own DoD, in its own words: "the delta equals the rebuild
    // objective minus the baseline objective of the same run." chip_advisories.delta
    // is a database GENERATED column (chip_enabled_objective - chip_free_objective,
    // see that migration's header) — this row supplies exactly those two inputs,
    // never a pre-computed delta of its own, so this arithmetic is what the
    // database will actually compute from the row this function returns.
    expect(row.chip_enabled_objective - row.chip_free_objective).toBeCloseTo(320.5 - 273.2, 10)
  })

  it('builds an FH row the same way, with chip_code "FH" — never both WC and FH in one row', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'FH', gameweekId: 5 }], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250 }]

    const row = buildSquadAdvisoryRow({
      gameweekId: 5,
      solverRunId: 99,
      variant: 'fh',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row.chip_code).toBe('FH')
    expect(row.chip_code).not.toBe('WC')
  })

  it('ignores solution_index 1 and 2 (alternates) on both sides — only iteration 0 is compared', () => {
    const rebuildSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 310 },
      { solutionIndex: 1, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 305 },
      { solutionIndex: 2, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 300 },
    ]
    const baselineSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 260 },
      { solutionIndex: 1, chips: [], score: 255 },
      { solutionIndex: 2, chips: [], score: 250 },
    ]

    const row = buildSquadAdvisoryRow({
      gameweekId: 3,
      solverRunId: 1,
      variant: 'wc',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row.chip_enabled_objective).toBe(310)
    expect(row.chip_free_objective).toBe(260)
  })

  it('stamps the row with the gameweekId and solverRunId passed in, never a value read from elsewhere', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 12 }], score: 100 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 80 }]

    const row = buildSquadAdvisoryRow({
      gameweekId: 12,
      solverRunId: 777,
      variant: 'wc',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row.gameweek_id).toBe(12)
    expect(row.solver_run_id).toBe(777)
  })

  it('reads chip_gameweek_id from the rebuild solve\'s own chip token, not the target gameweekId parameter — they can differ', () => {
    // A rebuild solved FOR gameweek 5 that plays the chip at horizon position
    // 6 (a real absolute gameweek id, same convention TC2/BB4 already use —
    // see scripts/lib/solver-output.ts's own header).
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 6 }], score: 200 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 150 }]

    const row = buildSquadAdvisoryRow({
      gameweekId: 5,
      solverRunId: 1,
      variant: 'wc',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row.gameweek_id).toBe(5)
    expect(row.chip_gameweek_id).toBe(6)
  })
})

describe('buildSquadAdvisoryRow — refuses to guess, throws on anything it cannot prove', () => {
  it('throws when the rebuild solve has no solution_index 0', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 1, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250 }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(SquadAdvisoryBuildError)
    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/rebuild solve.*no solution_index 0/)
  })

  it('throws when the baseline solve has no solution_index 0', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 1, chips: [], score: 250 }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/baseline.*no solution_index 0/)
  })

  it('throws when the baseline solution played a chip — refuses to compare against a contaminated baseline', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'BB', gameweekId: 2 }], score: 250 }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(SquadAdvisoryBuildError)
    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/contaminated baseline/)
  })

  it('throws when the rebuild solution did not actually play the requested variant\'s chip', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250 }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/did not play WC/)
  })

  it('throws when the rebuild solution played the OTHER variant\'s chip instead of the requested one', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'FH', gameweekId: 3 }], score: 300 }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250 }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/did not play WC/)
  })
})
