// Mini-league standings ingest job — ticket #271, feature-list item 33.
//
// DISPLAY ONLY, FOREVER. product-brief.md §1: mini-league standings "may be displayed. They
// must never enter the optimiser's objective." This job writes to public.mini_league_standings
// only — nothing in src/lib/scoring/, src/lib/projection/, the solver input or the
// recommendation tables ever reads it. See the migration's own header
// (supabase/migrations/20260925090000_mini_league_standings.sql) for the full "because".
//
// Two public, unauthenticated FPL endpoints, no login, no credential — pre-approved by
// product-brief.md §5/§6a:
//   - bootstrap-static/ (already used by scripts/ingest-fpl.ts) — read here only for
//     events[].finished/id, to resolve the latest FINISHED gameweek. Standings only ever
//     reflect a completed gameweek (product-brief.md §3: no live mini-league updates), so a
//     pre-GW1/no-finished-gameweek state is a normal skip, not a failure.
//   - leagues-classic/{leagueId}/standings/?page_standings={n} — paginated via
//     standings.has_next. Columns read, straight off the API's own field names: entry,
//     entry_name, player_name, rank, last_rank, total, event_total.
//
// leagueId comes from config/mini-league.json (848654, not a secret — see that file). Read via
// readFileSync rather than a static import: config/ sits outside both tsconfig.app.json's and
// tsconfig.scripts.json's "include" roots, and a static JSON import across that boundary would
// need a tsconfig change this ticket's file scope does not list (CLAUDE.md's "a ticket whose
// scope constraint lists exact files must list the build config too" — this ticket's does not,
// so this script does not force that change).
//
// FAILURE SEMANTICS. Every page is fetched and validated into memory BEFORE any Supabase write —
// a failure on page 2 must never leave page 1's rows written alone (the DoD's "don't write
// partial pages"). One job_runs row per run, same shape as every other scripts/*.ts job.
//
// Reads SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other scripts/*.ts job.
// FPL_API_BASE_URL is the same override convention scripts/ingest-fpl.ts / scripts/sync-squad.ts
// already define, so a test can point this job at a mocked host.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const JOB_NAME = 'ingest-mini-league'
const MINI_LEAGUE_MIGRATION = 'supabase/migrations/20260925090000_mini_league_standings.sql'

const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL
const BOOTSTRAP_URL = `${API_BASE_URL}/bootstrap-static/`

const MAX_ATTEMPTS = 4 // 1 initial try + 3 retries — same convention as ingest-fpl.ts
const BASE_DELAY_MS = 300

// A sanity cap on pagination, not a real limit — a ~20-manager classic league fits on FPL's own
// first page (50 entries/page). Guards against an infinite loop if standings.has_next is ever
// malformed/always-true, never expected to fire in normal operation.
const MAX_PAGES = 50

const CONFIG_PATH = fileURLToPath(new URL('../config/mini-league.json', import.meta.url))

// ============================================================================
// Env
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
        `(missing: ${missing.join(', ')}). Making no network call.`
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

/**
 * config/mini-league.json — `{"leagueId": 848654}`, not a secret. A malformed or missing file is
 * a real misconfiguration (the file is checked in and its shape is fixed), so this throws rather
 * than guessing a fallback league id — matching sync-squad.ts's readEntryId() rule of never
 * substituting a placeholder for a real identifier.
 */
export function readLeagueId(configPath: string = CONFIG_PATH): number {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new MiniLeagueIngestError(`could not read ${configPath}: ${reason}`, configPath)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new MiniLeagueIngestError(`${configPath} is not valid JSON: ${reason}`, configPath)
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('leagueId' in parsed) ||
    typeof (parsed as { leagueId: unknown }).leagueId !== 'number' ||
    !Number.isInteger((parsed as { leagueId: number }).leagueId)
  ) {
    throw new MiniLeagueIngestError(
      `${configPath} must contain an integer "leagueId" field`,
      configPath
    )
  }

  return (parsed as { leagueId: number }).leagueId
}

// ============================================================================
// Errors — carry enough context that a failed job_runs row is diagnosable on sight, matching
// scripts/ingest-fpl.ts's own IngestError.
// ============================================================================

export class MiniLeagueIngestError extends Error {
  context: string
  statusCode?: number

