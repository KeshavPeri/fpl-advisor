// Squad API sync job — ticket #14.
//
// Once a gameweek deadline passes, Keshav's true squad is readable from the
// public FPL API. This job reads it and reconciles it against whatever is
// already stored in `squads`/`squad_picks` (manual entry, ticket #13, or an
// earlier api_sync run) — it never silently overwrites a stored squad with
// what the API reports; a difference is recorded and surfaced instead. See
// "Reconcile, do not overwrite" in the ticket notes for the "because".
//
// DELIBERATELY UNAUTHENTICATED, FOREVER. This script calls exactly three
// public, unauthenticated FPL endpoints — entry/{id}/, entry/{id}/history/,
// and entry/{id}/event/{gw}/picks/ — and nothing else. It never signs in,
// never stores a credential of any kind, and never reads the one endpoint
// that would need one: the authenticated in-progress-squad endpoint FPL
// exposes between deadlines. That endpoint is the single reason the whole
// app needs no account — see product-brief.md §6a and escalation.md's Tier 1
// (accounts and credentials). The in-progress squad between deadlines is
// covered by registered overrides instead (item 20, a separate ticket). This
// is a Tier 1 boundary, not a Tier 2 convenience call — do not add it, not
// even behind a flag, no matter how tempting a future ticket makes it look.
//
// No entry id is ever hardcoded. FPL_ENTRY_ID configures this job;
// VITE_FPL_ENTRY_ID configures the browser (src/lib/squad/env.ts). If
// FPL_ENTRY_ID is unset, this script makes no network call at all and exits
// zero — see readEntryId() below.
//
// Reads SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every
// other scripts/*.ts job.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const JOB_NAME = 'sync-squad'

// The only remote host this script ever talks to. FPL_API_BASE_URL exists
// solely so a test run can point at an unreachable/mocked host, matching
// scripts/ingest-fpl.ts's own convention — the script itself never
// references any other remote host.
const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL

const MAX_ATTEMPTS = 4 // 1 initial try + 3 retries
const BASE_DELAY_MS = 300

// ============================================================================
// Position codes and squad shape — duplicated locally rather than imported
// from src/lib/squad/positions.ts. scripts/ and src/ are deliberately
// separate compilation environments (see tsconfig.scripts.json vs
// tsconfig.app.json) and every other scripts/*.ts file already duplicates
// rather than imports across that boundary (readSupabaseEnv, isMissingTable,
// …) — see decisions/ticket-13.md for the same call made the other
// direction (squad/positions.ts declining to import scoring/types.ts's
// identical-looking constants) for the general reasoning. Values must stay
// in sync with src/lib/squad/positions.ts by hand; both are 2026/27 FPL
// squad-shape constants that essentially never change mid-season.
// ============================================================================

export type PositionCode = 1 | 2 | 3 | 4
const POSITION_ORDER: readonly PositionCode[] = [1, 2, 3, 4]
const SQUAD_SLOT_COUNT: Record<PositionCode, number> = { 1: 2, 2: 5, 3: 5, 4: 3 }

export function squadPositionRange(position: PositionCode): { start: number; end: number } {
  let start = 1
  for (const code of POSITION_ORDER) {
    const count = SQUAD_SLOT_COUNT[code]
    if (code === position) return { start, end: start + count - 1 }
    start += count
  }
  throw new Error(`Unknown position code: ${String(position)}`)
}

// ============================================================================
// Env
// ============================================================================

/**
 * FPL_ENTRY_ID is read once, here. "Unset" and "set but malformed" are
 * deliberately different outcomes: unset is the normal pre-setup state
 * (DoD: "the script exits zero with a message naming the variable, and
 * makes no request. It never guesses an entry id." — no default, no
 * fallback id); a malformed value is a real misconfiguration and should be
 * loud, not silently swallowed the same way.
 */
type EntryIdResult = { ok: true; entryId: string } | { ok: false; reason: 'unset' | 'malformed' }

