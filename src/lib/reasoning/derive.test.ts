import { describe, expect, it } from 'vitest'
import { deriveCaptainConfidenceBand, deriveReasoningView, formatComponentLabel } from './derive.ts'
import type {
  PlayerProjectionData,
  ReasoningRecommendationData,
  StartingXIPick,
} from './types.ts'

const PLAYER_NAMES = new Map<number, string>([
  [1, 'Haaland'],
  [2, 'Isak'],
  [3, 'Salah'],
  [4, 'Saliba'],
])

function projection(overrides: Partial<PlayerProjectionData> = {}): PlayerProjectionData {
  return {
    playerId: 3,
    points: {
      appearancePoints: 2,
      goalPoints: 1.91,
      assistPoints: 1.24,
      cleanSheetPoints: 0.34,
      goalsConcededPoints: -0.1,
      savePoints: 0,
      defensiveContributionPoints: 0.3,
      bonusPoints: 0,
    },
    modelVersion: 'baseline-v1',
    computedAt: '2026-08-21T09:00:00Z',
    ...overrides,
  }
}

function baseData(overrides: Partial<ReasoningRecommendationData> = {}): ReasoningRecommendationData {
  return {
    gameweekId: 1,
    gameweekName: 'Gameweek 1',
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
    reasons: ['Transfer in Haaland. Transfer out Isak.'],
    playerNames: PLAYER_NAMES,
    horizon: 5,
    startingXI: null,
    projections: new Map(),
    ...overrides,
  }
}

function elevenStarters(captainId: number, captainPoints: number, othersPoints: number): StartingXIPick[] {
  return [
    { playerId: captainId, expectedPoints: captainPoints, isCaptain: true },
    ...Array.from({ length: 10 }, (_, i) => ({
      playerId: 100 + i,
      expectedPoints: othersPoints,
      isCaptain: false,
    })),
  ]
}

describe('deriveReasoningView — empty state', () => {
  it('renders a specific, actionable empty state when no recommendation exists at all', () => {
    const view = deriveReasoningView(null)
    expect(view.status).toBe('empty')
    expect(view.emptyMessage).not.toBeNull()
    expect(view.emptyMessage).toMatch(/generate-recommendations\.ts/)
    expect(view.emptyMessage).not.toMatch(/something went wrong/i)
  })
})

describe('deriveReasoningView — reason lines', () => {
  it('renders every stored reason line, in order_index order, not just the first', () => {
    const reasons = [
      'Transfer in Haaland. Transfer out Isak.',
      'Captain Salah. Vice-captain Saliba.',
      'Salah has no Premier League history yet — this rests on an early-season estimate.',
      'Confidence: clear.',
    ]
    const view = deriveReasoningView(baseData({ reasons }))
    expect(view.reasons).toEqual(reasons)
    expect(view.reasons.length).toBeGreaterThanOrEqual(4)
  })
})

describe('deriveReasoningView — horizon total', () => {
  it('labels the horizon total with the stored gameweek count, never a hardcoded figure', () => {
    const view = deriveReasoningView(baseData({ horizon: 3 }))
    expect(view.horizonLabel).toBe('Projected across 3 gameweeks')
  })

  it('singularises the label for a horizon of exactly one gameweek', () => {
    const view = deriveReasoningView(baseData({ horizon: 1 }))
    expect(view.horizonLabel).toBe('Projected across 1 gameweek')
  })

  it('renders the horizon total as unavailable, without hiding the stored gross/net figures, when solver_runs.horizon could not be resolved', () => {
    const view = deriveReasoningView(baseData({ horizon: null, grossPointsRounded: 58, netPointsRounded: 58 }))
    expect(view.horizonLabel).toBe('Horizon unavailable')
    expect(view.horizonGross).toBe(58)
    expect(view.horizonNet).toBe(58)
  })

  it('exposes the hit as horizon-wide cost/gross/net figures when a hit is recommended', () => {
    const view = deriveReasoningView(
      baseData({ hitCost: 4, grossPointsRounded: 62, netPointsRounded: 58 })
    )
    expect(view.hit).toEqual({ cost: 4, gross: 62, net: 58 })
  })

  it('carries no hit block when hit_cost is zero', () => {
    const view = deriveReasoningView(baseData({ hitCost: 0 }))
    expect(view.hit).toBeNull()
  })
})

