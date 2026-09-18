// Transfer scorecard — ticket #254. Read-only, changes nothing.
//
// ============================================================================
// Why this exists.
// ============================================================================
// Every existing measurement in this repo scores the PROJECTION (calibration-report.ts,
// run-backtest.ts) or the RECOMMENDATION as a whole (recommendation-scorecard.ts, captaincy
// regret in the same file). Nothing has ever scored the TRANSFER ITSELF — whether the specific
// player-out/player-in swap the solver chose was worth making, in points, once its hit cost is
// paid. This was impossible before ticket #248: player_match_stats carries no price, so a past
// squad could never be priced, and player_projections/prediction_log carry no price either.
// public.player_gameweek_history (#248) now carries `now_cost` per player per gameweek for the
// current season, which is what this script needs to price both the issued transfer and every
// alternative it is compared against.
//
// NOTHING IS TUNED, CHANGED, OR WRITTEN BACK by this file. src/lib/, the solver, and
// scripts/generate-recommendations.ts are untouched — this is a read-only instrument, matching
// scripts/bonus-validation-report.ts's and scripts/recommendation-scorecard.ts's own "changes
// nothing" convention.
//
// ============================================================================
// THE ISSUED TRANSFER COMES FROM notifications.plan_snapshot, NEVER `recommendations`.
// ============================================================================
// `recommendations` is upserted in place, keyed on (gameweek_id, plan_index) — a re-run of
// scripts/generate-recommendations.ts for the same gameweek replaces that gameweek's rows, so a
// later read of it is not necessarily what was actually issued (see
// supabase/migrations/20260913090000_notifications_plan_snapshot.sql's own header). This script
// reads ONLY notifications.plan_snapshot for the transfer (player out, player in, hit cost) — it
// never queries `recommendations` at all. A gameweek with no usable plan_snapshot is excluded and
// named, never silently backfilled from the mutable table (same discipline
// scripts/recommendation-scorecard.ts's own "CAPTAINCY REGRET AND RANK" section already applies
// for the identical reason).
//
// ============================================================================
// UNITS — the single most dangerous line in this file.
// ============================================================================
// public.player_gameweek_history.now_cost is DECIMAL MILLIONS (5.8 means £5.8m) — verified
// directly against both seasons' source data (see that table's own column comment). It is NOT
// the same convention as public.players.now_cost or public.squads.bank, both of which are
// INTEGER TENTHS of a million (58 means £5.8m), the raw FPL API format. Mixing the two silently
// misprices every squad by a factor of ten. This file therefore:
//   - reads every alternative's price from player_gameweek_history ONLY, never players.now_cost;
//   - converts squads.bank (tenths) to decimal millions with the one named function
//     bankTenthsToDecimalMillions before it is ever compared against a player_gameweek_history
//     price;
//   - never reads players.now_cost for a valuation at all — see the next section.
// A named test (`bankTenthsToDecimalMillions` / `buildPriceIndexForGameweek`) asserts both units
// directly, never inferred from a formatted string.
//
// ============================================================================
// NO LOOKAHEAD — every price is scoped to its own gameweek.
// ============================================================================
// `buildPriceIndexForGameweek` filters player_gameweek_history rows to (season, gameweek) BEFORE
// building the code -> price map; a row for any other gameweek is invisible to it, even for the
// same player. players.now_cost (today's live price) is never read by this file for a squad
// valuation — the exact class of leak that has cost four tickets on the fixture term previously
// (see this ticket's own text). A named test proves a same-player, different-gameweek row is
// excluded.
//
// ============================================================================
// THE THREE PIECES MEASURED, PER TRANSFER GAMEWEEK.
// ============================================================================
// 1. Realised gain — the following gameweek: incoming player's actual points minus outgoing
//    player's actual points, minus hit cost. This IS the gain over the roll baseline (see below)
//    — the roll baseline's own score is reported alongside it, not folded away.
// 2. Realised gain — the following five gameweeks: identical arithmetic, summed across
//    PROJECTION_HORIZON gameweeks (the horizon the solver actually optimises over — matches
//    scripts/project-points.ts's own PROJECTION_HORIZON = 5, duplicated per this repo's "every
//    scripts/*.ts job is a standalone entry point" convention). Hit cost is a ONE-TIME cost —
//    applied exactly once to the summed total, never once per gameweek. A named test
//    (`computeNetGain`) proves this directly.
// 3. The roll baseline: what the score would have been had no transfer been made — i.e. the
//    outgoing player's own actual points, with no hit cost (a roll never pays one). A transfer
//    with a negative realised gain is, by construction, a transfer that scored worse than rolling
//    would have; the count of those is this report's headline number.
// 4. The affordable ceiling: the best single, same-position transfer available under that
//    gameweek's own real prices and the squad's real pre-transfer bank, scored in hindsight —
//    explicitly a ceiling nobody could have known to hit in real time, never a target. Must
//    respect the bank constraint (candidate price <= pre-transfer bank + outgoing player's own
//    sale price, all in decimal millions) and the 3-per-club limit on the resulting squad. Same
//    position as the outgoing player, matching how a real FPL transfer actually works (you pick a
//    replacement FOR a specific departing squad slot) — not named as its own DoD test, but
//    enforced and unit-tested; see decisions log.
//
// A ROLL SNAPSHOT (isRoll: true) IS EXCLUDED FROM ALL FOUR, BY NAME, NEVER SCORED AS A
// ZERO-POINT TRANSFER. Rolling is a real decision this app can make; there is no transfer to
// price or measure. classifySnapshot + a named test cover this directly.
//
// ============================================================================
// WHERE THE PRE-TRANSFER SQUAD AND BANK COME FROM.
// ============================================================================
// The pre-transfer 15-man squad is reconstructed from plan_snapshot's own startingXi + benchOrder
// (the POST-transfer squad) with the transferred-IN code swapped back to the transferred-OUT
// code — the same reconstruction scripts/recommendation-scorecard.ts's buildRollShape already
// uses for its own roll counterfactual, extended here from 11+bench to the full 15. No second
// table is needed for the squad's shape.
//
// The pre-transfer BANK, however, is not carried by plan_snapshot at all — it is read from
// public.squads.bank at the transfer's OWN gameweek_id. This matches scripts/
// build-solver-input.ts's own read (`squads`/`squad_picks` at `nextGw.id`, the upcoming,
// not-yet-decided gameweek): sync-squad.ts carries the bank/squad forward into that row before
// its own deadline, so squads.bank at gameweek_id = N is the budget available BEFORE any
// transfer for gameweek N is made — exactly the "squad's real bank" this ticket asks for. A
// gameweek with no squads row is excluded from the affordable-ceiling figure by name
// ('noSquadState'), never assumed to be £0.0m.
//
// ============================================================================
// ACTUALS COME FROM prediction_log ONLY, matching every sibling scorecard in this repo.
// ============================================================================
// Never player_match_stats, gameweek_live_stats, or player_projections — settled prediction_log
// rows already wait for gameweek lockdown (scripts/settle-predictions.ts). Joined on
// player_code (denormalized on prediction_log), never player_id: this script never crosses a
// season boundary (only the current season carries a plan_snapshot at all), so there is no D9
// cross-season id-drift concern to guard against here — same documented departure
// recommendation-scorecard.ts's own file header already explains for the identical reason.
//
// ============================================================================
// POOLING AND SAMPLE SIZE — read this before reading any number below.
// ============================================================================
// Every pooled figure is computed by summing the underlying per-gameweek rows directly, never by
// averaging a set of already-computed per-gameweek means (poolGains, matching
// scripts/bonus-validation-report.ts's and scripts/recommendation-scorecard.ts's own "pooling"
// convention). At most four gameweeks carry a plan_snapshot at all as of this ticket (the column
// shipped 13 Sep 2026) — every figure is printed beside its own `n`, and the report states this
// limitation plainly, in the same shape scripts/bonus-validation-report.ts already uses for its
// own three-gameweek limitation.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other
// scripts/*.ts job. Every multi-row Supabase read goes through scripts/lib/paginate.ts's
// fetchAllPages + assertRowCountMatches. Writes to no table but job_runs (one row, never
// upserted). Writes one report file, to TRANSFER_SCORECARD_REPORT_PATH (default
// ./out/transfer-scorecard.md). Hand-run only — not wired into any scheduled workflow, same
// precedent as run-backtest.ts, calibration-report.ts and recommendation-scorecard.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'

