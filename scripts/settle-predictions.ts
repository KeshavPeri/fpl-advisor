// Settle prediction_log rows against actuals, after lockdown — ticket #73.
//
// product-brief.md §2/§6d: "every projection stored, scored against actuals after gameweek
// lockdown". scripts/snapshot-predictions.ts is the "stored" half; this job is "scored against
// actuals after lockdown". It never runs early: product-brief.md §6d states the rule in one
// sentence — "Gameweek lockdown is 09:00 UK time the morning after the final match, not one hour
// after the final whistle. The accuracy tracker must wait for lockdown before scoring itself, or
// it will compare against provisional bonus and defcon numbers." scripts/lib/lockdown.ts is the
// one place that rule is computed (imported here, not re-derived) — see that file's own header.
//
// Ticket #260: settles every model_version with unsettled rows, not one fixed constant — the
// prediction_log PK already includes model_version, so this needed no schema change.
//
// ============================================================================
// The freeze rule and the "no fake zero" rule — this ticket's two hard constraints.
// ============================================================================
// 1. An already-settled row (settled_at IS NOT NULL) is never re-settled. Every query below that
//    selects rows to settle filters `settled_at IS NULL`, AND buildSettlementRows() re-checks the
//    same thing on every row it is handed, as defence in depth (see that function's own comment).
// 2. A player missing from the FPL live/ response (or present with a non-numeric total_points) is
//    left unsettled — settled_at and actual_points/actual_minutes/error all stay NULL for that
//    row. It is NEVER written as actual_points = 0. A player who genuinely played zero minutes
//    and scored zero points (present in the response with numeric zeros) IS a real, measured
//    zero and IS settled normally — the two cases are structurally different in this file's code,
//    not just described differently in a comment (see parseLiveActuals below).
//
// ============================================================================
// Where actuals come from — verified against the LIVE FPL API, not memory (this ticket's own DoD).
// ============================================================================
// GET {FPL_API_BASE_URL}/event/{gameweekId}/live/ — confirmed live on 20 Aug 2026 (see
// decisions/ticket-73.md): returns HTTP 200 with `{"elements":[...]}` for a real gameweek id
// (an empty array before that gameweek has any data yet) and HTTP 404 with a JSON error body for
// an out-of-range id. This is ONE call per gameweek covering every player — not a per-player
// request (this ticket's own DoD forbids a ~600-request storm) — because each element in the
// response already carries that player's own per-gameweek stats, keyed by `id` (this season's
// FPL element id, the same id `players.id`/`prediction_log.player_id` already use — see
// scripts/emit-projections-csv.ts's header for the one other place in this repo that same
// current-season element id is the deliberately correct join key). The exact per-player field
// names (`stats.total_points`, `stats.minutes`) are long-documented, stable FPL API shapes, but
// could not be verified against a POPULATED response this session because no gameweek has
// finished yet on the live API as of this ticket (see decisions/ticket-73.md for the full
// account) — every field is read defensively (num(), below) so an unexpected shape degrades a
// row to "left unsettled" rather than crashing the whole job or, worse, silently writing a wrong
// number.
//
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other
// scripts/*.ts job. No VITE_-prefixed variable. FPL_API_BASE_URL is an optional override, same
// escape hatch scripts/ingest-fpl.ts already defines (only ever pointed elsewhere by this
// script's own tests).
//
// Every multi-row Supabase read goes through scripts/lib/paginate.ts's fetchAllPages +
// assertRowCountMatches (ticket #43's convention). Upsert only, never delete: this file issues no
// Supabase row-removal call anywhere, and the migration grants no DELETE.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { computeLockdownInstant } from './lib/lockdown.ts'

const JOB_NAME = 'settle-predictions'
const PREDICTION_LOG_MIGRATION = 'supabase/migrations/20260821090000_prediction_log.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/** The only remote host this script ever talks to, same escape hatch scripts/ingest-fpl.ts defines — exists so this script's own network-failure tests can override it. */
const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL

const MAX_ATTEMPTS = 4 // 1 initial try + 3 retries, matching scripts/ingest-fpl.ts
const BASE_DELAY_MS = 300

