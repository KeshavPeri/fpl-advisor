import { describe, expect, it } from 'vitest'
import {
  deriveCaptainConfidenceBand,
  deriveReasoningView,
  describeDriver,
  formatComponentLabel,
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

describe('deriveReasoningView — alternatives (Plan B / Plan C), difference from Plan A', () => {
  it('states a transfer-only difference, naming both incoming players, without mentioning the captain', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [alternativePlan({ planIndex: 1, transferInPlayerId: 2, captainPlayerId: 3 })],
      })
    )
    expect(view.alternatives).toHaveLength(1)
    expect(view.alternatives[0].differenceText).toBe('Transfers in Isak instead of Haaland.')
    expect(view.alternatives[0].differenceText).not.toContain('captain')
  })

  it('states a captain-only difference, naming both captains, without mentioning the transfer', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [alternativePlan({ planIndex: 1, transferInPlayerId: 1, captainPlayerId: 4 })],
      })
    )
    expect(view.alternatives[0].differenceText).toBe('Captains Saliba instead of Salah.')
    expect(view.alternatives[0].differenceText).not.toContain('transfer')
  })

  it('states both differences in one sentence when the alternative differs in transfer and captain', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [alternativePlan({ planIndex: 1, transferInPlayerId: 2, captainPlayerId: 4 })],
      })
    )
    const text = view.alternatives[0].differenceText
    expect(text).toContain('Transfers in Isak instead of Haaland')
    expect(text).toContain('captains Saliba instead of Salah')
  })

  it('labels the first alternative Plan B and the second Plan C', () => {
    const view = deriveReasoningView(
      baseData({
        alternatives: [
          alternativePlan({ planIndex: 1, captainPlayerId: 4 }),
          alternativePlan({ planIndex: 2, transferInPlayerId: 2 }),
        ],
      })
    )
    expect(view.alternatives[0].label).toBe('Plan B')
    expect(view.alternatives[1].label).toBe('Plan C')
  })
})

describe('deriveReasoningView — alternatives, horizon points gap', () => {
  it('states the horizon points gap against Plan A, computed from the stored net figures', () => {
    const view = deriveReasoningView(
      baseData({
        netPointsRounded: 58,
        alternatives: [alternativePlan({ planIndex: 1, netPointsRounded: 60 })],
      })
    )
    expect(view.alternatives[0].pointsGap).toBe(2)
    expect(view.alternatives[0].pointsGapLabel).toBe('+2 pts vs Plan A over the horizon.')
  })

  it('signs a negative gap when the alternative projects lower than Plan A', () => {
    const view = deriveReasoningView(
      baseData({
        netPointsRounded: 58,
        alternatives: [alternativePlan({ planIndex: 1, netPointsRounded: 54 })],
      })
    )
    expect(view.alternatives[0].pointsGap).toBe(-4)
    expect(view.alternatives[0].pointsGapLabel).toBe('-4 pts vs Plan A over the horizon.')
  })
})

describe('deriveReasoningView — fewer than three distinct plans', () => {
  it('reads as a confident answer, with no apology or error framing, when Plan A is the only stored plan', () => {
    const view = deriveReasoningView(baseData({ alternatives: [] }))
    expect(view.alternatives).toEqual([])
    expect(view.alternativesEmptyNote).not.toBeNull()
    expect(view.alternativesEmptyNote).toMatch(/confident/i)
    expect(view.alternativesEmptyNote).not.toMatch(/sorry|apolog|something went wrong|error|unfortunately/i)
  })

  it('carries no empty-alternatives note once at least one alternative exists', () => {
    const view = deriveReasoningView(baseData({ alternatives: [alternativePlan()] }))
    expect(view.alternativesEmptyNote).toBeNull()
  })
})