const JOB_NAME = 'transfer-scorecard'
const NOTIFICATIONS_PLAN_SNAPSHOT_MIGRATION = 'supabase/migrations/20260913090000_notifications_plan_snapshot.sql'
const PREDICTION_LOG_MIGRATION = 'supabase/migrations/20260821090000_prediction_log.sql'
const PLAYER_GAMEWEEK_HISTORY_MIGRATION = 'supabase/migrations/20260917100000_player_gameweek_history.sql'
const SQUAD_STATE_MIGRATION = 'supabase/migrations/20260811180000_squad_state.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

const DEFAULT_REPORT_PATH = './out/transfer-scorecard.md'

/** Must match scripts/project-points.ts's own CURRENT_SEASON — duplicated, not imported; every
 *  scripts/*.ts job is a standalone entry point (see file header). plan_snapshot only exists for
 *  the current season (the column shipped 13 Sep 2026), so this is the only season this script
 *  ever needs to price. */
export const CURRENT_SEASON = '2026-2027'

/** Must match scripts/project-points.ts's own PROJECTION_HORIZON — "the horizon the solver
 *  actually optimises over" (this ticket's own text), duplicated for the same reason as
 *  CURRENT_SEASON above. */
export const HORIZON_GAMEWEEKS = 5

/** Squad slot limit per real-world club — the standard FPL rule, applied to the resulting
 *  15-man squad after a hypothetical single swap. */
export const MAX_PLAYERS_PER_CLUB = 3

// ============================================================================
// Units — see file header, "UNITS". Pure, no I/O.
// ============================================================================

/** public.squads.bank is stored in TENTHS of a million (public.players.now_cost's own
 *  convention — see supabase/migrations/20260811180000_squad_state.sql: "5 means £0.5m").
 *  public.player_gameweek_history.now_cost is ALREADY decimal millions. This is the one place
 *  tenths are converted to decimal millions before comparison — never apply this to a
 *  player_gameweek_history value, which is already in the target unit. */
export function bankTenthsToDecimalMillions(bankTenths: number): number {
  return bankTenths / 10
}

// ============================================================================
// plan_snapshot — the shape scripts/send-telegram.ts's buildPlanSnapshot writes (see that
// migration's header for the full shape). Only the fields this file needs.
// ============================================================================

export interface RawPlanSnapshot {
  isRoll: boolean
  transferIn: { code: number } | null
  transferOut: { code: number } | null
  startingXi: number[]
  benchOrder: number[]
  hitCost: number
}

export type SnapshotClassification =
  | { kind: 'transfer'; transferInCode: number; transferOutCode: number; hitCost: number }
  | { kind: 'roll' }
  | { kind: 'invalid'; detail: string }

/** A roll snapshot is classified as a roll and NEVER falls through to the transfer arithmetic —
 *  the exact defect a "zero-point transfer" would be (file header, "A ROLL SNAPSHOT"). Defensive
 *  'invalid' branch: isRoll false with a null transfer side should not occur given how
 *  buildPlanSnapshot writes this column, but this file never assumes a stored jsonb blob is
 *  shaped as expected — see every extractor in scripts/bonus-validation-report.ts for the same
 *  discipline. */
export function classifySnapshot(snapshot: RawPlanSnapshot): SnapshotClassification {
  if (snapshot.isRoll) return { kind: 'roll' }
  if (snapshot.transferIn === null || snapshot.transferOut === null) {
    return {
      kind: 'invalid',
      detail: 'isRoll is false but transferIn and/or transferOut is null — cannot identify the issued transfer from this snapshot.',
    }
  }
  return { kind: 'transfer', transferInCode: snapshot.transferIn.code, transferOutCode: snapshot.transferOut.code, hitCost: snapshot.hitCost }
}

/** Reconstructs the PRE-transfer 15-man squad (player codes) from the snapshot's own POST-transfer
 *  startingXi + benchOrder, by swapping the transferred-in code back to the transferred-out code —
 *  the same reconstruction scripts/recommendation-scorecard.ts's buildRollShape already uses for
 *  its own roll counterfactual (there, applied to just the 11+bench that script tracks; here, to
 *  the full 15, since the affordable-ceiling search needs every squad slot's club). Returns null
 *  (never a wrong-length array) when startingXi + benchOrder together are not exactly 15 codes —
 *  a reconstruction failure, excluded and named at the call site, never guessed past. */
