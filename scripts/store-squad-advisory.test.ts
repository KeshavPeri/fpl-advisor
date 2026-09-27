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
// TICKET #284 (feature-list item 28, the second half) adds three more pure
// functions below, tested the same way: mapRebuildResultsCsvRow and
// buildChipRebuildPickRows against plain, already-parsed results-CSV row
// objects (the same column shapes scripts/store-solver-output.test.ts's own
// csvRow fixture uses, verified there against dev/solve.py's source), and
// resolveChipRebuildPicksInsertOutcome against a bare Postgrest-shaped error
// object — proving the "the store step still writes the advisory when the
// picks table is missing" DoD item without a database: that function is
// only ever reached from main() AFTER the chip_advisories row is already
// committed, so proving it never throws on a missing-table error is exactly
// what proves the advisory survives that condition.
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
import {
  ChipRebuildPicksBuildError,
  SquadAdvisoryBuildError,
  buildChipRebuildPickRows,
  buildSquadAdvisoryRow,
  countDistinctObjectiveValues,
  mapRebuildResultsCsvRow,
  resolveChipRebuildPicksInsertOutcome,
} from './store-squad-advisory.js'

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

// ============================================================================
// mapRebuildResultsCsvRow / buildChipRebuildPickRows — ticket #284. Same CSV
// column shapes scripts/store-solver-output.test.ts's own csvRow fixture
// uses (the exact columns run/solve.py writes at the pinned commit —
// verified there by reading dev/solver.py's source and by a real run),
// extended with `pos` read verbatim into chip_rebuild_picks.position (see
// that migration's own column comment).
// ============================================================================

function rebuildCsvRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: '303',
    week: '5',
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
    captain: '0',
    vicecaptain: '0',
    transfer_in: '1',
    transfer_out: '0',
    multiplier: '1',
    xp_cont: '5.49',
    chip: '-',
    iter: '0',
    ft: '1.0',
    transfer_count: '1.0',
    ...overrides,
  }
}

describe('mapRebuildResultsCsvRow', () => {
  it('maps id, pos and xP to player_id, position and expected_points, carrying the chip_advisory_id passed in', () => {
    const pick = mapRebuildResultsCsvRow(rebuildCsvRow(), 42, 12345)
    expect(pick.chip_advisory_id).toBe(42)
    expect(pick.player_id).toBe(303)
    expect(pick.position).toBe('DEF')
    expect(pick.expected_points).toBe(5.49)
  })

  it('carries the player_code passed in by the caller', () => {
    expect(mapRebuildResultsCsvRow(rebuildCsvRow(), 1, 12345).player_code).toBe(12345)
    expect(mapRebuildResultsCsvRow(rebuildCsvRow(), 1, null).player_code).toBeNull()
  })

  it('maps bench=-1 to is_starting true and bench_order null', () => {
    const pick = mapRebuildResultsCsvRow(rebuildCsvRow({ bench: '-1', lineup: '1' }), 1, null)
    expect(pick.is_starting).toBe(true)
    expect(pick.bench_order).toBeNull()
  })

  it('maps bench=0 to bench_order 1, and bench=3 to bench_order 4 — shifted by one from the solver\'s own 0-3 slot, is_starting false', () => {
    const first = mapRebuildResultsCsvRow(rebuildCsvRow({ bench: '0', lineup: '0' }), 1, null)
    expect(first.bench_order).toBe(1)
    expect(first.is_starting).toBe(false)
    expect(mapRebuildResultsCsvRow(rebuildCsvRow({ bench: '3', lineup: '0' }), 1, null).bench_order).toBe(4)
  })

  it('maps captain/vicecaptain flags to booleans independently', () => {
    expect(mapRebuildResultsCsvRow(rebuildCsvRow({ captain: '1', vicecaptain: '0' }), 1, null).is_captain).toBe(true)
    expect(mapRebuildResultsCsvRow(rebuildCsvRow({ captain: '0', vicecaptain: '1' }), 1, null).is_vice_captain).toBe(true)
  })
})

/**
 * A full, valid 15-player rebuild squad for one gameweek, solution_index 0 — 11 starting
 * (player 1 captain, player 2 vice-captain), 4 bench (players 12-15, bench_order 0-3), ids 1-15.
 * Matches the ticket's own DoD shape exactly: "results-CSV → 15 pick rows (11 starting, 4 bench,
 * exactly one captain and one vice)".
 */
function fullRebuildSquadCsvRows(gameweekId: number): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  for (let id = 1; id <= 11; id++) {
    rows.push(
      rebuildCsvRow({
        id: String(id),
        week: String(gameweekId),
        iter: '0',
        lineup: '1',
        bench: '-1',
        captain: id === 1 ? '1' : '0',
        vicecaptain: id === 2 ? '1' : '0',
      }),
    )
  }
  for (let id = 12; id <= 15; id++) {
    rows.push(
      rebuildCsvRow({
        id: String(id),
        week: String(gameweekId),
        iter: '0',
        lineup: '0',
        bench: String(id - 12),
        captain: '0',
        vicecaptain: '0',
      }),
    )
  }
  return rows
}