describe('deriveReasoningView — coin-flip confidence names the alternative', () => {
  it('states plainly that the top options cannot be separated, naming Plan A and Plan B by their decisions', () => {
    const view = deriveReasoningView(
      baseData({
        confidenceBand: 'coin-flip',
        transferInPlayerId: 1,
        captainPlayerId: 3,
        alternatives: [alternativePlan({ planIndex: 1, transferInPlayerId: 2, captainPlayerId: 3 })],
      })
    )
    expect(view.coinFlipNote).not.toBeNull()
    expect(view.coinFlipNote).toContain('cannot be separated')
    expect(view.coinFlipNote).toContain('Plan A')
    expect(view.coinFlipNote).toContain('Plan B')
    expect(view.coinFlipNote).toContain('Haaland')
    expect(view.coinFlipNote).toContain('Isak')
  })

  it('carries no coin-flip note when Plan A is clear, even with an alternative present', () => {
    const view = deriveReasoningView(
      baseData({ confidenceBand: 'clear', alternatives: [alternativePlan({ planIndex: 1 })] })
    )
    expect(view.coinFlipNote).toBeNull()
  })

  it('carries no coin-flip note when Plan A is coin-flip but no alternative was stored (collapsed into the same decision)', () => {
    const view = deriveReasoningView(baseData({ confidenceBand: 'coin-flip', alternatives: [] }))
    expect(view.coinFlipNote).toBeNull()
    expect(view.alternativesEmptyNote).not.toBeNull()
  })
})

