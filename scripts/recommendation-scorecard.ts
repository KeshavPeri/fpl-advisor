// Recommendation scorecard — ticket #223 (feature-list item 32, the
// recommendation-level measurement that never got built).
//
// ============================================================================
// WHAT THIS IS, AND WHY IT IS NOT scripts/run-backtest.ts.
// ============================================================================
// Every existing measurement in this repo (calibration-report.ts,
// run-backtest.ts) scores the PROJECTION — whether the model ranks players in
// the right order. Nothing has ever scored the RECOMMENDATION: whether the
// transfer and captain the app actually told Keshav to make were good calls.
// This script is that measurement, built entirely from data this app has
// already written for its own operation — no new ingest, no new table, no
// change to the model, the solver, or any stored recommendation.
//
// ============================================================================
// THE 2025/26 REPLAY THIS SCRIPT DOES NOT ATTEMPT.
// ============================================================================
// A season-length replay of 2025/26 (what would the solver have recommended,
// under a real budget, every week of last season) cannot be built from this
// database: player_match_stats has no price column and players.now_cost holds
// only the current season, so there is no record of what any player cost in
// 2025/26. A replay that ignores the budget measures nothing — optimising
// under a budget constraint is the solver's whole job. This is recorded as
// its own entry in docs/projection-model-backlog.md; it is not attempted
// here and no workaround is applied.
//
// ============================================================================
// WHAT THIS SCRIPT SCORES INSTEAD: the recommendations this app has actually
// issued, against what actually happened.
// ============================================================================
// One row per SETTLED gameweek that has a stored Plan A. For that gameweek:
//   - Plan A / Plan B / Plan C as issued — starting XI's actual points,
//     captain doubled, minus the plan's own hit cost.
//   - Roll — the squad as it stood with no transfer, the honest do-nothing
//     counterfactual, derived from Plan A (see "THE ROLL COUNTERFACTUAL"
//     below). Its hit cost is always 0 — a roll is exactly the recommendation
//     of paying no hit and making no transfer.
//   - What Keshav actually did — from recommendation_decisions, either a
//     'commit' (accepted the referenced plan as given) or an 'override' (did
//     something else). See "THE ACTUAL-DECISION RECONSTRUCTION" below for the
//     one real limitation this carries.
// Plus the captaincy question, answered on its own (see "CAPTAINCY" below),
// and reconciling counters: gameweeks read, scored, and excluded by name.
//
// ============================================================================
// WHERE ACTUALS COME FROM: prediction_log, never player_match_stats.
// ============================================================================
// prediction_log already carries each player's settled actual points and
// minutes, gated on gameweek lockdown (scripts/settle-predictions.ts). The
// ticket text is explicit: "prediction_log is the settled source and it
// already waits for 09:00 UK the morning after the final match. Do not
// reconstruct actuals from player_match_stats if prediction_log has them —
// one source, not two." This script reads prediction_log ONLY for actuals
// and never reads player_match_stats at all — there is nothing in that table
// this script needs that prediction_log does not already carry, settled and
// ready.
//
// ============================================================================
// JOIN KEY: player_id, deliberately NOT player_code, and why that is correct
// here (a documented departure from the D9 "always join on player_code"
// rule, not an oversight of it).
// ============================================================================
// D9 exists because player_match_stats mixes rows from a season whose FPL
// element ids do not match the CURRENT season's players table — id is not
// stable across a season boundary, code is. Nothing here crosses that
// boundary: recommendations, recommendation_decisions and prediction_log are
// ALL written, this season, by this app's own current-season jobs, using the
// SAME current-season players.id throughout (recommendations.captain_player_id,
// prediction_log.player_id, and so on, all come from the same live `players`
// table). Joining on player_id is therefore the direct, correct key here —
// not a shortcut around D9, a case D9 was never written to cover. player_code
// is not read by this script at all.
//
// ============================================================================
// THE ROLL COUNTERFACTUAL.
// ============================================================================
// recommendation_decisions never stores a full 15-man squad (see "THE
// ACTUAL-DECISION RECONSTRUCTION" below) and neither does anything else this
// app writes — the only full squad shape on record for a gameweek is each
// plan's own starting_xi + bench_order. Roll is built from Plan A's own
// shape: if Plan A itself recommended no transfer (is_roll), Roll IS Plan A.
// Otherwise, Roll is Plan A's shape with the transfer undone — the
// transferred-IN player replaced, in whichever slot he occupies (starting XI
// or bench), by the transferred-OUT player. This is exactly "the squad as it
// stood before this gameweek's transfer" and needs no data this script does
// not already have. If Plan A's own captain or vice-captain WAS the
// transferred-in player (he is not part of the roll squad at all), the
// armband falls back exactly the way a blanking captain does in real FPL —
// see resolveRollCaptaincy.
//
// ============================================================================
// THE ACTUAL-DECISION RECONSTRUCTION — a real, stated limitation.
// ============================================================================
// recommendation_decisions.snapshot carries exactly seven fields for both a
// commit and an override: is_roll, transfer_in/out_player_id, captain/
// vice_captain_player_id, hit_cost, solver_run_id (src/lib/commit/api.ts,
// src/lib/override/api.ts — verified directly against both write paths, not
// assumed from the migration comment alone). It never stores a full squad.
// So "what Keshav actually did" is reconstructed, not read verbatim: take the
// Roll shape above (the squad as it stood before any transfer that week) and
// apply the DECISION's own transfer (its own transfer_in/out, which for an
// override may differ entirely from what any plan recommended), then score
// with the decision's own captain/vice-captain. The eleven-or-fifteen names
// NOT touched by that transfer are assumed identical to Plan A's own squad
// that week — the best available reconstruction given what is stored, and
// wrong exactly when Keshav made a second, unrecorded change the same week
// (the override screen's own stated scope: "no multi-transfer entry").
//
// A SEPARATE, PERMANENT gap on top of that: an override's hit_cost is always
// stored as null (src/lib/override/api.ts's registerOverride — "the real
// figure arrives from the FPL API … leave hit_cost null in the override
// snapshot", never hand-typed and never defaulted to 0 here either). This
// script reports an override gameweek's gross points in full and reports its
// net points and hit cost as explicitly UNKNOWN, never as zero — a guessed
// zero would silently flatter (or penalise) every hit Keshav actually paid
// on an overridden week. A commit's hit_cost IS known (copied verbatim from
// the committed plan at commit time), so a committed gameweek's net points
// are always reported.
//
// ============================================================================
// recommendations IS UPSERTED IN PLACE — a real, un-fixable limitation.
// ============================================================================
// recommendations keys on (gameweek_id, plan_index) and a re-run of
// scripts/generate-recommendations.ts replaces that gameweek's plans in
// place (20260817090000_recommendations.sql). This script reads whatever
// Plan A/B/C currently sit in that table for a past gameweek — which is not
// necessarily what the app displayed or Telegram sent at the real deadline,
// if the job has run again since. There is no history table to read instead.
// This is stated here once and printed in the report itself, not silently
// carried.
//
// ============================================================================
// CAPTAINCY, ANSWERED SEPARATELY (ticket text: "the one Keshav feels most").
// ============================================================================
// For each scored gameweek: within Plan A's OWN starting XI, did the
// effective captain (after the same blank-armband fallback used everywhere
// else in this file) outscore the best of the other ten starters, and by how
// many raw (undoubled) points. That gap is exactly the marginal value of the
// captaincy pick — doubling adds one extra copy of whichever player wears the
// armband, so the difference between two candidates' extra copies is the
// difference between their raw scores. Hit rate = the fraction of scored
// gameweeks where that gap is >= 0; cumulative points won/lost = the sum of
// the gap across every scored gameweek.
//
// ============================================================================
// THE SAMPLE IS TINY, DELIBERATELY NEVER HIDDEN, AND NEVER NULLED OUT.
// ============================================================================
// run-backtest.ts and src/lib/accuracy/derive.ts both NULL a figure outright
// once its sample is below a threshold ("too small to read") — correct there,
// because their populations are thousands of rows and a small bucket really
// is noise nobody should read. That rule does not transfer here unmodified:
// this report's unit is GAMEWEEKS, there are only three or four settled all
// season, and nulling every figure out for the next several months would
// defeat the ticket's own stated point — "the value here is that it
// compounds… by December it is the most important report in the repo." So
// every figure below is always computed and always printed, every figure is
// printed beside its own sample size (never bare), and MIN_GAMEWEEKS_FOR_SIGNAL
// names, once, prominently, and on every run, how many settled gameweeks it
// would take before any of this should be read as a verdict rather than a
// running total. This is a Tier 3 reporting judgement, not a derived
// statistic — see this file's own decisions log entry.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as
// every other scripts/*.ts job. Writes to no table but job_runs (one row,
// never upserted). Writes one report file, to SCORECARD_REPORT_PATH. Hand-run
// only — not wired into any scheduled workflow, same precedent as
// run-backtest.ts and calibration-report.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'

