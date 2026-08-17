import { describe, expect, it } from 'vitest'
import { detectIterationShortfall, rankSolutions } from './ranking.ts'

describe('rankSolutions', () => {
  it('ranks the highest score as planIndex 0 ("Plan A")', () => {
    const ranked = rankSolutions(
      new Map([
        [0, 40],
        [1, 45],
        [2, 38],
      ]),
    )
    expect(ranked[0]).toEqual({ solutionIndex: 1, score: 45, planIndex: 0 })
    expect(ranked[1]).toEqual({ solutionIndex: 0, score: 40, planIndex: 1 })
    expect(ranked[2]).toEqual({ solutionIndex: 2, score: 38, planIndex: 2 })
  })

  it('breaks a tie on the solver\'s own solutionIndex ascending, for a deterministic order', () => {
    const ranked = rankSolutions(
      new Map([
        [2, 40],
        [0, 40],
        [1, 40],
      ]),
    )
    expect(ranked.map((r) => r.solutionIndex)).toEqual([0, 1, 2])
  })

  it('handles a single solution (no alternatives found)', () => {
    const ranked = rankSolutions(new Map([[0, 40]]))
    expect(ranked).toEqual([{ solutionIndex: 0, score: 40, planIndex: 0 }])
  })

  it('handles zero solutions without throwing', () => {
    expect(rankSolutions(new Map())).toEqual([])
  })
})

describe('detectIterationShortfall', () => {
  it('is not a shortfall when found meets requested', () => {
    expect(detectIterationShortfall(3, 3).isShortfall).toBe(false)
  })

  it('is a shortfall when fewer distinct solutions came back than requested — not an error, just a fact to record', () => {
    const shortfall = detectIterationShortfall(3, 1)
    expect(shortfall.isShortfall).toBe(true)
    expect(shortfall.requested).toBe(3)
    expect(shortfall.found).toBe(1)
  })
})
