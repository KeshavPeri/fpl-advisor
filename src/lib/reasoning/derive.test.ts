import { describe, expect, it } from 'vitest'
import {
  confidenceBadgeLabel,
  deriveCaptainConfidenceBand,
  deriveReasoningView,
  describeDriver,
  formatComponentLabel,
  heroLine,
  otherOptionGapText,
  otherOptionLine,
  planPointsGap,
  reasonChip,
  topReasonChips,
} from './derive.ts'
import type {
  AlternativePlanData,
  PlayerProjectionData,
  PlayerProjectionDriver,
  ReasoningRecommendationData,
  StartingXIPick,
} from './types.ts'

const PLAYER_NAMES = new Map<number, string>([
  [1, 'Haaland'],
  [2, 'Isak'],
  [3, 'Salah'],
  [4, 'Saliba'],
  [5, 'Schade'],
  [6, 'Tarkowski'],
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
    alternatives: [],
    updatedAt: '2026-09-25T03:41:00Z',
    ...overrides,
  }
}

function alternativePlan(overrides: Partial<AlternativePlanData> = {}): AlternativePlanData {
  return {
    planIndex: 1,
    isRoll: false,
    transferInPlayerId: 1,
    transferOutPlayerId: 2,
    captainPlayerId: 3,
    hitCost: 0,
    grossPointsRounded: 55,
    netPointsRounded: 55,
    confidenceBand: 'clear',
    coverage: [],
    reasons: ['Transfer in Haaland. Transfer out Isak.'],
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

function driver(overrides: Partial<PlayerProjectionDriver> = {}): PlayerProjectionDriver {
  return { feature: 'r5_total_points', value: 4.2, contribution: 0.8, ...overrides }
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

describe('heroLine', () => {
  it('states the transfer and the captain in one line', () => {
    const line = heroLine(baseData())
    expect(line).toBe('Haaland in · Isak out · Captain Salah')
  })

  it('states a rolled transfer and the captain in one line', () => {
    const line = heroLine(
      baseData({ isRoll: true, transferInPlayerId: null, transferOutPlayerId: null })
    )
    expect(line).toBe('Roll your transfer · Captain Salah')
  })
})

describe('confidenceBadgeLabel', () => {
  it('labels each band in plain words, never the raw band name', () => {
    expect(confidenceBadgeLabel('clear')).toBe('Clear')
    expect(confidenceBadgeLabel('marginal')).toBe('Leaning')
    expect(confidenceBadgeLabel('coin-flip')).toBe('Close call')
  })
})

describe('deriveReasoningView — hero, confidence and headline', () => {
  it('carries the hero line, confidence band and label through the view', () => {
    const view = deriveReasoningView(baseData({ confidenceBand: 'marginal' }))
    expect(view.heroLine).toBe('Haaland in · Isak out · Captain Salah')
    expect(view.confidenceBand).toBe('marginal')
    expect(view.confidenceLabel).toBe('Leaning')
  })

  it('sums the starting XI for the headline figure, doubling the captain', () => {
    const startingXI = elevenStarters(3, 8, 4) // captain 8, ten others at 4 each
    const view = deriveReasoningView(baseData({ startingXI }))
    // captain doubled: 16, plus 10 * 4 = 40 -> 56
    expect(view.headlineValue).toBe(56)
    expect(view.headlineCaption).toBe('Expected this gameweek')
  })

  it('reports the headline figure as unavailable, with a plain caption, when there is no starting XI', () => {
    const view = deriveReasoningView(baseData({ startingXI: null }))
    expect(view.headlineValue).toBeNull()
    expect(view.headlineCaption.length).toBeGreaterThan(0)
    expect(view.headlineCaption).not.toMatch(/projection/i)
  })

  it('states a coverage gap in the hero sentence when a named player has little match history', () => {
    const view = deriveReasoningView(
      baseData({
        coverage: [{ role: 'transferIn', playerId: 1, hasHistory: false }],
      })
    )
    expect(view.heroSentence).not.toBeNull()
    expect(view.heroSentence).toContain('Haaland')
    expect(view.heroSentence).toMatch(/little match history/)
  })

  it('names the alternative in the hero sentence for a coin-flip plan with full data coverage', () => {
    const view = deriveReasoningView(
      baseData({
        confidenceBand: 'coin-flip',
        alternatives: [alternativePlan({ planIndex: 1, transferInPlayerId: 5 })],
      })
    )
    expect(view.heroSentence).not.toBeNull()
    expect(view.heroSentence).toContain('Schade')
  })

  it('carries no hero sentence for a clear plan with full data coverage', () => {
    const view = deriveReasoningView(baseData({ confidenceBand: 'clear' }))
    expect(view.heroSentence).toBeNull()
  })

  it('never mentions a model name, "MAE", "explainable model" or "projection" anywhere in the view text', () => {
    const startingXI = elevenStarters(3, 8, 4)
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(
      baseData({
        startingXI,
        projections,
        confidenceBand: 'coin-flip',
        alternatives: [alternativePlan({ planIndex: 1 })],
      })
    )
    const haystack = JSON.stringify(view)
    expect(haystack).not.toMatch(/gbm-v1|baseline-v1|MAE|explainable model|pushes up|pulls down/i)
  })
})

describe('deriveReasoningView — hit block', () => {
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

describe('deriveReasoningView — per-player figure and breakdown', () => {
  it('sums the stored baseline-v1 components for the player figure when there is no gbm-v1 row', () => {
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.hasProjection).toBe(true)
    // 2 + 1.91 + 1.24 + 0.34 - 0.1 + 0 + 0.3 + 0 = 5.69
    expect(captain.points).toBeCloseTo(5.69, 5)
  })

  it('prefers the gbm-v1 expected_points figure over the baseline-v1 sum when both resolved', () => {
    const projections = new Map([
      [
        3,
        {
          ...projection({ playerId: 3 }),
          learned: { modelVersion: 'gbm-v1', expectedPoints: 5.6, drivers: [] },
        } satisfies PlayerProjectionData,
      ],
    ])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.points).toBe(5.6)
  })

  it('builds the disclosed breakdown by iterating the stored components.points object, not a fixed list', () => {
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    const labels = captain.components.map((c) => c.label)
    expect(labels).toContain('Appearance')
    expect(labels).toContain('Goal')
    expect(labels).toContain('Clean sheet')
  })

  it('still renders an unrecognised component key, with a readable label, rather than dropping it', () => {
    const projections = new Map([
      [3, projection({ playerId: 3, points: { appearancePoints: 2, weirdNewModelInputPoints: 0.42 } })],
    ])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    const weird = captain.components.find((c) => c.key === 'weirdNewModelInputPoints')
    expect(weird).toBeDefined()
    expect(weird!.label).toBe('Weird new model input')
  })

  it('reports a player as having no stored projection, with a null figure, rather than a fabricated number', () => {
    const view = deriveReasoningView(baseData({ projections: new Map() }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.hasProjection).toBe(false)
    expect(captain.points).toBeNull()
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
  it('carries no coverage note for a player with real Premier League history', () => {
    const view = deriveReasoningView(
      baseData({ coverage: [{ role: 'captain', playerId: 3, hasHistory: true }] })
    )
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.coverageNote).toBeNull()
  })

  it('states a data-coverage gap in words for a player with no Premier League history', () => {
    const view = deriveReasoningView(
      baseData({ coverage: [{ role: 'transferIn', playerId: 1, hasHistory: false }] })
    )
    const transferIn = view.players.find((p) => p.role === 'Transfer in')!
    expect(transferIn.coverageNote).not.toBeNull()
    expect(transferIn.coverageNote).toContain('Haaland')
    expect(transferIn.coverageNote).toMatch(/little Premier League history/)
  })

  it('never renders the deleted "built on real Premier League match history" filler', () => {
    const view = deriveReasoningView(
      baseData({
        coverage: [
          { role: 'transferIn', playerId: 1, hasHistory: true },
          { role: 'transferOut', playerId: 2, hasHistory: true },
        ],
      })
    )
    for (const player of view.players) {
      expect(player.coverageNote ?? '').not.toMatch(/built on real/i)
    }
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
  it('labels a coin-flip captain gap with the plain badge word, not the raw band name', () => {
    const startingXI = elevenStarters(3, 5.79, 5.0)
    startingXI[1] = { playerId: 1, expectedPoints: 5.59, isCaptain: false }

    const view = deriveReasoningView(baseData({ startingXI }))
    expect(view.captainBand).toBe('coin-flip')
    expect(view.captainLabel).toBe('Captain confidence: Close call')
    expect(view.captainNote).toContain('too close to call')
  })

  it('reports captain confidence as unavailable, without breaking the rest of the view, when there is no starting XI', () => {
    const view = deriveReasoningView(baseData({ startingXI: null }))
    expect(view.captainBand).toBeNull()
    expect(view.captainLabel).toBeNull()
    expect(view.captainNote).toBeNull()
    expect(view.heroLine).not.toBeNull()
  })

  it('derives a clear band and a "clear pick" sentence for a wide gap', () => {
    const startingXI = elevenStarters(3, 8.0, 4.0)
    const view = deriveReasoningView(baseData({ startingXI }))
    expect(view.captainBand).toBe('clear')
    expect(view.captainLabel).toBe('Captain confidence: Clear')
    expect(view.captainNote).toContain('clear pick')
  })
})

describe('deriveReasoningView — updated-at footer (ticket #277 bug fix)', () => {
  it('derives the footer time from the recommendation\'s OWN updated_at, never a projection row\'s computed_at', () => {
    const projections = new Map([
      [3, projection({ playerId: 3, computedAt: '2020-01-01T00:00:00Z' })],
    ])
    const view = deriveReasoningView(
      baseData({ projections, updatedAt: '2026-09-25T03:41:00Z' })
    )
    expect(view.updatedAtLabel).not.toBeNull()
    // Asia/Singapore is UTC+8 — 03:41 UTC is 11:41 local.
    expect(view.updatedAtLabel).toContain('11:41')
    expect(view.updatedAtLabel).not.toContain('2020')
  })

  it('carries no model name anywhere near the footer time', () => {
    const view = deriveReasoningView(baseData({ updatedAt: '2026-09-25T03:41:00Z' }))
    expect(view.updatedAtLabel).not.toMatch(/baseline-v1|gbm-v1/)
  })
})

describe('reasonChip', () => {
  it('reads r1_minutes >= 80 as "Played 90 mins last game"', () => {
    expect(reasonChip(driver({ feature: 'r1_minutes', value: 90 }))).toBe('Played 90 mins last game')
    expect(reasonChip(driver({ feature: 'r1_minutes', value: 45 }))).toBeNull()
  })

  it('reads a high transfers_rank as managers buying, a low one as managers selling', () => {
    expect(reasonChip(driver({ feature: 'transfers_rank', value: 0.9 }))).toBe('Managers are buying him')
    expect(reasonChip(driver({ feature: 'transfers_rank', value: 0.05 }))).toBe('Managers are selling him')
    expect(reasonChip(driver({ feature: 'transfers_rank', value: 0.5 }))).toBeNull()
  })

  it('reads a high own_pct_rank as owned by most managers', () => {
    expect(reasonChip(driver({ feature: 'own_pct_rank', value: 0.85 }))).toBe('Owned by most managers')
    expect(reasonChip(driver({ feature: 'own_pct_rank', value: 0.2 }))).toBeNull()
  })

  it('reads a high price as a premium, nailed starter', () => {
    expect(reasonChip(driver({ feature: 'value', value: 130 }))).toBe('Premium, nailed starter')
    expect(reasonChip(driver({ feature: 'value', value: 45 }))).toBeNull()
  })

  it('reads a high lambda_for as the team expected to score', () => {
    expect(reasonChip(driver({ feature: 'lambda_for', value: 2.1 }))).toBe('Team expected to score')
    expect(reasonChip(driver({ feature: 'lambda_for', value: 0.9 }))).toBeNull()
  })

  it('reads a high p_cs as a good clean-sheet chance', () => {
    expect(reasonChip(driver({ feature: 'p_cs', value: 0.5 }))).toBe('Good clean-sheet chance')
    expect(reasonChip(driver({ feature: 'p_cs', value: 0.1 }))).toBeNull()
  })

  it('reads a high r5/p90 goal stat as scoring regularly', () => {
    expect(reasonChip(driver({ feature: 'r5_goals_scored', value: 4 }))).toBe('Scoring regularly')
    expect(reasonChip(driver({ feature: 'r5_expected_goals', value: 3 }))).toBe('Scoring regularly')
    expect(reasonChip(driver({ feature: 'p90_10_expected_goals', value: 0.6 }))).toBe('Scoring regularly')
    expect(reasonChip(driver({ feature: 'r5_goals_scored', value: 1 }))).toBeNull()
  })

  it('returns null for a feature this screen has no chip wording for', () => {
    expect(reasonChip(driver({ feature: 'some_future_feature_nobody_mapped', value: 99 }))).toBeNull()
  })

  it('returns null when the driver carries no value at all', () => {
    expect(reasonChip(driver({ feature: 'r1_minutes', value: null }))).toBeNull()
  })

  it('never returns "pushes up", "pulls down" or the raw feature name', () => {
    const chip = reasonChip(driver({ feature: 'r1_minutes', value: 90 }))
    expect(chip).not.toMatch(/pushes up|pulls down|r1_minutes/)
  })
})

describe('topReasonChips', () => {
  it('keeps at most 3 chips, ranked by the driver\'s own |contribution|', () => {
    const drivers: PlayerProjectionDriver[] = [
      driver({ feature: 'r1_minutes', value: 90, contribution: 0.3 }),
      driver({ feature: 'transfers_rank', value: 0.9, contribution: 1.2 }),
      driver({ feature: 'own_pct_rank', value: 0.9, contribution: -0.5 }),
      driver({ feature: 'p_cs', value: 0.5, contribution: 0.05 }),
      driver({ feature: 'lambda_for', value: 2.0, contribution: 0.9 }),
    ]
    const chips = topReasonChips(drivers)
    expect(chips).toHaveLength(3)
    expect(chips).toEqual([
      'Managers are buying him', // 1.2
      'Team expected to score', // 0.9
      'Owned by most managers', // 0.5
    ])
  })

  it('drops unrecognised or below-threshold drivers before ranking, never leaving a gap', () => {
    const drivers: PlayerProjectionDriver[] = [
      driver({ feature: 'some_unknown_feature', value: 99, contribution: 5 }),
      driver({ feature: 'r1_minutes', value: 30, contribution: 4 }), // below threshold -> null
      driver({ feature: 'p_cs', value: 0.5, contribution: 0.1 }),
    ]
    expect(topReasonChips(drivers)).toEqual(['Good clean-sheet chance'])
  })

  it('is empty for a player with no drivers at all', () => {
    expect(topReasonChips([])).toEqual([])
  })
})

describe('deriveReasoningView — reason chips flow through to the player view', () => {
  it('caps a player\'s chips at 3, built from that player\'s own gbm-v1 drivers', () => {
    const projections = new Map([
      [
        3,
        {
          ...projection({ playerId: 3 }),
          learned: {
            modelVersion: 'gbm-v1',
            expectedPoints: 5.6,
            drivers: [
              driver({ feature: 'r1_minutes', value: 90, contribution: 0.3 }),
              driver({ feature: 'transfers_rank', value: 0.9, contribution: 1.2 }),
              driver({ feature: 'own_pct_rank', value: 0.9, contribution: -0.5 }),
              driver({ feature: 'p_cs', value: 0.5, contribution: 0.05 }),
            ],
          },
        } satisfies PlayerProjectionData,
      ],
    ])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.chips.length).toBeLessThanOrEqual(3)
    // Ranked by |contribution|: transfers_rank (1.2), own_pct_rank (magnitude
    // 0.5), r1_minutes (0.3) — p_cs (0.05) is the fourth and dropped.
    expect(captain.chips).toEqual([
      'Managers are buying him',
      'Owned by most managers',
      'Played 90 mins last game',
    ])
  })

  it('is empty for a player with only a baseline-v1 row', () => {
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.chips).toEqual([])
  })
})

describe('planPointsGap / otherOptionGapText', () => {
  it('computes the signed points gap from the stored net figures', () => {
    expect(planPointsGap(58, 60)).toBe(2)
    expect(planPointsGap(58, 54)).toBe(-4)
    expect(planPointsGap(58, 58)).toBe(0)
  })

  it('renders a zero gap as "same points"', () => {
    expect(otherOptionGapText(0)).toBe('same points')
  })

  it('renders a -1 gap as "1 pt less"', () => {
    expect(otherOptionGapText(-1)).toBe('1 pt less')
  })

  it('renders a larger negative gap in the plural', () => {
    expect(otherOptionGapText(-4)).toBe('4 pts less')
  })

  it('renders a positive gap as "more"', () => {
    expect(otherOptionGapText(2)).toBe('2 pts more')
    expect(otherOptionGapText(1)).toBe('1 pt more')
  })
})

describe('otherOptionLine', () => {
  it('states a transfer-only difference as a compact noun phrase with the points gap', () => {
    const line = otherOptionLine(
      { isRoll: false, transferInPlayerId: 1, captainPlayerId: 3, netPointsRounded: 58 },
      { isRoll: false, transferInPlayerId: 5, captainPlayerId: 3, netPointsRounded: 58 },
      PLAYER_NAMES
    )
    expect(line).toBe('Schade instead of Haaland · same points')
  })

  it('states a -1 point gap in the ticket\'s own words', () => {
    const line = otherOptionLine(
      { isRoll: false, transferInPlayerId: 1, captainPlayerId: 3, netPointsRounded: 58 },
      { isRoll: false, transferInPlayerId: 6, captainPlayerId: 3, netPointsRounded: 57 },
      PLAYER_NAMES
    )
    expect(line).toBe('Tarkowski instead of Haaland · 1 pt less')
  })
})

describe('deriveReasoningView — other options', () => {
  it('labels the first alternative Plan B and the second Plan C, each with its own one-line summary', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [
          alternativePlan({ planIndex: 1, transferInPlayerId: 5, netPointsRounded: 58 }),
          alternativePlan({ planIndex: 2, transferInPlayerId: 6, netPointsRounded: 57 }),
        ],
      })
    )
    expect(view.otherOptions[0].label).toBe('Plan B')
    expect(view.otherOptions[0].summaryLine).toBe('Schade instead of Haaland · same points')
    expect(view.otherOptions[1].label).toBe('Plan C')
    expect(view.otherOptions[1].summaryLine).toBe('Tarkowski instead of Haaland · 1 pt less')
  })

  it('carries the alternative\'s own confidence as a plain label, never the raw band word', () => {
    const view = deriveReasoningView(
      baseData({ alternatives: [alternativePlan({ planIndex: 1, confidenceBand: 'coin-flip' })] })
    )
    expect(view.otherOptions[0].confidenceLabel).toBe('Close call')
  })

  it('reads as a confident answer, with no apology, when Plan A is the only stored plan', () => {
    const view = deriveReasoningView(baseData({ alternatives: [] }))
    expect(view.otherOptions).toEqual([])
    expect(view.otherOptionsEmptyNote).not.toBeNull()
    expect(view.otherOptionsEmptyNote).toMatch(/confident/i)
    expect(view.otherOptionsEmptyNote).not.toMatch(/sorry|apolog|something went wrong|error|unfortunately/i)
  })

  it('carries no empty-options note once at least one alternative exists', () => {
    const view = deriveReasoningView(baseData({ alternatives: [alternativePlan()] }))
    expect(view.otherOptionsEmptyNote).toBeNull()
  })

  it('carries a coverage note for an alternative\'s own player only when that plan has a data gap', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [
          alternativePlan({
            planIndex: 1,
            transferInPlayerId: 5,
            coverage: [{ role: 'transferIn', playerId: 5, hasHistory: false }],
          }),
        ],
      })
    )
    const transferIn = view.otherOptions[0].players.find((p) => p.role === 'Transfer in')!
    expect(transferIn.coverageNote).not.toBeNull()
    expect(transferIn.coverageNote).toContain('Schade')
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

// ============================================================================
// describeDriver — model/fpl_model/features.py's FEATURES, copied here as a
// fixture exactly as computed by that file's own list comprehensions
// (verified by hand against the module on this branch's base, 132 names).
// Kept from #266: `describeDriver` is no longer rendered anywhere on this
// screen (see derive.ts's own header), but it remains the tested, generic
// plain-word mapping a future ticket might reuse — this fixture is the
// regression net for it.
// ============================================================================

const FROZEN_FEATURES: readonly string[] = [
  ...[1, 3, 5, 10, 38].flatMap((k) =>
    [
      'minutes',
      'total_points',
      'goals_scored',
      'assists',
      'expected_goals',
      'expected_assists',
      'bps',
      'bonus',
      'ict_index',
      'threat',
      'creativity',
      'saves',
      'clean_sheets',
      'goals_conceded',
      'starts',
      'defensive_contribution',
      'expected_goals_conceded',
      'm60',
      'app',
    ].map((stat) => `r${k}_${stat}`)
  ),
  ...[10, 38].flatMap((k) =>
    [
      'expected_goals',
      'expected_assists',
      'total_points',
      'bps',
      'threat',
      'creativity',
      'defensive_contribution',
      'saves',
    ].map((stat) => `p90_${k}_${stat}`)
  ),
  'sd_minutes',
  'sd_apps',
  'rows_hist',
  ...[5, 10, 20].flatMap((k) => [`t_gf_${k}`, `t_ga_${k}`]),
  ...[5, 10, 20].flatMap((k) => [`ot_gf_${k}`, `ot_ga_${k}`]),
  'pos_i',
  'value',
  'was_home',
  'nfix',
  'own_pct_rank',
  'transfers_rank',
]

const ODDS_FEATURES: readonly string[] = ['lambda_for', 'lambda_against', 'p_win', 'p_cs']

describe('describeDriver', () => {
  it('has exactly 132 names in the frozen FEATURES fixture', () => {
    expect(FROZEN_FEATURES).toHaveLength(132)
  })

  it('describes every name in model/fpl_model/features.py\'s FEATURES, none null', () => {
    for (const feature of FROZEN_FEATURES) {
      expect(describeDriver(feature), `expected a description for "${feature}"`).not.toBeNull()
    }
  })

  it('describes all four odds names', () => {
    for (const feature of ODDS_FEATURES) {
      expect(describeDriver(feature), `expected a description for "${feature}"`).not.toBeNull()
    }
  })

  it('returns null for an unrecognised name, never a raw feature name', () => {
    expect(describeDriver('some_future_feature_nobody_mapped')).toBeNull()
  })

  it('special-cases a 1-game rolling window as "last game", not "over the last 1 games"', () => {
    expect(describeDriver('r1_total_points')).toBe('points last game')
  })

  it('phrases a multi-game rolling window with "over the last N games"', () => {
    expect(describeDriver('r5_total_points')).toBe('points over the last 5 games')
  })
})