const JOB_NAME = 'recommendation-scorecard'
const RECOMMENDATIONS_MIGRATION = 'supabase/migrations/20260817090000_recommendations.sql'
const RECOMMENDATION_DECISIONS_MIGRATION = 'supabase/migrations/20260823090000_recommendation_decisions.sql'
const PREDICTION_LOG_MIGRATION = 'supabase/migrations/20260821090000_prediction_log.sql'

const DEFAULT_REPORT_PATH = './out/recommendation-scorecard.md'

/**
 * How many settled gameweeks it would take before this report's figures stop
 * being dominated by week-to-week variance and start being a reasonably
 * stable read on the recommendation engine. A JUDGEMENT, stated plainly as
 * one — not fitted from anything in this database (there is not enough data
 * yet to fit it from), same status as run-backtest.ts's own
 * TOP_N_MAX_POPULATION_FRACTION. Chosen as roughly half a season (38
 * gameweeks) — the point by which early-season noise (new signings finding
 * form, fixture congestion, injuries settling) should have mostly washed
 * out. Printed on every run, regardless of how close the real count is to
 * it — see this file's header, "THE SAMPLE IS TINY".
 */
export const MIN_GAMEWEEKS_FOR_SIGNAL = 20

// ============================================================================
// Pure types — every scoring function below takes plain data and returns
// plain data. No Supabase client, no Date.now(), no I/O of any kind.
// ============================================================================

export type PlanIndex = 0 | 1 | 2
export type DecisionKind = 'commit' | 'override'

/** One squad slot — a player id. playerCode travels alongside in the stored
 *  jsonb but this script never needs it (see file header, "JOIN KEY"). */
export interface SquadSlot {
  playerId: number
}

export interface PlanRecord {
  gameweekId: number
  planIndex: PlanIndex
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  startingXi: readonly SquadSlot[]
  benchOrder: readonly SquadSlot[]
  hitCost: number
}

export interface DecisionRecord {
  kind: DecisionKind
  planIndex: PlanIndex
  decidedAt: string
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  /** Always null for an override — see file header. Known for a commit. */
  hitCost: number | null
}

export interface PlayerActual {
  points: number
  minutes: number
}

export type ActualsByPlayer = ReadonlyMap<number, PlayerActual>

export interface SquadShape {
  startingXi: readonly SquadSlot[]
  benchOrder: readonly SquadSlot[]
}

// ----------------------------------------------------------------------------
// scoreSquad — the one place captain doubling, the blank-armband fallback,
// and "missing actual" detection happen. Everything else composes this.
// ----------------------------------------------------------------------------

export interface ScoredSquadOk {
  ok: true
  /** Sum of the 11 starters' actual points plus exactly one extra copy of
   *  whichever player ends up wearing the effective armband (zero extra
   *  copies if the armband was void — see below). This IS the plan's gross
   *  points; hit cost is applied by the caller, never here. */
  grossPoints: number
  /** Undoubled actual points per starter — what the captaincy diagnostic
   *  reads to find "the best of the other ten". */
  starterPoints: ReadonlyMap<number, number>
  /** The player whose points were doubled. Null when neither the named
   *  captain nor the named vice-captain played (both zero minutes) — real
   *  FPL rule: the armband is void that week, nobody's points are doubled. */
  effectiveCaptainPlayerId: number | null
  /** True when the named captain did not play and the vice-captain's points
   *  were doubled instead — real FPL rule, not a modelling choice. */
  captainPromotedToVice: boolean
}

