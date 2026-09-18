// Unit tests for scripts/transfer-scorecard.ts — ticket #254.
//
// This job's Supabase reads can't be exercised without a live Supabase project holding real
// notifications/prediction_log/player_gameweek_history/squads rows (same limitation every
// scripts/*.ts test file already documents — see e.g. scripts/bonus-validation-report.test.ts's
// own header). Every function this file exports is pure, so each is exercised directly on
// constructed rows instead.

import { describe, expect, it } from 'vitest'
import {
  bankTenthsToDecimalMillions,
  buildActualsByGameweek,
  buildPreTransferSquadCodes,
  buildPriceIndexForGameweek,
  buildSummedPointsByCode,
  classifySnapshot,
  computeCeiling,
  computeNetGain,
  evaluateTransferGameweek,
  findAffordableCandidates,
  horizonGameweekIds,
  MAX_PLAYERS_PER_CLUB,
  pickBestByPoints,
  pickLatestSnapshotByGameweek,
  poolGains,
  renderScorecard,
  sumActualPoints,
  type ActualsByGameweek,
  type CandidatePlayer,
  type PlayerGameweekHistoryRow,
  type RawPlanSnapshot,
} from './transfer-scorecard.ts'

// ============================================================================
// Fixtures
// ============================================================================

/** A snapshot naming a real transfer: player code 200 sold, player code 201 bought, hit cost 4,
 *  a 15-man squad with code 201 already in the starting XI (post-transfer shape) in place of
 *  200. */
