import { describe, expect, it } from 'vitest'
import {
  applyTransferToShape,
  bestAvailableAmongStarters,
  buildRollShape,
  compareNetPoints,
  computeNetPoints,
  evaluateCaptaincy,
  evaluateCaptaincyRegret,
  pairedNetGap,
  pickDecisionForGameweek,
  pickLatestSnapshotByGameweek,
  pickNaiveCaptain,
  poolCaptaincyFigure,
  rankAmongStarters,
  reconcile,
  renderCaptaincyRegretSection,
  renderScorecard,
  resolvePlanA,
  resolveRollCaptaincy,
  scoreGameweek,
  scoreSquad,
  shapeContainsPlayer,
  snapshotToPlanRecord,
  summarizeCaptaincy,
  summarizeViceEffect,
  sumGross,
  sumNet,
  type ActualsByPlayer,
  type CaptainPick,
  type CaptaincyRegretResult,
  type CaptaincyRegretScored,
  type DecisionRecord,
  type GameweekPlans,
  type PlanRecord,
  type RawPlanSnapshot,
  type ScoredEntity,
  type SquadSlot,
  type ViceEffect,
} from './recommendation-scorecard.ts'

function slots(ids: readonly number[]): SquadSlot[] {
  return ids.map((playerId) => ({ playerId }))
}

function actuals(entries: readonly [number, number, number][]): ActualsByPlayer {
  const map = new Map<number, { points: number; minutes: number }>()
  for (const [playerId, points, minutes] of entries) {
    map.set(playerId, { points, minutes })
  }
  return map
}

/** A standard 11-man XI (ids 1-11) with a couple of convenience defaults. */
const STANDARD_XI_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

function standardPlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    gameweekId: 5,
    planIndex: 0,
    isRoll: true,
    transferInPlayerId: null,
    transferOutPlayerId: null,
    captainPlayerId: 9,
    viceCaptainPlayerId: 10,
    startingXi: slots(STANDARD_XI_IDS),
    benchOrder: slots([12, 13, 14, 15]),
    hitCost: 0,
    ...overrides,
  }
}

/** Every starter scores 2 points and plays 90 minutes, by default —
 *  overridden per test for the player(s) under test. Any override key not
 *  already in the standard 15 (e.g. a transfer-in from outside the squad) is
 *  added too, with exactly the override's own values. */
function flatActuals(overrides: Record<number, { points: number; minutes: number }> = {}): ActualsByPlayer {
  const ids = new Set([...STANDARD_XI_IDS, 12, 13, 14, 15, ...Object.keys(overrides).map(Number)])
  const entries: [number, number, number][] = []
  for (const id of ids) {
    const o = overrides[id]
    entries.push([id, o ? o.points : 2, o ? o.minutes : 90])
  }
  return actuals(entries)
}