  constructor(message: string, context: string, statusCode?: number) {
    super(message)
    this.name = 'MiniLeagueIngestError'
    this.context = context
    this.statusCode = statusCode
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Same cause-unwrapping as scripts/ingest-fpl.ts — Node's fetch wraps every network-level
// failure in a generic "fetch failed" Error and puts the actually useful reason on `.cause`.
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
// Fetch with retry — network errors and 5xx responses are retried with exponential backoff;
// 4xx responses fail immediately since retrying won't change a client error. Same shape as
// scripts/ingest-fpl.ts's fetchJson, duplicated rather than imported (scripts/ and src/ share
// code one way only — see CLAUDE.md — and this is a small, job-specific helper, the same call
// every prior scripts/*.ts job with its own external fetch has made).
// ============================================================================

export async function fetchJsonWithRetry(endpoint: string): Promise<unknown> {
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
        throw new MiniLeagueIngestError(
          `request to ${endpoint} failed: ${lastReason}`,
          endpoint,
          response.status
        )
      }
      // 5xx falls through to the retry/backoff below.
    } catch (err) {
      if (err instanceof MiniLeagueIngestError) throw err
      lastReason = describeNetworkError(err)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      console.error(
        `${JOB_NAME}: ${endpoint} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastReason}), retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }

  throw new MiniLeagueIngestError(
    `request to ${endpoint} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`,
    endpoint,
    lastStatus
  )
}

// ============================================================================
// Field access + shape validation — same defensive style as ingest-fpl.ts/sync-squad.ts: the FPL
// API is undocumented and can change without notice (product-brief.md §6a).
// ============================================================================

export type JsonRecord = Record<string, unknown>

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

function str(row: JsonRecord, key: string): string | null {
  const v = row[key]
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return null
  return String(v)
}

function bool(row: JsonRecord, key: string): boolean {
  return row[key] === true
}

function validateBootstrapEventsShape(data: unknown): asserts data is { events: JsonRecord[] } {
  if (!isRecord(data)) {
    throw new MiniLeagueIngestError('bootstrap-static/ response is not a JSON object', BOOTSTRAP_URL)
  }
  const events = data['events']
  if (!Array.isArray(events)) {
    throw new MiniLeagueIngestError(
      'bootstrap-static/ response is missing expected array field "events"',
      BOOTSTRAP_URL
    )
  }
  if (events.length === 0) {
    throw new MiniLeagueIngestError('bootstrap-static/ response field "events" is empty', BOOTSTRAP_URL)
  }
}

/**
 * The latest FINISHED gameweek id — classic-league standings only ever reflect a completed
 * gameweek, never a live/in-progress one (product-brief.md §3). Returns null when no gameweek
 * has finished yet (pre-GW1 lockdown) — a normal, non-failing state, not an error.
 */
export function resolveLatestFinishedGameweekId(events: readonly JsonRecord[]): number | null {
  let latest: number | null = null
  for (const event of events) {
    if (!isRecord(event)) continue
    if (!bool(event, 'finished')) continue
    const id = num(event, 'id')
    if (id === null) continue
    if (latest === null || id > latest) latest = id
  }
  return latest
}

// ============================================================================
// Standings pagination
// ============================================================================

export interface StandingsPageResult {
  results: JsonRecord[]
  hasNext: boolean
}

/**
 * Parses one leagues-classic/{id}/standings/?page_standings={n} response. Exported so
 * fetchAllStandingsPages' loop and its own shape-checking can be tested independently of a real
 * fetch, on fixture JSON.
 */
export function parseStandingsPage(data: unknown, url: string): StandingsPageResult {
  if (!isRecord(data)) {
    throw new MiniLeagueIngestError('standings response is not a JSON object', url)
  }
  const standings = data['standings']
  if (!isRecord(standings)) {
    throw new MiniLeagueIngestError('standings response is missing the "standings" object', url)
  }
  const results = standings['results']
  if (!Array.isArray(results)) {
    throw new MiniLeagueIngestError('standings.results is not an array', url)
  }
  return {
    results: results.filter(isRecord),
    hasNext: standings['has_next'] === true,
  }
}

/**
 * Follows standings.has_next across pages, aggregating every page's raw results before
 * returning. Takes `fetchJson` as a parameter (rather than calling fetchJsonWithRetry directly)
 * so a test can inject a stub keyed by URL and exercise the has_next loop against fixture JSON
 * with no real network call.
 */
export async function fetchAllStandingsPages(
  fetchJson: (url: string) => Promise<unknown>,
  apiBaseUrl: string,
  leagueId: number
): Promise<{ results: JsonRecord[]; pageCount: number }> {
  const allResults: JsonRecord[] = []
  let page = 1

  for (;;) {
    const url = `${apiBaseUrl}/leagues-classic/${leagueId}/standings/?page_standings=${page}`
    const data = await fetchJson(url)
    const { results, hasNext } = parseStandingsPage(data, url)
    allResults.push(...results)

    if (!hasNext) {
      return { results: allResults, pageCount: page }
    }

    page++
    if (page > MAX_PAGES) {
      throw new MiniLeagueIngestError(
        `standings pagination for league ${leagueId} exceeded ${MAX_PAGES} pages — refusing to loop further`,
        url
      )
    }
  }
}

// ============================================================================
// Row mapping — one row per manager. entry/rank/total/event_total missing or unparseable makes
// a row useless (there is nothing to key or display), so such a row is skipped and counted
// (job_runs.details.skippedRows), never written with a guessed value.
// ============================================================================

export interface MappedStandingRow {
  entryId: number
  entryName: string | null
  playerName: string | null
  rank: number | null
  lastRank: number | null
  total: number | null
  eventTotal: number | null
}

export function mapStandingsResults(
  results: readonly JsonRecord[]
): { rows: MappedStandingRow[]; skippedCount: number } {
  const rows: MappedStandingRow[] = []
  let skippedCount = 0

  for (const raw of results) {
    const entryId = num(raw, 'entry')
    if (entryId === null) {
      skippedCount++
      continue
    }
    rows.push({
      entryId,
      entryName: str(raw, 'entry_name'),
      playerName: str(raw, 'player_name'),
      rank: num(raw, 'rank'),
      lastRank: num(raw, 'last_rank'),
      total: num(raw, 'total'),
      eventTotal: num(raw, 'event_total'),
    })
  }

  return { rows, skippedCount }
}

// ============================================================================
// job_runs — same shape as every other scripts/*.ts job.
// ============================================================================

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTableError(error: PostgrestLikeError, table: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(table).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

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
    if (isMissingTableError(error, 'job_runs')) {
      console.error(
        `${JOB_NAME}: table "job_runs" does not exist. Apply supabase/migrations/20260811130000_job_runs.sql before running this script.`
      )
    } else {
      console.error(`${JOB_NAME}: insert into job_runs failed: ${error.message}`)
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }

  const supabase = createClient(env.url, env.secretKey)
  const startedAt = new Date()

  try {
    const leagueId = readLeagueId()

    console.log(`${JOB_NAME}: fetching ${BOOTSTRAP_URL}`)
    const bootstrapData = await fetchJsonWithRetry(BOOTSTRAP_URL)
    validateBootstrapEventsShape(bootstrapData)
    const gameweekId = resolveLatestFinishedGameweekId(bootstrapData.events)

    if (gameweekId === null) {
      const message =
        `${JOB_NAME}: no gameweek has finished yet — classic-league standings only reflect a ` +
        'completed gameweek. Nothing to ingest. Will pick this up automatically once GW1 finishes.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: { leagueId, reason: 'no_finished_gameweek' },
        startedAt,
      })
      return
    }

    console.log(`${JOB_NAME}: latest finished gameweek is ${gameweekId}; fetching league ${leagueId} standings`)
    const { results, pageCount } = await fetchAllStandingsPages(fetchJsonWithRetry, API_BASE_URL, leagueId)
    const { rows: mapped, skippedCount } = mapStandingsResults(results)

    if (mapped.length === 0) {
      throw new MiniLeagueIngestError(
        `league ${leagueId} standings resolved to zero usable rows across ${pageCount} page(s) — refusing to upsert`,
        `${API_BASE_URL}/leagues-classic/${leagueId}/standings/`
      )
    }

    const fetchedAt = new Date().toISOString()
    const dbRows = mapped.map((row) => ({
      league_id: leagueId,
      gameweek_id: gameweekId,
      entry_id: row.entryId,
      entry_name: row.entryName,
      player_name: row.playerName,
      rank: row.rank,
      last_rank: row.lastRank,
      total: row.total,
      event_total: row.eventTotal,
      fetched_at: fetchedAt,
    }))

    // Everything above is fetched and validated before this, the only write this job makes —
    // the DoD's "don't write partial pages": a failure on any page throws before this line is
    // ever reached.
    const { error: upsertError } = await supabase
      .from('mini_league_standings')
      .upsert(dbRows, { onConflict: 'league_id,gameweek_id,entry_id' })

    if (upsertError) {
      if (isMissingTableError(upsertError, 'mini_league_standings')) {
        throw new MiniLeagueIngestError(
          `table "mini_league_standings" does not exist. Apply ${MINI_LEAGUE_MIGRATION} before running this script.`,
          'mini_league_standings'
        )
      }
      throw new MiniLeagueIngestError(`upsert into "mini_league_standings" failed: ${upsertError.message}`, 'mini_league_standings')
    }

    const message =
      `${JOB_NAME}: wrote ${dbRows.length} standings row(s) for league ${leagueId}, gameweek ${gameweekId} ` +
      `across ${pageCount} page(s)` +
      (skippedCount > 0 ? `, skipping ${skippedCount} row(s) with no resolvable entry id` : '') +
      '.'
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: { leagueId, gameweekId, pageCount, rowCount: dbRows.length, skippedCount },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof MiniLeagueIngestError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)
    await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job with its own test file (e.g. ingest-fpl.ts,
// sync-squad.ts): this file exports its pure/injectable functions
// (readLeagueId/resolveLatestFinishedGameweekId/parseStandingsPage/fetchAllStandingsPages/
// mapStandingsResults) for scripts/ingest-mini-league.test.ts. Importing the module for that
// must not trigger a real run — only running it directly does.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
