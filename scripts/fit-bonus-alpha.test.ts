// Unit tests for scripts/fit-bonus-alpha.ts — ticket #253.
//
// This job's whole purpose is fetching public CSVs over the network and running a large offline
// reconstruction — not something a unit test suite should do (no network access in CI, and the
// point of this file's own DoD is that the fit is deterministic and reproducible from the same
// inputs, not that a test re-fetches the internet on every run). The pieces that are pure and
// meaningful to test in isolation — the fit/holdout range split and its own non-overlap guarantee —
// are exercised directly here, exactly like every other scripts/*.ts test file in this repo.

import { describe, expect, it } from 'vitest'
import { assertNoRangeOverlap, FIT_RANGE, gameweeksInRange, HOLDOUT_RANGE, type GameweekRange } from './fit-bonus-alpha.ts'

describe('FIT_RANGE / HOLDOUT_RANGE — ticket #253 DoD: "fit/holdout split never overlaps"', () => {
  it('the actual FIT_RANGE and HOLDOUT_RANGE constants this script uses do not overlap', () => {
    expect(() => assertNoRangeOverlap(FIT_RANGE, HOLDOUT_RANGE)).not.toThrow()
  })

  it('FIT_RANGE is gameweeks 1-28 and HOLDOUT_RANGE is gameweeks 29-38, per the ticket text verbatim', () => {
    expect(FIT_RANGE).toEqual({ start: 1, end: 28 })
    expect(HOLDOUT_RANGE).toEqual({ start: 29, end: 38 })
  })
})

describe('assertNoRangeOverlap', () => {
  it('does not throw for two disjoint ranges, fit range before holdout range', () => {
    expect(() => assertNoRangeOverlap({ start: 1, end: 28 }, { start: 29, end: 38 })).not.toThrow()
  })

  it('does not throw for two disjoint ranges, holdout range before fit range (order-independent)', () => {
    expect(() => assertNoRangeOverlap({ start: 29, end: 38 }, { start: 1, end: 28 })).not.toThrow()
  })

  it('throws when the ranges share exactly one gameweek at the boundary', () => {
    const a: GameweekRange = { start: 1, end: 28 }
    const b: GameweekRange = { start: 28, end: 38 }
    expect(() => assertNoRangeOverlap(a, b)).toThrow(/overlap/)
  })

  it('throws when one range is fully contained inside the other', () => {
    const a: GameweekRange = { start: 1, end: 38 }
    const b: GameweekRange = { start: 10, end: 20 }
    expect(() => assertNoRangeOverlap(a, b)).toThrow(/overlap/)
  })

  it('throws when the ranges partially overlap in the middle', () => {
    const a: GameweekRange = { start: 1, end: 20 }
    const b: GameweekRange = { start: 15, end: 30 }
    expect(() => assertNoRangeOverlap(a, b)).toThrow(/overlap/)
  })

  it('does not throw for two single-gameweek ranges on different gameweeks', () => {
    expect(() => assertNoRangeOverlap({ start: 5, end: 5 }, { start: 6, end: 6 })).not.toThrow()
  })

  it('throws for two identical single-gameweek ranges', () => {
    expect(() => assertNoRangeOverlap({ start: 5, end: 5 }, { start: 5, end: 5 })).toThrow(/overlap/)
  })
})

describe('gameweeksInRange', () => {
  it('lists every integer gameweek from start to end inclusive', () => {
    expect(gameweeksInRange({ start: 1, end: 5 })).toEqual([1, 2, 3, 4, 5])
  })

  it('a single-gameweek range lists exactly that one gameweek', () => {
    expect(gameweeksInRange({ start: 7, end: 7 })).toEqual([7])
  })

  it('FIT_RANGE and HOLDOUT_RANGE together cover every gameweek 1-38 with no gap and no duplicate', () => {
    const combined = [...gameweeksInRange(FIT_RANGE), ...gameweeksInRange(HOLDOUT_RANGE)]
    expect(combined).toEqual(Array.from({ length: 38 }, (_, i) => i + 1))
  })
})