describe('scoreSquad', () => {
  it('doubles the captain and reports gross points', () => {
    const result = scoreSquad(slots(STANDARD_XI_IDS), 9, 10, flatActuals())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 11 starters x 2 = 22, plus one extra copy of the captain's 2 points.
    expect(result.grossPoints).toBe(24)
    expect(result.effectiveCaptainPlayerId).toBe(9)
    expect(result.captainPromotedToVice).toBe(false)
  })

  // Named DoD test: "a plan whose captain blanks".
  it('a plan whose captain blanks contributes no extra points from doubling a zero', () => {
    const result = scoreSquad(slots(STANDARD_XI_IDS), 9, 10, flatActuals({ 9: { points: 0, minutes: 90 } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 10 starters x 2 + captain's own 0 = 20, plus one extra copy of 0.
    expect(result.grossPoints).toBe(20)
    expect(result.effectiveCaptainPlayerId).toBe(9)
  })

  it('promotes the vice-captain when the named captain did not play', () => {
    const result = scoreSquad(
      slots(STANDARD_XI_IDS),
      9,
      10,
      flatActuals({ 9: { points: 0, minutes: 0 }, 10: { points: 5, minutes: 90 } }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 10 starters (incl. captain's own 0) x mostly 2 + vice's 5 once, plus one extra copy of vice's 5.
    // 9 starters at 2 (18) + captain at 0 (0) + vice at 5 (5) = 23, + 5 extra = 28.
    expect(result.grossPoints).toBe(28)
    expect(result.effectiveCaptainPlayerId).toBe(10)
    expect(result.captainPromotedToVice).toBe(true)
  })

  it('voids the armband when neither captain nor vice-captain played', () => {
    const result = scoreSquad(
      slots(STANDARD_XI_IDS),
      9,
      10,
      flatActuals({ 9: { points: 0, minutes: 0 }, 10: { points: 0, minutes: 0 } }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.grossPoints).toBe(9 * 2) // no doubling at all
    expect(result.effectiveCaptainPlayerId).toBeNull()
  })

  // Named DoD test: "a gameweek with a player who did not feature".
  it('a player who did not feature is a real settled zero, not a missing actual', () => {
    const result = scoreSquad(slots(STANDARD_XI_IDS), 9, 10, flatActuals({ 3: { points: 0, minutes: 0 } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.starterPoints.get(3)).toBe(0)
  })

  it('fails, naming the missing player, when a starter has no settled actual at all', () => {
    const partial = flatActuals()
    const withoutOne = new Map(partial)
    withoutOne.delete(7)
    const result = scoreSquad(slots(STANDARD_XI_IDS), 9, 10, withoutOne)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missingPlayerIds).toEqual([7])
  })

  it('fails when the named captain is not actually in the starting XI', () => {
    const result = scoreSquad(slots(STANDARD_XI_IDS), 99, 10, flatActuals())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missingPlayerIds).toContain(99)
  })
})

describe('computeNetPoints / compareNetPoints', () => {
  // Named DoD test: "a plan with a hit".
  it('subtracts the hit cost', () => {
    expect(computeNetPoints(30, 4)).toBe(26)
  })

  // Named DoD test, verbatim from the ticket: "a −4 plan that outscores a
  // roll by 3 is correctly reported as the worse decision."
  it('a -4 plan that outscores a roll by 3 is reported as the worse decision', () => {
    const rollGross = 40
    const rollNet = computeNetPoints(rollGross, 0)
    const planGross = rollGross + 3
    const planNet = computeNetPoints(planGross, 4)
    expect(compareNetPoints(planNet, rollNet)).toBe('worse')
    expect(planNet).toBe(rollNet - 1)
  })

  it('reports equal net points as equal, not better or worse', () => {
    expect(compareNetPoints(10, 10)).toBe('equal')
  })
})

describe('buildRollShape / resolveRollCaptaincy', () => {
  // Named DoD test: "a roll week".
  it('a roll plan is its own roll shape', () => {
    const plan = standardPlan({ isRoll: true, transferInPlayerId: null, transferOutPlayerId: null })
    const roll = buildRollShape(plan)
    expect(roll.startingXi).toEqual(plan.startingXi)
    expect(roll.benchOrder).toEqual(plan.benchOrder)
  })

  it('undoes a transfer into the starting XI', () => {
    const plan = standardPlan({ isRoll: false, transferInPlayerId: 9, transferOutPlayerId: 99 })
    const roll = buildRollShape(plan)
    expect(roll.startingXi.map((s) => s.playerId)).not.toContain(9)
    expect(roll.startingXi.map((s) => s.playerId)).toContain(99)
  })

  it('undoes a transfer into the bench, leaving the starting XI untouched', () => {
    const plan = standardPlan({ isRoll: false, transferInPlayerId: 12, transferOutPlayerId: 99, benchOrder: slots([12, 13, 14, 15]) })
    const roll = buildRollShape(plan)
    expect(roll.startingXi).toEqual(plan.startingXi)
    expect(roll.benchOrder.map((s) => s.playerId)).toContain(99)
    expect(roll.benchOrder.map((s) => s.playerId)).not.toContain(12)
  })

  it('falls back the armband to the vice-captain when the captain was the transferred-in player', () => {
    const plan = standardPlan({ isRoll: false, transferInPlayerId: 9, transferOutPlayerId: 99, captainPlayerId: 9, viceCaptainPlayerId: 10 })
    const roll = buildRollShape(plan)
    const captaincy = resolveRollCaptaincy(plan, roll)
    expect(captaincy.captainPlayerId).toBe(10)
    // The original vice-captain (10) is still in the roll squad, so it stays
    // the vice-captain too — captain and vice-captain both resolving to the
    // same player is a harmless degenerate case: scoreSquad only reads
    // viceCaptainPlayerId as a fallback when the captain doesn't play, and
    // captainPlayerId (10) always does in this scenario.
    expect(captaincy.viceCaptainPlayerId).toBe(10)
  })
})

describe('applyTransferToShape / shapeContainsPlayer', () => {
  it('swaps the named players and leaves everything else untouched', () => {
    const base = { startingXi: slots(STANDARD_XI_IDS), benchOrder: slots([12, 13, 14, 15]) }
    const applied = applyTransferToShape(base, 5, 55)
    expect(applied.startingXi.map((s) => s.playerId)).toContain(55)
    expect(applied.startingXi.map((s) => s.playerId)).not.toContain(5)
  })

  it('is a no-op for a roll decision (null ids)', () => {
    const base = { startingXi: slots(STANDARD_XI_IDS), benchOrder: slots([12, 13, 14, 15]) }
    expect(applyTransferToShape(base, null, null)).toEqual(base)
  })

  it('shapeContainsPlayer checks both starting XI and bench', () => {
    const base = { startingXi: slots(STANDARD_XI_IDS), benchOrder: slots([12, 13, 14, 15]) }
    expect(shapeContainsPlayer(base, 3)).toBe(true)
    expect(shapeContainsPlayer(base, 13)).toBe(true)
    expect(shapeContainsPlayer(base, 999)).toBe(false)
  })
})

describe('evaluateCaptaincy', () => {
  it('reports a hit when the captain matched or beat the best alternative', () => {
    const starterPoints = new Map([[9, 8], [10, 5], [3, 3]])
    const outcome = evaluateCaptaincy(starterPoints, 9)
    expect(outcome).toEqual({ gap: 3, hit: true })
  })

  it('reports a miss when a starter outscored the captain', () => {
    const starterPoints = new Map([[9, 2], [10, 5], [3, 3]])
    const outcome = evaluateCaptaincy(starterPoints, 9)
    expect(outcome).toEqual({ gap: -3, hit: false })
  })

  it('treats a tie as a hit', () => {
    const starterPoints = new Map([[9, 5], [10, 5]])
    expect(evaluateCaptaincy(starterPoints, 9)).toEqual({ gap: 0, hit: true })
  })

  it('returns null when the armband was void', () => {
    expect(evaluateCaptaincy(new Map([[9, 5]]), null)).toBeNull()
  })
})

describe('pickDecisionForGameweek', () => {
  function decision(overrides: Partial<DecisionRecord>): DecisionRecord {
    return {
      kind: 'commit',
      planIndex: 0,
      decidedAt: '2026-08-25T00:00:00Z',
      isRoll: true,
      transferInPlayerId: null,
      transferOutPlayerId: null,
      captainPlayerId: 9,
      viceCaptainPlayerId: 10,
      hitCost: 0,
      ...overrides,
    }
  }

  it('returns null for no decisions', () => {
    expect(pickDecisionForGameweek([])).toBeNull()
  })

  it('prefers an override over a commit regardless of order', () => {
    const commit = decision({ kind: 'commit', decidedAt: '2026-08-25T00:00:00Z' })
    const override = decision({ kind: 'override', decidedAt: '2026-08-24T00:00:00Z' })
    expect(pickDecisionForGameweek([commit, override])).toBe(override)
    expect(pickDecisionForGameweek([override, commit])).toBe(override)
  })

  it('prefers the most recently decided among the same kind', () => {
    const earlier = decision({ kind: 'override', decidedAt: '2026-08-24T00:00:00Z' })
    const later = decision({ kind: 'override', decidedAt: '2026-08-26T00:00:00Z' })
    expect(pickDecisionForGameweek([earlier, later])).toBe(later)
  })
})

// ============================================================================
// ticket #231 — freezing the issued recommendation at send time.
// Player CODE throughout in the snapshot; player_id throughout everywhere
// else in this file (deltas.md D9, and this file's own "JOIN KEY" header
// note on why player_id is the right key HERE).
// ============================================================================

describe('snapshotToPlanRecord', () => {
  const CODE_TO_ID = new Map<number, number>([
    [5001, 1],
    [5002, 2],
    [5003, 9],
    [5004, 10],
  ])

  function rawSnapshot(overrides: Partial<RawPlanSnapshot> = {}): RawPlanSnapshot {
    return {
      isRoll: false,
      transferIn: { code: 5001 },
      transferOut: { code: 5002 },
      captainPlayerCode: 5003,
      viceCaptainPlayerCode: 5004,
      startingXi: [5001, 5003],
      benchOrder: [5004],
      hitCost: 4,
      ...overrides,
    }
  }

  it('translates every player code to the current players.id via codeToPlayerId', () => {
    const outcome = snapshotToPlanRecord(5, rawSnapshot(), CODE_TO_ID)
    expect(outcome).toEqual({
      ok: true,
      plan: {
        gameweekId: 5,
        planIndex: 0,
        isRoll: false,
        transferInPlayerId: 1,
        transferOutPlayerId: 2,
        captainPlayerId: 9,
        viceCaptainPlayerId: 10,
        startingXi: [{ playerId: 1 }, { playerId: 9 }],
        benchOrder: [{ playerId: 10 }],
        hitCost: 4,
      },
    })
  })

  it('a roll snapshot (no transfer) translates to null transferIn/Out player ids, never a fabricated player', () => {
    const outcome = snapshotToPlanRecord(5, rawSnapshot({ isRoll: true, transferIn: null, transferOut: null }), CODE_TO_ID)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.transferInPlayerId).toBeNull()
    expect(outcome.plan.transferOutPlayerId).toBeNull()
  })

  it('fails closed, naming the code, when a player code has no row in the current players table', () => {
    const outcome = snapshotToPlanRecord(5, rawSnapshot({ captainPlayerCode: 9999 }), CODE_TO_ID)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.detail).toContain('9999')
    expect(outcome.detail).toContain('gameweek 5')
  })

  it('names every missing code at once, not just the first', () => {
    const outcome = snapshotToPlanRecord(5, rawSnapshot({ captainPlayerCode: 9999, viceCaptainPlayerCode: 8888 }), CODE_TO_ID)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.detail).toContain('9999')
    expect(outcome.detail).toContain('8888')
  })
})

describe('pickLatestSnapshotByGameweek', () => {
  it('keeps the most recently sent snapshot per gameweek, regardless of input order', () => {
    const older: RawPlanSnapshot = { isRoll: true, transferIn: null, transferOut: null, captainPlayerCode: 1, viceCaptainPlayerCode: 2, startingXi: [], benchOrder: [], hitCost: 0 }
    const newer: RawPlanSnapshot = { isRoll: false, transferIn: { code: 9 }, transferOut: { code: 8 }, captainPlayerCode: 1, viceCaptainPlayerCode: 2, startingXi: [], benchOrder: [], hitCost: 4 }
    const map = pickLatestSnapshotByGameweek([
      { recommendation_gameweek_id: 5, plan_index: 0, sent_at: '2026-08-24T10:00:00Z', plan_snapshot: newer },
      { recommendation_gameweek_id: 5, plan_index: 0, sent_at: '2026-08-23T00:00:00Z', plan_snapshot: older },
    ])
    expect(map.get(5)).toBe(newer)
  })

  it('keeps separate gameweeks separate', () => {
    const a: RawPlanSnapshot = { isRoll: true, transferIn: null, transferOut: null, captainPlayerCode: 1, viceCaptainPlayerCode: 2, startingXi: [], benchOrder: [], hitCost: 0 }
    const b: RawPlanSnapshot = { isRoll: true, transferIn: null, transferOut: null, captainPlayerCode: 3, viceCaptainPlayerCode: 4, startingXi: [], benchOrder: [], hitCost: 0 }
    const map = pickLatestSnapshotByGameweek([
      { recommendation_gameweek_id: 5, plan_index: 0, sent_at: '2026-08-23T00:00:00Z', plan_snapshot: a },
      { recommendation_gameweek_id: 6, plan_index: 0, sent_at: '2026-08-30T00:00:00Z', plan_snapshot: b },
    ])
    expect(map.get(5)).toBe(a)
    expect(map.get(6)).toBe(b)
  })
})

describe('resolvePlanA — the scorecard prefers the snapshot, and falls back cleanly when there is none (ticket #231)', () => {
  const CODE_TO_ID = new Map<number, number>([
    [5001, 1],
    [5003, 9],
    [5004, 10],
  ])

  const recommendationsPlanA = standardPlan({ captainPlayerId: 999, hitCost: 8 }) // deliberately DIFFERENT from the snapshot below, so "prefers" is provable, not coincidental.

  const snapshot: RawPlanSnapshot = {
    isRoll: true,
    transferIn: null,
    transferOut: null,
    captainPlayerCode: 5003,
    viceCaptainPlayerCode: 5004,
    startingXi: [5001, 5003, 5004],
    benchOrder: [],
    hitCost: 0,
  }

  it('prefers the frozen plan_snapshot over the mutable recommendations row when one is present and resolves cleanly', () => {
    const resolved = resolvePlanA(5, recommendationsPlanA, snapshot, CODE_TO_ID)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.source).toBe('snapshot')
    // Proves it is really the snapshot's own data, not the recommendations
    // row's — the two disagree on captain and hit cost by construction above.
    expect(resolved.plan.captainPlayerId).toBe(9)
    expect(resolved.plan.hitCost).toBe(0)
    expect(resolved.plan).not.toEqual(recommendationsPlanA)
  })

  it('falls back cleanly to the recommendations-derived Plan A when no snapshot was recorded for this gameweek, and says so via `source`', () => {
    const resolved = resolvePlanA(5, recommendationsPlanA, undefined, CODE_TO_ID)
    expect(resolved).toEqual({ ok: true, source: 'recommendations', plan: recommendationsPlanA })
  })

  it('a snapshot that cannot be reconstructed today is reported as a failure, never silently downgraded to recommendations', () => {
    const unresolvable: RawPlanSnapshot = { ...snapshot, captainPlayerCode: 424242 }
    const resolved = resolvePlanA(5, recommendationsPlanA, unresolvable, CODE_TO_ID)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.detail).toContain('424242')
  })
})

describe('scoreGameweek', () => {
  function plans(overrides: Partial<GameweekPlans> = {}): GameweekPlans {
    return { a: standardPlan(), b: null, c: null, ...overrides }
  }

  it('excludes an unsettled gameweek by name', () => {
    const result = scoreGameweek(5, plans(), null, new Map(), false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsettled')
  })

  it('excludes a gameweek when Plan A is missing an actual', () => {
    const missing = new Map(flatActuals())
    missing.delete(1)
    const result = scoreGameweek(5, plans(), null, missing, true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missingActuals')
    expect(result.detail).toContain('Plan A')
  })

  // Named DoD test: "a roll week", scored end to end.
  it('scores a roll week with roll equal to Plan A', () => {
    const result = scoreGameweek(5, plans(), null, flatActuals(), true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.planA.grossPoints).toBe(result.roll.grossPoints)
    expect(result.planA.netPoints).toBe(result.roll.netPoints)
    expect(result.roll.hitCost).toBe(0)
  })

  it('scores a transfer week, with Roll reflecting the undone transfer and Plan A its own hit', () => {
    const plan = standardPlan({
      isRoll: false,
      transferInPlayerId: 9,
      transferOutPlayerId: 99,
      hitCost: 4,
      startingXi: slots([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    })
    const gwActuals = flatActuals({ 9: { points: 10, minutes: 90 }, 99: { points: 1, minutes: 90 } })
    const result = scoreGameweek(5, { a: plan, b: null, c: null }, null, gwActuals, true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Plan A: 10 outfield-2s (players 1-8,10,11) + captain 9's 10 + captain double = 20 + 10 + 10 = 40.
    expect(result.planA.grossPoints).toBe(40)
    expect(result.planA.netPoints).toBe(36)
    // Roll swaps player 9 back out for 99: 10 outfield-2s + 99's 1 + captain doubling of 99? No —
    // captain in Plan A is player 9, who is not in the roll squad, so armband falls to vice (10).
    expect(result.roll.hitCost).toBe(0)
  })

  // Named DoD test: "an overridden week".
  it('scores an overridden week using the decision transfer and captain, with net points unknown', () => {
    const plan = standardPlan({ isRoll: true })
    const decision: DecisionRecord = {
      kind: 'override',
      planIndex: 0,
      decidedAt: '2026-08-25T00:00:00Z',
      isRoll: false,
      transferInPlayerId: 20,
      transferOutPlayerId: 3,
      captainPlayerId: 11,
      viceCaptainPlayerId: 10,
      hitCost: null,
    }
    const gwActuals = flatActuals({ 20: { points: 7, minutes: 90 }, 11: { points: 4, minutes: 90 } })
    const result = scoreGameweek(5, { a: plan, b: null, c: null }, decision, gwActuals, true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.actual).not.toBeNull()
    expect(result.actual?.kind).toBe('override')
    expect(result.actual?.entity.hitCost).toBeNull()
    expect(result.actual?.entity.netPoints).toBeNull()
    // 9 flat-2 starters (1,2,4,5,6,7,8,9,10) + transferred-in 20's 7 + captain 11's 4, plus one extra copy of 11's 4.
    expect(result.actual?.entity.grossPoints).toBe(9 * 2 + 7 + 4 + 4)
  })

  it('excludes with reconstructionFailed when the override transfer-out player is not in Plan A\'s squad', () => {
    const plan = standardPlan({ isRoll: true })
    const decision: DecisionRecord = {
      kind: 'override',
      planIndex: 0,
      decidedAt: '2026-08-25T00:00:00Z',
      isRoll: false,
      transferInPlayerId: 20,
      transferOutPlayerId: 999,
      captainPlayerId: 9,
      viceCaptainPlayerId: 10,
      hitCost: null,
    }
    const result = scoreGameweek(5, { a: plan, b: null, c: null }, decision, flatActuals(), true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('reconstructionFailed')
  })

  it('carries the captaincy diagnostic through from Plan A', () => {
    const gwActuals = flatActuals({ 9: { points: 8, minutes: 90 } })
    const result = scoreGameweek(5, plans(), null, gwActuals, true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.captaincy).toEqual({ gap: 6, hit: true })
  })
})

describe('reconcile', () => {
  it('partitions every gameweek into exactly one bucket', () => {
    const counters = reconcile([
      { gameweekId: 1, ok: false, reason: 'unsettled', detail: 'x' },
      { gameweekId: 2, ok: false, reason: 'missingActuals', detail: 'x' },
      { gameweekId: 3, ok: false, reason: 'reconstructionFailed', detail: 'x' },
      {
        gameweekId: 4,
        ok: true,
        planASource: 'recommendations',
        planA: { label: 'Plan A', grossPoints: 1, hitCost: 0, netPoints: 1, effectiveCaptainPlayerId: null, captainPromotedToVice: false },
        planB: null,
        planC: null,
        roll: { label: 'Roll', grossPoints: 1, hitCost: 0, netPoints: 1, effectiveCaptainPlayerId: null, captainPromotedToVice: false },
        actual: null,
        captaincy: null,
      },
    ])
    expect(counters).toEqual({
      gameweeksRead: 4,
      gameweeksScored: 1,
      excludedUnsettled: 1,
      excludedMissingActuals: 1,
      excludedReconstructionFailed: 1,
    })
  })
})

describe('sumGross / sumNet / pairedNetGap / summarizeCaptaincy', () => {
  function entity(gross: number, net: number | null): ScoredEntity {
    return { label: 'x', grossPoints: gross, hitCost: net === null ? null : gross - net, netPoints: net, effectiveCaptainPlayerId: null, captainPromotedToVice: false }
  }

  it('sums gross over every present entity', () => {
    expect(sumGross([entity(10, 10), null, entity(20, 20)])).toEqual({ n: 2, total: 30 })
  })

  it('sums net only over entities with a known net figure', () => {
    expect(sumNet([entity(10, 10), entity(20, null), entity(5, 5)])).toEqual({ n: 2, total: 15 })
  })

  it('pairs a gap only where both sides are known', () => {
    expect(pairedNetGap([10, 20, null], [5, null, 5])).toEqual({ n: 1, total: 5 })
  })

  it('summarizes captaincy hit rate and cumulative gap, ignoring void armbands', () => {
    const summary = summarizeCaptaincy([{ gap: 3, hit: true }, { gap: -2, hit: false }, null])
    expect(summary).toEqual({ n: 2, hits: 1, cumulativeGap: 1 })
  })
})

describe('renderScorecard', () => {
  it('always states the sample size, the signal threshold, and the price-blocker note', () => {
    const report = renderScorecard({
      generatedAtIso: '2026-09-11T00:00:00Z',
      results: [
        {
          gameweekId: 1,
          ok: true,
          planASource: 'recommendations',
          planA: { label: 'Plan A', grossPoints: 40, hitCost: 0, netPoints: 40, effectiveCaptainPlayerId: 1, captainPromotedToVice: false },
          planB: null,
          planC: null,
          roll: { label: 'Roll', grossPoints: 38, hitCost: 0, netPoints: 38, effectiveCaptainPlayerId: 1, captainPromotedToVice: false },
          actual: null,
          captaincy: { gap: 2, hit: true },
        },
      ],
      counters: { gameweeksRead: 1, gameweeksScored: 1, excludedUnsettled: 0, excludedMissingActuals: 0, excludedReconstructionFailed: 0 },
      conflictingPlayerCount: 0,
    })
    expect(report).toContain('n=1')
    expect(report).toContain('20 settled gameweeks')
    expect(report).toContain('more settled gameweek(s) needed')
    expect(report).toContain('No 2025/26 replay')
    expect(report).toContain('upserted in place')
  })

  it('names the Plan A source per scored gameweek — ticket #231: a scorecard that silently mixes frozen and mutable sources is worse than one that says which it had', () => {
    const entity = (label: string): ScoredEntity => ({ label, grossPoints: 40, hitCost: 0, netPoints: 40, effectiveCaptainPlayerId: 1, captainPromotedToVice: false })
    const report = renderScorecard({
      generatedAtIso: '2026-09-11T00:00:00Z',
      results: [
        { gameweekId: 1, ok: true, planASource: 'snapshot', planA: entity('Plan A'), planB: null, planC: null, roll: entity('Roll'), actual: null, captaincy: null },
        { gameweekId: 2, ok: true, planASource: 'recommendations', planA: entity('Plan A'), planB: null, planC: null, roll: entity('Roll'), actual: null, captaincy: null },
      ],
      counters: { gameweeksRead: 2, gameweeksScored: 2, excludedUnsettled: 0, excludedMissingActuals: 0, excludedReconstructionFailed: 0 },
      conflictingPlayerCount: 0,
    })

    // Both source labels appear, and specifically on the row for the
    // gameweek that has them — not just present somewhere in the report.
    const gw1Row = report.split('\n').find((line) => line.startsWith('| 1 |'))
    const gw2Row = report.split('\n').find((line) => line.startsWith('| 2 |'))
    expect(gw1Row).toContain('snapshot')
    expect(gw2Row).toContain('recommendations')
    expect(report).toContain('1/2 scored gameweek(s) use the frozen')
  })

  it('appends the captaincy-regret section (ticket #249), defaulting to empty when not provided', () => {
    const minimalInput = {
      generatedAtIso: '2026-09-17T00:00:00Z',
      results: [],
      counters: { gameweeksRead: 0, gameweeksScored: 0, excludedUnsettled: 0, excludedMissingActuals: 0, excludedReconstructionFailed: 0 },
      conflictingPlayerCount: 0,
    }
    expect(() => renderScorecard(minimalInput)).not.toThrow()
    const withSection = renderScorecard({ ...minimalInput, captaincyRegret: [scoredRow(1, { triggered: false })] })
    expect(withSection).toContain('Captaincy — regret and rank against a naive baseline')
  })
})

// ============================================================================
// Ticket #249 — captaincy regret and rank against a naive baseline.
// ============================================================================

/** Every starter carries the same projected points by default — overridden
 *  per test for the player(s) under test, same convention as flatActuals. */
function projectedPoints(overrides: Record<number, number> = {}): Map<number, number> {
  const map = new Map<number, number>()
  for (const id of STANDARD_XI_IDS) {
    map.set(id, overrides[id] ?? 3)
  }
  return map
}

function dummyPick(overrides: Partial<CaptainPick> = {}): CaptainPick {
  return { playerId: 1, actualPoints: 5, bestAvailableActualPoints: 5, regret: 0, rank: 1, ...overrides }
}

function scoredRow(gameweekId: number, viceEffect: ViceEffect): CaptaincyRegretScored {
  return {
    gameweekId,
    ok: true,
    chosen: dummyPick(),
    naive: dummyPick(),
    namedCaptainPlayerId: 1,
    namedCaptainMinutes: 90,
    viceEffect,
  }
}

describe('rankAmongStarters', () => {
  it('standard competition ranking: ties share the better rank and the next distinct score skips accordingly', () => {
    const starterPoints = new Map([
      [1, 10],
      [2, 10],
      [3, 5],
      [4, 2],
    ])
    expect(rankAmongStarters(starterPoints, 1)).toBe(1)
    expect(rankAmongStarters(starterPoints, 2)).toBe(1)
    expect(rankAmongStarters(starterPoints, 3)).toBe(3)
    expect(rankAmongStarters(starterPoints, 4)).toBe(4)
  })

  it('the sole top scorer is rank 1', () => {
    const starterPoints = new Map([
      [1, 10],
      [2, 4],
    ])
    expect(rankAmongStarters(starterPoints, 1)).toBe(1)
    expect(rankAmongStarters(starterPoints, 2)).toBe(2)
  })
})

describe('bestAvailableAmongStarters', () => {
  it('picks the highest actual score', () => {
    const starterPoints = new Map([
      [1, 4],
      [2, 9],
      [3, 2],
    ])
    expect(bestAvailableAmongStarters(starterPoints)).toEqual({ playerId: 2, points: 9 })
  })

  it('breaks a tie for the best score to the lowest player id', () => {
    const starterPoints = new Map([
      [5, 10],
      [2, 10],
      [9, 3],
    ])
    expect(bestAvailableAmongStarters(starterPoints)).toEqual({ playerId: 2, points: 10 })
  })
})

describe('pickNaiveCaptain', () => {
  it('picks the starter with the highest projected points', () => {
    const projected = new Map([
      [1, 5],
      [2, 5],
      [3, 9],
    ])
    expect(pickNaiveCaptain([1, 2, 3], projected)).toBe(3)
  })

  it('breaks a tie for the highest projection to the lowest player id', () => {
    const projected = new Map([
      [1, 5],
      [2, 5],
    ])
    expect(pickNaiveCaptain([1, 2], projected)).toBe(1)
  })
})

describe('evaluateCaptaincyRegret', () => {
  // Named DoD test.
  it('regret is 0 when the chosen captain was in fact the best', () => {
    const gwActuals = flatActuals({ 9: { points: 10, minutes: 90 } })
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projectedPoints())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chosen.playerId).toBe(9)
    expect(result.chosen.bestAvailableActualPoints).toBe(10)
    expect(result.chosen.regret).toBe(0)
    expect(result.chosen.rank).toBe(1)
  })

  // Named DoD test.
  it('rank is computed correctly when there are tied actual scores', () => {
    // Captain (9) and player 1 are tied for the best actual score.
    const gwActuals = flatActuals({ 9: { points: 8, minutes: 90 }, 1: { points: 8, minutes: 90 } })
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projectedPoints())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chosen.rank).toBe(1) // tied for best -> still rank 1
    expect(result.chosen.regret).toBe(0) // tied for best -> no regret
  })

  it('regret is positive, and rank worse than 1, when a non-captained starter actually scored best', () => {
    const gwActuals = flatActuals({ 9: { points: 4, minutes: 90 }, 3: { points: 12, minutes: 90 } })
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projectedPoints())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chosen.bestAvailableActualPoints).toBe(12)
    expect(result.chosen.regret).toBe(8)
    expect(result.chosen.rank).toBeGreaterThan(1)
  })

  it('excludes as reconstructionFailed when the named captain or vice-captain is not part of the starting eleven', () => {
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 99, 10, flatActuals(), projectedPoints())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('reconstructionFailed')
  })

  it('excludes as missingActuals, naming the player, when a starter has no settled actual', () => {
    const missing = new Map(flatActuals())
    missing.delete(7)
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, missing, projectedPoints())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missingActuals')
    expect(result.detail).toContain('7')
  })

  it('excludes as missingProjections, naming the player, when a starter has no projected_points', () => {
    const projected = projectedPoints()
    projected.delete(4)
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, flatActuals(), projected)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missingProjections')
    expect(result.detail).toContain('4')
  })

  it('excludes as armbandVoid when neither the named captain nor vice-captain played', () => {
    const gwActuals = flatActuals({ 9: { points: 0, minutes: 0 }, 10: { points: 0, minutes: 0 } })
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projectedPoints())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('armbandVoid')
  })

  // Named DoD test.
  it('a captain who played 0 minutes correctly triggers the vice-captain comparison path', () => {
    const gwActuals = flatActuals({ 9: { points: 0, minutes: 0 }, 10: { points: 6, minutes: 90 } })
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projectedPoints())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.viceEffect.triggered).toBe(true)
    if (!result.viceEffect.triggered) return
    expect(result.viceEffect.namedCaptainActualPoints).toBe(0)
    expect(result.viceEffect.viceCaptainActualPoints).toBe(6)
    expect(result.viceEffect.scoredBetterThanNamedCaptain).toBe(true)
    expect(result.viceEffect.margin).toBe(6)
    // The real, effective armband holder is the promoted vice, not the blanking named captain.
    expect(result.chosen.playerId).toBe(10)
  })

  it('does not evaluate the vice-captain comparison when the named captain played', () => {
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, flatActuals(), projectedPoints())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.viceEffect).toEqual({ triggered: false })
  })

  it('scores the naive baseline against the highest-PROJECTED starter, independent of who the app actually captained', () => {
    const gwActuals = flatActuals({ 9: { points: 2, minutes: 90 }, 3: { points: 9, minutes: 90 } })
    const projected = projectedPoints({ 3: 20 }) // player 3 projected highest; the app still captained 9.
    const result = evaluateCaptaincyRegret(5, slots(STANDARD_XI_IDS), 9, 10, gwActuals, projected)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.naive.playerId).toBe(3)
    expect(result.naive.actualPoints).toBe(9)
    expect(result.naive.regret).toBe(0) // player 3 is also the best available here
    expect(result.chosen.playerId).toBe(9)
    expect(result.chosen.regret).toBe(7) // 9 (best available) - 2 (chosen actual)
  })
})