function readEntryId(): EntryIdResult {
  const raw = process.env.FPL_ENTRY_ID
  if (!raw || raw.trim() === '') {
    console.log(
      `${JOB_NAME}: FPL_ENTRY_ID is not set. Nothing to sync — making no request. ` +
        'Set FPL_ENTRY_ID (and VITE_FPL_ENTRY_ID for the browser) once the entry id is known.'
    )
    return { ok: false, reason: 'unset' }
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    console.error(
      `${JOB_NAME}: FPL_ENTRY_ID is set to "${trimmed}", which is not a plain positive integer. ` +
        'Refusing to guess — fix the environment variable rather than substituting a placeholder.'
    )
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, entryId: trimmed }
}

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
        `(missing: ${missing.join(', ')}).`
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

class SyncError extends Error {
  context: string
  statusCode?: number

  constructor(message: string, context: string, statusCode?: number) {
    super(message)
    this.name = 'SyncError'
    this.context = context
    this.statusCode = statusCode
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Same cause-unwrapping as scripts/ingest-fpl.ts — Node's fetch wraps every
// network-level failure in a generic "fetch failed" Error.
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

// ============================================================================
// Fetch with retry. Network errors and 5xx are retried with backoff; every
// other status (2xx, 4xx — including 404) is returned immediately for the
// caller to interpret, since a 404 here is frequently an expected outcome
// (picks not yet published), not a failure to retry.
// ============================================================================

export interface FetchResult {
  status: number
  body: unknown
}

export async function fetchWithRetry(url: string): Promise<FetchResult> {
  let lastReason = 'unknown error'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status < 500) {
        let body: unknown = null
        try {
          body = await response.json()
        } catch {
          body = null
        }
        return { status: response.status, body }
      }
      lastReason = `HTTP ${response.status} ${response.statusText}`
    } catch (err) {
      lastReason = describeNetworkError(err)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      console.error(
        `${JOB_NAME}: ${url} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastReason}), retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }

  throw new SyncError(`request to ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`, url)
}

// ============================================================================
// Response parsing — defensive field access, same style as ingest-fpl.ts.
// The FPL API is undocumented and can change without notice
// (product-brief.md §6a); every field is read defensively so a missing
// optional field degrades to null rather than a crash, while a missing
// *required* shape still fails loudly.
// ============================================================================

export type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numOrNull(row: JsonRecord, key: string): number | null {
  const v = row[key]
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function strOrNull(row: JsonRecord, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' ? v : null
}

function boolField(row: JsonRecord, key: string): boolean {
  return row[key] === true
}

export interface EntryData {
  bank: number | null
  squadValue: number | null
  totalTransfers: number | null
  overallPoints: number | null
  overallRank: number | null
}

/** entry/{id}/ — bank, squad value, transfer count, overall points and rank. */
export function parseEntryData(body: unknown, url: string): EntryData {
  if (!isRecord(body)) {
    throw new SyncError(`entry/{id}/ response is not a JSON object`, url)
  }
  return {
    bank: numOrNull(body, 'last_deadline_bank'),
    squadValue: numOrNull(body, 'last_deadline_value'),
    totalTransfers: numOrNull(body, 'last_deadline_total_transfers'),
    overallPoints: numOrNull(body, 'summary_overall_points'),
    overallRank: numOrNull(body, 'summary_overall_rank'),
  }
}

export interface ChipUsage {
  name: string
  event: number | null
  time: string | null
}

/**
 * entry/{id}/history/'s top-level "chips" array — cumulative chips used so
 * far this season. Missing or malformed is treated as "no chips used yet"
 * rather than a hard failure: this is genuinely optional context, not a
 * field the rest of the sync depends on.
 */
export function parseChips(body: unknown): ChipUsage[] {
  if (!isRecord(body)) return []
  const chips = body['chips']
  if (!Array.isArray(chips)) return []
  const result: ChipUsage[] = []
  for (const entry of chips) {
    if (!isRecord(entry)) continue
    const name = strOrNull(entry, 'name')
    if (!name) continue
    result.push({ name, event: numOrNull(entry, 'event'), time: strOrNull(entry, 'time') })
  }
  return result
}

export interface ApiPick {
  element: number
  position: number // 1-15: the pick's own slot order, 1-11 starting, 12-15 bench
  isCaptain: boolean
  isViceCaptain: boolean
}

/** entry/{id}/event/{gw}/picks/ — the squad itself. Only called when the 200 case applies. */
export function parsePicks(body: unknown, url: string): ApiPick[] {
  if (!isRecord(body)) {
    throw new SyncError('picks/ response is not a JSON object', url)
  }
  const picks = body['picks']
  if (!Array.isArray(picks)) {
    throw new SyncError('picks/ response is missing the "picks" array', url)
  }
  if (picks.length !== 15) {
    throw new SyncError(`picks/ response has ${picks.length} picks, expected 15`, url)
  }
  return picks.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new SyncError(`picks/ response pick #${index} is not an object`, url)
    }
    const element = numOrNull(raw, 'element')
    const position = numOrNull(raw, 'position')
    if (element === null || position === null) {
      throw new SyncError(`picks/ response pick #${index} is missing "element" or "position"`, url)
    }
    return {
      element,
      position,
      isCaptain: boolField(raw, 'is_captain'),
      isViceCaptain: boolField(raw, 'is_vice_captain'),
    }
  })
}

