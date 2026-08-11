// FPL ingest job — ticket #11.
//
// Fetches the official FPL API's bootstrap-static/ and fixtures/ endpoints
// and upserts the results into teams, players, gameweeks and fixtures.
// Everything downstream (projections, the pitch view, the deadline
// countdown) reads from these four tables, so this job is the only place
// real FPL data enters Supabase.
//
// Deliberately unauthenticated, forever: only bootstrap-static/ and
// fixtures/ are called. No per-manager endpoint, no picks/, no session of
// any kind, no stored FPL credential — see the ticket's "explicitly out of
// scope" and escalation.md Tier 1 (accounts/credentials). Squad data is a
// separate ticket (#14) by design, not an oversight here.
//
// Reads exactly two environment variables — SUPABASE_URL and
// SUPABASE_SECRET_KEY — same convention as scripts/heartbeat.ts (#10). No
// browser-bundle-prefixed variables of the kind src/lib/supabase.ts reads —
// this script runs in a GitHub Actions job, never in the browser.
//
// Upsert semantics: every write is `upsert(..., { onConflict: 'id' })`
// keyed on the FPL id, which is also each table's primary key (see the #9
// migration). Nothing here ever deletes a row — a player or fixture that
// disappears from the API response is left in place, not removed. That is
// a deliberate scope limit (see the ticket's "explicitly out of scope"),
// not an oversight.
//
// Shape validation happens before any table is touched: bootstrap-static/
// must be a JSON object with non-empty `teams`, `events` and `elements`
// arrays, and fixtures/ must be a non-empty JSON array. An unexpected shape
// throws before the first upsert call, so a bad response never overwrites
// good data with partial or empty rows — no data beats wrong data.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const JOB_NAME = 'ingest-fpl'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

// The only remote host this script ever talks to. FPL_API_BASE_URL exists
// solely so the DoD's "point the base URL at an unreachable host" failure
// test can override it — the script itself never references any other
// remote host.
const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL
const BOOTSTRAP_URL = `${API_BASE_URL}/bootstrap-static/`
const FIXTURES_URL = `${API_BASE_URL}/fixtures/`

const MAX_ATTEMPTS = 4 // 1 initial try + 3 retries
const BASE_DELAY_MS = 300

const TABLES = ['teams', 'gameweeks', 'players', 'fixtures'] as const
type TableName = (typeof TABLES)[number]

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
      'ingest-fpl: required environment variables are not set. ' +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors — carry enough context (endpoint/table + reason) that a failed
// job_runs row is diagnosable on sight, matching heartbeat.ts's style.
// ============================================================================

class IngestError extends Error {
  context: string
  statusCode?: number