describe('deriveReasoningView — per-player component breakdown', () => {
  it('builds the breakdown by iterating the stored components.points object, not a fixed list of names', () => {
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(baseData({ projections }))

    const captain = view.players.find((p) => p.role === 'Captain')
    expect(captain).toBeDefined()
    expect(captain!.hasProjection).toBe(true)
    const labels = captain!.components.map((c) => c.label)
    expect(labels).toContain('Appearance')
    expect(labels).toContain('Goal')
    expect(labels).toContain('Clean sheet')
    expect(labels).toContain('Goals conceded')
    expect(labels).toContain('Defensive contribution')
    expect(labels).toContain('Bonus')
  })

  it('still renders an unrecognised component key, with a readable label, rather than dropping it', () => {
    const projections = new Map([
      [
        3,
        projection({
          playerId: 3,
          points: { appearancePoints: 2, weirdNewModelInputPoints: 0.42 },
        }),
      ],
    ])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    const weird = captain.components.find((c) => c.key === 'weirdNewModelInputPoints')
    expect(weird).toBeDefined()
    expect(weird!.label).toBe('Weird new model input')
    expect(weird!.value).toBe(0.42)
  })

  it('reports a player as having no stored projection, rather than an empty table, when none was resolved', () => {
    const view = deriveReasoningView(baseData({ projections: new Map() }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.hasProjection).toBe(false)
    expect(captain.components).toEqual([])
  })

  it('skips transfer-in/out for a roll plan, but still shows captain and vice-captain', () => {
    const view = deriveReasoningView(
      baseData({ isRoll: true, transferInPlayerId: null, transferOutPlayerId: null })
    )
    const roles = view.players.map((p) => p.role)
    expect(roles).not.toContain('Transfer in')
    expect(roles).not.toContain('Transfer out')
    expect(roles).toContain('Captain')
    expect(roles).toContain('Vice-captain')
  })
})

describe('deriveReasoningView — coverage', () => {
  it('states coverage in words for every player shown, not just the ones missing history', () => {
    const view = deriveReasoningView(
      baseData({
        coverage: [
          { role: 'transferIn', playerId: 1, hasHistory: true },
          { role: 'transferOut', playerId: 2, hasHistory: true },
          { role: 'captain', playerId: 3, hasHistory: true },
          { role: 'viceCaptain', playerId: 4, hasHistory: true },
        ],
      })
    )
    expect(view.players).toHaveLength(4)
    for (const player of view.players) {
      expect(player.coverageNote.length).toBeGreaterThan(0)
    }
  })

  it('describes a player with no Premier League history as such, rather than showing a bare number', () => {
    const view = deriveReasoningView(
      baseData({
        coverage: [{ role: 'transferIn', playerId: 1, hasHistory: false }],
      })
    )
    const transferIn = view.players.find((p) => p.role === 'Transfer in')!
    expect(transferIn.coverageNote).toBe(
      'Haaland — no Premier League history yet; this rests on a position-based estimate, not a season of form.'
    )
  })

  it('describes a player with real history positively, distinct from the no-history wording', () => {
    const view = deriveReasoningView(
      baseData({
        coverage: [{ role: 'captain', playerId: 3, hasHistory: true }],
      })
    )
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.coverageNote).toBe('Salah — built on real Premier League match history.')
  })
})

describe('deriveCaptainConfidenceBand', () => {
  it('returns coin-flip for the verified GW1 gap of 0.20', () => {
    expect(deriveCaptainConfidenceBand(0.2)).toBe('coin-flip')
  })

  it('returns marginal for a gap of 0.9', () => {
    expect(deriveCaptainConfidenceBand(0.9)).toBe('marginal')
  })

  it('returns clear for a gap of 2.4', () => {
    expect(deriveCaptainConfidenceBand(2.4)).toBe('clear')
  })

  it('treats the 0.5 boundary as marginal, not coin-flip', () => {
    expect(deriveCaptainConfidenceBand(0.5)).toBe('marginal')
  })

  it('treats the 1.5 boundary as marginal, not clear', () => {
    expect(deriveCaptainConfidenceBand(1.5)).toBe('marginal')
  })

  it('is symmetric around zero — a negative gap behaves the same as its magnitude', () => {
    expect(deriveCaptainConfidenceBand(-0.2)).toBe('coin-flip')
  })
})

describe('deriveReasoningView — captain confidence', () => {
  it('renders a coin-flip sentence naming the alternative player when the gap is the verified GW1 0.20', () => {
    // B. Fernandes (captain, id 3) 5.79 vs Haaland (id 1) 5.59 — G3 addendum,
    // docs/projection-model-backlog.md, verified exact.
    const startingXI = elevenStarters(3, 5.79, 5.0)
    startingXI[1] = { playerId: 1, expectedPoints: 5.59, isCaptain: false }

    const view = deriveReasoningView(baseData({ startingXI }))
    expect(view.captainBand).toBe('coin-flip')
    expect(view.captainNote).toContain('too close to call')
    expect(view.captainNote).toContain('Salah') // captainPlayerId 3 -> Salah in PLAYER_NAMES
    expect(view.captainNote).toContain('Haaland')
  })

  it('reports captain confidence as unavailable, without breaking the rest of the view, when there is no starting XI', () => {
    const view = deriveReasoningView(baseData({ startingXI: null }))
    expect(view.captainBand).toBeNull()
    expect(view.captainNote).toBeNull()
    expect(view.headline).not.toBeNull()
  })

  it('derives a clear band and a "clear pick" sentence for a wide gap', () => {
    const startingXI = elevenStarters(3, 8.0, 4.0)
    const view = deriveReasoningView(baseData({ startingXI }))
    expect(view.captainBand).toBe('clear')
    expect(view.captainNote).toContain('clear pick')
  })
})

describe('deriveReasoningView — model version and computed-at', () => {
  it('surfaces the stored model version and computed-at from a resolved projection', () => {
    const projections = new Map([[3, projection({ playerId: 3, modelVersion: 'baseline-v1' })]])
    const view = deriveReasoningView(baseData({ projections }))
    expect(view.modelVersion).toBe('baseline-v1')
    expect(view.computedAtLabel).not.toBeNull()
  })

  it('reports the model version as unavailable when no projection resolved for anyone', () => {
    const view = deriveReasoningView(baseData({ projections: new Map() }))
    expect(view.modelVersion).toBeNull()
    expect(view.computedAtLabel).toBeNull()
  })
})

describe('formatComponentLabel', () => {
  it('turns a camelCase *Points key into a sentence-case label with the trailing "Points" removed', () => {
    expect(formatComponentLabel('appearancePoints')).toBe('Appearance')
    expect(formatComponentLabel('cleanSheetPoints')).toBe('Clean sheet')
    expect(formatComponentLabel('defensiveContributionPoints')).toBe('Defensive contribution')
  })

  it('handles a key with no trailing "Points" gracefully', () => {
    expect(formatComponentLabel('xgPer90')).toBe('Xg per90')
  })
})
