import { describe, expect, it } from 'vitest'
import { roundSolverCount } from './rounding.ts'

describe('roundSolverCount', () => {
  it('rounds 0.9999999999999996 (the solver\'s own one-transfer noise) to 1, never leaving it a non-integer', () => {
    expect(roundSolverCount(0.9999999999999996)).toBe(1)
  })

  it('rounds 1.0000000000000044 (the solver\'s own noisy-above value) to 1', () => {
    expect(roundSolverCount(1.0000000000000044)).toBe(1)
  })

  it('leaves an exact integer unchanged', () => {
    expect(roundSolverCount(2)).toBe(2)
    expect(roundSolverCount(0)).toBe(0)
  })

  it('the raw noisy value never equals 1 by strict equality, but the rounded value does — the guard this module exists for', () => {
    const raw: number = 0.9999999999999996
    const rounded = roundSolverCount(raw)
    expect(raw === 1).toBe(false)
    expect(rounded === 1).toBe(true)
  })
})