function transferSnapshot(overrides: Partial<RawPlanSnapshot> = {}): RawPlanSnapshot {
  const startingXi = [201, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const benchOrder = [12, 13, 14, 15]
  return {
    isRoll: false,
    transferIn: { code: 201 },
    transferOut: { code: 200 },
    startingXi,
    benchOrder,
    hitCost: 4,
    ...overrides,
  }
}

function rollSnapshot(): RawPlanSnapshot {
  return {
    isRoll: true,
    transferIn: null,
    transferOut: null,
    startingXi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    benchOrder: [12, 13, 14, 15],
    hitCost: 0,
  }
}

function player(code: number, teamId: number, elementType: number): CandidatePlayer {
  return { code, teamId, elementType }
}

// ============================================================================
// Units — the single most dangerous line in the file (per its own header).
// ============================================================================

describe('bankTenthsToDecimalMillions', () => {
  it('converts squads.bank (integer tenths, £0.1m units) into decimal millions, matching player_gameweek_history.now_cost\'s own units', () => {
    expect(bankTenthsToDecimalMillions(23)).toBe(2.3)
    expect(bankTenthsToDecimalMillions(100)).toBe(10)
    expect(bankTenthsToDecimalMillions(0)).toBe(0)
  })
})

describe('now_cost is treated as decimal millions and never as integer tenths', () => {
  it('buildPriceIndexForGameweek stores player_gameweek_history.now_cost verbatim — 5.8 stays 5.8, never scaled to 58', () => {
    const rows: PlayerGameweekHistoryRow[] = [{ season: '2026-2027', gameweek: 3, playerCode: 500, nowCost: 5.8 }]
    const index = buildPriceIndexForGameweek(rows, '2026-2027', 3)
    expect(index.get(500)).toBe(5.8)
    expect(index.get(500)).not.toBe(58)
  })

  it('a converted bank (decimal millions) and a player_gameweek_history price are directly comparable without further scaling', () => {
    // A realistic gameweek: £2.3m bank (squads.bank = 23) plus a £5.5m sale should afford a
    // £7.5m player, not reject it as if the bank were still "23".
    const bankDecimalMillions = bankTenthsToDecimalMillions(23)
    const salePrice = 5.5
    const budget = bankDecimalMillions + salePrice
    expect(budget).toBeCloseTo(7.8, 5)
    const rows: PlayerGameweekHistoryRow[] = [{ season: '2026-2027', gameweek: 1, playerCode: 999, nowCost: 7.5 }]
    const priceByCode = buildPriceIndexForGameweek(rows, '2026-2027', 1)
    expect(priceByCode.get(999)!).toBeLessThanOrEqual(budget)
  })
})

describe('prices come from the transfer\'s own gameweek', () => {
  it('excludes a same-player row from a different gameweek, even when it is a cheaper/more attractive price', () => {
    const rows: PlayerGameweekHistoryRow[] = [
      { season: '2026-2027', gameweek: 2, playerCode: 300, nowCost: 12.0 }, // the transfer's own gameweek — must be used
      { season: '2026-2027', gameweek: 3, playerCode: 300, nowCost: 4.0 }, // a LATER gameweek's price — must be invisible (would be a lookahead leak)
      { season: '2026-2027', gameweek: 1, playerCode: 300, nowCost: 20.0 }, // an EARLIER gameweek's price — must also be invisible
    ]
    const index = buildPriceIndexForGameweek(rows, '2026-2027', 2)
    expect(index.get(300)).toBe(12.0)
  })

  it('excludes a different season\'s row for the same (gameweek, player_code)', () => {
    const rows: PlayerGameweekHistoryRow[] = [
      { season: '2025-2026', gameweek: 2, playerCode: 300, nowCost: 99.0 },
      { season: '2026-2027', gameweek: 2, playerCode: 300, nowCost: 12.0 },
    ]
    const index = buildPriceIndexForGameweek(rows, '2026-2027', 2)
    expect(index.get(300)).toBe(12.0)
  })
})

// ============================================================================
// A roll is scored as a roll, not as a zero-point transfer.
// ============================================================================

describe('a roll (no transfer) is scored as a roll, not as a zero-point transfer', () => {
  it('classifySnapshot returns kind "roll" for an isRoll snapshot, never a transfer with null codes coerced to a gain of zero', () => {
    const classification = classifySnapshot(rollSnapshot())
    expect(classification.kind).toBe('roll')
  })

  it('evaluateTransferGameweek excludes a roll gameweek by name, and it never appears among the scored (ok: true) results', () => {
    const actuals: ActualsByGameweek = new Map([[10, new Map([[200, 5]])]])
    const result = evaluateTransferGameweek({
      gameweekId: 10,
      snapshot: rollSnapshot(),
      oneGwIds: [10],
      fiveGwIds: [10, 11, 12, 13, 14],
      actualsByGameweek: actuals,
      playersByCode: new Map(),
      priceByCode: new Map(),
      bankTenths: 0,
      candidatesExcludingSquad: () => [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('roll')
      expect(result.detail.length).toBeGreaterThan(0)
    }
  })

  it('a gain of exactly 0 for a REAL transfer (e.g. incoming == outgoing points, no hit) is still scored as a transfer, distinguishing it from an excluded roll', () => {
    const actuals: ActualsByGameweek = new Map([[10, new Map([[200, 5], [201, 5]])]])
    const result = evaluateTransferGameweek({
      gameweekId: 10,
      snapshot: transferSnapshot({ hitCost: 0 }),
      oneGwIds: [10],
      fiveGwIds: [10],
      actualsByGameweek: actuals,
      playersByCode: new Map(),
      priceByCode: new Map(),
      bankTenths: null,
      candidatesExcludingSquad: () => [],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.oneGw.gain).toBe(0)
      expect(result.oneGw.exclusionReason).toBeNull()
    }
  })
})

// ============================================================================
// Hit cost is subtracted exactly once.
// ============================================================================

describe('hit cost is subtracted exactly once', () => {
  it('computeNetGain subtracts hitCost once regardless of how many gameweeks the summed points already cover', () => {
    // Following gameweek: incoming 8, outgoing 3, hit 4 -> 8 - 3 - 4 = 1
    expect(computeNetGain(8, 3, 4)).toBe(1)
    // Five-gameweek horizon: incoming SUM 40, outgoing SUM 15, hit STILL 4 (not 4*5=20) -> 40 - 15 - 4 = 21
    expect(computeNetGain(40, 15, 4)).toBe(21)
  })

  it('evaluateTransferGameweek applies the same hitCost to both the 1-gameweek and 5-gameweek horizons, never multiplying it by horizon length', () => {
    const actuals: ActualsByGameweek = new Map([
      [10, new Map([[200, 3], [201, 8]])],
      [11, new Map([[200, 3], [201, 8]])],
      [12, new Map([[200, 3], [201, 8]])],
      [13, new Map([[200, 3], [201, 8]])],
      [14, new Map([[200, 3], [201, 8]])],
    ])
    const result = evaluateTransferGameweek({
      gameweekId: 10,
      snapshot: transferSnapshot({ hitCost: 4 }),
      oneGwIds: [10],
      fiveGwIds: [10, 11, 12, 13, 14],
      actualsByGameweek: actuals,
      playersByCode: new Map(),
      priceByCode: new Map(),
      bankTenths: null,
      candidatesExcludingSquad: () => [],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.oneGw.gain).toBe(8 - 3 - 4) // 1
      expect(result.fiveGw.gain).toBe(40 - 15 - 4) // 21, not 40 - 15 - 20
    }
  })
})

// ============================================================================
// A gameweek with no snapshot is excluded and named.
// ============================================================================

describe('a gameweek with no snapshot is excluded and named', () => {
  it('evaluateTransferGameweek returns reason "noSnapshot" when snapshot is undefined', () => {
    const result = evaluateTransferGameweek({
      gameweekId: 7,
      snapshot: undefined,
      oneGwIds: [7],
      fiveGwIds: [7, 8, 9, 10, 11],
      actualsByGameweek: new Map(),
      playersByCode: new Map(),
      priceByCode: new Map(),
      bankTenths: null,
      candidatesExcludingSquad: () => [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('noSnapshot')
      expect(result.detail.length).toBeGreaterThan(0)
    }
  })

  it('pickLatestSnapshotByGameweek never invents an entry for a gameweek with zero plan_snapshot rows', () => {
    const map = pickLatestSnapshotByGameweek([{ recommendation_gameweek_id: 5, plan_index: 0, sent_at: '2026-09-01T10:00:00Z', plan_snapshot: transferSnapshot() }])
    expect(map.has(5)).toBe(true)
    expect(map.has(6)).toBe(false)
  })

  it('renderScorecard lists an excluded, unsnapshotted gameweek by number and reason in the excluded table', () => {
    const report = renderScorecard(
      [{ gameweekId: 9, ok: false, reason: 'noSnapshot', detail: 'no notifications.plan_snapshot was recorded for this gameweek.' }],
      '2026-09-18T00:00:00.000Z',
    )
    expect(report).toContain('9')
    expect(report).toContain('noSnapshot')
  })
})

// ============================================================================
// The affordable ceiling respects both bank and the 3-per-club limit.
// ============================================================================

describe('the affordable ceiling respects the bank constraint', () => {
  it('rejects a candidate priced above budget even when it is the highest-scoring option', () => {
    const squad = [player(200, 1, 3)] // one MID from club 1, being replaced
    const outgoing = squad[0]
    const candidates = [player(300, 2, 3), player(301, 3, 3)]
    const priceByCode = new Map([[300, 15.0], [301, 5.0]])
    const pointsByCode = new Map([[200, 2], [300, 20], [301, 6]]) // 300 scores far more but is unaffordable
    const result = computeCeiling(squad, outgoing, 6.0, priceByCode, pointsByCode, candidates)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bestCode).toBe(301)
      expect(result.ceilingGain).toBe(6 - 2)
    }
  })

  it('findAffordableCandidates excludes anything strictly over budget and includes anything at exactly budget', () => {
    const squad = [player(200, 1, 3)]
    const outgoing = squad[0]
    const candidates = [player(301, 2, 3), player(302, 2, 3)]
    const priceByCode = new Map([[301, 6.0], [302, 6.01]])
    const affordable = findAffordableCandidates(squad, outgoing, 6.0, priceByCode, candidates)
    expect(affordable.map((c) => c.code)).toEqual([301])
  })
})

describe('the affordable ceiling respects the 3-per-club limit', () => {
  it('excludes a candidate whose club would rise to 4 in the resulting squad', () => {
    // Squad already has 3 players from club 9 (none of them the outgoing player).
    const squad = [player(1, 9, 2), player(2, 9, 2), player(3, 9, 2), player(200, 5, 3)]
    const outgoing = player(200, 5, 3)
    const candidateFromFullClub = player(301, 9, 3) // would make club 9's count 4 — illegal
    const candidateFromOtherClub = player(302, 6, 3)
    const priceByCode = new Map([[301, 5.0], [302, 5.0]])
    const affordable = findAffordableCandidates(squad, outgoing, 10.0, priceByCode, [candidateFromFullClub, candidateFromOtherClub])
    expect(affordable.map((c) => c.code)).toEqual([302])
  })

  it('allows a same-club replacement when the outgoing player is the one vacating that club slot (net count unchanged)', () => {
    // Squad has 3 players from club 9, one of them (200) is the outgoing player itself.
    const squad = [player(1, 9, 3), player(2, 9, 3), player(200, 9, 3)]
    const outgoing = player(200, 9, 3)
    const sameClubReplacement = player(301, 9, 3) // replaces 200 within club 9 — net count stays 3, legal
    const priceByCode = new Map([[301, 5.0]])
    const affordable = findAffordableCandidates(squad, outgoing, 10.0, priceByCode, [sameClubReplacement])
    expect(affordable.map((c) => c.code)).toEqual([301])
  })

  it('MAX_PLAYERS_PER_CLUB is the standard FPL limit of 3', () => {
    expect(MAX_PLAYERS_PER_CLUB).toBe(3)
  })
})

describe('the affordable ceiling only considers same-position alternatives', () => {
  it('excludes a candidate of a different element_type from the outgoing player, even if affordable and high-scoring', () => {
    const squad = [player(200, 1, 4)] // a forward (element_type 4)
    const outgoing = squad[0]
    const wrongPosition = player(301, 2, 3) // a midfielder
    const rightPosition = player(302, 2, 4)
    const priceByCode = new Map([[301, 5.0], [302, 5.0]])
    const pointsByCode = new Map([[200, 2], [301, 20], [302, 6]])
    const result = computeCeiling(squad, outgoing, 10.0, priceByCode, pointsByCode, [wrongPosition, rightPosition])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bestCode).toBe(302)
  })
})

// ============================================================================
// Supporting pure-function tests — the rest of the module's behaviour.
// ============================================================================

describe('computeNetGain', () => {
  it('is incoming minus outgoing minus hit cost, signed (negative when the transfer underperformed rolling)', () => {
    expect(computeNetGain(2, 5, 0)).toBe(-3)
  })
})

describe('poolGains', () => {
  it('pools from the underlying gains directly (sum then divide), never averages already-computed means', () => {
    const pooled = poolGains([3, -1, 5])
    expect(pooled.n).toBe(3)
    expect(pooled.totalGain).toBe(7)
    expect(pooled.meanGain).toBeCloseTo(7 / 3, 10)
    expect(pooled.negativeCount).toBe(1)
  })

  it('returns null (never 0) for meanGain on an empty input — an unmeasured mean must never read as measured and zero', () => {
    const pooled = poolGains([])
    expect(pooled.n).toBe(0)
    expect(pooled.meanGain).toBeNull()
  })
})

describe('sumActualPoints', () => {
  it('sums across every gameweek in the list for one player code', () => {
    const actuals: ActualsByGameweek = new Map([
      [1, new Map([[500, 4]])],
      [2, new Map([[500, 6]])],
    ])
    expect(sumActualPoints(actuals, [1, 2], 500)).toBe(10)
  })

  it('returns null (never a partial sum) when any gameweek in the list is missing an actual for the player', () => {
    const actuals: ActualsByGameweek = new Map([[1, new Map([[500, 4]])]])
    expect(sumActualPoints(actuals, [1, 2], 500)).toBeNull()
  })
})

describe('buildSummedPointsByCode', () => {
  it('only keeps codes with a settled actual in every gameweek of the horizon', () => {
    const actuals: ActualsByGameweek = new Map([
      [1, new Map([[100, 2], [200, 3]])],
      [2, new Map([[100, 4]])], // 200 missing this gameweek
    ])
    const summed = buildSummedPointsByCode(actuals, [1, 2])
    expect(summed.get(100)).toBe(6)
    expect(summed.has(200)).toBe(false)
  })
})

describe('pickBestByPoints', () => {
  it('picks the highest-points candidate, breaking ties on the lower player code', () => {
    const candidates = [player(10, 1, 3), player(11, 1, 3), player(12, 1, 3)]
    const pointsByCode = new Map([[10, 5], [11, 7], [12, 7]])
    expect(pickBestByPoints(candidates, pointsByCode)).toEqual({ code: 11, points: 7 })
  })

  it('skips a candidate with no recorded points and returns null when nothing qualifies', () => {
    expect(pickBestByPoints([player(1, 1, 1)], new Map())).toBeNull()
  })
})

describe('buildPreTransferSquadCodes', () => {
  it('swaps the transferred-in code back to the transferred-out code across starting XI + bench', () => {
    const snapshot = transferSnapshot()
    const pre = buildPreTransferSquadCodes(snapshot, 201, 200)
    expect(pre).not.toBeNull()
    expect(pre).toContain(200)
    expect(pre).not.toContain(201)
    expect(pre!.length).toBe(15)
  })

  it('returns null (a reconstruction failure) when startingXi + benchOrder together are not exactly 15 codes', () => {
    const snapshot = transferSnapshot({ startingXi: [201, 2, 3] }) // too few
    expect(buildPreTransferSquadCodes(snapshot, 201, 200)).toBeNull()
  })
})

describe('horizonGameweekIds', () => {
  it('slices `length` ascending ids starting at (and including) startId', () => {
    expect(horizonGameweekIds([1, 2, 3, 4, 5, 6, 7], 3, 5)).toEqual([3, 4, 5, 6, 7])
  })

  it('returns fewer than `length` ids at the end of the known season rather than inventing ids past the last one', () => {
    expect(horizonGameweekIds([1, 2, 3], 2, 5)).toEqual([2, 3])
  })

  it('returns an empty array when startId is not present at all', () => {
    expect(horizonGameweekIds([1, 2, 3], 99, 5)).toEqual([])
  })
})

describe('buildActualsByGameweek', () => {
  it('excludes rows with no player_code, counting them rather than guessing a code', () => {
    const { byGameweek, noPlayerCodeCount } = buildActualsByGameweek([
      { gameweek_id: 1, player_code: null, actual_points: 5, settled_at: '2026-09-01T00:00:00Z', captured_at: '2026-08-30T00:00:00Z' },
      { gameweek_id: 1, player_code: 100, actual_points: 3, settled_at: '2026-09-01T00:00:00Z', captured_at: '2026-08-30T00:00:00Z' },
    ])
    expect(noPlayerCodeCount).toBe(1)
    expect(byGameweek.get(1)?.get(100)).toBe(3)
  })

  it('excludes unsettled rows entirely', () => {
    const { byGameweek } = buildActualsByGameweek([{ gameweek_id: 1, player_code: 100, actual_points: 3, settled_at: null, captured_at: '2026-08-30T00:00:00Z' }])
    expect(byGameweek.has(1)).toBe(false)
  })

  it('keeps the most recently captured row when two settled rows disagree for the same (gameweek, player_code)', () => {
    const { byGameweek } = buildActualsByGameweek([
      { gameweek_id: 1, player_code: 100, actual_points: 3, settled_at: '2026-09-01T00:00:00Z', captured_at: '2026-08-30T00:00:00Z' },
      { gameweek_id: 1, player_code: 100, actual_points: 5, settled_at: '2026-09-01T00:00:00Z', captured_at: '2026-08-31T00:00:00Z' },
    ])
    expect(byGameweek.get(1)?.get(100)).toBe(5)
  })
})

describe('classifySnapshot', () => {
  it('returns kind "invalid" (never guesses a transfer) when isRoll is false but a transfer side is null', () => {
    const broken = transferSnapshot({ transferIn: null })
    const result = classifySnapshot(broken)
    expect(result.kind).toBe('invalid')
  })

  it('returns the transfer codes and hit cost verbatim for a real transfer', () => {
    const result = classifySnapshot(transferSnapshot({ hitCost: 8 }))
    expect(result).toEqual({ kind: 'transfer', transferInCode: 201, transferOutCode: 200, hitCost: 8 })
  })
})

describe('renderScorecard', () => {
  it('states the early-season sample-size limitation explicitly, matching scripts/bonus-validation-report.ts\'s own convention', () => {
    const report = renderScorecard([], '2026-09-18T00:00:00.000Z')
    expect(report).toMatch(/No measurable transfer gameweeks yet/i)
  })

  it('states the four-gameweek ceiling by name, in its own heading, matching scripts/bonus-validation-report.ts\'s shape', () => {
    const report = renderScorecard([], '2026-09-18T00:00:00.000Z')
    expect(report).toContain('## The four-gameweek limitation')
    expect(report).toMatch(/at most four\s+gameweeks/i)
  })

  it('prints the pooled headline figure — how many gameweeks gained less than rolling — for a scored population', () => {
    const actuals: ActualsByGameweek = new Map([[10, new Map([[200, 8], [201, 3]])]]) // incoming underperforms outgoing
    const result = evaluateTransferGameweek({
      gameweekId: 10,
      snapshot: transferSnapshot({ hitCost: 0, transferIn: { code: 201 }, transferOut: { code: 200 } }),
      oneGwIds: [10],
      fiveGwIds: [10],
      actualsByGameweek: actuals,
      playersByCode: new Map(),
      priceByCode: new Map(),
      bankTenths: null,
      candidatesExcludingSquad: () => [],
    })
    expect(result.ok).toBe(true)
    const report = renderScorecard([result], '2026-09-18T00:00:00.000Z')
    expect(report).toMatch(/gained less than rolling/i)
    expect(report).toContain('1/1')
  })
})

// ============================================================================
// End-to-end: evaluateTransferGameweek with a full, realistic squad/price/bank setup, proving the
// budget = pre-transfer bank + outgoing player's own sale price arithmetic and the whole pipeline
// composes correctly.
// ============================================================================

describe('evaluateTransferGameweek — end to end', () => {
  function fullSquad(): CandidatePlayer[] {
    // 2 GK, 5 DEF, 5 MID, 3 FWD — codes 1..15, spread across enough clubs to stay under the
    // 3-per-club limit, with code 200 (outgoing) as one of the MIDs, club 7.
    return [
      player(1, 1, 1), player(16, 2, 1), // GKs
      player(2, 1, 2), player(3, 2, 2), player(4, 3, 2), player(5, 4, 2), player(6, 5, 2), // DEF
      player(200, 7, 3), player(7, 6, 3), player(8, 8, 3), player(9, 9, 3), player(13, 13, 3), // MID (200 is outgoing)
      player(10, 10, 4), player(11, 11, 4), player(12, 12, 4), // FWD
    ]
  }

  it('computes the ceiling budget as pre-transfer bank + outgoing player\'s own sale price, both in decimal millions', () => {
    const squad = fullSquad()
    const playersByCode = new Map(squad.map((p) => [p.code, p]))
    playersByCode.set(201, player(201, 20, 3)) // the incoming player, a MID from an unrelated club

    const snapshot: RawPlanSnapshot = {
      isRoll: false,
      transferIn: { code: 201 },
      transferOut: { code: 200 },
      startingXi: squad.filter((p) => p.code !== 200).map((p) => p.code).slice(0, 10).concat(201),
      benchOrder: squad.filter((p) => p.code !== 200).map((p) => p.code).slice(10),
      hitCost: 0,
    }
    // Sanity: startingXi + benchOrder together must be exactly 15 codes (14 unchanged + incoming).
    expect(snapshot.startingXi.length + snapshot.benchOrder.length).toBe(15)

    const priceByCode = new Map([
      [200, 6.0], // outgoing player's own price this gameweek
      [201, 9.0], // incoming, affordable at bank(2.3) + sale(6.0) = 8.3? No -- see below, this is the ISSUED transfer's own price, not constrained by this test's ceiling search.
      [300, 8.0], // an affordable ceiling candidate, MID, unrelated club
      [301, 20.0], // an unaffordable ceiling candidate
    ])
    const candidatePool = [player(300, 21, 3), player(301, 22, 3)]

    const actuals: ActualsByGameweek = new Map([[5, new Map([[200, 2], [201, 9], [300, 11], [301, 30]])]])

    const result = evaluateTransferGameweek({
      gameweekId: 5,
      snapshot,
      oneGwIds: [5],
      fiveGwIds: [5],
      actualsByGameweek: actuals,
      playersByCode,
      priceByCode,
      bankTenths: 23, // £2.3m
      candidatesExcludingSquad: () => candidatePool,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Realised gain: incoming 9 - outgoing 2 - hit 0 = 7.
    expect(result.oneGw.gain).toBe(7)
    // Ceiling budget = 2.3 + 6.0 = 8.3m -> candidate 300 (8.0m) affordable, 301 (20.0m) is not.
    expect(result.oneGw.ceiling?.ok).toBe(true)
    if (result.oneGw.ceiling?.ok) {
      expect(result.oneGw.ceiling.bestCode).toBe(300)
      expect(result.oneGw.ceiling.ceilingGain).toBe(11 - 2)
    }
  })
})
