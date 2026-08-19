import { describe, expect, it } from 'vitest'
import { SCORE_TOLERANCE, assignContiguousPlanIndices, collapseSameDecisionPlans, isSameDecision, type PlanDecisionKey } from './distinctness.ts'

function key(overrides: Partial<PlanDecisionKey> = {}): PlanDecisionKey {
  return {
    isRoll: false,
    transferInPlayerId: 100,
    captainPlayerId: 200,
    score: 50,
    ...overrides,
  }
}

describe('isSameDecision', () => {
  it('same incoming player + same captain + equal scores -> same decision', () => {
    const a = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    const b = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    expect(isSameDecision(a, b)).toBe(true)
  })

  it('same incoming player but a different captain -> different decisions', () => {
    const a = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    const b = key({ transferInPlayerId: 100, captainPlayerId: 999, score: 50 })
    expect(isSameDecision(a, b)).toBe(false)
  })

  it('a different incoming player -> different decisions, even with the same captain and score', () => {
    const a = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    const b = key({ transferInPlayerId: 101, captainPlayerId: 200, score: 50 })
    expect(isSameDecision(a, b)).toBe(false)
  })

  it('both plans rolling the transfer, with the same captain -> same decision, regardless of transferInPlayerId being null on both', () => {
    const a = key({ isRoll: true, transferInPlayerId: null, captainPlayerId: 200, score: 50 })
    const b = key({ isRoll: true, transferInPlayerId: null, captainPlayerId: 200, score: 50.2 })
    expect(isSameDecision(a, b)).toBe(true)
  })

  it('a roll plan is never the same decision as a transfer plan, even with the same captain and score', () => {
    const roll = key({ isRoll: true, transferInPlayerId: null, captainPlayerId: 200, score: 50 })
    const transfer = key({ isRoll: false, transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    expect(isSameDecision(roll, transfer)).toBe(false)
  })

  it('the outgoing player is not part of the comparison — this function has no transferOut parameter at all, so two plans differing only in who is sold are the same decision', () => {
    // isSameDecision's PlanDecisionKey has no transferOutPlayerId field — the type system itself
    // makes it impossible to pass the outgoing player in. Two plans built from picks that differ
    // only in the benched/sold player collapse to identical PlanDecisionKey values.
    const soldPlayerA = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    const soldPlayerB = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    expect(isSameDecision(soldPlayerA, soldPlayerB)).toBe(true)
  })

  it('scores within the tolerance are the same decision; scores outside it are not', () => {
    const base = key({ score: 50 })
    expect(isSameDecision(base, key({ score: 50 + SCORE_TOLERANCE }))).toBe(true)
    expect(isSameDecision(base, key({ score: 50 - SCORE_TOLERANCE }))).toBe(true)
    expect(isSameDecision(base, key({ score: 50 + SCORE_TOLERANCE + 0.01 }))).toBe(false)
  })

  it('accepts an explicit tolerance override', () => {
    const a = key({ score: 50 })
    const b = key({ score: 52 })
    expect(isSameDecision(a, b, 1)).toBe(false)
    expect(isSameDecision(a, b, 5)).toBe(true)
  })
})

describe('collapseSameDecisionPlans', () => {
  it('keeps every plan when all three are distinct decisions', () => {
    const plans = [
      key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 }),
      key({ transferInPlayerId: 101, captainPlayerId: 200, score: 48 }),
      key({ transferInPlayerId: 102, captainPlayerId: 200, score: 46 }),
    ]
    const result = collapseSameDecisionPlans(plans)
    expect(result.survivors).toHaveLength(3)
    expect(result.collapsedCount).toBe(0)
  })

  it('collapses two same-decision plans, keeping the higher-scoring one (the input is score-descending, so it is seen first)', () => {
    const best = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 })
    const duplicate = key({ transferInPlayerId: 100, captainPlayerId: 200, score: 49.9 })
    const distinct = key({ transferInPlayerId: 101, captainPlayerId: 200, score: 40 })
    const result = collapseSameDecisionPlans([best, duplicate, distinct])
    expect(result.survivors).toEqual([best, distinct])
    expect(result.collapsedCount).toBe(1)
  })

  it('three plans that are all the same decision collapse to a single survivor', () => {
    const plans = [
      key({ transferInPlayerId: 100, captainPlayerId: 200, score: 50 }),
      key({ transferInPlayerId: 100, captainPlayerId: 200, score: 49.8 }),
      key({ transferInPlayerId: 100, captainPlayerId: 200, score: 49.6 }),
    ]
    const result = collapseSameDecisionPlans(plans)
    expect(result.survivors).toHaveLength(1)
    expect(result.survivors[0].score).toBe(50)
    expect(result.collapsedCount).toBe(2)
  })

  it('an empty input collapses to an empty result without throwing', () => {
    expect(collapseSameDecisionPlans([])).toEqual({ survivors: [], collapsedCount: 0 })
  })

  it('a single plan is its own survivor, nothing collapsed', () => {
    const only = key()
    expect(collapseSameDecisionPlans([only])).toEqual({ survivors: [only], collapsedCount: 0 })
  })
})

describe('assignContiguousPlanIndices', () => {
  it('re-assigns plan_index contiguously from 0 over whatever survives a collapse — never a gap like {0, 2}', () => {
    // Simulates the real pipeline: raw solutions carried planIndex/solutionIndex 0, 1, 2 from
    // rankSolutions; the middle one (1) got collapsed away as the same decision as 0, leaving
    // survivors with their OLD indices 0 and 2 still attached.
    const survivors = [
      { planIndex: 0, solutionIndex: 0, score: 50 },
      { planIndex: 2, solutionIndex: 2, score: 40 },
    ]
    const reassigned = assignContiguousPlanIndices(survivors)
    expect(reassigned.map((p) => p.planIndex)).toEqual([0, 1])
    // The solver's own solutionIndex is untouched — only the FINAL storage plan_index changes.
    expect(reassigned.map((p) => p.solutionIndex)).toEqual([0, 2])
  })

  it('a single survivor is re-assigned plan_index 0, whatever its original index was', () => {
    const reassigned = assignContiguousPlanIndices([{ planIndex: 2, score: 50 }])
    expect(reassigned).toEqual([{ planIndex: 0, score: 50 }])
  })

  it('three surviving plans (no collapse) keep the stored set {0, 1, 2}', () => {
    const survivors = [{ planIndex: 0 }, { planIndex: 1 }, { planIndex: 2 }]
    expect(assignContiguousPlanIndices(survivors).map((p) => p.planIndex)).toEqual([0, 1, 2])
  })

  it('an empty list re-assigns to an empty list', () => {
    expect(assignContiguousPlanIndices([])).toEqual([])
  })
})
