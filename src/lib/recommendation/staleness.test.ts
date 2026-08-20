import { describe, expect, it } from 'vitest'
import { computeStalePlanIndices } from './staleness.ts'

describe('computeStalePlanIndices', () => {
  it('three-then-one: a previous run stored plan_index 0/1/2, this run only produces 0 — 1 and 2 are stale', () => {
    expect(computeStalePlanIndices([0, 1, 2], [0])).toEqual([1, 2])
  })

  it('no stale rows when the new set covers everything the previous run stored', () => {
    expect(computeStalePlanIndices([0, 1], [0, 1, 2])).toEqual([])
  })

  it('no stale rows on the very first run (nothing stored previously)', () => {
    expect(computeStalePlanIndices([], [0, 1, 2])).toEqual([])
  })

  it('every previous row is stale when this run produces nothing (should not happen in practice, but does not throw)', () => {
    expect(computeStalePlanIndices([0, 1, 2], [])).toEqual([0, 1, 2])
  })

  it('returns indices sorted ascending regardless of input order', () => {
    expect(computeStalePlanIndices([2, 0, 1], [1])).toEqual([0, 2])
  })
})