export interface ScoredSquadFailed {
  ok: false
  /** Every player id this squad could not be scored for: a starter, the
   *  captain, or the vice-captain absent from `actuals` entirely (never
   *  settled, or settled but this script's read excluded it), OR the named
   *  captain/vice-captain not actually present among the 11 starters (a
   *  reconstruction inconsistency — see file header on the actual-decision
   *  reconstruction). Never guessed at, never defaulted to zero. */
  missingPlayerIds: readonly number[]
}

export type ScoredSquadResult = ScoredSquadOk | ScoredSquadFailed

export function scoreSquad(
  startingXi: readonly SquadSlot[],
  captainPlayerId: number,
  viceCaptainPlayerId: number,
  actuals: ActualsByPlayer,
): ScoredSquadResult {
  const startingIds = new Set(startingXi.map((slot) => slot.playerId))
  const armbandMissing = [captainPlayerId, viceCaptainPlayerId].filter((id) => !startingIds.has(id))
  if (armbandMissing.length > 0) {
    return { ok: false, missingPlayerIds: armbandMissing }
  }

  const starterPoints = new Map<number, number>()
  const missing: number[] = []
  for (const slot of startingXi) {
    const actual = actuals.get(slot.playerId)
    if (!actual) {
      missing.push(slot.playerId)
    } else {
      starterPoints.set(slot.playerId, actual.points)
    }
  }
  if (missing.length > 0) return { ok: false, missingPlayerIds: missing }

  const sumStarters = [...starterPoints.values()].reduce((sum, points) => sum + points, 0)

  const captainMinutes = actuals.get(captainPlayerId)?.minutes ?? 0
  let effectiveCaptainPlayerId: number | null
  let captainPromotedToVice: boolean
  let extra: number

  if (captainMinutes > 0) {
    effectiveCaptainPlayerId = captainPlayerId
    captainPromotedToVice = false
    extra = starterPoints.get(captainPlayerId) ?? 0
  } else {
    const viceMinutes = actuals.get(viceCaptainPlayerId)?.minutes ?? 0
    if (viceMinutes > 0) {
      effectiveCaptainPlayerId = viceCaptainPlayerId
      captainPromotedToVice = true
      extra = starterPoints.get(viceCaptainPlayerId) ?? 0
    } else {
      effectiveCaptainPlayerId = null
      captainPromotedToVice = false
      extra = 0
    }
  }

  return {
    ok: true,
    grossPoints: sumStarters + extra,
    starterPoints,
    effectiveCaptainPlayerId,
    captainPromotedToVice,
  }
}

/** Applies a plan/decision's own hit cost to already-scored gross points.
 *  Named and exported purely so a −4-vs-roll comparison reads as one call in
 *  a test, matching the ticket's own worked example. */
export function computeNetPoints(grossPoints: number, hitCost: number): number {
  return grossPoints - hitCost
}

// ----------------------------------------------------------------------------
// The Roll counterfactual — see file header.
// ----------------------------------------------------------------------------

function swapPlayer(slot: SquadSlot, fromId: number, toId: number): SquadSlot {
  return slot.playerId === fromId ? { playerId: toId } : slot
}

export function buildRollShape(plan: PlanRecord): SquadShape {
  if (plan.isRoll || plan.transferInPlayerId === null || plan.transferOutPlayerId === null) {
    return { startingXi: plan.startingXi, benchOrder: plan.benchOrder }
  }
  const transferInId = plan.transferInPlayerId
  const transferOutId = plan.transferOutPlayerId
  return {
    startingXi: plan.startingXi.map((slot) => swapPlayer(slot, transferInId, transferOutId)),
    benchOrder: plan.benchOrder.map((slot) => swapPlayer(slot, transferInId, transferOutId)),
  }
}

/**
 * The captain/vice-captain to use for the Roll shape. Identical to Plan A's
 * own picks UNLESS one of them was the transferred-IN player — he is not
 * part of the roll squad at all, so the armband falls back to the other one,
 * the same blank-armband rule scoreSquad applies for a captain who did not
 * play. Both cannot be the transferred-in player at once (a captain and
 * vice-captain are always two different players), so this always resolves
 * to someone who is actually in the roll squad.
 */
export function resolveRollCaptaincy(
  plan: PlanRecord,
  rollShape: SquadShape,
): { captainPlayerId: number; viceCaptainPlayerId: number } {
  const rollIds = new Set(rollShape.startingXi.map((slot) => slot.playerId))
  const captainPlayerId = rollIds.has(plan.captainPlayerId) ? plan.captainPlayerId : plan.viceCaptainPlayerId
  const viceCaptainPlayerId = rollIds.has(plan.viceCaptainPlayerId) ? plan.viceCaptainPlayerId : plan.captainPlayerId
  return { captainPlayerId, viceCaptainPlayerId }
}

// ----------------------------------------------------------------------------
// The actual-decision reconstruction — see file header.
// ----------------------------------------------------------------------------

export function shapeContainsPlayer(shape: SquadShape, playerId: number): boolean {
  return shape.startingXi.some((slot) => slot.playerId === playerId) || shape.benchOrder.some((slot) => slot.playerId === playerId)
}

/** Applies a DECISION's own transfer (which may differ entirely from any
 *  plan's) on top of a base shape — normally the Roll shape, see file
 *  header. A no-op when either id is null (the decision was itself a roll). */
export function applyTransferToShape(
  base: SquadShape,
  transferOutPlayerId: number | null,
  transferInPlayerId: number | null,
): SquadShape {
  if (transferOutPlayerId === null || transferInPlayerId === null) return base
  return {
    startingXi: base.startingXi.map((slot) => swapPlayer(slot, transferOutPlayerId, transferInPlayerId)),
    benchOrder: base.benchOrder.map((slot) => swapPlayer(slot, transferOutPlayerId, transferInPlayerId)),
  }
}

// ----------------------------------------------------------------------------
// Captaincy diagnostic — see file header, "CAPTAINCY".
// ----------------------------------------------------------------------------

export interface CaptaincyOutcome {
  /** effectiveCaptainPoints - bestAlternativePoints. Positive or zero is a
   *  hit; negative means a starter would have outscored the armband. */
  gap: number
  hit: boolean
}

/** Null when there is nothing to evaluate — the armband was void (see
 *  scoreSquad), or (defensively) fewer than two starters were scored. */
