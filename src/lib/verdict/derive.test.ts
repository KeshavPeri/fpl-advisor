import { describe, expect, it } from 'vitest'
import { deriveVerdictView } from './derive.ts'
import type { VerdictRecommendationData } from './types.ts'

const PLAYER_NAMES = new Map<number, string>([
  [1, 'Haaland'],
  [2, 'Isak'],
  [3, 'Salah'],
  [4, 'Saliba'],
])

function baseData(overrides: Partial<VerdictRecommendationData> = {}): VerdictRecommendationData {
  return {
    gameweekId: 5,
    gameweekName: 'Gameweek 5',
    isRoll: false,
    transferInPlayerId: 1,
    transferOutPlayerId: 2,
    captainPlayerId: 3,
    viceCaptainPlayerId: 4,
    hitCost: 0,
    grossPointsRounded: 58,
    netPointsRounded: 58,
    confidenceBand: 'clear',
    coverage: [],
    reasons: ['Transfer in Haaland. Transfer out Isak.', 'Captain Salah. Vice-captain Saliba.'],
    playerNames: PLAYER_NAMES,
    ...overrides,
  }
}

describe('deriveVerdictView', () => {
  it('uses the stored order_index-0 reason line as the headline, verbatim', () => {
    const view = deriveVerdictView(baseData(), 5)
    expect(view.headline).toBe('Transfer in Haaland. Transfer out Isak.')
  })

  it('falls back to a roll-shaped headline if reasons is somehow empty (defensive)', () => {
    const view = deriveVerdictView(baseData({ isRoll: true, reasons: [] }), 5)
    expect(view.headline).toBe('Roll your transfer.')
  })

  it('builds the captain/vice-captain line from resolved player names', () => {
    const view = deriveVerdictView(baseData(), 5)
    expect(view.captainLine).toBe('Captain Salah. Vice-captain Saliba.')
  })

  it('is not stale when the recommendation gameweek matches the current one', () => {
    const view = deriveVerdictView(baseData({ gameweekId: 5 }), 5)
    expect(view.isStale).toBe(false)
    expect(view.staleGameweekName).toBeNull()
    expect(view.staleGameweeksOld).toBeNull()
  })

  it('marks the recommendation stale, with its age, when its gameweek is older than current', () => {
    const view = deriveVerdictView(baseData({ gameweekId: 3, gameweekName: 'Gameweek 3' }), 6)
    expect(view.isStale).toBe(true)
    expect(view.staleGameweekName).toBe('Gameweek 3')
    expect(view.staleGameweeksOld).toBe(3)
  })

  it('carries no hit-cost figures when hit_cost is zero', () => {
    const view = deriveVerdictView(baseData({ hitCost: 0 }), 5)
    expect(view.hit).toBeNull()
  })

  it('exposes cost, gross and net as separate whole numbers when hit_cost is greater than zero', () => {
    const view = deriveVerdictView(
      baseData({ hitCost: 4, grossPointsRounded: 62, netPointsRounded: 58 }),
      5
    )
    expect(view.hit).toEqual({ cost: 4, gross: 62, net: 58 })
  })

  it('shows the confidence band as one of the three literal words, never a number', () => {
    expect(deriveVerdictView(baseData({ confidenceBand: 'clear' }), 5).confidenceWord).toBe(
      'clear'
    )
    expect(deriveVerdictView(baseData({ confidenceBand: 'marginal' }), 5).confidenceWord).toBe(
      'marginal'
    )
    expect(deriveVerdictView(baseData({ confidenceBand: 'coin-flip' }), 5).confidenceWord).toBe(
      'coin-flip'
    )
  })

  it('states in words when the top options are too close to separate, only for coin-flip', () => {
    expect(deriveVerdictView(baseData({ confidenceBand: 'coin-flip' }), 5).coinFlipNote).toBe(
      'The top options are too close to separate.'
    )
    expect(deriveVerdictView(baseData({ confidenceBand: 'clear' }), 5).coinFlipNote).toBeNull()
    expect(deriveVerdictView(baseData({ confidenceBand: 'marginal' }), 5).coinFlipNote).toBeNull()
  })

  it('flags a player with no match history in words, from the coverage column', () => {
    const view = deriveVerdictView(
      baseData({
        coverage: [
          { role: 'transferIn', playerId: 1, hasHistory: false },
          { role: 'captain', playerId: 3, hasHistory: true },
        ],
      }),
      5
    )
    expect(view.coverageNote).toBe(
      'Haaland has no Premier League history yet — this rests on an early-season estimate.'
    )
  })

  it('pluralises the coverage note for more than one flagged player, without duplicates', () => {
    const view = deriveVerdictView(
      baseData({
        coverage: [
          { role: 'transferIn', playerId: 1, hasHistory: false },
          { role: 'captain', playerId: 3, hasHistory: false },
          { role: 'viceCaptain', playerId: 4, hasHistory: true },
        ],
      }),
      5
    )
    expect(view.coverageNote).toBe(
      'Haaland and Salah have no Premier League history yet — this rests on an early-season estimate.'
    )
  })

  it('has no coverage note when every referenced player has history', () => {
    const view = deriveVerdictView(
      baseData({
        coverage: [
          { role: 'captain', playerId: 3, hasHistory: true },
          { role: 'viceCaptain', playerId: 4, hasHistory: true },
        ],
      }),
      5
    )
    expect(view.coverageNote).toBeNull()
  })

  it('never renders a decimal point anywhere in its numeric output', () => {
    const view = deriveVerdictView(
      baseData({ hitCost: 4, grossPointsRounded: 62, netPointsRounded: 58 }),
      5
    )
    const numericStrings = [
      String(view.netPoints),
      ...(view.hit ? [String(view.hit.cost), String(view.hit.gross), String(view.hit.net)] : []),
      ...(view.staleGameweeksOld !== null ? [String(view.staleGameweeksOld)] : []),
    ]
    for (const value of numericStrings) {
      expect(value).not.toContain('.')
    }
    expect(Number.isInteger(view.netPoints)).toBe(true)
  })

  it('uses the stored roll reason verbatim as the headline for a rolled transfer', () => {
    const view = deriveVerdictView(
      baseData({
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        reasons: ['Roll your transfer. No changes recommended this gameweek.'],
      }),
      5
    )
    expect(view.headline).toBe('Roll your transfer. No changes recommended this gameweek.')
  })
})
