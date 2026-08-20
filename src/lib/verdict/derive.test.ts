import { describe, expect, it } from 'vitest'
import { deriveVerdictView } from './derive.ts'
import type { GameweekPick, VerdictRecommendationData } from './types.ts'

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
    // Most tests don't care about this gameweek's projected-points figure —
    // null (the "unavailable" input, ticket #68) is the safe default so
    // every unrelated test isn't forced to invent a starting XI just to
    // satisfy the type. Tests that DO care override it explicitly below.
    gameweekPicks: null,
    ...overrides,
  }
}

/** Eleven starting-XI rows, one flagged captain, all identical value —
 *  a minimal realistic lineup fixture for the gameweek-points tests below. */
function elevenLineupPicks(captainExpectedPoints: number, othersExpectedPoints: number): GameweekPick[] {
  return [
    { expectedPoints: captainExpectedPoints, isCaptain: true, isLineup: true },
    ...Array.from({ length: 10 }, () => ({
      expectedPoints: othersExpectedPoints,
      isCaptain: false,
      isLineup: true,
    })),
  ]
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

  it('builds the captain/vice-captain line from resolved player names, adding a full stop when the name has none', () => {
    const view = deriveVerdictView(baseData(), 5)
    expect(view.captainLine).toBe('Captain Salah. Vice-captain Saliba.')
  })

  it('does not double the full stop on a name that already ends in one ("Bruno G.")', () => {
    const names = new Map<number, string>([
      [3, 'Guéhi'],
      [4, 'Bruno G.'],
    ])
    const view = deriveVerdictView(baseData({ playerNames: names }), 5)
    expect(view.captainLine).toBe('Captain Guéhi. Vice-captain Bruno G.')
  })

  it('does not strip a full stop from the middle of a name', () => {
    const names = new Map<number, string>([
      [3, 'A.Test'],
      [4, 'Saliba'],
    ])
    const view = deriveVerdictView(baseData({ playerNames: names }), 5)
    expect(view.captainLine).toBe('Captain A.Test. Vice-captain Saliba.')
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
      baseData({
        hitCost: 4,
        grossPointsRounded: 62,
        netPointsRounded: 58,
        gameweekPicks: elevenLineupPicks(4.6, 3.3),
      }),
      5
    )
    const numericStrings = [
      ...(view.gameweekPoints !== null ? [String(view.gameweekPoints)] : []),
      ...(view.hit ? [String(view.hit.cost), String(view.hit.gross), String(view.hit.net)] : []),
      ...(view.staleGameweeksOld !== null ? [String(view.staleGameweeksOld)] : []),
    ]
    for (const value of numericStrings) {
      expect(value).not.toContain('.')
    }
    expect(view.gameweekPoints).not.toBeNull()
    expect(Number.isInteger(view.gameweekPoints)).toBe(true)
  })

  it('carries no hit basis label when there is no hit', () => {
    const view = deriveVerdictView(baseData({ hitCost: 0 }), 5)
    expect(view.hitBasisLabel).toBeNull()
  })

  it('states the hit figures are a multi-gameweek total, distinct from the gameweek figure, when a hit is recommended', () => {
    const view = deriveVerdictView(
      baseData({ hitCost: 4, grossPointsRounded: 62, netPointsRounded: 58 }),
      5
    )
    expect(view.hitBasisLabel).toBe('Across the full transfer plan')
  })

  describe('this gameweek\'s projected points (ticket #68)', () => {
    it("doubles the captain's contribution — a lineup where the captain projects 5 scores 5 higher than the same lineup with no captain flagged", () => {
      const withoutCaptain: GameweekPick[] = [
        { expectedPoints: 5, isCaptain: false, isLineup: true },
        ...Array.from({ length: 10 }, () => ({
          expectedPoints: 3,
          isCaptain: false,
          isLineup: true,
        })),
      ]
      const withCaptain: GameweekPick[] = [
        { expectedPoints: 5, isCaptain: true, isLineup: true },
        ...Array.from({ length: 10 }, () => ({
          expectedPoints: 3,
          isCaptain: false,
          isLineup: true,
        })),
      ]

      const viewWithout = deriveVerdictView(baseData({ gameweekPicks: withoutCaptain }), 5)
      const viewWith = deriveVerdictView(baseData({ gameweekPicks: withCaptain }), 5)

      expect(viewWithout.gameweekPoints).toBe(35)
      expect(viewWith.gameweekPoints).toBe(40)
      expect(viewWith.gameweekPoints).toBe((viewWithout.gameweekPoints ?? 0) + 5)
    })

    it('excludes bench rows — a fifteen-row set (eleven lineup, four bench) is unaffected by the four bench rows', () => {
      const lineup: GameweekPick[] = Array.from({ length: 11 }, () => ({
        expectedPoints: 4,
        isCaptain: false,
        isLineup: true,
      }))
      const bench: GameweekPick[] = Array.from({ length: 4 }, () => ({
        expectedPoints: 100,
        isCaptain: false,
        isLineup: false,
      }))

      const view = deriveVerdictView(baseData({ gameweekPicks: [...lineup, ...bench] }), 5)

      expect(view.gameweekPoints).toBe(44)
    })

    it('rounds a fractional total to the nearest whole number', () => {
      // captain: 4.6 * 2 = 9.2; ten others: 3.3 * 10 = 33; raw total 42.2.
      const view = deriveVerdictView(
        baseData({ gameweekPicks: elevenLineupPicks(4.6, 3.3) }),
        5
      )
      expect(view.gameweekPoints).toBe(42)
    })

    it("labels the figure with the recommendation's own gameweek name", () => {
      const view = deriveVerdictView(baseData({ gameweekName: 'Gameweek 7' }), 5)
      expect(view.gameweekPointsLabel).toBe('Gameweek 7 projected points')
    })

    it('falls back to an unavailable figure, without blanking the rest of the card, when solver_picks rows are missing', () => {
      const view = deriveVerdictView(baseData({ gameweekPicks: null }), 5)

      expect(view.gameweekPoints).toBeNull()
      expect(view.headline).toBe('Transfer in Haaland. Transfer out Isak.')
      expect(view.captainLine).toBe('Captain Salah. Vice-captain Saliba.')
      expect(view.confidenceWord).toBe('clear')
    })

    it('falls back to an unavailable figure when solver_picks rows exist but none are lineup rows', () => {
      const view = deriveVerdictView(
        baseData({
          gameweekPicks: [{ expectedPoints: 10, isCaptain: false, isLineup: false }],
        }),
        5
      )
      expect(view.gameweekPoints).toBeNull()
    })

    it("derives a stale recommendation's figure from ITS OWN gameweek's picks, not the current gameweek", () => {
      const view = deriveVerdictView(
        baseData({
          gameweekId: 3,
          gameweekName: 'Gameweek 3',
          gameweekPicks: elevenLineupPicks(6, 2),
        }),
        6
      )

      expect(view.isStale).toBe(true)
      expect(view.gameweekPoints).toBe(32) // 6*2 + 10*2
      expect(view.gameweekPointsLabel).toBe('Gameweek 3 projected points')
    })
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