export function buildPreTransferSquadCodes(snapshot: RawPlanSnapshot, transferInCode: number, transferOutCode: number): number[] | null {
  const full = [...snapshot.startingXi, ...snapshot.benchOrder]
  if (full.length !== 15) return null
  return full.map((code) => (code === transferInCode ? transferOutCode : code))
}

// ============================================================================
// Gain arithmetic — PURE, and the single place hit cost is applied. Shared by both the
// following-gameweek and the five-gameweek figures: the caller passes in already-SUMMED
// incoming/outgoing points (a sum of one gameweek, or a sum of five), and hit cost is applied
// exactly once regardless — see file header, "Hit cost is a ONE-TIME cost".
// ============================================================================

export function computeNetGain(incomingPointsSum: number, outgoingPointsSum: number, hitCost: number): number {
  return incomingPointsSum - outgoingPointsSum - hitCost
}

export interface PooledGain {
  n: number
  totalGain: number
  /** null (never 0) when n is 0 — an unmeasured mean must never read as "measured and zero",
   *  same discipline as scripts/bonus-validation-report.ts's computeBonusComparisonStats. */
  meanGain: number | null
  /** How many of the n gameweeks gained less than rolling would have — the headline number
   *  (file header, "a transfer with a negative realised gain"). */
  negativeCount: number
}

/** Pools from the underlying per-gameweek gain values directly (sum then divide) — never from a
 *  mean of already-computed per-gameweek means. See file header, "POOLING". */
export function poolGains(gains: readonly number[]): PooledGain {
  const n = gains.length
  const totalGain = gains.reduce((sum, g) => sum + g, 0)
  return { n, totalGain, meanGain: n === 0 ? null : totalGain / n, negativeCount: gains.filter((g) => g < 0).length }
}

// ============================================================================
// Pricing — PURE. Scoped to exactly one (season, gameweek) — see file header, "NO LOOKAHEAD".
// ============================================================================

export interface PlayerGameweekHistoryRow {
  season: string
  gameweek: number
  playerCode: number
  /** Decimal millions, verbatim from player_gameweek_history — see file header, "UNITS". */
  nowCost: number
}

/** Filters to EXACTLY (season, gameweek) before building the code -> price map. A row for any
 *  other gameweek — even for the same player_code — is invisible to the returned map. This is
 *  the one place a price ever enters this file; every other function takes a price only via this
 *  map. */
export function buildPriceIndexForGameweek(rows: readonly PlayerGameweekHistoryRow[], season: string, gameweek: number): Map<number, number> {
  const index = new Map<number, number>()
  for (const row of rows) {
    if (row.season !== season || row.gameweek !== gameweek) continue
    index.set(row.playerCode, row.nowCost)
  }
  return index
}

// ============================================================================
// Actuals — PURE. Sums settled prediction_log actual_points across a list of gameweeks for one
// player_code; null (never a partial sum) when any gameweek in the list is missing an actual for
// that player — a fair comparison across a horizon needs every gameweek measured, not most of
// them.
// ============================================================================

export type ActualsByGameweek = ReadonlyMap<number, ReadonlyMap<number, number>>

export function sumActualPoints(actualsByGameweek: ActualsByGameweek, gameweekIds: readonly number[], playerCode: number): number | null {
  let sum = 0
  for (const gwId of gameweekIds) {
    const points = actualsByGameweek.get(gwId)?.get(playerCode)
    if (points === undefined) return null
    sum += points
  }
  return sum
}

/** Builds a (playerCode -> summed actual points) map for every player_code present across the
 *  given horizon's FIRST gameweek (the widest reasonable candidate pool — the pool of players
 *  ever worth considering as a hindsight alternative), keeping only codes with a settled actual
 *  for EVERY gameweek in the horizon (see sumActualPoints above). Used both for the outgoing/
 *  incoming players and for scoring every affordable-ceiling candidate with one shared map. */
export function buildSummedPointsByCode(actualsByGameweek: ActualsByGameweek, gameweekIds: readonly number[]): Map<number, number> {
  const firstGw = actualsByGameweek.get(gameweekIds[0])
  const result = new Map<number, number>()
  if (!firstGw) return result
  for (const code of firstGw.keys()) {
    const sum = sumActualPoints(actualsByGameweek, gameweekIds, code)
    if (sum !== null) result.set(code, sum)
  }
  return result
}

// ============================================================================
// The affordable ceiling — PURE. See file header, item 4.
// ============================================================================

export interface CandidatePlayer {
  code: number
  teamId: number
  elementType: number
}

/** Every squad-legal, budget-legal alternative to `outgoing`, drawn from `candidates` (assumed to
 *  exclude every player already in `preTransferSquad` — see the call site). Same position as
 *  `outgoing` (see file header, item 4, "same position"), price (from `priceByCode`) at or under
 *  `budgetDecimalMillions`, and the resulting squad keeps every club at or under
 *  MAX_PLAYERS_PER_CLUB. A candidate with no price on record for this gameweek is silently
 *  unaffordable (never assumed free) — it simply cannot be evaluated and is excluded. */
export function findAffordableCandidates(
  preTransferSquad: readonly CandidatePlayer[],
  outgoing: CandidatePlayer,
  budgetDecimalMillions: number,
  priceByCode: ReadonlyMap<number, number>,
  candidates: readonly CandidatePlayer[],
): CandidatePlayer[] {
  const clubCounts = new Map<number, number>()
  for (const p of preTransferSquad) clubCounts.set(p.teamId, (clubCounts.get(p.teamId) ?? 0) + 1)

  const affordable: CandidatePlayer[] = []
  for (const c of candidates) {
    if (c.elementType !== outgoing.elementType) continue
    const price = priceByCode.get(c.code)
    if (price === undefined || price > budgetDecimalMillions) continue
    const existingClubCount = clubCounts.get(c.teamId) ?? 0
    const newClubCount = existingClubCount - (outgoing.teamId === c.teamId ? 1 : 0) + 1
    if (newClubCount > MAX_PLAYERS_PER_CLUB) continue
    affordable.push(c)
  }
  return affordable
}

/** Highest hindsight points first; ties broken by the lower player code, purely for a
 *  deterministic single answer (carries no football meaning) — same tie-break convention as
 *  scripts/recommendation-scorecard.ts's own bestAvailableAmongStarters. A candidate with no
 *  points on record for the horizon (never settled, or excluded from buildSummedPointsByCode for
 *  lacking full-horizon coverage) cannot be picked at all. */