// ============================================================================
// Mapping API picks onto our squad_position layout — grouped by the
// player's own element_type (from `players`, looked up by id) into the same
// fixed blocks the manual-entry screen uses (1-2 GK, 3-7 DEF, 8-12 MID,
// 13-15 FWD; src/lib/squad/positions.ts), ordered within each block by the
// API's own pick "position" so starters sort before bench. This keeps an
// api_sync squad's squad_position layout consistent with what the manual
// entry screen would have produced for the same 15 players.
// ============================================================================

export interface PlayerInfo {
  code: number
  elementType: PositionCode
}

async function resolvePlayers(
  supabase: SupabaseClient,
  elementIds: number[]
): Promise<Map<number, PlayerInfo>> {
  const { data, error } = await supabase
    .from('players')
    .select('id, code, element_type')
    .in('id', elementIds)

  if (error) {
    throw new SyncError(`players lookup failed: ${error.message}`, 'players')
  }

  const map = new Map<number, PlayerInfo>()
  for (const row of (data ?? []) as { id: number; code: number | null; element_type: number }[]) {
    if (row.code === null || row.code === undefined) continue // surfaces as "missing" below — never a silent gap
    map.set(row.id, { code: row.code, elementType: row.element_type as PositionCode })
  }
  return map
}

export interface SquadPickRow {
  gameweek_id: number
  squad_position: number
  player_id: number
  player_code: number
  is_starting: boolean
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
}

export function buildSquadPickRows(
  apiPicks: ApiPick[],
  playerMap: Map<number, PlayerInfo>,
  gameweekId: number
): { rows: SquadPickRow[]; missingElementIds: number[] } {
  const missingElementIds: number[] = []
  const byPosition: Record<PositionCode, ApiPick[]> = { 1: [], 2: [], 3: [], 4: [] }

  for (const pick of apiPicks) {
    const info = playerMap.get(pick.element)
    if (!info) {
      missingElementIds.push(pick.element)
      continue
    }
    byPosition[info.elementType].push(pick)
  }

  if (missingElementIds.length > 0) {
    return { rows: [], missingElementIds }
  }

  const rows: SquadPickRow[] = []
  for (const position of POSITION_ORDER) {
    const range = squadPositionRange(position)
    const picksForPosition = [...byPosition[position]].sort((a, b) => a.position - b.position)
    picksForPosition.forEach((pick, index) => {
      const info = playerMap.get(pick.element)! // resolved above; missingElementIds is empty here
      const isStarting = pick.position <= 11
      rows.push({
        gameweek_id: gameweekId,
        squad_position: range.start + index,
        player_id: pick.element,
        player_code: info.code,
        is_starting: isStarting,
        bench_order: isStarting ? null : pick.position - 11,
        is_captain: pick.isCaptain,
        is_vice_captain: pick.isViceCaptain,
      })
    })
  }
  return { rows, missingElementIds: [] }
}