/** Rows written per upsert call — same batch size as project-points.ts/snapshot-predictions.ts. */
const UPSERT_BATCH_SIZE = 500

// ============================================================================
// Env — identical contract to every other scripts/*.ts job.
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
      `${JOB_NAME}: required environment variables are not set. ` +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

export class SettleError extends Error {
  context: string
  statusCode?: number
  constructor(message: string, context: string, statusCode?: number) {
    super(message)
    this.name = 'SettleError'
    this.context = context
    this.statusCode = statusCode
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

// Same PGRST205 / 42P01 recognition as every other job in scripts/.
function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// job_runs
// ============================================================================

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: JsonRecord
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

// ============================================================================
// Fetch with retry for the live/ endpoint — same shape as scripts/ingest-fpl.ts's fetchJson:
// network errors and 5xx are retried with exponential backoff, 4xx fails immediately.
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) {
      return `${err.message}: ${cause.message}`
    }
    return err.message
  }
  return String(err)
}

export async function fetchLiveJson(endpoint: string): Promise<unknown> {
  let lastReason = 'unknown error'
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(endpoint)
      if (response.ok) {
        return await response.json()
      }

      lastStatus = response.status
      lastReason = `HTTP ${response.status} ${response.statusText}`

      if (response.status < 500) {
        throw new SettleError(`request to ${endpoint} failed: ${lastReason}`, endpoint, response.status)
      }
      // 5xx falls through to the retry/backoff below.
    } catch (err) {
      if (err instanceof SettleError) throw err
      lastReason = describeNetworkError(err)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      console.error(`${JOB_NAME}: ${endpoint} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastReason}), retrying in ${delay}ms`)
      await sleep(delay)
    }
  }

  throw new SettleError(`request to ${endpoint} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`, endpoint, lastStatus)
}