describe('poolCaptaincyFigure', () => {
  // Named DoD test.
  it('pools from underlying gameweek rows, not an average of per-gameweek means', () => {
    // Three scored gameweeks contributed raw regret values 0, 0 and 9. The
    // correct pooled mean sums those three raw values and divides by 3 — it
    // is NOT computed by first reducing to some other grouping of
    // "per-gameweek means" and averaging those (there is no such grouping
    // here to begin with: each gameweek contributes exactly one row, so any
    // implementation that silently zero-pads an excluded gameweek into the
    // list, rather than omitting it entirely, would also be caught by this
    // shape of test).
    const pooled = poolCaptaincyFigure([0, 0, 9])
    expect(pooled).toEqual({ n: 3, total: 9, mean: 3 })
  })

  it('is 0/0/0, never NaN, when nothing scored', () => {
    expect(poolCaptaincyFigure([])).toEqual({ n: 0, total: 0, mean: 0 })
  })
})

describe('summarizeViceEffect', () => {
  it('counts only triggered gameweeks, and within those, how many the vice outscored the blanking named captain', () => {
    const rows: CaptaincyRegretScored[] = [
      scoredRow(1, { triggered: false }),
      scoredRow(2, { triggered: true, namedCaptainActualPoints: 0, viceCaptainActualPoints: 6, scoredBetterThanNamedCaptain: true, margin: 6 }),
      scoredRow(3, { triggered: true, namedCaptainActualPoints: 0, viceCaptainActualPoints: 0, scoredBetterThanNamedCaptain: false, margin: 0 }),
    ]
    expect(summarizeViceEffect(rows)).toEqual({ triggeredCount: 2, viceScoredBetterCount: 1 })
  })

  it('is 0/0 when no gameweek is scored at all', () => {
    expect(summarizeViceEffect([])).toEqual({ triggeredCount: 0, viceScoredBetterCount: 0 })
  })
})