export function pickBestByPoints(candidates: readonly CandidatePlayer[], pointsByCode: ReadonlyMap<number, number>): { code: number; points: number } | null {
  let best: { code: number; points: number } | null = null
  for (const c of candidates) {
    const points = pointsByCode.get(c.code)
    if (points === undefined) continue
    if (!best || points > best.points || (points === best.points && c.code < best.code)) {
      best = { code: c.code, points }
    }
  }
  return best
}

export type CeilingOutcome =
  | {
      ok: true
      bestCode: number
      bestPoints: number
      outgoingPoints: number
      /** bestPoints - outgoingPoints. Explicitly NOT compared against any hit cost — the
       *  ceiling is scored as a free hypothetical single transfer, exactly like the transfer it
       *  is measured against would have been had it been Keshav's only (free) transfer that
       *  week; see file header, item 4. */
      ceilingGain: number
      candidatesAffordable: number
    }
  | { ok: false; reason: string }

/** Composes findAffordableCandidates + pickBestByPoints into the one figure this report prints —
 *  "how much of the available gain the solver captured" (file header, item 4). Fails closed with
 *  a named reason at every step: no recorded points for the outgoing player over this horizon, no
 *  affordable/legal alternative at all, or no affordable alternative with a recorded hindsight
 *  points figure. Never guesses a ceiling from a partial candidate pool. */
export function computeCeiling(
  preTransferSquad: readonly CandidatePlayer[],
  outgoing: CandidatePlayer,
  budgetDecimalMillions: number,
  priceByCode: ReadonlyMap<number, number>,
  pointsByCode: ReadonlyMap<number, number>,
  candidates: readonly CandidatePlayer[],
): CeilingOutcome {
  const outgoingPoints = pointsByCode.get(outgoing.code)
  if (outgoingPoints === undefined) {
    return { ok: false, reason: 'no settled actual points on record for the outgoing player over this horizon' }
  }

  const affordable = findAffordableCandidates(preTransferSquad, outgoing, budgetDecimalMillions, priceByCode, candidates)
  if (affordable.length === 0) {
    return { ok: false, reason: 'no affordable, same-position, club-legal alternative was found under the real bank and prices' }
  }

  const best = pickBestByPoints(affordable, pointsByCode)
  if (!best) {
    return { ok: false, reason: 'every affordable alternative lacked a settled actual points figure over this horizon' }
  }

  return { ok: true, bestCode: best.code, bestPoints: best.points, outgoingPoints, ceilingGain: best.points - outgoingPoints, candidatesAffordable: affordable.length }
}

// ============================================================================
// One transfer gameweek, fully evaluated — PURE. Composes every function above. This is the
// function the DoD's named tests exercise end to end for a realistic gameweek.
// ============================================================================

export interface HorizonResult {
  gameweekIds: readonly number[]
  gain: number | null
  incomingPoints: number | null
  outgoingPoints: number | null
  rollBaselinePoints: number | null
  exclusionReason: string | null
  ceiling: CeilingOutcome | null
}

/** Everything evaluateHorizon needs to attempt the affordable-ceiling figure for one gameweek —
 *  built once per gameweek at the call site (it does not vary by horizon) and reused for both the
 *  1- and 5-gameweek HorizonResults. budgetDecimalMillions is null exactly when the pre-transfer
 *  budget could not be computed (no squads.bank row, or no recorded price for the outgoing
 *  player) — see evaluateTransferGameweek. */
export interface CeilingInputs {
  preTransferSquad: readonly CandidatePlayer[]
  outgoing: CandidatePlayer
  budgetDecimalMillions: number | null
  priceByCode: ReadonlyMap<number, number>
  candidates: readonly CandidatePlayer[]
}

function evaluateHorizon(
  gameweekIds: readonly number[],
  transferInCode: number,
  transferOutCode: number,
  hitCost: number,
  actualsByGameweek: ActualsByGameweek,
  ceilingInputs: CeilingInputs | null,
): HorizonResult {
  const incomingPoints = sumActualPoints(actualsByGameweek, gameweekIds, transferInCode)
  const outgoingPoints = sumActualPoints(actualsByGameweek, gameweekIds, transferOutCode)

  if (incomingPoints === null || outgoingPoints === null) {
    return {
      gameweekIds,
      gain: null,
      incomingPoints,
      outgoingPoints,
      rollBaselinePoints: outgoingPoints,
      exclusionReason: `no settled actual for player code(s) over gameweek(s) ${gameweekIds.join(', ')}: ` +
        `incoming (code ${transferInCode}) ${incomingPoints === null ? 'missing' : 'present'}, ` +
        `outgoing (code ${transferOutCode}) ${outgoingPoints === null ? 'missing' : 'present'}.`,
      ceiling: null,
    }
  }

  const gain = computeNetGain(incomingPoints, outgoingPoints, hitCost)

  let ceiling: CeilingOutcome | null = null
  if (ceilingInputs) {
    if (ceilingInputs.budgetDecimalMillions === null) {
      ceiling = { ok: false, reason: 'no squads.bank on record for this gameweek — the pre-transfer budget cannot be computed' }
    } else {
      const pointsByCode = buildSummedPointsByCode(actualsByGameweek, gameweekIds)
      ceiling = computeCeiling(
        ceilingInputs.preTransferSquad,
        ceilingInputs.outgoing,
        ceilingInputs.budgetDecimalMillions,
        ceilingInputs.priceByCode,
        pointsByCode,
        ceilingInputs.candidates,
      )
    }
  }

  return { gameweekIds, gain, incomingPoints, outgoingPoints, rollBaselinePoints: outgoingPoints, exclusionReason: null, ceiling }
}

export interface TransferGameweekScored {
  gameweekId: number
  ok: true
  transferInCode: number
  transferOutCode: number
  hitCost: number
  oneGw: HorizonResult
  fiveGw: HorizonResult
}

export type TransferGameweekExclusionReason = 'noSnapshot' | 'roll' | 'invalidSnapshot' | 'reconstructionFailed'

export interface TransferGameweekExcluded {
  gameweekId: number
  ok: false
  reason: TransferGameweekExclusionReason
  detail: string
}

export type TransferGameweekResult = TransferGameweekScored | TransferGameweekExcluded