describe('buildChipRebuildPickRows', () => {
  it('the DoD shape: results-CSV -> 15 pick rows, 11 starting, 4 bench, exactly one captain and one vice', () => {
    const rows = buildChipRebuildPickRows({
      chipAdvisoryId: 99,
      targetGameweekId: 5,
      csvRows: fullRebuildSquadCsvRows(5),
      codeByPlayerId: new Map(),
    })

    expect(rows).toHaveLength(15)
    expect(rows.every((r) => r.chip_advisory_id === 99)).toBe(true)
    expect(rows.filter((r) => r.is_starting)).toHaveLength(11)
    expect(rows.filter((r) => !r.is_starting)).toHaveLength(4)
    expect(rows.filter((r) => r.is_captain)).toHaveLength(1)
    expect(rows.filter((r) => r.is_vice_captain)).toHaveLength(1)
  })

  it('filters to solution_index 0 and the target gameweek only — other iterations and other horizon gameweeks in the same CSV are ignored, never mixed in', () => {
    const targetRows = fullRebuildSquadCsvRows(5)
    const otherIterRows = fullRebuildSquadCsvRows(5).map((r) => ({ ...r, iter: '1', id: String(Number(r.id) + 100) }))
    const otherGameweekRows = fullRebuildSquadCsvRows(6).map((r) => ({ ...r, id: String(Number(r.id) + 200) }))

    const rows = buildChipRebuildPickRows({
      chipAdvisoryId: 1,
      targetGameweekId: 5,
      csvRows: [...targetRows, ...otherIterRows, ...otherGameweekRows],
      codeByPlayerId: new Map(),
    })

    expect(rows).toHaveLength(15)
    expect(rows.map((r) => r.player_id).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    )
  })

  it('resolves player_code from the caller-provided map, null when a player id is not present in it', () => {
    const rows = buildChipRebuildPickRows({
      chipAdvisoryId: 1,
      targetGameweekId: 5,
      csvRows: fullRebuildSquadCsvRows(5),
      codeByPlayerId: new Map([[1, 5001]]),
    })
    expect(rows.find((r) => r.player_id === 1)?.player_code).toBe(5001)
    expect(rows.find((r) => r.player_id === 2)?.player_code).toBeNull()
  })

  it('throws (ChipRebuildPicksBuildError) when there are not exactly 15 rows for solution_index 0 / the target gameweek', () => {
    const rows = fullRebuildSquadCsvRows(5).slice(0, 14)
    expect(() =>
      buildChipRebuildPickRows({ chipAdvisoryId: 1, targetGameweekId: 5, csvRows: rows, codeByPlayerId: new Map() }),
    ).toThrow(ChipRebuildPicksBuildError)
  })

  it('throws when the starting/bench split is not 11/4', () => {
    const rows = fullRebuildSquadCsvRows(5)
    rows[11] = { ...rows[11], lineup: '1', bench: '-1' } // player 12 (bench) now also flagged starting
    expect(() =>
      buildChipRebuildPickRows({ chipAdvisoryId: 1, targetGameweekId: 5, csvRows: rows, codeByPlayerId: new Map() }),
    ).toThrow(/11 starting and 4 bench/)
  })

  it('throws when there is no captain at all', () => {
    const rows = fullRebuildSquadCsvRows(5).map((r) => ({ ...r, captain: '0' }))
    expect(() =>
      buildChipRebuildPickRows({ chipAdvisoryId: 1, targetGameweekId: 5, csvRows: rows, codeByPlayerId: new Map() }),
    ).toThrow(/one captain and one vice-captain/)
  })

  it('throws when there are two vice-captains', () => {
    const rows = fullRebuildSquadCsvRows(5)
    rows[2] = { ...rows[2], vicecaptain: '1' } // player 3, alongside player 2's own vice flag
    expect(() =>
      buildChipRebuildPickRows({ chipAdvisoryId: 1, targetGameweekId: 5, csvRows: rows, codeByPlayerId: new Map() }),
    ).toThrow(/one captain and one vice-captain/)
  })
})

// ============================================================================
// resolveChipRebuildPicksInsertOutcome — ticket #284's own DoD: "the store
// step still writes the advisory when the picks table is missing." Pure —
// see its own comment in store-squad-advisory.ts for why proving this
// function never throws on a missing-table error is exactly what proves
// that DoD item, with no database involved.
// ============================================================================

describe('resolveChipRebuildPicksInsertOutcome', () => {
  it('reports "stored" with the row count when there is no error', () => {
    expect(resolveChipRebuildPicksInsertOutcome(null, 15)).toEqual({ outcome: 'stored', count: 15 })
  })

  it('reports "skipped", never throws, when the table does not exist yet (PGRST205 — Supabase\'s schema-cache shape) — the advisory already written before this call stands', () => {
    const outcome = resolveChipRebuildPicksInsertOutcome(
      { code: 'PGRST205', message: "Could not find the table 'public.chip_rebuild_picks' in the schema cache" },
      15,
    )
    expect(outcome.outcome).toBe('skipped')
    if (outcome.outcome === 'skipped') {
      expect(outcome.reason).toMatch(/chip_rebuild_picks/)
      expect(outcome.reason).toMatch(/20260926090000_chip_rebuild_picks\.sql/)
    }
  })

  it('reports "skipped", never throws, for the bare-Postgres "relation does not exist" shape too (42P01)', () => {
    const outcome = resolveChipRebuildPicksInsertOutcome(
      { code: '42P01', message: 'relation "public.chip_rebuild_picks" does not exist' },
      15,
    )
    expect(outcome.outcome).toBe('skipped')
  })

  it('throws — never silently skips — for any other error, e.g. a genuine constraint or permission failure', () => {
    expect(() =>
      resolveChipRebuildPicksInsertOutcome({ code: '23505', message: 'duplicate key value violates unique constraint' }, 15),
    ).toThrow(/chip_rebuild_picks insert failed/)
  })
})