export function evaluateCaptaincy(
  starterPoints: ReadonlyMap<number, number>,
  effectiveCaptainPlayerId: number | null,
): CaptaincyOutcome | null {
  if (effectiveCaptainPlayerId === null) return null
  const captainPoints = starterPoints.get(effectiveCaptainPlayerId)
  if (captainPoints === undefined) return null

  let bestAlternative = Number.NEGATIVE_INFINITY
  for (const [playerId, points] of starterPoints) {
    if (playerId === effectiveCaptainPlayerId) continue
    if (points > bestAlternative) bestAlternative = points
  }
  if (!Number.isFinite(bestAlternative)) return null

  const gap = captainPoints - bestAlternative
  return { gap, hit: gap >= 0 }
}

// ----------------------------------------------------------------------------
// compareNetPoints — the ticket's own worked example, named so a test can
// assert it directly: "a −4 plan that outscores a roll by 3 is correctly
// reported as the worse decision."
// ----------------------------------------------------------------------------

export type NetComparison = 'better' | 'worse' | 'equal'

export function compareNetPoints(planNet: number, rollNet: number): NetComparison {
  if (planNet > rollNet) return 'better'
  if (planNet < rollNet) return 'worse'
  return 'equal'
}

// ----------------------------------------------------------------------------
// scoreGameweek — composes every function above into one gameweek's row.
// This is the function the DoD's named tests exercise end to end.
// ----------------------------------------------------------------------------

export interface GameweekPlans {
  a: PlanRecord
  b: PlanRecord | null
  c: PlanRecord | null
}

export interface ScoredEntity {
  label: string
  grossPoints: number
  /** Null only for an override with no recorded hit cost — see file header.
   *  Never a guessed number. */
  hitCost: number | null
  /** Null exactly when hitCost is null. */
  netPoints: number | null
  effectiveCaptainPlayerId: number | null
  captainPromotedToVice: boolean
}

function toEntity(label: string, scored: ScoredSquadOk, hitCost: number | null): ScoredEntity {
  return {
    label,
    grossPoints: scored.grossPoints,
    hitCost,
    netPoints: hitCost === null ? null : computeNetPoints(scored.grossPoints, hitCost),
    effectiveCaptainPlayerId: scored.effectiveCaptainPlayerId,
    captainPromotedToVice: scored.captainPromotedToVice,
  }
}

export type GameweekExclusionReason = 'unsettled' | 'missingActuals' | 'reconstructionFailed'

export interface GameweekScored {
  gameweekId: number
  ok: true
  planA: ScoredEntity
  planB: ScoredEntity | null
  planC: ScoredEntity | null
  roll: ScoredEntity
  actual: { kind: DecisionKind; decidedAt: string; entity: ScoredEntity } | null
  captaincy: CaptaincyOutcome | null
}

export interface GameweekExcluded {
  gameweekId: number
  ok: false
  reason: GameweekExclusionReason
  detail: string
}

export type GameweekResult = GameweekScored | GameweekExcluded

/**
 * Scores one gameweek's Plan A/B/C, Roll, and (if one was recorded) the
 * actual decision — or excludes the whole gameweek by name. A gameweek is
 * excluded, never partially scored, the moment ANY entity it needs cannot be
 * computed: this keeps "gameweeks read = gameweeks scored + gameweeks
 * excluded (by reason)" a strict, checkable partition (see reconcile()
 * below), the same discipline run-backtest.ts's own measured-population rule
 * uses.
 */
export function scoreGameweek(
  gameweekId: number,
  plans: GameweekPlans,
  decision: DecisionRecord | null,
  actuals: ActualsByPlayer,
  isSettled: boolean,
): GameweekResult {
  if (!isSettled) {
    return {
      gameweekId,
      ok: false,
      reason: 'unsettled',
      detail: 'no settled prediction_log rows exist yet for this gameweek',
    }
  }

  const scoredA = scoreSquad(plans.a.startingXi, plans.a.captainPlayerId, plans.a.viceCaptainPlayerId, actuals)
  if (!scoredA.ok) {
    return {
      gameweekId,
      ok: false,
      reason: 'missingActuals',
      detail: `Plan A: no settled actual for player id(s) ${scoredA.missingPlayerIds.join(', ')}`,
    }
  }

  let scoredB: ScoredSquadOk | null = null
  if (plans.b) {
    const result = scoreSquad(plans.b.startingXi, plans.b.captainPlayerId, plans.b.viceCaptainPlayerId, actuals)
    if (!result.ok) {
      return {
        gameweekId,
        ok: false,
        reason: 'missingActuals',
        detail: `Plan B: no settled actual for player id(s) ${result.missingPlayerIds.join(', ')}`,
      }
    }
    scoredB = result
  }

  let scoredC: ScoredSquadOk | null = null
  if (plans.c) {
    const result = scoreSquad(plans.c.startingXi, plans.c.captainPlayerId, plans.c.viceCaptainPlayerId, actuals)
    if (!result.ok) {
      return {
        gameweekId,
        ok: false,
        reason: 'missingActuals',
        detail: `Plan C: no settled actual for player id(s) ${result.missingPlayerIds.join(', ')}`,
      }
    }
    scoredC = result
  }

  const rollShape = buildRollShape(plans.a)
  const rollCaptaincy = resolveRollCaptaincy(plans.a, rollShape)
  const scoredRoll = scoreSquad(rollShape.startingXi, rollCaptaincy.captainPlayerId, rollCaptaincy.viceCaptainPlayerId, actuals)
  if (!scoredRoll.ok) {
    return {
      gameweekId,
      ok: false,
      reason: 'missingActuals',
      detail: `Roll: no settled actual for player id(s) ${scoredRoll.missingPlayerIds.join(', ')}`,
    }
  }

  let actualResult: { kind: DecisionKind; decidedAt: string; entity: ScoredEntity } | null = null
  if (decision) {
    if (decision.transferOutPlayerId !== null && !shapeContainsPlayer(rollShape, decision.transferOutPlayerId)) {
      return {
        gameweekId,
        ok: false,
        reason: 'reconstructionFailed',
        detail:
          `${decision.kind}: recorded transfer-out player id ${decision.transferOutPlayerId} is not part of Plan A's ` +
          'own squad that week — the actual decision cannot be reconstructed from the data this app stored.',
      }
    }
    const actualShape = applyTransferToShape(rollShape, decision.transferOutPlayerId, decision.transferInPlayerId)
    const scoredActual = scoreSquad(actualShape.startingXi, decision.captainPlayerId, decision.viceCaptainPlayerId, actuals)
    if (!scoredActual.ok) {
      return {
        gameweekId,
        ok: false,
        reason: 'missingActuals',
        detail: `${decision.kind}: no settled actual for player id(s) ${scoredActual.missingPlayerIds.join(', ')}`,
      }
    }
    actualResult = {
      kind: decision.kind,
      decidedAt: decision.decidedAt,
      entity: toEntity('Actual', scoredActual, decision.hitCost),
    }
  }

  const captaincy = evaluateCaptaincy(scoredA.starterPoints, scoredA.effectiveCaptainPlayerId)

  return {
    gameweekId,
    ok: true,
    planA: toEntity('Plan A', scoredA, plans.a.hitCost),
    planB: scoredB ? toEntity('Plan B', scoredB, plans.b!.hitCost) : null,
    planC: scoredC ? toEntity('Plan C', scoredC, plans.c!.hitCost) : null,
    roll: toEntity('Roll', scoredRoll, 0),
    actual: actualResult,
    captaincy,
  }
}