export interface EvaluateTransferGameweekInputs {
  gameweekId: number
  snapshot: RawPlanSnapshot | undefined
  oneGwIds: readonly number[]
  fiveGwIds: readonly number[]
  actualsByGameweek: ActualsByGameweek
  playersByCode: ReadonlyMap<number, CandidatePlayer>
  priceByCode: ReadonlyMap<number, number>
  /** squads.bank at this gameweek_id, in TENTHS (raw, unconverted) — null when no squads row
   *  exists. Converted internally via bankTenthsToDecimalMillions so no call site can pass an
   *  already-converted figure by mistake. */
  bankTenths: number | null
  /** Every current player NOT in the pre-transfer squad — the affordable-ceiling candidate pool.
   *  Built at the call site once per gameweek (depends on the reconstructed squad). */
  candidatesExcludingSquad: (preTransferSquadCodes: readonly number[]) => CandidatePlayer[]
}

/** Evaluates one gameweek's transfer end to end, or excludes it by name. This is the function the
 *  DoD's named tests exercise directly. */
export function evaluateTransferGameweek(input: EvaluateTransferGameweekInputs): TransferGameweekResult {
  const { gameweekId, snapshot } = input
  if (!snapshot) {
    return { gameweekId, ok: false, reason: 'noSnapshot', detail: 'no notifications.plan_snapshot was recorded for this gameweek.' }
  }

  const classification = classifySnapshot(snapshot)
  if (classification.kind === 'roll') {
    return { gameweekId, ok: false, reason: 'roll', detail: 'the issued plan was a roll — no transfer to measure. Not scored as a zero-point transfer.' }
  }
  if (classification.kind === 'invalid') {
    return { gameweekId, ok: false, reason: 'invalidSnapshot', detail: classification.detail }
  }

  const { transferInCode, transferOutCode, hitCost } = classification
  const preTransferSquadCodes = buildPreTransferSquadCodes(snapshot, transferInCode, transferOutCode)
  if (preTransferSquadCodes === null) {
    return {
      gameweekId,
      ok: false,
      reason: 'reconstructionFailed',
      detail: `startingXi + benchOrder together carry ${snapshot.startingXi.length + snapshot.benchOrder.length} code(s), expected 15.`,
    }
  }

  const outgoingPlayer = input.playersByCode.get(transferOutCode)
  const preTransferSquad: CandidatePlayer[] = preTransferSquadCodes
    .map((code) => input.playersByCode.get(code))
    .filter((p): p is CandidatePlayer => p !== undefined)

  let ceilingInputs: CeilingInputs | null = null
  if (outgoingPlayer && preTransferSquad.length === preTransferSquadCodes.length) {
    const outgoingPrice = input.priceByCode.get(transferOutCode)
    const bankDecimalMillions = input.bankTenths === null ? null : bankTenthsToDecimalMillions(input.bankTenths)
    const budgetDecimalMillions = bankDecimalMillions === null || outgoingPrice === undefined ? null : bankDecimalMillions + outgoingPrice
    ceilingInputs = {
      preTransferSquad,
      outgoing: outgoingPlayer,
      budgetDecimalMillions,
      priceByCode: input.priceByCode,
      candidates: input.candidatesExcludingSquad(preTransferSquadCodes),
    }
  }

  const oneGw = evaluateHorizon(input.oneGwIds, transferInCode, transferOutCode, hitCost, input.actualsByGameweek, ceilingInputs)
  const fiveGw = evaluateHorizon(input.fiveGwIds, transferInCode, transferOutCode, hitCost, input.actualsByGameweek, ceilingInputs)

  return { gameweekId, ok: true, transferInCode, transferOutCode, hitCost, oneGw, fiveGw }
}

// ============================================================================
// Rendering — PURE string building, no I/O. Markdown, matching every sibling report script's own
// console-log-a-markdown-report convention.
// ============================================================================

function fmt(n: number | null, digits = 2): string {
  return n === null ? 'n/a' : n.toFixed(digits)
}

function fmtCeiling(c: CeilingOutcome | null): string {
  if (c === null) return 'not evaluated'
  if (!c.ok) return `n/a — ${c.reason}`
  return `player code ${c.bestCode}: +${fmt(c.ceilingGain)} (of ${c.candidatesAffordable} affordable candidate(s))`
}

function renderHorizonRow(label: string, h: HorizonResult): string {
  if (h.exclusionReason) return `| ${label} | excluded | — | — | ${h.exclusionReason} | ${fmtCeiling(h.ceiling)} |`
  const verdict = h.gain !== null && h.gain < 0 ? 'gained LESS than rolling' : 'gained at least as much as rolling'
  return `| ${label} | ${fmt(h.gain)} | incoming ${fmt(h.incomingPoints)} | outgoing / roll baseline ${fmt(h.rollBaselinePoints)} | ${verdict} | ${fmtCeiling(h.ceiling)} |`
}