// ============================================================================
// Reconciliation — set-based comparison (player id, starting/bench status,
// captain, vice-captain), deliberately independent of squad_position
// ordering: two squads holding the same 15 players in the same starting/
// bench/captaincy configuration are "the same squad" even if their internal
// slot order differs. "Reconcile, do not overwrite" (ticket notes): this
// function only ever reports a difference, it never decides to write one.
// ============================================================================

export interface ExistingPickRow {
  player_id: number
  is_starting: boolean
  is_captain: boolean
  is_vice_captain: boolean
}

export interface SquadDiff {
  addedPlayerIds: number[] // in the API squad, not in the stored squad
  removedPlayerIds: number[] // in the stored squad, not in the API squad
  startingChangedPlayerIds: number[] // present in both, starting/bench status differs
  captainChanged: boolean
  viceCaptainChanged: boolean
}

export function computeDiff(existing: ExistingPickRow[], apiRows: SquadPickRow[]): SquadDiff | null {
  const existingByPlayer = new Map(existing.map((r) => [r.player_id, r]))
  const apiByPlayer = new Map(apiRows.map((r) => [r.player_id, r]))

  const addedPlayerIds: number[] = []
  const startingChangedPlayerIds: number[] = []
  for (const [playerId, apiRow] of apiByPlayer) {
    const existingRow = existingByPlayer.get(playerId)
    if (!existingRow) {
      addedPlayerIds.push(playerId)
      continue
    }
    if (existingRow.is_starting !== apiRow.is_starting) {
      startingChangedPlayerIds.push(playerId)
    }
  }

  const removedPlayerIds: number[] = []
  for (const playerId of existingByPlayer.keys()) {
    if (!apiByPlayer.has(playerId)) removedPlayerIds.push(playerId)
  }

  const existingCaptain = existing.find((r) => r.is_captain)?.player_id ?? null
  const apiCaptain = apiRows.find((r) => r.is_captain)?.player_id ?? null
  const existingVice = existing.find((r) => r.is_vice_captain)?.player_id ?? null
  const apiVice = apiRows.find((r) => r.is_vice_captain)?.player_id ?? null

  const diff: SquadDiff = {
    addedPlayerIds,
    removedPlayerIds,
    startingChangedPlayerIds,
    captainChanged: existingCaptain !== apiCaptain,
    viceCaptainChanged: existingVice !== apiVice,
  }

  const hasDiff =
    diff.addedPlayerIds.length > 0 ||
    diff.removedPlayerIds.length > 0 ||
    diff.startingChangedPlayerIds.length > 0 ||
    diff.captainChanged ||
    diff.viceCaptainChanged

  return hasDiff ? diff : null
}

export function summarizeDiff(diff: SquadDiff): string {
  const parts: string[] = []
  if (diff.addedPlayerIds.length > 0) parts.push(`${diff.addedPlayerIds.length} player(s) added`)
  if (diff.removedPlayerIds.length > 0) parts.push(`${diff.removedPlayerIds.length} player(s) removed`)
  if (diff.startingChangedPlayerIds.length > 0) {
    parts.push(`${diff.startingChangedPlayerIds.length} player(s) moved starting XI/bench`)
  }
  if (diff.captainChanged) parts.push('captain changed')
  if (diff.viceCaptainChanged) parts.push('vice-captain changed')
  return parts.join(', ')
}

