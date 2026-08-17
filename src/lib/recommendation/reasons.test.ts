import { describe, expect, it } from 'vitest'
import { buildReasonLines, type ReasonInputs } from './reasons.ts'

function inputs(overrides: Partial<ReasonInputs> = {}): ReasonInputs {
  return {
    isRoll: false,
    transferInName: 'Player In',
    transferOutName: 'Player Out',
    captainName: 'Captain Name',
    viceCaptainName: 'Vice Name',
    hitCost: 0,
    transfersMade: 1,
    freeTransfersAvailable: 1,
    grossPointsRounded: 40,
    netPointsRounded: 40,
    confidenceBand: 'clear',
    coverageGaps: [],
    ...overrides,
  }
}

describe('buildReasonLines', () => {
  it('a roll plan reads as a confident answer, not an absence — no "null" or empty-sounding text', () => {
    const lines = buildReasonLines(inputs({ isRoll: true, transferInName: null, transferOutName: null }))
    expect(lines[0]).toBe('Roll your transfer. No changes recommended this gameweek.')
    expect(lines[0]).not.toMatch(/null|undefined/i)
  })

  it('a transfer plan names both players', () => {
    const lines = buildReasonLines(inputs({ isRoll: false, transferInName: 'Haaland', transferOutName: 'Watkins' }))
    expect(lines[0]).toBe('Transfer in Haaland. Transfer out Watkins.')
  })

  it('always states captain and vice-captain', () => {
    const lines = buildReasonLines(inputs({ captainName: 'Salah', viceCaptainName: 'Palmer' }))
    expect(lines).toContain('Captain Salah. Vice-captain Palmer.')
  })

  it('states hit cost, transfer counts and both gross/net figures only when a hit is made', () => {
    const withHit = buildReasonLines(inputs({ hitCost: 4, transfersMade: 2, freeTransfersAvailable: 1, grossPointsRounded: 20, netPointsRounded: 16 }))
    expect(withHit.some((l) => l.includes('4-point hit'))).toBe(true)
    expect(withHit.some((l) => l.includes('20 points before the hit, 16 after'))).toBe(true)

    const withoutHit = buildReasonLines(inputs({ hitCost: 0 }))
    expect(withoutHit.some((l) => l.includes('hit'))).toBe(false)
  })

  it('states plainly, not as a preference, when the confidence band is coin-flip', () => {
    const lines = buildReasonLines(inputs({ confidenceBand: 'coin-flip' }))
    expect(lines.some((l) => l.includes('statistically close'))).toBe(true)
  })

  it('reports a coverage gap per named player, with no history stated in words', () => {
    const lines = buildReasonLines(
      inputs({ coverageGaps: [{ role: 'transferIn', name: 'New Signing' }] }),
    )
    expect(lines.some((l) => l.startsWith('New Signing has no Premier League match history'))).toBe(true)
  })

  it('never uses filler like "something went wrong" or vague apology language', () => {
    const lines = buildReasonLines(inputs())
    const joined = lines.join(' ').toLowerCase()
    expect(joined).not.toMatch(/sorry|something went wrong|oops/)
  })
})
