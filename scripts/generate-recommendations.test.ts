// Unit tests for scripts/generate-recommendations.ts's pure functions —
// ticket #47. No Supabase: everything provable without a database is
// proven here. Confidence-band, hit-cost, bench-order and rounding logic
// itself lives in src/lib/recommendation/ and is tested there — this file
// covers only what is specific to this script: which run's picks to use,
// how the current gameweek is derived from them, and which players a plan
// asks the data-coverage check about.

import { describe, expect, it } from 'vitest'
import { buildCoverageRefs, deriveCurrentGameweekId, findLatestRunId, GenerateRecommendationsError, NUM_ITERATIONS_REQUESTED } from './generate-recommendations.js'

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