// ----------------------------------------------------------------------------
// Reconciliation counters.
// ----------------------------------------------------------------------------

export interface ReconciliationCounters {
  gameweeksRead: number
  gameweeksScored: number
  excludedUnsettled: number
  excludedMissingActuals: number
  excludedReconstructionFailed: number
}

export function reconcile(results: readonly GameweekResult[]): ReconciliationCounters {
  const counters: ReconciliationCounters = {
    gameweeksRead: results.length,
    gameweeksScored: 0,
    excludedUnsettled: 0,
    excludedMissingActuals: 0,
    excludedReconstructionFailed: 0,
  }
  for (const result of results) {
    if (result.ok) {
      counters.gameweeksScored++
    } else if (result.reason === 'unsettled') {
      counters.excludedUnsettled++
    } else if (result.reason === 'missingActuals') {
      counters.excludedMissingActuals++
    } else {
      counters.excludedReconstructionFailed++
    }
  }
  return counters
}

// ----------------------------------------------------------------------------
// Aggregation — every figure is printed beside its own sample size, never
// bare (see file header, "THE SAMPLE IS TINY"). `n` counts how many
// gameweeks actually contributed, which is not always every scored gameweek
// (an override's net points are unknown; a plan's B/C slot is not always
// present; an actual decision does not always exist).
// ----------------------------------------------------------------------------

export interface AggregateFigure {
  n: number
  total: number
}

export function sumGross(entities: readonly (ScoredEntity | null)[]): AggregateFigure {
  const present = entities.filter((entity): entity is ScoredEntity => entity !== null)
  return { n: present.length, total: present.reduce((sum, entity) => sum + entity.grossPoints, 0) }
}

export function sumNet(entities: readonly (ScoredEntity | null)[]): AggregateFigure {
  const known = entities.filter((entity): entity is ScoredEntity => entity !== null && entity.netPoints !== null)
  return { n: known.length, total: known.reduce((sum, entity) => sum + (entity.netPoints as number), 0) }
}

/** The gap between two parallel per-gameweek net-points series — e.g. Plan A
 *  vs Roll, or Plan A vs Actual. Only pairs where BOTH sides are known
 *  contribute, and `n` says exactly how many did — never averaged over a
 *  longer list padded with zeros for the gaps that could not be computed. */
export function pairedNetGap(
  as: readonly (number | null)[],
  bs: readonly (number | null)[],
): AggregateFigure {
  let n = 0
  let total = 0
  const length = Math.min(as.length, bs.length)
  for (let i = 0; i < length; i++) {
    const a = as[i]
    const b = bs[i]
    if (a !== null && b !== null) {
      n++
      total += a - b
    }
  }
  return { n, total }
}

export interface CaptaincySeasonSummary {
  n: number
  hits: number
  cumulativeGap: number
}

export function summarizeCaptaincy(outcomes: readonly (CaptaincyOutcome | null)[]): CaptaincySeasonSummary {
  const present = outcomes.filter((outcome): outcome is CaptaincyOutcome => outcome !== null)
  return {
    n: present.length,
    hits: present.filter((outcome) => outcome.hit).length,
    cumulativeGap: present.reduce((sum, outcome) => sum + outcome.gap, 0),
  }
}

// ============================================================================
// Everything below this line is I/O: Supabase reads, report rendering, and
// job_runs bookkeeping. Nothing above this line touches a network or a
// clock.
// ============================================================================

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')

  if (missing.length > 0) {
    console.error(
      `${JOB_NAME}: required environment variables are not set. Both SUPABASE_URL and ` +
        `SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

function readReportPath(): string {
  return process.env.SCORECARD_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

export class ScorecardError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'ScorecardError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ----------------------------------------------------------------------------
// job_runs
// ----------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: JsonRecord | null
  startedAt: Date
}

async function recordJobRun(supabase: SupabaseClient, input: JobRunInput): Promise<void> {
  const finishedAt = new Date()
  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: input.status,
    message: input.message,
    details: input.details,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })
  if (error) {
    if (isMissingTable(error, 'job_runs')) {
      console.error(`${JOB_NAME}: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ----------------------------------------------------------------------------
// Raw row shapes and mappers.
// ----------------------------------------------------------------------------

interface RawSquadSlot {
  playerId: number
  playerCode?: number | null
}

function toSquadSlots(value: unknown): SquadSlot[] {
  if (!Array.isArray(value)) return []
  return (value as RawSquadSlot[]).map((slot) => ({ playerId: slot.playerId }))
}

interface RecommendationRow {
  gameweek_id: number
  plan_index: number
  is_roll: boolean
  transfer_in_player_id: number | null
  transfer_out_player_id: number | null
  captain_player_id: number
  vice_captain_player_id: number
  starting_xi: unknown
  bench_order: unknown
  hit_cost: number
}

function toPlanRecord(row: RecommendationRow): PlanRecord {
  return {
    gameweekId: row.gameweek_id,
    planIndex: row.plan_index as PlanIndex,
    isRoll: row.is_roll,
    transferInPlayerId: row.transfer_in_player_id,
    transferOutPlayerId: row.transfer_out_player_id,
    captainPlayerId: row.captain_player_id,
    viceCaptainPlayerId: row.vice_captain_player_id,
    startingXi: toSquadSlots(row.starting_xi),
    benchOrder: toSquadSlots(row.bench_order),
    hitCost: row.hit_cost,
  }
}

interface DecisionRow {
  id: number
  gameweek_id: number
  plan_index: number
  kind: DecisionKind
  decided_at: string
  snapshot: {
    is_roll: boolean
    transfer_in_player_id: number | null
    transfer_out_player_id: number | null
    captain_player_id: number
    vice_captain_player_id: number
    hit_cost: number | null
  }
}

function toDecisionRecord(row: DecisionRow): DecisionRecord {
  return {
    kind: row.kind,
    planIndex: row.plan_index as PlanIndex,
    decidedAt: row.decided_at,
    isRoll: row.snapshot.is_roll,
    transferInPlayerId: row.snapshot.transfer_in_player_id,
    transferOutPlayerId: row.snapshot.transfer_out_player_id,
    captainPlayerId: row.snapshot.captain_player_id,
    viceCaptainPlayerId: row.snapshot.vice_captain_player_id,
    hitCost: row.snapshot.hit_cost,
  }
}

/**
 * Exactly one decision per gameweek, even though the database can (rarely)
 * hold more than one (a commit AND an override for the same gameweek is not
 * database-enforced — src/lib/override/types.ts's own comment calls this "an
 * interface rule, not a database guarantee"; two overrides at different
 * plan_index for one gameweek are possible for the same reason). Prefers an
 * 'override' over a 'commit' (an override is the more specific fact — it
 * says what Keshav did INSTEAD of the plan), then the most recently decided.
 * Pure and named so this tie-break is a checkable rule, not an artifact of
 * whatever order Supabase happened to return rows in.
 */
export function pickDecisionForGameweek(rows: readonly DecisionRecord[]): DecisionRecord | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'override' ? -1 : 1
    return new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime()
  })
  return sorted[0]
}