describe('deriveReasoningView — alternative with missing recommendation_reasons', () => {
  it('renders the alternative without its reason headline, rather than dropping it or erroring', () => {
    const view = deriveReasoningView(
      baseData({ alternatives: [alternativePlan({ planIndex: 1, reasons: [] })] })
    )
    expect(view.alternatives).toHaveLength(1)
    expect(view.alternatives[0].reasonHeadline).toBeNull()
    expect(view.alternatives[0].label).toBe('Plan B')
    expect(view.alternatives[0].differenceText.length).toBeGreaterThan(0)
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
// describeDriver (ticket #266) — model/fpl_model/features.py's FEATURES,
// copied here as a fixture exactly as computed by that file's own list
// comprehensions (verified by hand against the module on this branch's
// base, 132 names). This is a snapshot, not a live import — see this
// ticket's own note on why: scripts/, model/ and src/ are separate
// compilation environments and this ticket's Files list is src/ only.
// ============================================================================

const FROZEN_FEATURES: readonly string[] = [
  // r{k}_{stat} — k in [1, 3, 5, 10, 38], stat in _STAT_COLS + [m60, app]
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
  // p90_{k}_{stat} — k in [10, 38], stat in _P90_STATS
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
  // team_feature_names — t_{gf,ga}_{k} then o + same, k in [5, 10, 20]
  ...[5, 10, 20].flatMap((k) => [`t_gf_${k}`, `t_ga_${k}`]),
  ...[5, 10, 20].flatMap((k) => [`ot_gf_${k}`, `ot_ga_${k}`]),
  // _CONTEXT
  'pos_i',
  'value',
  'was_home',
  'nfix',
  // _MARKET
  'own_pct_rank',
  'transfers_rank',
]

// The four odds names #133 adds behind USE_ODDS — not part of FEATURES
// itself (appended only when odds are joined in), tested separately per
// this ticket's own DoD wording ("the four odds names too").
const ODDS_FEATURES: readonly string[] = ['lambda_for', 'lambda_against', 'p_win', 'p_cs']

describe('describeDriver', () => {
  it('has exactly 132 names in the frozen FEATURES fixture', () => {
    // A guard on the fixture itself, not on describeDriver — if this ever
    // fails, the fixture has drifted from model/fpl_model/features.py and
    // needs re-copying, not a code fix here.
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

  it('phrases a per-90 feature with its window', () => {
    expect(describeDriver('p90_10_expected_goals')).toBe('expected goals per 90 minutes, last 10 games')
  })

  it('distinguishes team from opponent, and scored from conceded', () => {
    expect(describeDriver('t_gf_5')).toBe('team goals scored, last 5')
    expect(describeDriver('t_ga_5')).toBe('team goals conceded, last 5')
    expect(describeDriver('ot_gf_5')).toBe('opponent goals scored, last 5')
    expect(describeDriver('ot_ga_5')).toBe('opponent goals conceded, last 5')
  })

  it('describes the named context, market and odds features exactly as the ticket specifies', () => {
    expect(describeDriver('own_pct_rank')).toBe('popular with managers')
    expect(describeDriver('transfers_rank')).toBe('being transferred in')
    expect(describeDriver('value')).toBe('price')
    expect(describeDriver('was_home')).toBe('playing at home')
    expect(describeDriver('nfix')).toBe('number of fixtures')
    expect(describeDriver('lambda_for')).toBe('expected team goals this fixture')
    expect(describeDriver('lambda_against')).toBe('expected goals against')
    expect(describeDriver('p_win')).toBe('chance of winning')
    expect(describeDriver('p_cs')).toBe('clean-sheet chance')
  })
})

// ============================================================================
// deriveReasoningView — gbm-v1 learned-model block per player (ticket #266)
// ============================================================================

function driver(overrides: Partial<PlayerProjectionDriver> = {}): PlayerProjectionDriver {
  return { feature: 'r5_total_points', value: 4.2, contribution: 0.8, ...overrides }
}

describe('deriveReasoningView — learned model (gbm-v1) block', () => {
  it('renders a "Decided by" headline and the top three described drivers for a player with a gbm-v1 row', () => {
    const projections = new Map([
      [
        3,
        {
          playerId: 3,
          points: { appearancePoints: 2 },
          modelVersion: 'baseline-v1',
          computedAt: '2026-08-21T09:00:00Z',
          learned: {
            modelVersion: 'gbm-v1',
            expectedPoints: 5.79,
            drivers: [
              driver({ feature: 'r5_total_points', contribution: 1.2 }),
              driver({ feature: 'lambda_for', contribution: 0.9 }),
              driver({ feature: 'own_pct_rank', contribution: -0.2 }),
              driver({ feature: 'p_cs', contribution: 0.05 }),
              driver({ feature: 'some_unknown_future_feature', contribution: 5 }),
            ],
          },
        } satisfies PlayerProjectionData,
      ],
    ])

    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!

    expect(captain.learned).not.toBeNull()
    expect(captain.learned!.headline).toBe('Decided by gbm-v1 · 5.8')
    // Top three by |contribution|: r5_total_points (1.2), lambda_for (0.9),
    // own_pct_rank (-0.2 magnitude 0.2, beats p_cs's 0.05). The unknown
    // feature (contribution 5, the largest of all) is dropped before
    // ranking, never shown with a raw name.
    expect(captain.learned!.drivers).toHaveLength(3)
    expect(captain.learned!.drivers.map((d) => d.feature)).toEqual([
      'r5_total_points',
      'lambda_for',
      'own_pct_rank',
    ])
    expect(captain.learned!.drivers[0].description).toBe('points over the last 5 games')
    expect(captain.learned!.drivers[0].direction).toBe('pushes up')
    expect(captain.learned!.drivers[2].direction).toBe('pulls down')
    // The baseline-v1 breakdown is untouched — still built from `points`.
    expect(captain.components.map((c) => c.label)).toContain('Appearance')
  })

  it('renders no learned block, exactly as before this ticket, for a player with only a baseline-v1 row', () => {
    const projections = new Map([[3, projection({ playerId: 3 })]])
    const view = deriveReasoningView(baseData({ projections }))
    const captain = view.players.find((p) => p.role === 'Captain')!

    expect(captain.learned).toBeNull()
    expect(captain.hasProjection).toBe(true)
    const labels = captain.components.map((c) => c.label)
    expect(labels).toContain('Appearance')
    expect(labels).toContain('Goal')
  })

  it('renders no learned block for a player with no resolved projection at all', () => {
    const view = deriveReasoningView(baseData({ projections: new Map() }))
    const captain = view.players.find((p) => p.role === 'Captain')!
    expect(captain.learned).toBeNull()
  })
})