export function renderScorecard(results: readonly TransferGameweekResult[], generatedAtIso: string): string {
  const scored = results.filter((r): r is TransferGameweekScored => r.ok)
  const excluded = results.filter((r): r is TransferGameweekExcluded => !r.ok)

  const lines: string[] = []
  lines.push('# Transfer scorecard')
  lines.push('')
  lines.push(`Generated ${generatedAtIso}. Job: \`${JOB_NAME}\`. **Read-only — changes nothing.**`)
  lines.push('')
  lines.push(
    '**The issued transfer is read from `notifications.plan_snapshot` only, never from the mutable `recommendations` ' +
      'table.** A gameweek with no usable snapshot is excluded and named below, never silently backfilled.',
  )
  lines.push('')
  lines.push(
    `**${scored.length} gameweek(s) with an issued, measurable transfer.** At most a handful of gameweeks carry a ` +
      "plan_snapshot at all right now (the column shipped 13 Sep 2026), so a mean over this few gameweeks is weak " +
      "evidence — this instrument's value is that it accumulates over the season, not that any single run of it is " +
      "conclusive (same convention as scripts/bonus-validation-report.ts's own three-gameweek limitation, and " +
      "scripts/recommendation-scorecard.ts's own captaincy-regret section). Read every figure below alongside its " +
      'own sample size, printed beside it.',
  )
  lines.push('')
  lines.push(
    '**The affordable ceiling is a hindsight figure nobody could have known to hit in real time.** It exists only to ' +
      "show how much of the available gain the solver's actual transfer captured — it is never a target, and a " +
      'transfer that fell short of it was not necessarily a bad decision.',
  )
  lines.push('')

  if (scored.length === 0) {
    lines.push(
      '## No measurable transfer gameweeks yet\n\n' +
        'No gameweek has both a usable `notifications.plan_snapshot` naming an actual transfer AND settled ' +
        '`prediction_log` actuals for the players involved. See the excluded-gameweeks table below for why each ' +
        "gameweek this script knows about didn't qualify. This is the expected early-season state, not a failure.",
    )
    if (excluded.length > 0) {
      lines.push('')
      lines.push('### Excluded gameweeks')
      lines.push('')
      lines.push('| Gameweek | Reason | Detail |')
      lines.push('|---|---|---|')
      for (const e of excluded) lines.push(`| ${e.gameweekId} | ${e.reason} | ${e.detail} |`)
    }
    return lines.join('\n')
  }

  lines.push('## Per gameweek')
  lines.push('')
  for (const gw of scored) {
    lines.push(`### Gameweek ${gw.gameweekId} — transfer: OUT player code ${gw.transferOutCode}, IN player code ${gw.transferInCode}, hit cost ${gw.hitCost}`)
    lines.push('')
    lines.push('| Horizon | Realised gain (vs. roll) | Incoming actual points | Outgoing / roll baseline points | Verdict | Affordable ceiling (hindsight) |')
    lines.push('|---|---|---|---|---|---|')
    lines.push(renderHorizonRow('Following gameweek', gw.oneGw))
    lines.push(renderHorizonRow(`${HORIZON_GAMEWEEKS}-gameweek horizon`, gw.fiveGw))
    lines.push('')
  }

  const oneGwGains = scored.filter((gw) => gw.oneGw.gain !== null).map((gw) => gw.oneGw.gain as number)
  const fiveGwGains = scored.filter((gw) => gw.fiveGw.gain !== null).map((gw) => gw.fiveGw.gain as number)
  const oneGwPool = poolGains(oneGwGains)
  const fiveGwPool = poolGains(fiveGwGains)

  lines.push('## Pooled (from underlying gameweek rows, never an average of per-gameweek means)')
  lines.push('')
  lines.push(
    `- **Following gameweek** — mean realised gain **${fmt(oneGwPool.meanGain)}** (n=${oneGwPool.n}), total ${fmt(oneGwPool.totalGain)}. ` +
      `**${oneGwPool.negativeCount}/${oneGwPool.n}** gameweek(s) gained less than rolling would have — the headline number.`,
  )
  lines.push(
    `- **${HORIZON_GAMEWEEKS}-gameweek horizon** — mean realised gain **${fmt(fiveGwPool.meanGain)}** (n=${fiveGwPool.n}), total ${fmt(fiveGwPool.totalGain)}. ` +
      `**${fiveGwPool.negativeCount}/${fiveGwPool.n}** gameweek(s) gained less than rolling would have.`,
  )
  lines.push('')

  if (excluded.length > 0) {
    lines.push('## Excluded gameweeks')
    lines.push('')
    lines.push('| Gameweek | Reason | Detail |')
    lines.push('|---|---|---|')
    for (const e of excluded) lines.push(`| ${e.gameweekId} | ${e.reason} | ${e.detail} |`)
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================================================
// Everything below this line is I/O: Supabase reads, report rendering glue, and job_runs
// bookkeeping. Nothing above this line touches a network or a clock.
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
  return process.env.TRANSFER_SCORECARD_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

export class TransferScorecardError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'TransferScorecardError'
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

function isMissingColumn(error: PostgrestLikeError, columnName: string): boolean {
  if (error.code === '42703') return true
  const message = error.message ?? ''
  return new RegExp(columnName).test(message) && /does not exist/i.test(message)
}

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
// Row shapes and mappers.
// ----------------------------------------------------------------------------

interface NotificationSnapshotRow {
  recommendation_gameweek_id: number
  plan_index: number
  sent_at: string
  plan_snapshot: RawPlanSnapshot
}

/** Latest-sent-wins per gameweek — same "most recently sent snapshot is the frozen record
 *  closest to the real deadline" reasoning as scripts/recommendation-scorecard.ts's own
 *  pickLatestSnapshotByGameweek. */
export function pickLatestSnapshotByGameweek(rows: readonly NotificationSnapshotRow[]): Map<number, RawPlanSnapshot> {
  const bySortedSentAt = [...rows].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
  const result = new Map<number, RawPlanSnapshot>()
  for (const row of bySortedSentAt) result.set(row.recommendation_gameweek_id, row.plan_snapshot)
  return result
}

interface PredictionLogRow {
  gameweek_id: number
  player_code: number | null
  actual_points: number | null
  settled_at: string | null
  captured_at: string
}

/** Builds one (playerCode -> actual points) map per gameweek from every settled prediction_log
 *  row that carries a player_code. Rows with no player_code (a pre-#33-era row, or a resolution
 *  gap) are counted and excluded, never guessed. When more than one settled row exists for the
 *  same (gameweek, player_code) — possible across model_version — the most recently captured one
 *  wins, same tie-break as scripts/recommendation-scorecard.ts's buildActualsByGameweek. */
export function buildActualsByGameweek(rows: readonly PredictionLogRow[]): {
  byGameweek: Map<number, Map<number, number>>
  noPlayerCodeCount: number
} {
  const byGameweek = new Map<number, Map<number, { points: number; capturedAtMs: number }>>()
  let noPlayerCodeCount = 0

  for (const row of rows) {
    if (row.settled_at === null || row.actual_points === null) continue
    if (row.player_code === null) {
      noPlayerCodeCount++
      continue
    }
    let forGameweek = byGameweek.get(row.gameweek_id)
    if (!forGameweek) {
      forGameweek = new Map()
      byGameweek.set(row.gameweek_id, forGameweek)
    }
    const capturedAtMs = new Date(row.captured_at).getTime()
    const existing = forGameweek.get(row.player_code)
    if (!existing || capturedAtMs > existing.capturedAtMs) {
      forGameweek.set(row.player_code, { points: row.actual_points, capturedAtMs })
    }
  }

  const flattened = new Map<number, Map<number, number>>()
  for (const [gwId, byCode] of byGameweek) {
    const flat = new Map<number, number>()
    for (const [code, entry] of byCode) flat.set(code, entry.points)
    flattened.set(gwId, flat)
  }
  return { byGameweek: flattened, noPlayerCodeCount }
}

interface PlayerRow {
  code: number | null
  team_id: number
  element_type: number
}

interface SquadRow {
  gameweek_id: number
  bank: number
}

interface GameweekRow {
  id: number
}

/** From a full, id-ascending list of gameweek ids, the horizon (up to `length` ids, starting at
 *  and including `startId`) — mirrors scripts/project-points.ts's own `gwRows.slice(nextIndex,
 *  nextIndex + PROJECTION_HORIZON)` convention rather than assuming ids are contiguous. Returns
 *  fewer than `length` ids only at the end of a season's known gameweeks — callers must check the
 *  returned length before treating a horizon as complete. */
export function horizonGameweekIds(allIdsAscending: readonly number[], startId: number, length: number): number[] {
  const startIndex = allIdsAscending.indexOf(startId)
  if (startIndex === -1) return []
  return allIdsAscending.slice(startIndex, startIndex + length)
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
    // 1. notifications.plan_snapshot — every gameweek that ever had ANY
    //    Plan A notification (recommendation_gameweek_id not null), so a
    //    gameweek that never got a snapshot at all can be named, not just
    //    silently absent from the map. See file header.
    // ------------------------------------------------------------------
    const { rows: allNotificationRows, error: allNotificationsError } = await fetchAllPages<{ recommendation_gameweek_id: number | null; plan_index: number | null; sent_at: string }>(
      (from, to) =>
        supabase
          .from('notifications')
          .select('recommendation_gameweek_id, plan_index, sent_at')
          .eq('plan_index', 0)
          .not('recommendation_gameweek_id', 'is', null)
          .order('sent_at', { ascending: true })
          .range(from, to)
          .returns<{ recommendation_gameweek_id: number | null; plan_index: number | null; sent_at: string }[]>(),
    )
    if (allNotificationsError) {
      if (isMissingTable(allNotificationsError, 'notifications')) {
        const message = `${JOB_NAME}: the "notifications" table does not exist yet — nothing has ever been sent. Nothing to score.`
        console.log(message)
        await recordJobRun(supabase, { status: 'skipped', message, details: null, startedAt })
        process.exit(0)
        return
      }
      throw new TransferScorecardError(`notifications lookup failed: ${allNotificationsError.message}`, 'notifications')
    }
    const allGameweekIdsWithNotification = [...new Set(allNotificationRows.map((r) => r.recommendation_gameweek_id).filter((id): id is number => id !== null))].sort((a, b) => a - b)

    if (allGameweekIdsWithNotification.length === 0) {
      const message = `${JOB_NAME}: no Plan A notification has ever been sent. Nothing to score.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: null, startedAt })
      process.exit(0)
      return
    }

    let latestSnapshotByGameweek = new Map<number, RawPlanSnapshot>()
    {
      const { rows: snapshotRows, error: snapshotError } = await fetchAllPages<NotificationSnapshotRow>((from, to) =>
        supabase
          .from('notifications')
          .select('recommendation_gameweek_id, plan_index, sent_at, plan_snapshot')
          .eq('plan_index', 0)
          .not('plan_snapshot', 'is', null)
          .order('sent_at', { ascending: true })
          .range(from, to)
          .returns<NotificationSnapshotRow[]>(),
      )
      if (snapshotError) {
        if (isMissingColumn(snapshotError, 'plan_snapshot')) {
          console.log(`${JOB_NAME}: notifications.plan_snapshot does not exist yet — apply ${NOTIFICATIONS_PLAN_SNAPSHOT_MIGRATION} first. Every gameweek will be excluded ('noSnapshot').`)
        } else {
          throw new TransferScorecardError(`notifications (plan_snapshot) lookup failed: ${snapshotError.message}`, 'notifications')
        }
      } else {
        const { count: snapshotExpectedCount, error: snapshotCountError } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('plan_index', 0)
          .not('plan_snapshot', 'is', null)
        if (snapshotCountError) throw new TransferScorecardError(`notifications (plan_snapshot) count check failed: ${snapshotCountError.message}`, 'notifications')
        assertRowCountMatches('notifications (plan_snapshot)', snapshotRows.length, snapshotExpectedCount ?? 0)
        latestSnapshotByGameweek = pickLatestSnapshotByGameweek(snapshotRows)
      }
    }

    if (latestSnapshotByGameweek.size === 0) {
      const message = `${JOB_NAME}: no gameweek has a usable notifications.plan_snapshot yet. Nothing to score — this is the expected early-season state, not a failure.`
      console.log(message)
      const noSnapshotResults: TransferGameweekExcluded[] = allGameweekIdsWithNotification.map((id) => ({
        gameweekId: id,
        ok: false,
        reason: 'noSnapshot',
        detail: 'no notifications.plan_snapshot was recorded for this gameweek.',
      }))
      console.log(renderScorecard(noSnapshotResults, startedAt.toISOString()))
      await recordJobRun(supabase, { status: 'skipped', message, details: { gameweeksWithNotification: allGameweekIdsWithNotification.length }, startedAt })
      process.exit(0)
      return
    }

    // ------------------------------------------------------------------
    // 2. gameweeks — full id-ascending list, so each transfer's own
    //    5-gameweek horizon can be sliced correctly (file header, "no
    //    lookahead" / horizonGameweekIds).
    // ------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase.from('gameweeks').select('id').order('id', { ascending: true }).returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) throw new TransferScorecardError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      throw new TransferScorecardError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const allGameweekIds = (gwRows ?? []).map((r) => r.id)

    // ------------------------------------------------------------------
    // 3. players — code -> {teamId, elementType}, the current season's
    //    only squad-shape reference (never a price — see file header,
    //    "UNITS").
    // ------------------------------------------------------------------
    const { rows: playerRows, error: playersError } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('code, team_id, element_type').order('code', { ascending: true }).range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) {
      if (isMissingTable(playersError, 'players')) throw new TransferScorecardError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      throw new TransferScorecardError(`players lookup failed: ${playersError.message}`, 'players')
    }
    const { count: playersExpectedCount, error: playersCountError } = await supabase.from('players').select('*', { count: 'exact', head: true })
    if (playersCountError) throw new TransferScorecardError(`players count check failed: ${playersCountError.message}`, 'players')
    assertRowCountMatches('players', playerRows.length, playersExpectedCount ?? 0)

    const playersByCode = new Map<number, CandidatePlayer>()
    for (const row of playerRows) {
      if (row.code !== null) playersByCode.set(row.code, { code: row.code, teamId: row.team_id, elementType: row.element_type })
    }
    const allCandidatePlayers = [...playersByCode.values()]

    // ------------------------------------------------------------------
    // 4. player_gameweek_history — prices for exactly the transfer
    //    gameweeks this run needs (file header, "NO LOOKAHEAD").
    // ------------------------------------------------------------------
    const transferGameweekIds = allGameweekIdsWithNotification
    const { rows: priceHistoryRows, error: priceHistoryError } = await fetchAllPages<{ season: string; gameweek: number; player_code: number; now_cost: number }>((from, to) =>
      supabase
        .from('player_gameweek_history')
        .select('season, gameweek, player_code, now_cost')
        .eq('season', CURRENT_SEASON)
        .in('gameweek', transferGameweekIds)
        .order('gameweek', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<{ season: string; gameweek: number; player_code: number; now_cost: number }[]>(),
    )
    if (priceHistoryError) {
      if (isMissingTable(priceHistoryError, 'player_gameweek_history')) {
        throw new TransferScorecardError(`the "player_gameweek_history" table does not exist. Apply ${PLAYER_GAMEWEEK_HISTORY_MIGRATION} first.`, 'player_gameweek_history')
      }
      throw new TransferScorecardError(`player_gameweek_history lookup failed: ${priceHistoryError.message}`, 'player_gameweek_history')
    }
    const priceRowsBySource: PlayerGameweekHistoryRow[] = priceHistoryRows.map((r) => ({ season: r.season, gameweek: r.gameweek, playerCode: r.player_code, nowCost: r.now_cost }))
    const priceIndexByGameweek = new Map<number, Map<number, number>>()
    for (const gwId of transferGameweekIds) {
      priceIndexByGameweek.set(gwId, buildPriceIndexForGameweek(priceRowsBySource, CURRENT_SEASON, gwId))
    }

    // ------------------------------------------------------------------
    // 5. squads.bank — the pre-transfer budget, at each transfer's own
    //    gameweek_id (file header, "WHERE THE PRE-TRANSFER SQUAD AND
    //    BANK COME FROM").
    // ------------------------------------------------------------------
    const { data: squadRows, error: squadError } = await supabase.from('squads').select('gameweek_id, bank').in('gameweek_id', transferGameweekIds).returns<SquadRow[]>()
    if (squadError) {
      if (isMissingTable(squadError, 'squads')) throw new TransferScorecardError(`the "squads" table does not exist. Apply ${SQUAD_STATE_MIGRATION} first.`, 'squads')
      throw new TransferScorecardError(`squads lookup failed: ${squadError.message}`, 'squads')
    }
    const bankTenthsByGameweek = new Map<number, number>((squadRows ?? []).map((r) => [r.gameweek_id, r.bank]))

    // ------------------------------------------------------------------
    // 6. prediction_log — settled rows only, for every gameweek any
    //    transfer's 1- or 5-gameweek horizon could ever touch.
    // ------------------------------------------------------------------
    const horizonUnion = new Set<number>()
    for (const gwId of transferGameweekIds) {
      for (const id of horizonGameweekIds(allGameweekIds, gwId, HORIZON_GAMEWEEKS)) horizonUnion.add(id)
    }
    const predictionLogGameweekIds = [...horizonUnion].sort((a, b) => a - b)

    const { rows: predictionLogRows, error: predictionLogError } = await fetchAllPages<PredictionLogRow>((from, to) =>
      supabase
        .from('prediction_log')
        .select('gameweek_id, player_code, actual_points, settled_at, captured_at')
        .in('gameweek_id', predictionLogGameweekIds.length > 0 ? predictionLogGameweekIds : [-1])
        .not('settled_at', 'is', null)
        .order('gameweek_id', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<PredictionLogRow[]>(),
    )
    if (predictionLogError) {
      if (isMissingTable(predictionLogError, 'prediction_log')) throw new TransferScorecardError(`the "prediction_log" table does not exist. Apply ${PREDICTION_LOG_MIGRATION} first.`, 'prediction_log')
      throw new TransferScorecardError(`prediction_log lookup failed: ${predictionLogError.message}`, 'prediction_log')
    }
    const { count: predictionLogExpectedCount, error: predictionLogCountError } = await supabase
      .from('prediction_log')
      .select('*', { count: 'exact', head: true })
      .in('gameweek_id', predictionLogGameweekIds.length > 0 ? predictionLogGameweekIds : [-1])
      .not('settled_at', 'is', null)
    if (predictionLogCountError) throw new TransferScorecardError(`prediction_log count check failed: ${predictionLogCountError.message}`, 'prediction_log')
    assertRowCountMatches('prediction_log (settled, horizon)', predictionLogRows.length, predictionLogExpectedCount ?? 0)

    const { byGameweek: actualsByGameweek, noPlayerCodeCount } = buildActualsByGameweek(predictionLogRows)

    // ------------------------------------------------------------------
    // 7. Evaluate every gameweek that ever had a notification.
    // ------------------------------------------------------------------
    const results: TransferGameweekResult[] = allGameweekIdsWithNotification.map((gameweekId) => {
      const oneGwIds = horizonGameweekIds(allGameweekIds, gameweekId, 1)
      const fiveGwIds = horizonGameweekIds(allGameweekIds, gameweekId, HORIZON_GAMEWEEKS)
      const priceByCode = priceIndexByGameweek.get(gameweekId) ?? new Map<number, number>()
      const bankTenths = bankTenthsByGameweek.get(gameweekId) ?? null

      return evaluateTransferGameweek({
        gameweekId,
        snapshot: latestSnapshotByGameweek.get(gameweekId),
        oneGwIds,
        fiveGwIds,
        actualsByGameweek,
        playersByCode,
        priceByCode,
        bankTenths,
        candidatesExcludingSquad: (preTransferSquadCodes) => {
          const squadCodes = new Set(preTransferSquadCodes)
          return allCandidatePlayers.filter((p) => !squadCodes.has(p.code))
        },
      })
    })

    const generatedAt = new Date()
    const report = renderScorecard(results, generatedAt.toISOString())
    console.log(report)

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, report, 'utf8')

    const scoredCount = results.filter((r) => r.ok).length
    const message =
      `${JOB_NAME}: ${results.length} gameweek(s) with a notification read, ${scoredCount} had a measurable issued transfer. ` +
      `${noPlayerCodeCount} prediction_log row(s) excluded for missing player_code. Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: { gameweeksRead: results.length, gameweeksScored: scoredCount, noPlayerCodeCount, reportPath },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof TransferScorecardError ? err.message : err instanceof Error ? `unexpected failure: ${err.message}` : `unexpected failure: ${String(err)}`

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

// Guarded, matching every other scripts/*.ts job: importing this module (e.g. from its test file)
// must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