  constructor(message: string, context: string, statusCode?: number) {
    super(message)
    this.name = 'IngestError'
    this.context = context
    this.statusCode = statusCode
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Node's fetch (undici) wraps every network-level failure in a generic
// "fetch failed" Error and puts the actually useful reason (DNS failure,
// connection refused, TLS error, ...) on `.cause`. Surface that cause so
// "unreachable host" reads as "getaddrinfo ENOTFOUND ..." rather than the
// uninformative wrapper message.
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
// Fetch with retry — network errors and 5xx responses are retried with
// exponential backoff; 4xx responses fail immediately since retrying won't
// change a client error. Final failure names the endpoint and the status
// code (or network reason) in the thrown message.
// ============================================================================

async function fetchJson(endpoint: string): Promise<unknown> {
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
        // Client error — retrying will not help.
        throw new IngestError(
          `request to ${endpoint} failed: ${lastReason}`,
          endpoint,
          response.status
        )
      }
      // 5xx falls through to the retry/backoff below.
    } catch (err) {
      if (err instanceof IngestError) throw err
      lastReason = describeNetworkError(err)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      console.error(
        `ingest-fpl: ${endpoint} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastReason}), retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }

  throw new IngestError(
    `request to ${endpoint} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`,
    endpoint,
    lastStatus
  )
}

// ============================================================================
// Response shapes — only the fields this job reads. The FPL API is
// undocumented and can change without notice (product-brief.md §6a); every
// field is read defensively (see the num/str/bool helpers below) so a
// missing optional field degrades to null/default rather than a crash. A
// missing *required* top-level shape (see validate* below) still fails loudly.
// ============================================================================

type JsonRecord = Record<string, unknown>

interface BootstrapStatic {
  teams: JsonRecord[]
  events: JsonRecord[]
  elements: JsonRecord[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateBootstrapShape(data: unknown): asserts data is BootstrapStatic {
  if (!isRecord(data)) {
    throw new IngestError('bootstrap-static/ response is not a JSON object', BOOTSTRAP_URL)
  }
  for (const key of ['teams', 'events', 'elements'] as const) {
    const value = data[key]
    if (!Array.isArray(value)) {
      throw new IngestError(
        `bootstrap-static/ response is missing expected array field "${key}"`,
        BOOTSTRAP_URL
      )
    }
    if (value.length === 0) {
      throw new IngestError(`bootstrap-static/ response field "${key}" is empty`, BOOTSTRAP_URL)
    }
  }
}

function validateFixturesShape(data: unknown): asserts data is JsonRecord[] {
  if (!Array.isArray(data)) {
    throw new IngestError('fixtures/ response is not a JSON array', FIXTURES_URL)
  }
  if (data.length === 0) {
    throw new IngestError('fixtures/ response array is empty', FIXTURES_URL)
  }
}

// ============================================================================
// Field-access helpers — the FPL API mixes numbers and numeric strings for
// the same kind of value (e.g. now_cost is a number, form is the string
// "0.0"). Postgres numeric columns need an actual number, not a numeric
// string, so every numeric field is normalised on the way in.
// ============================================================================

function str(row: JsonRecord, key: string): string | null {
  const v = row[key]
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return null
  return String(v)
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

function bool(row: JsonRecord, key: string, fallback = false): boolean {
  const v = row[key]
  return typeof v === 'boolean' ? v : fallback
}

// ============================================================================
// Row mapping — one function per table, straight off the API field names.
// Prices (now_cost) stay integers, exactly as the API returns them — never
// converted to a float here (product-brief.md, formatting is a display
// concern). Availability fields (status, chance_of_playing_next_round,
// news) are carried through for the injury/suspension rings on the pitch
// view (later ticket).
// ============================================================================

function mapTeams(teams: JsonRecord[]): JsonRecord[] {
  return teams.map((t) => ({
    id: num(t, 'id'),
    name: str(t, 'name'),
    short_name: str(t, 'short_name'),
    code: num(t, 'code'),
    strength: num(t, 'strength'),
    strength_overall_home: num(t, 'strength_overall_home'),
    strength_overall_away: num(t, 'strength_overall_away'),
    strength_attack_home: num(t, 'strength_attack_home'),
    strength_attack_away: num(t, 'strength_attack_away'),
    strength_defence_home: num(t, 'strength_defence_home'),
    strength_defence_away: num(t, 'strength_defence_away'),
    pulse_id: num(t, 'pulse_id'),
  }))
}

function mapGameweeks(events: JsonRecord[]): JsonRecord[] {
  return events.map((e) => ({
    id: num(e, 'id'),
    name: str(e, 'name'),
    deadline_time: str(e, 'deadline_time'),
    finished: bool(e, 'finished'),
    is_previous: bool(e, 'is_previous'),
    is_current: bool(e, 'is_current'),
    is_next: bool(e, 'is_next'),
    average_entry_score: num(e, 'average_entry_score'),
    highest_score: num(e, 'highest_score'),
    most_selected: num(e, 'most_selected'),
    most_transferred_in: num(e, 'most_transferred_in'),
    top_element: num(e, 'top_element'),
    most_captained: num(e, 'most_captained'),
    most_vice_captained: num(e, 'most_vice_captained'),
    transfers_made: num(e, 'transfers_made'),
  }))
}

function mapPlayers(elements: JsonRecord[]): JsonRecord[] {
  return elements.map((p) => ({
    id: num(p, 'id'),
    code: num(p, 'code'),
    web_name: str(p, 'web_name'),
    first_name: str(p, 'first_name'),
    second_name: str(p, 'second_name'),
    team_id: num(p, 'team'),
    element_type: num(p, 'element_type'),
    now_cost: num(p, 'now_cost'),
    status: str(p, 'status') ?? 'a',
    chance_of_playing_next_round: num(p, 'chance_of_playing_next_round'),
    chance_of_playing_this_round: num(p, 'chance_of_playing_this_round'),
    news: str(p, 'news'),
    news_added: str(p, 'news_added'),
    total_points: num(p, 'total_points') ?? 0,
    form: num(p, 'form'),
    selected_by_percent: num(p, 'selected_by_percent'),
    minutes: num(p, 'minutes') ?? 0,
    goals_scored: num(p, 'goals_scored') ?? 0,
    assists: num(p, 'assists') ?? 0,
    clean_sheets: num(p, 'clean_sheets') ?? 0,
    goals_conceded: num(p, 'goals_conceded') ?? 0,
    own_goals: num(p, 'own_goals') ?? 0,
    penalties_saved: num(p, 'penalties_saved') ?? 0,
    penalties_missed: num(p, 'penalties_missed') ?? 0,
    yellow_cards: num(p, 'yellow_cards') ?? 0,
    red_cards: num(p, 'red_cards') ?? 0,
    saves: num(p, 'saves') ?? 0,
    bonus: num(p, 'bonus') ?? 0,
    bps: num(p, 'bps') ?? 0,
    influence: num(p, 'influence'),
    creativity: num(p, 'creativity'),
    threat: num(p, 'threat'),
    ict_index: num(p, 'ict_index'),
    defensive_contribution: num(p, 'defensive_contribution') ?? 0,
    expected_goals: num(p, 'expected_goals') ?? 0,
    expected_assists: num(p, 'expected_assists') ?? 0,
    expected_goal_involvements: num(p, 'expected_goal_involvements') ?? 0,
    expected_goals_conceded: num(p, 'expected_goals_conceded') ?? 0,
  }))
}

function mapFixtures(fixtures: JsonRecord[]): JsonRecord[] {
  return fixtures.map((f) => ({
    id: num(f, 'id'),
    event_id: num(f, 'event'),
    team_h: num(f, 'team_h'),
    team_a: num(f, 'team_a'),
    team_h_score: num(f, 'team_h_score'),
    team_a_score: num(f, 'team_a_score'),
    team_h_difficulty: num(f, 'team_h_difficulty'),
    team_a_difficulty: num(f, 'team_a_difficulty'),
    kickoff_time: str(f, 'kickoff_time'),
    started: bool(f, 'started'),
    finished: bool(f, 'finished'),
    finished_provisional: bool(f, 'finished_provisional'),
    minutes: num(f, 'minutes') ?? 0,
    provisional_start_time: bool(f, 'provisional_start_time'),
    pulse_id: num(f, 'pulse_id'),
  }))
}

// ============================================================================
// Supabase writes
// ============================================================================

async function upsertTable(
  supabase: SupabaseClient,
  table: TableName,
  rows: JsonRecord[]
): Promise<void> {
  if (rows.length === 0) {
    // Should be unreachable — the shape validators above already reject an
    // empty source array — but kept as a hard stop so a future mapping bug
    // can never silently upsert zero rows over a populated table.
    throw new IngestError(`refusing to upsert zero rows into "${table}"`, table)
  }

  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) {
    throw new IngestError(`upsert into "${table}" failed: ${error.message}`, table)
  }
}

async function countTable(supabase: SupabaseClient, table: TableName): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    throw new IngestError(`counting rows in "${table}" failed: ${error.message}`, table)
  }
  return count ?? 0
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

// Same PGRST205 / 42P01 recognition as heartbeat.ts — a table missing from
// the schema cache (hosted Supabase) or from Postgres itself (bare
// Postgres) both mean "the #9/#10 migrations have not been applied yet".
function isMissingTableError(error: PostgrestLikeError, table: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(table).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
  }

  const supabase = createClient(env.url, env.secretKey)
  const startedAt = new Date()

  try {
    console.log(`ingest-fpl: fetching ${BOOTSTRAP_URL}`)
    const bootstrapData = await fetchJson(BOOTSTRAP_URL)
    validateBootstrapShape(bootstrapData)

    console.log(`ingest-fpl: fetching ${FIXTURES_URL}`)
    const fixturesData = await fetchJson(FIXTURES_URL)
    validateFixturesShape(fixturesData)

    const teamRows = mapTeams(bootstrapData.teams)
    const gameweekRows = mapGameweeks(bootstrapData.events)
    const playerRows = mapPlayers(bootstrapData.elements)
    const fixtureRows = mapFixtures(fixturesData)

    // Order matters for foreign keys: teams and gameweeks have none,
    // players references teams, fixtures references both teams and
    // gameweeks.
    await upsertTable(supabase, 'teams', teamRows)
    await upsertTable(supabase, 'gameweeks', gameweekRows)
    await upsertTable(supabase, 'players', playerRows)
    await upsertTable(supabase, 'fixtures', fixtureRows)

    const counts: Record<TableName, number> = {
      teams: await countTable(supabase, 'teams'),
      gameweeks: await countTable(supabase, 'gameweeks'),
      players: await countTable(supabase, 'players'),
      fixtures: await countTable(supabase, 'fixtures'),
    }

    for (const table of TABLES) {
      console.log(`ingest-fpl: ${table}: ${counts[table]} rows`)
    }

    const finishedAt = new Date()
    const { error: jobRunError } = await supabase.from('job_runs').insert({
      job_name: JOB_NAME,
      status: 'success',
      message: 'ingest-fpl: bootstrap-static/ and fixtures/ ingested',
      details: counts,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    })

    if (jobRunError) {
      if (isMissingTableError(jobRunError, 'job_runs')) {
        console.error(
          `ingest-fpl: table "job_runs" does not exist in the target database. ` +
            `Apply the migration at supabase/migrations/20260811130000_job_runs.sql before running this script.`
        )
      } else {
        console.error(`ingest-fpl: insert into job_runs failed: ${jobRunError.message}`)
      }
      process.exit(1)
    }

    console.log('ingest-fpl: success')
  } catch (err) {
    const finishedAt = new Date()
    const message =
      err instanceof IngestError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`ingest-fpl: failed: ${message}`)

    const { error: jobRunError } = await supabase.from('job_runs').insert({
      job_name: JOB_NAME,
      status: 'failure',
      message,
      details: null,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    })

    if (jobRunError) {
      if (isMissingTableError(jobRunError, 'job_runs')) {
        console.error(
          `ingest-fpl: table "job_runs" does not exist in the target database — ` +
            `could not record this failure there either. ` +
            `Apply the migration at ${REFERENCE_SCHEMA_MIGRATION} and supabase/migrations/20260811130000_job_runs.sql.`
        )
      } else {
        console.error(`ingest-fpl: additionally failed to write the failure row to job_runs: ${jobRunError.message}`)
      }
    }

    process.exit(1)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`ingest-fpl: unexpected top-level failure: ${message}`)
  process.exit(1)
})
