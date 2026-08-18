import { describe, expect, it } from 'vitest'
import { composeSolverCaveat, isProvenOptimal } from './solverStatus.ts'

describe('isProvenOptimal', () => {
  it('is true for exactly "Optimal"', () => {
    expect(isProvenOptimal('Optimal')).toBe(true)
  })

  it('is false for a timed-out-but-usable status — never claimed proven', () => {
    expect(isProvenOptimal('Time limit reached')).toBe(false)
  })

  it('is false for an infeasible status', () => {
    expect(isProvenOptimal('Infeasible')).toBe(false)
  })

  it('is false when the status is unknown (null) — never guessed true', () => {
    expect(isProvenOptimal(null)).toBe(false)
  })

  it('is case-sensitive — "optimal" (lowercase) is not the same as HiGHS\'s own "Optimal"', () => {
    expect(isProvenOptimal('optimal')).toBe(false)
  })
})

describe('composeSolverCaveat', () => {
  it('states the raw status verbatim and that the plan is usable but not guaranteed best', () => {
    expect(composeSolverCaveat('Time limit reached')).toBe(
      'This plan comes from a solve that did not reach a proven optimum (status: Time limit reached). It is usable, but not guaranteed best.',
    )
  })

  it('contains no emoji', () => {
    expect(composeSolverCaveat('Time limit reached')).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})
