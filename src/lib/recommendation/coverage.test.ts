import { describe, expect, it } from 'vitest'
import { checkCoverage, hasAnyCoverageGap, type CoveragePlayerRef } from './coverage.ts'

describe('checkCoverage', () => {
  it('flags hasHistory true for a player code present in the history set', () => {
    const refs: CoveragePlayerRef[] = [{ role: 'transferIn', playerId: 1, playerCode: 100 }]
    const results = checkCoverage(refs, new Set([100, 200]))
    expect(results[0].hasHistory).toBe(true)
  })

  it('flags hasHistory false for a player code absent from the history set — the 45%-of-the-list-at-GW1 case', () => {
    const refs: CoveragePlayerRef[] = [{ role: 'transferIn', playerId: 1, playerCode: 999 }]
    const results = checkCoverage(refs, new Set([100, 200]))
    expect(results[0].hasHistory).toBe(false)
  })

  it('treats a null playerCode as no history — the honest default, never assumed present', () => {
    const refs: CoveragePlayerRef[] = [{ role: 'captain', playerId: 1, playerCode: null }]
    const results = checkCoverage(refs, new Set([100]))
    expect(results[0].hasHistory).toBe(false)
  })
})

describe('hasAnyCoverageGap', () => {
  it('is false when every checked player has history', () => {
    expect(hasAnyCoverageGap([{ role: 'transferIn', playerId: 1, hasHistory: true }])).toBe(false)
  })

  it('is true when at least one checked player has no history', () => {
    expect(
      hasAnyCoverageGap([
        { role: 'transferIn', playerId: 1, hasHistory: true },
        { role: 'captain', playerId: 2, hasHistory: false },
      ]),
    ).toBe(true)
  })

  it('is false for an empty list (a roll plan with no transfer-in to check)', () => {
    expect(hasAnyCoverageGap([])).toBe(false)
  })
})
