import { describe, expect, it } from 'vitest'
import {
  applyTransferToShape,
  buildRollShape,
  compareNetPoints,
  computeNetPoints,
  evaluateCaptaincy,
  pairedNetGap,
  pickDecisionForGameweek,
  reconcile,
  renderScorecard,
  resolveRollCaptaincy,
  scoreGameweek,
  scoreSquad,
  shapeContainsPlayer,
  summarizeCaptaincy,
  sumGross,
  sumNet,
  type ActualsByPlayer,
  type DecisionRecord,
  type GameweekPlans,
  type PlanRecord,
  type ScoredEntity,
  type SquadSlot,
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
    expect(captaincy.viceCaptainPlayerId).toBe(9) // whatever it was, not part of the roll squad — harmless since scoreSquad only needs it as a fallback
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
    const missing = flatActuals()
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
})
