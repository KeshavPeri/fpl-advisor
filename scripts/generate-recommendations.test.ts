// Unit tests for scripts/generate-recommendations.ts's pure functions —
// ticket #47. No Supabase: everything provable without a database is
// proven here. Confidence-band, hit-cost, bench-order and rounding logic
// itself lives in src/lib/recommendation/ and is tested there — this file
// covers only what is specific to this script: which run's picks to use,
// how the current gameweek is derived from them, and which players a plan
// asks the data-coverage check about.

import { describe, expect, it, vi } from 'vitest'
import { deriveTransferSummary } from '../src/lib/recommendation/index.ts'
import {
  buildCoverageRefs,
  deriveCurrentGameweekId,
  filterPicksToRun,
  findLatestRunId,
  GenerateRecommendationsError,
  NUM_ITERATIONS_REQUESTED,
  writeRecommendationsWithStaleCleanup,
} from './generate-recommendations.js'

describe('NUM_ITERATIONS_REQUESTED', () => {
  it('matches the num_iterations this ticket sets in scripts/build-solver-input.ts', () => {
    expect(NUM_ITERATIONS_REQUESTED).toBe(3)
  })
})

describe('findLatestRunId', () => {
  it('returns the highest run_id present', () => {
    expect(findLatestRunId([{ run_id: 5 }, { run_id: 9 }, { run_id: 2 }])).toBe(9)
  })

  it('ignores null run_ids when a real one is present', () => {
    expect(findLatestRunId([{ run_id: null }, { run_id: 3 }])).toBe(3)
  })

  it('returns null when every row has a null run_id', () => {
    expect(findLatestRunId([{ run_id: null }, { run_id: null }])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(findLatestRunId([])).toBeNull()
  })

  it('an older run\'s stale rows (lower run_id) never win over a newer run\'s rows, whatever order they arrive in', () => {
    expect(findLatestRunId([{ run_id: 42 }, { run_id: 1 }, { run_id: 42 }])).toBe(42)
  })
})

describe('deriveCurrentGameweekId', () => {
  it('is the lowest gameweek_id among the rows passed in — "the first week in the solver\'s own output"', () => {
    expect(
      deriveCurrentGameweekId([{ gameweek_id: 3 }, { gameweek_id: 1 }, { gameweek_id: 2 }, { gameweek_id: 5 }]),
    ).toBe(1)
  })

  it('is not "gameweek 1" by assumption — a horizon starting at gameweek 7 derives 7, not 1', () => {
    expect(deriveCurrentGameweekId([{ gameweek_id: 9 }, { gameweek_id: 7 }, { gameweek_id: 8 }])).toBe(7)
  })

  it('works for a single row', () => {
    expect(deriveCurrentGameweekId([{ gameweek_id: 4 }])).toBe(4)
  })
})

describe('buildCoverageRefs', () => {
  const captain = { playerId: 1, playerCode: 100 }
  const viceCaptain = { playerId: 2, playerCode: 200 }
  const transferIn = { playerId: 3, playerCode: 300 }
  const transferOut = { playerId: 4, playerCode: 400 }

  it('includes transfer-in and transfer-out for a real transfer plan, plus captain and vice-captain', () => {
    const refs = buildCoverageRefs({ isRoll: false, transferIn, transferOut, captain, viceCaptain })
    expect(refs.map((r) => r.role).sort()).toEqual(['captain', 'transferIn', 'transferOut', 'viceCaptain'].sort())
  })

  it('excludes transfer-in/out entirely for a roll plan — nothing to check for a transfer that was not made', () => {
    const refs = buildCoverageRefs({ isRoll: true, transferIn: null, transferOut: null, captain, viceCaptain })
    expect(refs.map((r) => r.role).sort()).toEqual(['captain', 'viceCaptain'])
  })

  it('always includes captain and vice-captain, since every plan has one', () => {
    const refs = buildCoverageRefs({ isRoll: true, transferIn: null, transferOut: null, captain, viceCaptain })
    expect(refs.some((r) => r.role === 'captain' && r.playerId === captain.playerId)).toBe(true)
    expect(refs.some((r) => r.role === 'viceCaptain' && r.playerId === viceCaptain.playerId)).toBe(true)
  })
})

describe('GenerateRecommendationsError', () => {
  it('carries its context alongside the message', () => {
    const err = new GenerateRecommendationsError('boom', 'solver_picks')
    expect(err.message).toBe('boom')
    expect(err.context).toBe('solver_picks')
    expect(err.name).toBe('GenerateRecommendationsError')
  })
})

// ============================================================================
// Ticket #60 (found 20 Aug 2026) — solver_picks double-counting guard.
// ============================================================================

describe('filterPicksToRun', () => {
  it('keeps only the rows carrying the given runId', () => {
    const picks = [{ run_id: 1 }, { run_id: 2 }, { run_id: 2 }, { run_id: null }]
    expect(filterPicksToRun(picks, 2)).toEqual([{ run_id: 2 }, { run_id: 2 }])
  })

  it('returns an empty list when no row carries the given runId', () => {
    expect(filterPicksToRun([{ run_id: 1 }, { run_id: 1 }], 9)).toEqual([])
  })

  it("a gameweek with two runs' worth of solver_picks yields the same transfers_made as one run's alone", () => {
    // solver_picks is upserted keyed on (solution_index, gameweek_id, player_id) — see
    // scripts/store-solver-output.ts — so an older run's row for a player no longer part of a
    // newer run's plan is never overwritten and can sit in the table under its old run_id
    // indefinitely. This reproduces exactly that: run 5's stale transfer-in row for player 100
    // coexists with run 9's real transfer-in (player 200) and transfer-out (player 300) rows, all
    // for gameweek 1.
    const allPicks = [
      { run_id: 5, gameweek_id: 1, player_id: 100, is_transfer_in: true, is_transfer_out: false },
      { run_id: 9, gameweek_id: 1, player_id: 200, is_transfer_in: true, is_transfer_out: false },
      { run_id: 9, gameweek_id: 1, player_id: 300, is_transfer_in: false, is_transfer_out: true },
    ]

    const latestRunId = findLatestRunId(allPicks)
    expect(latestRunId).toBe(9)

    const toSummaryInput = (picks: typeof allPicks) =>
      picks.map((p) => ({ playerId: p.player_id, playerCode: null, isTransferIn: p.is_transfer_in, isTransferOut: p.is_transfer_out }))

    const filteredToLatestRun = filterPicksToRun(allPicks, latestRunId!)
    const transfersMadeFromFilteredAllPicks = deriveTransferSummary(toSummaryInput(filteredToLatestRun)).transfersMade

    // The answer building from ONLY run 9's rows directly (as if run 5 had never left a row
    // behind) gives — the ground truth this guard must match.
    const singleRunOnly = allPicks.filter((p) => p.run_id === 9)
    const transfersMadeFromSingleRun = deriveTransferSummary(toSummaryInput(singleRunOnly)).transfersMade

    expect(transfersMadeFromFilteredAllPicks).toBe(transfersMadeFromSingleRun)
    expect(transfersMadeFromFilteredAllPicks).toBe(1) // not 2 — run 5's stale row must never be counted
  })
})

describe('writeRecommendationsWithStaleCleanup', () => {
  it('always upserts before it deletes, even when there is something stale to remove', async () => {
    const calls: string[] = []
    await writeRecommendationsWithStaleCleanup({
      gameweekId: 5,
      previousPlanIndices: [0, 1, 2],
      newPlanIndices: [0],
      upsertNewPlans: async () => {
        calls.push('upsert')
      },
      deleteStalePlans: async () => {
        calls.push('delete')
      },
    })
    expect(calls).toEqual(['upsert', 'delete'])
  })

  it('never calls delete at all when nothing is stale — no bare delete for its own sake', async () => {
    const deleteStalePlans = vi.fn(async () => {})
    await writeRecommendationsWithStaleCleanup({
      gameweekId: 5,
      previousPlanIndices: [0, 1],
      newPlanIndices: [0, 1, 2],
      upsertNewPlans: async () => {},
      deleteStalePlans,
    })
    expect(deleteStalePlans).not.toHaveBeenCalled()
  })

  it('never deletes if the upsert throws — a failed write must never be followed by a delete', async () => {
    const deleteStalePlans = vi.fn(async () => {})
    await expect(
      writeRecommendationsWithStaleCleanup({
        gameweekId: 5,
        previousPlanIndices: [0, 1, 2],
        newPlanIndices: [0],
        upsertNewPlans: async () => {
          throw new Error('upsert failed')
        },
        deleteStalePlans,
      }),
    ).rejects.toThrow('upsert failed')
    expect(deleteStalePlans).not.toHaveBeenCalled()
  })

  it('scopes the delete to exactly this gameweek and only the stale plan_index values — never cross-gameweek, never bare', async () => {
    let receivedSpec: { gameweekId: number; stalePlanIndices: number[] } | null = null
    await writeRecommendationsWithStaleCleanup({
      gameweekId: 7,
      previousPlanIndices: [0, 1, 2],
      newPlanIndices: [0],
      upsertNewPlans: async () => {},
      deleteStalePlans: async (spec) => {
        receivedSpec = spec
      },
    })
    expect(receivedSpec).toEqual({ gameweekId: 7, stalePlanIndices: [1, 2] })
  })

  it('reports which plan_index values it removed', async () => {
    const { stalePlanIndices } = await writeRecommendationsWithStaleCleanup({
      gameweekId: 3,
      previousPlanIndices: [0, 1, 2],
      newPlanIndices: [0, 1],
      upsertNewPlans: async () => {},
      deleteStalePlans: async () => {},
    })
    expect(stalePlanIndices).toEqual([2])
  })

  it('reports no stale plan_index values on a first run for a gameweek (nothing stored previously)', async () => {
    const { stalePlanIndices } = await writeRecommendationsWithStaleCleanup({
      gameweekId: 3,
      previousPlanIndices: [],
      newPlanIndices: [0, 1, 2],
      upsertNewPlans: async () => {},
      deleteStalePlans: async () => {},
    })
    expect(stalePlanIndices).toEqual([])
  })
})