interface PredictionLogRow {
  gameweek_id: number
  player_id: number
  actual_points: number | null
  actual_minutes: number | null
  settled_at: string | null
  captured_at: string
}

/**
 * Builds one ActualsByPlayer map per gameweek from every settled
 * prediction_log row. A player can (rarely) carry more than one settled row
 * for the same gameweek across model_version — actual points/minutes are a
 * fact about what happened, not about the model, so this keeps whichever row
 * was captured most recently and does not attempt to reconcile disagreement
 * beyond that; conflictingPlayerCount reports how often it happened so a
 * silent split is at least visible in job_runs.details.
 */
function buildActualsByGameweek(rows: readonly PredictionLogRow[]): {
  byGameweek: Map<number, Map<number, PlayerActual & { capturedAtMs: number }>>
  conflictingPlayerCount: number
} {
  const byGameweek = new Map<number, Map<number, PlayerActual & { capturedAtMs: number }>>()
  let conflictingPlayerCount = 0

  for (const row of rows) {
    if (row.settled_at === null || row.actual_points === null || row.actual_minutes === null) continue
    let forGameweek = byGameweek.get(row.gameweek_id)
    if (!forGameweek) {
      forGameweek = new Map()
      byGameweek.set(row.gameweek_id, forGameweek)
    }
    const capturedAtMs = new Date(row.captured_at).getTime()
    const existing = forGameweek.get(row.player_id)
    if (!existing) {
      forGameweek.set(row.player_id, { points: row.actual_points, minutes: row.actual_minutes, capturedAtMs })
    } else {
      if (existing.points !== row.actual_points || existing.minutes !== row.actual_minutes) {
        conflictingPlayerCount++
      }
      if (capturedAtMs > existing.capturedAtMs) {
        forGameweek.set(row.player_id, { points: row.actual_points, minutes: row.actual_minutes, capturedAtMs })
      }
    }
  }

  return { byGameweek, conflictingPlayerCount }
}

// ----------------------------------------------------------------------------
// Report rendering — plain text formatting, no I/O. Kept as pure functions so
// the "sample size beside every figure" and "standing line" requirements are
// directly testable (see recommendation-scorecard.test.ts's grep-style
// checks on the rendered output).
// ----------------------------------------------------------------------------

function fmtNum(value: number | null): string {
  return value === null ? 'n/a' : String(Math.round(value * 100) / 100)
}

function fmtAggregate(figure: AggregateFigure): string {
  return `${fmtNum(figure.total)} (n=${figure.n})`
}

function fmtEntity(entity: ScoredEntity | null): string {
  if (!entity) return 'n/a'
  const net = entity.netPoints === null ? 'net unknown — hit cost not recorded' : `net ${fmtNum(entity.netPoints)}`
  const armband = entity.captainPromotedToVice
    ? ' (vice-captain armband — captain did not play)'
    : entity.effectiveCaptainPlayerId === null
      ? ' (armband void — neither captain nor vice-captain played)'
      : ''
  return `gross ${fmtNum(entity.grossPoints)}, ${net}${armband}`
}

export interface RenderScorecardInput {
  generatedAtIso: string
  results: readonly GameweekResult[]
  counters: ReconciliationCounters
  conflictingPlayerCount: number
}

