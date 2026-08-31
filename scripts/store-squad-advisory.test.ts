// Unit tests for scripts/store-squad-advisory.ts's pure functions — ticket
// #134, updated by ticket #160. No Supabase, no filesystem, and —
// deliberately — no raw solver log text either: buildSquadAdvisoryRow is
// exercised directly against SolverSolution fixtures, the same pattern
// scripts/store-chip-advisory.test.ts already establishes for the sibling
// chip-timing advisory. This keeps these tests independent of
// scripts/lib/solver-output.ts's own raw-log parsing behaviour (out of this
// ticket's scope — see this file's header note below and the ticket's own
// Notes on ticket #132).
//
// A NOTE ON #132: scripts/lib/solver-output.ts's parser for chip-free
// Results-table rows (the shape both this ticket's BASELINE solve AND, since
// #160, the REBUILD solve produce) has a known bug being fixed concurrently
// by ticket #132, not yet on `main` as of ticket #134. This file never calls
// parseSolverOutput() at all — every fixture below is a plain, already-parsed
// SolverSolution[] array constructed by hand, so nothing here depends on
// which side of that fix scripts/lib/solver-output.ts happens to be on.
//
// TICKET #160: the rebuild solve is now chip-free (buildRebuildSolverConfig's
// chip_limits is all zero for both variants — chip_limits.wc/fh is no longer
// granted on top of preseason: true, since that let the solve rebuild the
// squad a second time). Every fixture below reflects that: rebuildSolutions
// now carry `chips: []`, exactly like baselineSolutions always have. See
// scripts/store-squad-advisory.ts's own buildSquadAdvisoryRow comment for
// the full "because", and docs/solver-notes.md for the 30 Aug 2026 dispatch
// that proved the bug.

import { describe, expect, it } from 'vitest'
import type { SolverSolution } from './lib/solver-output.js'
import { SquadAdvisoryBuildError, buildSquadAdvisoryRow, countDistinctObjectiveValues } from './store-squad-advisory.js'

describe('buildSquadAdvisoryRow — one row per run, always solution_index 0', () => {
  it('builds a WC row from the primary (solution_index 0) solution of each solve, delta = rebuild objective - baseline objective', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 320.5, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 273.2, playerSold: null, playerBought: null }]

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
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250, playerSold: null, playerBought: null }]

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

  it('ticket #160 — variant remains the SOLE determinant of chip_advisories.chip_code, independent of what the (now chip-free) rebuild solve\'s own solution played', () => {
    // Identical rebuild/baseline fixtures, only `variant` differs — proves chip_code tracks
    // variant alone, not anything read off rebuildPrimary.chips (which is empty either way).
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250, playerSold: null, playerBought: null }]

    const wcRow = buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions })
    const fhRow = buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'fh', rebuildSolutions, baselineSolutions })

    expect(wcRow.chip_code).toBe('WC')
    expect(fhRow.chip_code).toBe('FH')
  })

  it('ignores solution_index 1 and 2 (alternates) on both sides — only iteration 0 is compared', () => {
    const rebuildSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 310, playerSold: null, playerBought: null },
      { solutionIndex: 1, chips: [], score: 305, playerSold: null, playerBought: null },
      { solutionIndex: 2, chips: [], score: 300, playerSold: null, playerBought: null },
    ]
    const baselineSolutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 260, playerSold: null, playerBought: null },
      { solutionIndex: 1, chips: [], score: 255, playerSold: null, playerBought: null },
      { solutionIndex: 2, chips: [], score: 250, playerSold: null, playerBought: null },
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
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 100, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 80, playerSold: null, playerBought: null }]

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

  it('ticket #160 — chip_gameweek_id is now the target gameweekId, not a chip token\'s own gameweek: there is no longer a chip in the rebuild solve\'s output to read one from', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 200, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 150, playerSold: null, playerBought: null }]

    const row = buildSquadAdvisoryRow({
      gameweekId: 5,
      solverRunId: 1,
      variant: 'wc',
      rebuildSolutions,
      baselineSolutions,
    })

    expect(row.gameweek_id).toBe(5)
    expect(row.chip_gameweek_id).toBe(5)
  })
})