// ============================================================================
// job_runs — one row per execution, same shape as
// scripts/ingest-core-insights.ts's recordJobRun. 'skipped' covers both
// no-op paths the DoD names as normal, not failing, states: no deadline
// passed yet, and picks not yet published.
// ============================================================================

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

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
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()

  const entryIdResult = readEntryId()
  if (!entryIdResult.ok) {
    if (entryIdResult.reason === 'unset') {
      // No network call of any kind — including to Supabase — per the DoD.
      return
    }
    // Malformed, not unset: a real misconfiguration, not a normal
    // pre-setup state — fail loudly like every other bad-config path.
    process.exit(1)
    return
  }
  const entryId = entryIdResult.entryId

  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)

  try {
    const entryUrl = `${API_BASE_URL}/entry/${entryId}/`
    const entryResp = await fetchWithRetry(entryUrl)
    if (entryResp.status !== 200) {
      throw new SyncError(
        `entry/${entryId}/ returned HTTP ${entryResp.status} — check FPL_ENTRY_ID is a real entry id`,
        entryUrl,
        entryResp.status
      )
    }
    const entryData = parseEntryData(entryResp.body, entryUrl)

    const historyUrl = `${API_BASE_URL}/entry/${entryId}/history/`
    const historyResp = await fetchWithRetry(historyUrl)
    if (historyResp.status !== 200) {
      throw new SyncError(`entry/${entryId}/history/ returned HTTP ${historyResp.status}`, historyUrl, historyResp.status)
    }
    const chips = parseChips(historyResp.body)

    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, deadline_time')
      .order('id', { ascending: true })
      .returns<{ id: number; deadline_time: string }[]>()

    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new SyncError(
          'the "gameweeks" table does not exist. Apply supabase/migrations/20260811100000_reference_schema.sql first.',
          'gameweeks'
        )
      }
      throw new SyncError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    if (!gwRows || gwRows.length === 0) {
      const message =
        `${JOB_NAME}: the gameweeks table is empty. Run scripts/ingest-fpl.ts before syncing squad ` +
        'state — there is no gameweek to attach a squad row to.'
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { entryId }, startedAt })
      process.exit(1)
      return
    }

    const now = Date.now()
    const nextGameweek = gwRows.find((gw) => new Date(gw.deadline_time).getTime() > now)
    const targetGameweek = nextGameweek ?? gwRows[gwRows.length - 1]
    const gameweekId = targetGameweek.id

    // Picks are always attempted, independent of whether a deadline has
    // passed — a 404 here is handled below either way, and this is the path
    // exercised end-to-end every night between now and the GW1 deadline.
    const picksUrl = `${API_BASE_URL}/entry/${entryId}/event/${gameweekId}/picks/`
    const picksResp = await fetchWithRetry(picksUrl)
    if (picksResp.status !== 200 && picksResp.status !== 404) {
      throw new SyncError(`picks/ returned unexpected HTTP ${picksResp.status}`, picksUrl, picksResp.status)
    }
    const picksAvailable = picksResp.status === 200

    const deadlinePassed = entryData.bank !== null && entryData.squadValue !== null

    const baseDetails: JsonRecord = {
      entryId,
      gameweekId,
      deadlinePassed,
      picksHttpStatus: picksResp.status,
    }

    if (!deadlinePassed) {
      const message =
        `${JOB_NAME}: no deadline has passed yet for entry ${entryId} — entry/${entryId}/ returned null ` +
        `for last_deadline_bank/last_deadline_value. No squads row written for gameweek ${gameweekId}; any ` +
        'manually-entered squad is left exactly as it is.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: { ...baseDetails, reason: 'no_deadline_passed' },
        startedAt,
      })
      return
    }

    // Deadline has passed: bank/value/transfers/points/rank/chips are real.
    // Preserve free_transfers from any existing row — the API doesn't
    // expose it directly, and it isn't in this ticket's field list.
    const { data: existingSquadRow, error: existingSquadError } = await supabase
      .from('squads')
      .select('free_transfers')
      .eq('gameweek_id', gameweekId)
      .maybeSingle()
    if (existingSquadError) {
      throw new SyncError(`squads lookup failed: ${existingSquadError.message}`, 'squads')
    }
    const freeTransfers = existingSquadRow?.free_transfers ?? 1

    async function upsertSquadRow(): Promise<{ error: { message: string } | null }> {
      const { error } = await supabase.from('squads').upsert({
        gameweek_id: gameweekId,
        bank: entryData.bank,
        squad_value: entryData.squadValue,
        free_transfers: freeTransfers,
        source: 'api_sync',
        total_transfers: entryData.totalTransfers,
        overall_points: entryData.overallPoints,
        overall_rank: entryData.overallRank,
        chips_used: chips,
        updated_at: new Date().toISOString(),
      })
      return { error }
    }

    if (!picksAvailable) {
      const { error: upsertError } = await upsertSquadRow()
      if (upsertError) throw new SyncError(`squads upsert failed: ${upsertError.message}`, 'squads')

      const message =
        `${JOB_NAME}: picks not yet published for entry ${entryId}, event ${gameweekId} ` +
        `(404 from entry/${entryId}/event/${gameweekId}/picks/). Entry-level state (bank, squad value, ` +
        'transfers, chips, points, rank) synced; existing squad picks left untouched.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: { ...baseDetails, reason: 'picks_not_published' },
        startedAt,
      })
      return
    }

    const apiPicks = parsePicks(picksResp.body, picksUrl)
    const elementIds = apiPicks.map((p) => p.element)
    const playerMap = await resolvePlayers(supabase, elementIds)
    const { rows: apiRows, missingElementIds } = buildSquadPickRows(apiPicks, playerMap, gameweekId)

    if (missingElementIds.length > 0) {
      throw new SyncError(
        `could not resolve players.code for FPL element id(s) ${missingElementIds.join(', ')} — ` +
          'run scripts/ingest-fpl.ts to refresh the players table before syncing squad picks',
        'players'
      )
    }

    const { data: existingPickRows, error: existingPicksError } = await supabase
      .from('squad_picks')
      .select('player_id, is_starting, is_captain, is_vice_captain')
      .eq('gameweek_id', gameweekId)
      .returns<ExistingPickRow[]>()
    if (existingPicksError) {
      throw new SyncError(`squad_picks lookup failed: ${existingPicksError.message}`, 'squad_picks')
    }

    const hasExistingPicks = (existingPickRows?.length ?? 0) > 0
    const diff = hasExistingPicks ? computeDiff(existingPickRows!, apiRows) : null

    if (diff) {
      // Reconcile, do not overwrite: neither squads nor squad_picks is
      // touched. The difference is recorded (job_runs.details.diff) and
      // surfaced (src/lib/squad/syncStatus.ts reads it back for the UI).
      const message =
        `${JOB_NAME}: squad for gameweek ${gameweekId} differs from FPL (entry ${entryId}) — not ` +
        `overwritten. ${summarizeDiff(diff)}.`
      console.log(message)
      await recordJobRun(supabase, {
        status: 'success',
        message,
        details: { ...baseDetails, reason: 'diff_detected', diff },
        startedAt,
      })
      return
    }

    const { error: upsertError } = await upsertSquadRow()
    if (upsertError) throw new SyncError(`squads upsert failed: ${upsertError.message}`, 'squads')

    if (!hasExistingPicks) {
      const { error: insertError } = await supabase.from('squad_picks').insert(apiRows)
      if (insertError) throw new SyncError(`squad_picks insert failed: ${insertError.message}`, 'squad_picks')

      const message = `${JOB_NAME}: squad for gameweek ${gameweekId} established from FPL for entry ${entryId} (15 picks written).`
      console.log(message)
      await recordJobRun(supabase, {
        status: 'success',
        message,
        details: { ...baseDetails, reason: 'established' },
        startedAt,
      })
      return
    }

    const message = `${JOB_NAME}: squad for gameweek ${gameweekId} confirmed against FPL for entry ${entryId} — no changes.`
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: { ...baseDetails, reason: 'confirmed' },
      startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: ${message}`)
    try {
      await recordJobRun(supabase, {
        status: 'failure',
        message: `${JOB_NAME}: ${message}`,
        details: { entryId },
        startedAt,
      })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    process.exit(1)
  }
}

// Guarded, unlike every other scripts/*.ts job: this file also exports its
// pure parsing/reconciliation functions (scripts/sync-squad.test.ts) so they
// are unit-testable without a live Supabase project. Importing the module
// for that must not trigger a real run — only running it directly
// (`npx tsx scripts/sync-squad.ts`) should.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
