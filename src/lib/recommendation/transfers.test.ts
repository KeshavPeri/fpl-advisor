import { describe, expect, it } from 'vitest'
import { deriveTransferSummary, type TransferPickInput } from './transfers.ts'

function pick(overrides: Partial<TransferPickInput> = {}): TransferPickInput {
  return { playerId: 1, playerCode: 100, isTransferIn: false, isTransferOut: false, ...overrides }
}

describe('deriveTransferSummary', () => {
  it('a plan with no transfer flags is an explicit roll — isRoll true, not a null or empty result', () => {
    const picks = [pick({ playerId: 1 }), pick({ playerId: 2 }), pick({ playerId: 3 })]
    const summary = deriveTransferSummary(picks)
    expect(summary.isRoll).toBe(true)
    expect(summary.transferIn).toBeNull()
    expect(summary.transferOut).toBeNull()
    expect(summary.transfersMade).toBe(0)
  })

  it('one transfer: identifies the player in and the player out, and is not a roll', () => {
    const picks = [
      pick({ playerId: 1 }),
      pick({ playerId: 2, isTransferIn: true }),
      pick({ playerId: 3, isTransferOut: true }),
    ]
    const summary = deriveTransferSummary(picks)
    expect(summary.isRoll).toBe(false)
    expect(summary.transferIn?.playerId).toBe(2)
    expect(summary.transferOut?.playerId).toBe(3)
    expect(summary.transfersMade).toBe(1)
  })

  it('counts transfersMade as the greater of the in-count and out-count', () => {
    const picks = [
      pick({ playerId: 1, isTransferIn: true }),
      pick({ playerId: 2, isTransferIn: true }),
      pick({ playerId: 3, isTransferOut: true }),
    ]
    expect(deriveTransferSummary(picks).transfersMade).toBe(2)
  })
})