describe('buildSquadAdvisoryRow — refuses to guess, throws on anything it cannot prove', () => {
  it('throws when the rebuild solve has no solution_index 0', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 1, chips: [], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250, playerSold: null, playerBought: null }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(SquadAdvisoryBuildError)
    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/rebuild solve.*no solution_index 0/)
  })

  it('throws when the baseline solve has no solution_index 0', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 1, chips: [], score: 250, playerSold: null, playerBought: null }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/baseline.*no solution_index 0/)
  })

  it('throws when the baseline solution played a chip — refuses to compare against a contaminated baseline', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'BB', gameweekId: 2 }], score: 250, playerSold: null, playerBought: null }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(SquadAdvisoryBuildError)
    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/contaminated baseline/)
  })

  it('ticket #160 — throws when the rebuild solution played ANY chip: chip_limits is all zero for the rebuild solve now, so a chip appearing there is a solver anomaly, not a valid advisory', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'WC', gameweekId: 3 }], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250, playerSold: null, playerBought: null }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(SquadAdvisoryBuildError)
    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/played chip\(s\)/)
  })

  it('ticket #160 — throws the same way regardless of which chip appeared, or which variant was requested', () => {
    const rebuildSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [{ chipCode: 'FH', gameweekId: 3 }], score: 300, playerSold: null, playerBought: null }]
    const baselineSolutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 250, playerSold: null, playerBought: null }]

    expect(() =>
      buildSquadAdvisoryRow({ gameweekId: 3, solverRunId: 1, variant: 'wc', rebuildSolutions, baselineSolutions }),
    ).toThrow(/played chip\(s\)/)
  })
})

// ============================================================================
// countDistinctObjectiveValues — ticket #160's "three solutions, one answer"
// counter. Pure, no I/O — see its own comment in store-squad-advisory.ts.
// ============================================================================

describe('countDistinctObjectiveValues', () => {
  it('returns 1 when every solution shares the same objective — the 30 Aug 2026 dispatch\'s actual finding (295.54 on all three, differing only by bench goalkeeper)', () => {
    const solutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 295.54, playerSold: null, playerBought: null },
      { solutionIndex: 1, chips: [], score: 295.54, playerSold: null, playerBought: null },
      { solutionIndex: 2, chips: [], score: 295.54, playerSold: null, playerBought: null },
    ]
    expect(countDistinctObjectiveValues(solutions)).toBe(1)
  })

  it('returns 3 when all three solutions carry genuinely different objectives', () => {
    const solutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 310, playerSold: null, playerBought: null },
      { solutionIndex: 1, chips: [], score: 305, playerSold: null, playerBought: null },
      { solutionIndex: 2, chips: [], score: 300, playerSold: null, playerBought: null },
    ]
    expect(countDistinctObjectiveValues(solutions)).toBe(3)
  })

  it('returns 2 when exactly two of three solutions tie', () => {
    const solutions: SolverSolution[] = [
      { solutionIndex: 0, chips: [], score: 300, playerSold: null, playerBought: null },
      { solutionIndex: 1, chips: [], score: 300, playerSold: null, playerBought: null },
      { solutionIndex: 2, chips: [], score: 280, playerSold: null, playerBought: null },
    ]
    expect(countDistinctObjectiveValues(solutions)).toBe(2)
  })

  it('returns 0 for an empty solutions array — never guesses at a count that was never observed', () => {
    expect(countDistinctObjectiveValues([])).toBe(0)
  })

  it('returns 1 for a single solution', () => {
    const solutions: SolverSolution[] = [{ solutionIndex: 0, chips: [], score: 123.45, playerSold: null, playerBought: null }]
    expect(countDistinctObjectiveValues(solutions)).toBe(1)
  })
})