// ============================================================================
// Field-access helpers — same defensive style as scripts/ingest-fpl.ts's num(): the FPL API is
// undocumented and can change without notice, and a missing/non-numeric field must degrade to
// "no actual available" (null), never to a guessed 0.
// ============================================================================

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(row: JsonRecord, key: string): number | null {
  const v = row[key]
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

// ============================================================================
// Live response shape + parsing — PURE, no I/O.
// ============================================================================

export function validateLiveShape(data: unknown, endpoint: string): asserts data is { elements: JsonRecord[] } {
  if (!isRecord(data)) {
    throw new SettleError(`${endpoint} response is not a JSON object`, endpoint)
  }
  if (!Array.isArray(data.elements)) {
    throw new SettleError(`${endpoint} response is missing an "elements" array`, endpoint)
  }
}

export interface ActualByPlayer {
  points: number
  minutes: number | null
}

/**
 * Parses event/{id}/live/'s `elements` array into a player_id -> actual map. An element with a
 * non-numeric/missing `id` or a non-object/missing `stats.total_points` is SKIPPED entirely — it
 * never appears in the returned map — which is what makes "left unsettled" the natural default
 * for a malformed row rather than something buildSettlementRows() has to special-case. A present,
 * numeric `stats.total_points` of exactly 0 (a player who featured for zero points, or a real
 * zero for any other reason) DOES appear in the map — see file header, "no fake zero" is about
 * never inventing a 0 that wasn't actually reported, not about excluding real zeros.
 */
export function parseLiveActuals(elements: readonly JsonRecord[]): Map<number, ActualByPlayer> {
  const map = new Map<number, ActualByPlayer>()
  for (const el of elements) {
    const id = num(el, 'id')
    if (id === null) continue
    const stats = el['stats']
    if (!isRecord(stats)) continue
    const points = num(stats, 'total_points')
    if (points === null) continue
    const minutes = num(stats, 'minutes')
    map.set(id, { points, minutes })
  }
  return map
}

// ============================================================================
// Gameweek eligibility — PURE. Wraps scripts/lib/lockdown.ts's isPastLockdown with the
// "finished" half of the rule. No Date.now()/argument-less new Date() anywhere in this function.
// ============================================================================

export interface GameweekEligibilityInput {
  gameweekId: number
  finished: boolean
  fixtureKickoffIsos: readonly string[]
  nowMs: number
}

export interface GameweekEligibilityResult {
  eligible: boolean
  reason: string
}

export function decideGameweekEligibility(input: GameweekEligibilityInput): GameweekEligibilityResult {
  if (!input.finished) {
    return { eligible: false, reason: `gameweek ${input.gameweekId} is not marked finished yet — settlement waits for it.` }
  }
  if (input.fixtureKickoffIsos.length === 0) {
    return {
      eligible: false,
      reason: `gameweek ${input.gameweekId} is finished but has no fixture kickoff times to anchor a lockdown instant.`,
    }
  }

  const lockdownInstant = computeLockdownInstant(input.fixtureKickoffIsos)
  if (input.nowMs < lockdownInstant.getTime()) {
    return {
      eligible: false,
      reason: `gameweek ${input.gameweekId} is finished but lockdown (${lockdownInstant.toISOString()}) has not passed yet.`,
    }
  }

  return {
    eligible: true,
    reason: `gameweek ${input.gameweekId} is finished and past its ${lockdownInstant.toISOString()} lockdown.`,
  }
}

// ============================================================================
// Error arithmetic — PURE.
// ============================================================================

/** actual - projected. Positive = the model under-projected; negative = it over-projected. See prediction_log.error's own migration comment. */
export function computeError(actualPoints: number, projectedPoints: number): number {
  return actualPoints - projectedPoints
}

export interface ErrorStats {
  meanAbsoluteError: number | null
  meanSignedError: number | null
}

/** null (not 0) for an empty error set — a run that settled nothing has no error figure to report, and 0 would misleadingly read as "perfectly calibrated". */
export function computeAggregateErrorStats(errors: readonly number[]): ErrorStats {
  if (errors.length === 0) {
    return { meanAbsoluteError: null, meanSignedError: null }
  }
  const sumAbsolute = errors.reduce((sum, e) => sum + Math.abs(e), 0)
  const sumSigned = errors.reduce((sum, e) => sum + e, 0)
  return { meanAbsoluteError: sumAbsolute / errors.length, meanSignedError: sumSigned / errors.length }
}

// ============================================================================
// buildSettlementRows — PURE. The one place a fetched prediction_log row is turned into (or kept
// out of) an upsert payload.
// ============================================================================

export interface UnsettledPredictionRow {
  gameweek_id: number
  player_id: number
  model_version: string
  player_code: number | null
  projected_points: number
  projected_minutes: number
  components: unknown
  captured_at: string
  /** Present so buildSettlementRows can defend against re-settling even if a caller passes a row that turns out to already be settled — see "already-settled row is not re-settled" below. main() itself never fetches such a row in the first place (its query filters `settled_at IS NULL`), so this is defence in depth, not the only guard. */
  settled_at: string | null
}

export interface BuildSettlementRowsResult {
  updates: JsonRecord[]
  settledPlayerIds: number[]
  /** Rows with no actual available in actualsByPlayerId — left untouched (settled_at stays null). */
  unsettledPlayerIds: number[]
  /** Rows whose own settled_at was already non-null when handed to this function — skipped, never re-settled, never counted as newly settled. */
  alreadySettledPlayerIds: number[]
  /** Signed error for every row actually settled by this call, in the same order as settledPlayerIds — feeds computeAggregateErrorStats. */
  errors: number[]
}

export function buildSettlementRows(
  unsettledRows: readonly UnsettledPredictionRow[],
  actualsByPlayerId: ReadonlyMap<number, ActualByPlayer>,
  settledAtIso: string,
): BuildSettlementRowsResult {
  const updates: JsonRecord[] = []
  const settledPlayerIds: number[] = []
  const unsettledPlayerIds: number[] = []
  const alreadySettledPlayerIds: number[] = []
  const errors: number[] = []

  for (const row of unsettledRows) {
    if (row.settled_at !== null) {
      alreadySettledPlayerIds.push(row.player_id)
      continue
    }

    const actual = actualsByPlayerId.get(row.player_id)
    if (!actual) {
      unsettledPlayerIds.push(row.player_id)
      continue
    }

    const error = computeError(actual.points, row.projected_points)
    updates.push({
      gameweek_id: row.gameweek_id,
      player_id: row.player_id,
      model_version: row.model_version,
      player_code: row.player_code,
      projected_points: row.projected_points,
      projected_minutes: row.projected_minutes,
      components: row.components,
      captured_at: row.captured_at,
      actual_points: actual.points,
      actual_minutes: actual.minutes,
      settled_at: settledAtIso,
      error,
    })
    settledPlayerIds.push(row.player_id)
    errors.push(error)
  }

  return { updates, settledPlayerIds, unsettledPlayerIds, alreadySettledPlayerIds, errors }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  finished: boolean
}

interface FixtureRow {
  kickoff_time: string | null
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)
  const nowMs = Date.now()
  const settledAtIso = new Date(nowMs).toISOString()

  try {
    // --------------------------------------------------------------------
    // 1. Which gameweeks have unsettled prediction_log rows at all, across EVERY model_version
    //    (ticket #260 — settle every model_version that has unsettled rows, not one fixed
    //    constant) — the candidate set this run considers. Paginated + count-verified (a
    //    gameweek's worth of rows is ~600 per model_version, close to the 1,000-row
    //    db-max-rows ceiling; several unsettled gameweeks stacked up is a real, if unusual,
    //    catch-up scenario).
    // --------------------------------------------------------------------
    const {
      rows: unsettledGwIdRows,
      error: unsettledGwIdsError,
      pages: unsettledGwIdsPages,
    } = await fetchAllPages<{ gameweek_id: number }>((from, to) =>
      supabase
        .from('prediction_log')
        .select('gameweek_id')
        .is('settled_at', null)
        .order('gameweek_id', { ascending: true })
        .order('player_id', { ascending: true })
        .order('model_version', { ascending: true })
        .range(from, to)
        .returns<{ gameweek_id: number }[]>(),
    )
    if (unsettledGwIdsError) {
      if (isMissingTable(unsettledGwIdsError, 'prediction_log')) {
        throw new SettleError(`the "prediction_log" table does not exist. Apply ${PREDICTION_LOG_MIGRATION} first.`, 'prediction_log')
      }
      throw new SettleError(`prediction_log lookup failed: ${unsettledGwIdsError.message}`, 'prediction_log')
    }
    const { count: unsettledGwIdsExpectedByCount, error: unsettledGwIdsCountError } = await supabase
      .from('prediction_log')
      .select('*', { count: 'exact', head: true })
      .is('settled_at', null)
    if (unsettledGwIdsCountError) {
      throw new SettleError(`prediction_log count check failed: ${unsettledGwIdsCountError.message}`, 'prediction_log')
    }
    assertRowCountMatches('prediction_log (unsettled)', unsettledGwIdRows.length, unsettledGwIdsExpectedByCount ?? 0)

    const candidateGwIds = [...new Set(unsettledGwIdRows.map((r) => r.gameweek_id))].sort((a, b) => a - b)

    if (candidateGwIds.length === 0) {
      const message = `${JOB_NAME}: no unsettled prediction_log rows (any model_version) — nothing to settle.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { candidateGameweekIds: [] }, startedAt })
      return
    }

    // --------------------------------------------------------------------
    // 2. Per candidate gameweek: check eligibility, then settle if eligible.
    // --------------------------------------------------------------------
    const perGameweek: JsonRecord[] = []
    let rowsSettled = 0
    let rowsSkippedAlreadySettled = 0
    let rowsLeftUnsettledNoActual = 0
    const allErrors: number[] = []

    for (const gwId of candidateGwIds) {
      const { data: gwRow, error: gwError } = await supabase
        .from('gameweeks')
        .select('id, finished')
        .eq('id', gwId)
        .maybeSingle<GameweekRow>()
      if (gwError) {
        if (isMissingTable(gwError, 'gameweeks')) {
          throw new SettleError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
        }
        throw new SettleError(`gameweeks lookup for gameweek ${gwId} failed: ${gwError.message}`, 'gameweeks')
      }
      if (!gwRow) {
        throw new SettleError(
          `prediction_log has rows for gameweek ${gwId}, but no matching gameweeks row exists. This should be impossible under the foreign key.`,
          'gameweeks',
        )
      }

      // A single gameweek has ~10 fixtures, far under the 1,000-row db-max-rows ceiling, but
      // paginated and count-verified anyway — this ticket's own DoD asks for every Supabase
      // read to go through scripts/lib/paginate.ts.
      const {
        rows: fixtureRows,
        error: fixturesError,
        pages: fixturesPagesFetched,
      } = await fetchAllPages<FixtureRow>((from, to) =>
        supabase.from('fixtures').select('kickoff_time').eq('event_id', gwId).order('id', { ascending: true }).range(from, to).returns<FixtureRow[]>(),
      )
      if (fixturesError) {
        throw new SettleError(`fixtures lookup for gameweek ${gwId} failed: ${fixturesError.message}`, 'fixtures')
      }
      const { count: fixtureRowsExpectedByCount, error: fixturesCountError } = await supabase
        .from('fixtures')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', gwId)
      if (fixturesCountError) {
        throw new SettleError(`fixtures count check for gameweek ${gwId} failed: ${fixturesCountError.message}`, 'fixtures')
      }
      assertRowCountMatches(`fixtures (gameweek ${gwId})`, fixtureRows.length, fixtureRowsExpectedByCount ?? 0)

      const fixtureKickoffIsos = fixtureRows.map((f) => f.kickoff_time).filter((k): k is string => k !== null)

      const eligibility = decideGameweekEligibility({
        gameweekId: gwId,
        finished: gwRow.finished,
        fixtureKickoffIsos,
        nowMs,
      })

      if (!eligibility.eligible) {
        console.log(`${JOB_NAME}: ${eligibility.reason}`)
        perGameweek.push({
          gameweekId: gwId,
          eligible: false,
          reason: eligibility.reason,
          fixtureRowsFetched: fixtureRows.length,
          fixtureRowsExpectedByCount: fixtureRowsExpectedByCount ?? 0,
          fixturesPagesFetched,
        })
        continue
      }
      console.log(`${JOB_NAME}: ${eligibility.reason}`)

      // ------------------------------------------------------------------
      // 3. Actuals — ONE call for the whole gameweek (see file header).
      // ------------------------------------------------------------------
      const liveUrl = `${API_BASE_URL}/event/${gwId}/live/`
      const liveJson = await fetchLiveJson(liveUrl)
      validateLiveShape(liveJson, liveUrl)
      const actualsByPlayerId = parseLiveActuals(liveJson.elements)

      // ------------------------------------------------------------------
      // 4. Unsettled prediction_log rows for this specific gameweek, with every column needed
      //    to reconstruct a full row (upsert must supply every NOT NULL column, not just the
      //    ones being changed). Paginated + count-verified.
      // ------------------------------------------------------------------
      const {
        rows: unsettledRows,
        error: unsettledRowsError,
        pages: unsettledRowsPages,
      } = await fetchAllPages<UnsettledPredictionRow>((from, to) =>
        supabase
          .from('prediction_log')
          .select('gameweek_id, player_id, model_version, player_code, projected_points, projected_minutes, components, captured_at, settled_at')
          .eq('gameweek_id', gwId)
          .is('settled_at', null)
          .order('gameweek_id', { ascending: true })
          .order('player_id', { ascending: true })
          .order('model_version', { ascending: true })
          .range(from, to)
          .returns<UnsettledPredictionRow[]>(),
      )
      if (unsettledRowsError) {
        throw new SettleError(`prediction_log lookup for gameweek ${gwId} failed: ${unsettledRowsError.message}`, 'prediction_log')
      }
      const { count: unsettledRowsExpectedByCount, error: unsettledRowsCountError } = await supabase
        .from('prediction_log')
        .select('*', { count: 'exact', head: true })
        .eq('gameweek_id', gwId)
        .is('settled_at', null)
      if (unsettledRowsCountError) {
        throw new SettleError(`prediction_log count check for gameweek ${gwId} failed: ${unsettledRowsCountError.message}`, 'prediction_log')
      }
      assertRowCountMatches(`prediction_log (gameweek ${gwId}, unsettled)`, unsettledRows.length, unsettledRowsExpectedByCount ?? 0)

      const { count: totalRowsForGwByCount, error: totalRowsForGwError } = await supabase
        .from('prediction_log')
        .select('*', { count: 'exact', head: true })
        .eq('gameweek_id', gwId)
      if (totalRowsForGwError) {
        throw new SettleError(`prediction_log total-row count for gameweek ${gwId} failed: ${totalRowsForGwError.message}`, 'prediction_log')
      }
      const rowsAlreadySettledForGw = (totalRowsForGwByCount ?? 0) - unsettledRows.length

      // ------------------------------------------------------------------
      // 5. Build and write the settlement. Pure — buildSettlementRows.
      // ------------------------------------------------------------------
      const settlement = buildSettlementRows(unsettledRows, actualsByPlayerId, settledAtIso)

      for (let i = 0; i < settlement.updates.length; i += UPSERT_BATCH_SIZE) {
        const batch = settlement.updates.slice(i, i + UPSERT_BATCH_SIZE)
        const { error: upsertError } = await supabase
          .from('prediction_log')
          .upsert(batch, { onConflict: 'gameweek_id,player_id,model_version' })
        if (upsertError) {
          throw new SettleError(`settlement upsert for gameweek ${gwId} failed: ${upsertError.message}`, 'prediction_log')
        }
      }

      rowsSettled += settlement.updates.length
      rowsSkippedAlreadySettled += rowsAlreadySettledForGw + settlement.alreadySettledPlayerIds.length
      rowsLeftUnsettledNoActual += settlement.unsettledPlayerIds.length
      allErrors.push(...settlement.errors)
      // Ticket #260: unsettledRows can now span more than one model_version for the same
      // gameweek — this is purely a diagnostic, not a filter (buildSettlementRows already
      // settles every row it's handed regardless of model_version).
      const modelVersionsSettled = [...new Set(settlement.updates.map((u) => u.model_version as string))].sort()

      perGameweek.push({
        gameweekId: gwId,
        eligible: true,
        reason: eligibility.reason,
        rowsSettled: settlement.updates.length,
        modelVersionsSettled,
        rowsLeftUnsettledNoActual: settlement.unsettledPlayerIds.length,
        rowsSkippedAlreadySettled: rowsAlreadySettledForGw + settlement.alreadySettledPlayerIds.length,
        unsettledRowsFetched: unsettledRows.length,
        unsettledRowsExpectedByCount: unsettledRowsExpectedByCount ?? 0,
        unsettledRowsPages,
        fixtureRowsFetched: fixtureRows.length,
        fixtureRowsExpectedByCount: fixtureRowsExpectedByCount ?? 0,
        fixturesPagesFetched,
        liveElementsRead: liveJson.elements.length,
        actualsParsed: actualsByPlayerId.size,
      })
    }

    const errorStats = computeAggregateErrorStats(allErrors)
    const details: JsonRecord = {
      candidateGameweekIds: candidateGwIds,
      perGameweek,
      rowsSettled,
      rowsSkippedAlreadySettled,
      rowsLeftUnsettledNoActual,
      meanAbsoluteError: errorStats.meanAbsoluteError,
      meanSignedError: errorStats.meanSignedError,
      unsettledGwIdRowsFetched: unsettledGwIdRows.length,
      unsettledGwIdsExpectedByCount: unsettledGwIdsExpectedByCount ?? 0,
      unsettledGwIdsPages,
    }
    const message =
      rowsSettled > 0
        ? `${JOB_NAME}: settled ${rowsSettled} row(s) across ${candidateGwIds.length} candidate gameweek(s) ` +
          `(${rowsLeftUnsettledNoActual} left unsettled with no actual available, ${rowsSkippedAlreadySettled} already settled). ` +
          `Mean absolute error ${errorStats.meanAbsoluteError?.toFixed(3) ?? 'n/a'}, mean signed error ${errorStats.meanSignedError?.toFixed(3) ?? 'n/a'}.`
        : `${JOB_NAME}: none of ${candidateGwIds.length} candidate gameweek(s) were eligible to settle this run (not finished yet, or lockdown not yet passed).`
    console.log(message)
    await recordJobRun(supabase, { status: rowsSettled > 0 ? 'success' : 'skipped', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof SettleError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module (e.g. from a test file)
// must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