export function renderScorecard(input: RenderScorecardInput): string {
  const { results, counters } = input
  const scored = results.filter((r): r is GameweekScored => r.ok)
  const excluded = results.filter((r): r is GameweekExcluded => !r.ok)

  const lines: string[] = []
  lines.push('# Recommendation scorecard')
  lines.push('')
  lines.push(`Generated ${input.generatedAtIso}.`)
  lines.push('')
  lines.push(
    `**${counters.gameweeksScored} settled gameweek(s) scored.** ${MIN_GAMEWEEKS_FOR_SIGNAL} settled gameweeks ` +
      'is the point this report treats as the beginning of a readable signal (a stated judgement, not a derived ' +
      `statistic — see the script header). ${
        counters.gameweeksScored < MIN_GAMEWEEKS_FOR_SIGNAL
          ? `**${MIN_GAMEWEEKS_FOR_SIGNAL - counters.gameweeksScored} more settled gameweek(s) needed before ` +
            'anything below should be read as a verdict on the recommendation engine rather than a running total.**'
          : 'That threshold has been reached — the figures below are no longer an early running total alone.'
      }`,
  )
  lines.push('')
  lines.push(
    '**No 2025/26 replay.** player_match_stats has no price column and players.now_cost holds only the current ' +
      "season, so there is no record of what any player cost last season — a replay that ignores the transfer " +
      'budget measures nothing. See docs/projection-model-backlog.md for the recorded blocker.',
  )
  lines.push('')
  lines.push(
    '**recommendations is upserted in place.** Plan A/B/C below are whatever this table currently holds for that ' +
      'gameweek, which is not necessarily what was shown or sent at the real deadline if the recommendation job has ' +
      'run again since.',
  )
  lines.push('')

  lines.push('## Reconciliation')
  lines.push('')
  lines.push(`- Gameweeks read: ${counters.gameweeksRead}`)
  lines.push(`- Gameweeks scored: ${counters.gameweeksScored}`)
  lines.push(`- Excluded — unsettled: ${counters.excludedUnsettled}`)
  lines.push(`- Excluded — missing actuals: ${counters.excludedMissingActuals}`)
  lines.push(`- Excluded — reconstruction failed: ${counters.excludedReconstructionFailed}`)
  const reconciled =
    counters.gameweeksScored + counters.excludedUnsettled + counters.excludedMissingActuals + counters.excludedReconstructionFailed ===
    counters.gameweeksRead
  lines.push(`- Reconciles: ${reconciled ? 'yes' : 'NO — see script defect'}`)
  if (input.conflictingPlayerCount > 0) {
    lines.push(
      `- Note: ${input.conflictingPlayerCount} player-gameweek row(s) had disagreeing settled actuals across ` +
        'model_version — the most recently captured value was used for each.',
    )
  }
  lines.push('')

  if (excluded.length > 0) {
    lines.push('## Excluded gameweeks')
    lines.push('')
    lines.push('| Gameweek | Reason | Detail |')
    lines.push('|---|---|---|')
    for (const e of excluded) {
      lines.push(`| ${e.gameweekId} | ${e.reason} | ${e.detail} |`)
    }
    lines.push('')
  }

  lines.push('## Per-gameweek')
  lines.push('')
  lines.push('| Gameweek | Plan A | Plan B | Plan C | Roll | Actual |')
  lines.push('|---|---|---|---|---|---|')
  for (const gw of scored) {
    const actualCell = gw.actual ? `${gw.actual.kind}: ${fmtEntity(gw.actual.entity)}` : 'no decision recorded'
    lines.push(
      `| ${gw.gameweekId} | ${fmtEntity(gw.planA)} | ${fmtEntity(gw.planB)} | ${fmtEntity(gw.planC)} | ${fmtEntity(gw.roll)} | ${actualCell} |`,
    )
  }
  lines.push('')

  lines.push('## Season totals')
  lines.push('')
  const aNet = scored.map((gw) => gw.planA.netPoints)
  const rollNet = scored.map((gw) => gw.roll.netPoints)
  const bNet = scored.map((gw) => gw.planB?.netPoints ?? null)
  const cNet = scored.map((gw) => gw.planC?.netPoints ?? null)
  const actualNet = scored.map((gw) => gw.actual?.entity.netPoints ?? null)

  lines.push(`- Plan A gross: ${fmtAggregate(sumGross(scored.map((gw) => gw.planA)))}`)
  lines.push(`- Plan A net: ${fmtAggregate(sumNet(scored.map((gw) => gw.planA)))}`)
  lines.push(`- Plan B net: ${fmtAggregate(sumNet(scored.map((gw) => gw.planB)))}`)
  lines.push(`- Plan C net: ${fmtAggregate(sumNet(scored.map((gw) => gw.planC)))}`)
  lines.push(`- Roll net: ${fmtAggregate(sumNet(scored.map((gw) => gw.roll)))}`)
  lines.push(`- Actual net: ${fmtAggregate(sumNet(scored.map((gw) => gw.actual?.entity ?? null)))}`)
  lines.push('')
  lines.push('Gap vs. Plan A (positive means Plan A did better; sample size is how many gameweeks both sides had a known net figure for):')
  lines.push('')
  lines.push(`- Plan A − Roll: ${fmtAggregate(pairedNetGap(aNet, rollNet))}`)
  lines.push(`- Plan A − Plan B: ${fmtAggregate(pairedNetGap(aNet, bNet))}`)
  lines.push(`- Plan A − Plan C: ${fmtAggregate(pairedNetGap(aNet, cNet))}`)
  lines.push(`- Plan A − Actual: ${fmtAggregate(pairedNetGap(aNet, actualNet))}`)
  lines.push('')

  lines.push('## Captaincy')
  lines.push('')
  lines.push(
    "Within Plan A's own starting XI: did the effective captain outscore the best of the other ten starters, in raw " +
      '(undoubled) points.',
  )
  lines.push('')
  const captaincySummary = summarizeCaptaincy(scored.map((gw) => gw.captaincy))
  lines.push(
    `- Hit rate: ${captaincySummary.hits}/${captaincySummary.n} ` +
      `(${captaincySummary.n === 0 ? 'n/a' : `${Math.round((captaincySummary.hits / captaincySummary.n) * 100)}%`})`,
  )
  lines.push(`- Cumulative points won/lost versus the best alternative starter: ${fmtNum(captaincySummary.cumulativeGap)} (n=${captaincySummary.n})`)
  lines.push('')
  lines.push('| Gameweek | Gap (captain − best alternative) | Hit |')
  lines.push('|---|---|---|')
  for (const gw of scored) {
    if (!gw.captaincy) {
      lines.push(`| ${gw.gameweekId} | n/a (armband void) | n/a |`)
    } else {
      lines.push(`| ${gw.gameweekId} | ${fmtNum(gw.captaincy.gap)} | ${gw.captaincy.hit ? 'yes' : 'no'} |`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

// ----------------------------------------------------------------------------
// main()
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const reportPath = readReportPath()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // ------------------------------------------------------------------
    // 1. recommendations — every plan ever stored, current shape only
    //    (see file header on the upsert-in-place limitation).
    // ------------------------------------------------------------------
    const {
      rows: recommendationRows,
      error: recommendationsError,
    } = await fetchAllPages<RecommendationRow>((from, to) =>
      supabase
        .from('recommendations')
        .select(
          'gameweek_id, plan_index, is_roll, transfer_in_player_id, transfer_out_player_id, captain_player_id, ' +
            'vice_captain_player_id, starting_xi, bench_order, hit_cost',
        )
        .order('gameweek_id', { ascending: true })
        .order('plan_index', { ascending: true })
        .range(from, to)
        .returns<RecommendationRow[]>(),
    )
    if (recommendationsError) {
      if (isMissingTable(recommendationsError, 'recommendations')) {
        throw new ScorecardError(`the "recommendations" table does not exist. Apply ${RECOMMENDATIONS_MIGRATION} first.`, 'recommendations')
      }
      throw new ScorecardError(`recommendations lookup failed: ${recommendationsError.message}`, 'recommendations')
    }
    const { count: recommendationsExpectedCount, error: recommendationsCountError } = await supabase
      .from('recommendations')
      .select('*', { count: 'exact', head: true })
    if (recommendationsCountError) {
      throw new ScorecardError(`recommendations count check failed: ${recommendationsCountError.message}`, 'recommendations')
    }
    assertRowCountMatches('recommendations', recommendationRows.length, recommendationsExpectedCount ?? 0)

    if (recommendationRows.length === 0) {
      const message = `${JOB_NAME}: no recommendations have ever been stored. Nothing to score — writing no report.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: null, startedAt })
      process.exit(0)
      return
    }

    const plansByGameweek = new Map<number, GameweekPlans>()
    for (const row of recommendationRows) {
      const plan = toPlanRecord(row)
      let entry = plansByGameweek.get(plan.gameweekId)
      if (!entry) {
        entry = { a: plan, b: null, c: null }
        plansByGameweek.set(plan.gameweekId, entry)
      }
      if (plan.planIndex === 0) entry.a = plan
      else if (plan.planIndex === 1) entry.b = plan
      else entry.c = plan
    }
    // Only a gameweek with a real Plan A can be scored at all — see
    // scoreGameweek's own contract.
    const gameweekIds = [...plansByGameweek.keys()]
      .filter((id) => plansByGameweek.get(id)!.a.planIndex === 0)
      .sort((a, b) => a - b)

    // ------------------------------------------------------------------
    // 2. recommendation_decisions — every decision ever recorded.
    // ------------------------------------------------------------------
    const {
      rows: decisionRows,
      error: decisionsError,
    } = await fetchAllPages<DecisionRow>((from, to) =>
      supabase
        .from('recommendation_decisions')
        .select('id, gameweek_id, plan_index, kind, decided_at, snapshot')
        .order('id', { ascending: true })
        .range(from, to)
        .returns<DecisionRow[]>(),
    )
    if (decisionsError) {
      if (isMissingTable(decisionsError, 'recommendation_decisions')) {
        throw new ScorecardError(
          `the "recommendation_decisions" table does not exist. Apply ${RECOMMENDATION_DECISIONS_MIGRATION} first.`,
          'recommendation_decisions',
        )
      }
      throw new ScorecardError(`recommendation_decisions lookup failed: ${decisionsError.message}`, 'recommendation_decisions')
    }
    const { count: decisionsExpectedCount, error: decisionsCountError } = await supabase
      .from('recommendation_decisions')
      .select('*', { count: 'exact', head: true })
    if (decisionsCountError) {
      throw new ScorecardError(`recommendation_decisions count check failed: ${decisionsCountError.message}`, 'recommendation_decisions')
    }
    assertRowCountMatches('recommendation_decisions', decisionRows.length, decisionsExpectedCount ?? 0)

    const decisionsByGameweek = new Map<number, DecisionRecord[]>()
    for (const row of decisionRows) {
      const decision = toDecisionRecord(row)
      const list = decisionsByGameweek.get(row.gameweek_id) ?? []
      list.push(decision)
      decisionsByGameweek.set(row.gameweek_id, list)
    }

    // ------------------------------------------------------------------
    // 3. prediction_log — settled rows only. Never player_match_stats;
    //    see file header, "WHERE ACTUALS COME FROM".
    // ------------------------------------------------------------------
    const {
      rows: predictionLogRows,
      error: predictionLogError,
    } = await fetchAllPages<PredictionLogRow>((from, to) =>
      supabase
        .from('prediction_log')
        .select('gameweek_id, player_id, actual_points, actual_minutes, settled_at, captured_at, model_version')
        .not('settled_at', 'is', null)
        .order('gameweek_id', { ascending: true })
        .order('player_id', { ascending: true })
        .order('model_version', { ascending: true })
        .range(from, to)
        .returns<PredictionLogRow[]>(),
    )
    if (predictionLogError) {
      if (isMissingTable(predictionLogError, 'prediction_log')) {
        throw new ScorecardError(`the "prediction_log" table does not exist. Apply ${PREDICTION_LOG_MIGRATION} first.`, 'prediction_log')
      }
      throw new ScorecardError(`prediction_log lookup failed: ${predictionLogError.message}`, 'prediction_log')
    }
    const { count: predictionLogExpectedCount, error: predictionLogCountError } = await supabase
      .from('prediction_log')
      .select('*', { count: 'exact', head: true })
      .not('settled_at', 'is', null)
    if (predictionLogCountError) {
      throw new ScorecardError(`prediction_log count check failed: ${predictionLogCountError.message}`, 'prediction_log')
    }
    assertRowCountMatches('prediction_log (settled)', predictionLogRows.length, predictionLogExpectedCount ?? 0)

    const { byGameweek: actualsByGameweek, conflictingPlayerCount } = buildActualsByGameweek(predictionLogRows)

    // ------------------------------------------------------------------
    // 4. Score every gameweek that has a Plan A.
    // ------------------------------------------------------------------
    const results: GameweekResult[] = gameweekIds.map((gameweekId) => {
      const plans = plansByGameweek.get(gameweekId)!
      const decision = pickDecisionForGameweek(decisionsByGameweek.get(gameweekId) ?? [])
      const actuals = actualsByGameweek.get(gameweekId) ?? new Map()
      return scoreGameweek(gameweekId, plans, decision, actuals, actuals.size > 0)
    })

    const counters = reconcile(results)
    const report = renderScorecard({
      generatedAtIso: startedAt.toISOString(),
      results,
      counters,
      conflictingPlayerCount,
    })

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, report, 'utf8')

    const message =
      `${JOB_NAME}: ${counters.gameweeksRead} gameweek(s) read, ${counters.gameweeksScored} scored ` +
      `(excluded: ${counters.excludedUnsettled} unsettled, ${counters.excludedMissingActuals} missing actuals, ` +
      `${counters.excludedReconstructionFailed} reconstruction failed). Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: { ...counters, conflictingPlayerCount, reportPath },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof ScorecardError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g.
// from its test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