describe('renderCaptaincyRegretSection', () => {
  // Named DoD test.
  it('a gameweek with no snapshot is excluded and explicitly named as excluded, and left out of every pooled figure', () => {
    const results: CaptaincyRegretResult[] = [
      { gameweekId: 3, ok: false, reason: 'noSnapshot', detail: 'no notifications.plan_snapshot was recorded for this gameweek.' },
      scoredRow(4, { triggered: false }),
    ]
    const text = renderCaptaincyRegretSection(results).join('\n')
    expect(text).toContain('noSnapshot')
    expect(text).toContain('| 3 |')
    // Only the one scored gameweek is measured/pooled — the excluded one does not inflate the count.
    expect(text).toContain('1 gameweek(s) measured here')
  })

  it("states plainly that the sample is weak evidence, matching bonus-validation-report.ts's own convention, and labels the hindsight ceiling", () => {
    const text = renderCaptaincyRegretSection([scoredRow(1, { triggered: false })]).join('\n')
    expect(text).toContain('weak evidence')
    expect(text).toContain('hindsight ceiling')
  })

  it('says plainly that nothing qualifies yet when every attempted gameweek is excluded', () => {
    const results: CaptaincyRegretResult[] = [{ gameweekId: 1, ok: false, reason: 'unsettled', detail: 'x' }]
    const text = renderCaptaincyRegretSection(results).join('\n')
    expect(text).toContain('No gameweek both has a plan_snapshot and settled actuals yet')
  })

  it('reports the vice-captain trigger count and, only among triggered gameweeks, the comparison outcome', () => {
    const results: CaptaincyRegretResult[] = [
      scoredRow(1, { triggered: true, namedCaptainActualPoints: 0, viceCaptainActualPoints: 5, scoredBetterThanNamedCaptain: true, margin: 5 }),
      scoredRow(2, { triggered: false }),
    ]
    const text = renderCaptaincyRegretSection(results).join('\n')
    expect(text).toContain('1/2 scored gameweek(s)')
    expect(text).toContain('1/1')
  })
})
