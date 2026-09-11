// Ingest real bonus/BPS/minutes/total_points from event/{gw}/live/ — ticket #224.
//
// docs/model-review-2026-09-02.md §1h and docs/projection-model-backlog.md's G3 name the bonus
// allocator (src/lib/projection/bonus.ts, ticket #78) as the one component in this model with no
// validating instrument anywhere: player_match_stats carries neither `bonus` nor `bps` (verified
// directly against the source CSV header, ticket #127 — permanent, not an ingest gap a re-ingest
// closes). This job is that instrument's data source. It writes ONLY to public.gameweek_live_stats
// (supabase/migrations/20260911090000_gameweek_live_stats.sql) — nothing in src/lib/projection/,
// scripts/run-backtest.ts, scripts/calibration-report.ts, the solver or the app is touched, read,
// or changed by this file. scripts/bonus-validation-report.ts is the separate, read-only job that
// actually compares this table against player_projections.
//
// ============================================================================
// A SEPARATE SCRIPT FROM scripts/ingest-fpl.ts, DELIBERATELY.
// ============================================================================
// Batch-coupling constraint for this ticket: another ticket in the same batch touches
// scripts/ingest-fpl.ts and src/lib/projection/. This file does not import from, or modify,
// either. It duplicates the small amount of env/fetch/job_runs boilerplate every scripts/*.ts job
// already duplicates (CLAUDE.md's own "reasonable call for a four-line helper" note) rather than
// touch a file this ticket is forbidden to change.
//
// ============================================================================
// Reusing the lockdown rule, not re-deriving it.
// ============================================================================
// "Only ingest finished gameweeks. A live gameweek's bonus is provisional until lockdown at 09:00
// UK the morning after the final match — the same rule scripts/settle-predictions.ts already
// honours. Reuse that rule, do not invent a second one." (this ticket's own Notes). This file
// therefore imports decideGameweekEligibility and fetchLiveJson directly from
// scripts/settle-predictions.ts rather than duplicating either — the ONE exception to the
// "scripts duplicate small helpers" convention above, because the ticket text explicitly forbids
// a second version of this particular rule. Importing that module cannot trigger a live run of
// its own: like every scripts/*.ts job, it guards its main() behind an isMainModule check.
//
// ============================================================================
// THIS ENDPOINT SERVES THE CURRENT SEASON ONLY — stated once, binding on the job and the report.
// ============================================================================
// event/{gw}/live/ has no equivalent for a past season. Bonus can be validated on 2026/27
// gameweeks played so far (three, as of this ticket) and no further back, ever. That is why
// public.gameweek_live_stats.gameweek_id carries a real FK to public.gameweeks (the CURRENT
// season's own reference table) rather than the plain un-keyed integer a cross-season table like
// feature_history uses — see that migration's own header.
//
// ============================================================================
// Shape validation — matching scripts/ingest-fpl.ts's own pattern: fail loudly BEFORE any table
// is touched, never write a partial batch.
// ============================================================================
// validateLiveStatsShape below checks, in order: the response is a JSON object; it has a
// non-empty "elements" array; and EVERY element in that array is itself an object carrying a
// "stats" object. Any one of those failing throws before a single row is written for that
// gameweek — this is stricter than scripts/settle-predictions.ts's own validateLiveShape (which
// only checks for the "elements" array and lets parseLiveActuals skip malformed elements
// individually while settling what it can), because this job's job is to validate the payload
// itself, not to settle what it can from an imperfect one.
//
// ============================================================================
// Element ids are mapped to player_code via players — never stored as a bare element id.
// ============================================================================
// event/{gw}/live/'s `elements[].id` is this season's own FPL element id (the same id
// public.players.id uses). mapLiveRowsToPlayerCode resolves it against a fresh players table read
// (id -> code) and EXCLUDES, never guesses, an id with no matching row — counted under
// job_runs.details.rowsSkippedUnmappablePlayerCode, per gameweek and in total.
//
// ============================================================================
// The "no fake zero" rule — same one prediction_log/settle-predictions.ts already applies.
// ============================================================================
// An element that has a "stats" object but is missing (or carries a non-numeric) bonus, bps,
// minutes or total_points is excluded from the write entirely — never defaulted to 0. A present,
// numeric 0 for any of these fields (a real, measured zero) IS written normally.
//
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other scripts/*.ts
// job. FPL_API_BASE_URL is the same optional override scripts/ingest-fpl.ts and
// scripts/settle-predictions.ts already define. Every multi-row Supabase read goes through
// scripts/lib/paginate.ts's fetchAllPages + assertRowCountMatches. Upsert only, never delete —
// this file issues no Supabase row-removal call anywhere, and the migration grants no DELETE.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import {
  decideGameweekEligibility,
  fetchLiveJson,
  type GameweekEligibilityResult,
} from './settle-predictions.ts'

const JOB_NAME = 'ingest-gameweek-live-stats'
const GAMEWEEK_LIVE_STATS_MIGRATION = 'supabase/migrations/20260911090000_gameweek_live_stats.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/** The only remote host this script ever talks to — same escape hatch every other FPL-fetching job defines. */
const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL

/** Rows written per upsert call — same batch size convention as project-points.ts/settle-predictions.ts. */
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

export class IngestLiveStatsError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'IngestLiveStatsError'
    this.context = context
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
// Field-access helper — same defensive style as every other scripts/*.ts job: the FPL API is
// undocumented and can change without notice, and a missing/non-numeric field must degrade to
// "excluded", never to a guessed 0.
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
// Shape validation — PURE, no I/O. See file header for why this is stricter than
// settle-predictions.ts's own validateLiveShape.
// ============================================================================

export function validateLiveStatsShape(data: unknown, endpoint: string): asserts data is { elements: JsonRecord[] } {
  if (!isRecord(data)) {
    throw new IngestLiveStatsError(`${endpoint} response is not a JSON object`, endpoint)
  }
  if (!Array.isArray(data.elements)) {
    throw new IngestLiveStatsError(`${endpoint} response is missing an "elements" array`, endpoint)
  }
  if (data.elements.length === 0) {
    throw new IngestLiveStatsError(`${endpoint} response "elements" array is empty`, endpoint)
  }
  for (let index = 0; index < data.elements.length; index++) {
    const el = data.elements[index]
    if (!isRecord(el)) {
      throw new IngestLiveStatsError(`${endpoint} response element at index ${index} is not a JSON object`, endpoint)
    }
    if (!isRecord(el.stats)) {
      const idPart = typeof el.id === 'number' || typeof el.id === 'string' ? ` (id ${el.id})` : ''
      throw new IngestLiveStatsError(`${endpoint} response element at index ${index}${idPart} is missing a "stats" object`, endpoint)
    }
  }
}

// ============================================================================
// Parsing — PURE. Runs only after validateLiveStatsShape has already guaranteed every element
// carries a "stats" object; the isRecord(stats) re-check below is defence in depth, matching
// settle-predictions.ts's own precedent for re-checking an invariant a caller already enforced.
// ============================================================================

export interface ParsedLiveStatRow {
  elementId: number
  bonus: number
  bps: number
  minutes: number
  totalPoints: number
}

export interface ParseLiveElementsResult {
  rows: ParsedLiveStatRow[]
  /** Elements with a non-numeric/missing "id" — cannot be attributed to any player at all. */
  skippedMissingElementId: number
  /** Element ids whose "stats" object is missing/non-numeric bonus, bps, minutes or total_points — the "no fake zero" rule; see file header. */
  skippedMissingNumericStat: number[]
}

export function parseLiveElements(elements: readonly JsonRecord[]): ParseLiveElementsResult {
  const rows: ParsedLiveStatRow[] = []
  let skippedMissingElementId = 0
  const skippedMissingNumericStat: number[] = []

  for (const el of elements) {
    const elementId = num(el, 'id')
    if (elementId === null) {
      skippedMissingElementId++
      continue
    }
    const stats = el.stats
    if (!isRecord(stats)) {
      skippedMissingNumericStat.push(elementId)
      continue
    }
    const bonus = num(stats, 'bonus')
    const bps = num(stats, 'bps')
    const minutes = num(stats, 'minutes')
    const totalPoints = num(stats, 'total_points')
    if (bonus === null || bps === null || minutes === null || totalPoints === null) {
      skippedMissingNumericStat.push(elementId)
      continue
    }
    rows.push({ elementId, bonus, bps, minutes, totalPoints })
  }

  return { rows, skippedMissingElementId, skippedMissingNumericStat }
}

// ============================================================================
// Mapping to player_code — PURE. "Unmappable ids are counted and excluded, never guessed."
// ============================================================================

export interface MappedLiveStatRow {
  gameweek_id: number
  player_code: number
  bonus: number
  bps: number
  minutes: number
  total_points: number
}

export interface MapToPlayerCodeResult {
  rows: MappedLiveStatRow[]
  unmappableElementIds: number[]
}

export function mapLiveRowsToPlayerCode(
  gameweekId: number,
  parsedRows: readonly ParsedLiveStatRow[],
  playerCodeByElementId: ReadonlyMap<number, number | null>,
): MapToPlayerCodeResult {
  const rows: MappedLiveStatRow[] = []
  const unmappableElementIds: number[] = []

  for (const row of parsedRows) {
    const code = playerCodeByElementId.get(row.elementId)
    if (code === undefined || code === null) {
      unmappableElementIds.push(row.elementId)
      continue
    }
    rows.push({
      gameweek_id: gameweekId,
      player_code: code,
      bonus: row.bonus,
      bps: row.bps,
      minutes: row.minutes,
      total_points: row.totalPoints,
    })
  }

  return { rows, unmappableElementIds }
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

interface PlayerCodeRow {
  id: number
  code: number | null
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

  try {
    // --------------------------------------------------------------------
    // 1. Every gameweek, paginated + count-verified.
    // --------------------------------------------------------------------
    const {
      rows: gwRows,
      error: gwError,
      pages: gwPages,
    } = await fetchAllPages<GameweekRow>((from, to) =>
      supabase.from('gameweeks').select('id, finished').order('id', { ascending: true }).range(from, to).returns<GameweekRow[]>(),
    )
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new IngestLiveStatsError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new IngestLiveStatsError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const { count: gwExpectedCount, error: gwCountError } = await supabase.from('gameweeks').select('*', { count: 'exact', head: true })
    if (gwCountError) {
      throw new IngestLiveStatsError(`gameweeks count check failed: ${gwCountError.message}`, 'gameweeks')
    }
    assertRowCountMatches('gameweeks', gwRows.length, gwExpectedCount ?? 0)

    const finishedGwIds = gwRows
      .filter((g) => g.finished)
      .map((g) => g.id)
      .sort((a, b) => a - b)

    if (finishedGwIds.length === 0) {
      const message = `${JOB_NAME}: no gameweeks are marked finished yet — nothing to ingest.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { finishedGameweekIds: [] }, startedAt })
      return
    }

    // --------------------------------------------------------------------
    // 2. players id -> code map, fetched once and reused across every gameweek this run.
    // --------------------------------------------------------------------
    const {
      rows: playerRows,
      error: playerError,
      pages: playerPages,
    } = await fetchAllPages<PlayerCodeRow>((from, to) =>
      supabase.from('players').select('id, code').order('id', { ascending: true }).range(from, to).returns<PlayerCodeRow[]>(),
    )
    if (playerError) {
      if (isMissingTable(playerError, 'players')) {
        throw new IngestLiveStatsError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      }
      throw new IngestLiveStatsError(`players lookup failed: ${playerError.message}`, 'players')
    }
    const { count: playerExpectedCount, error: playerCountError } = await supabase.from('players').select('*', { count: 'exact', head: true })
    if (playerCountError) {
      throw new IngestLiveStatsError(`players count check failed: ${playerCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playerExpectedCount ?? 0)

    const playerCodeByElementId = new Map<number, number | null>(playerRows.map((p) => [p.id, p.code]))

    // --------------------------------------------------------------------
    // 3. Per finished gameweek: lockdown eligibility, then fetch/validate/parse/map/write.
    // --------------------------------------------------------------------
    const perGameweek: JsonRecord[] = []
    let gameweeksNotYetPastLockdown = 0
    let totalRowsWritten = 0
    let totalSkippedMissingElementId = 0
    let totalSkippedMissingNumericStat = 0
    let totalUnmappable = 0

    for (const gwId of finishedGwIds) {
      const {
        rows: fixtureRows,
        error: fixturesError,
        pages: fixturesPages,
      } = await fetchAllPages<FixtureRow>((from, to) =>
        supabase.from('fixtures').select('kickoff_time').eq('event_id', gwId).order('id', { ascending: true }).range(from, to).returns<FixtureRow[]>(),
      )
      if (fixturesError) {
        throw new IngestLiveStatsError(`fixtures lookup for gameweek ${gwId} failed: ${fixturesError.message}`, 'fixtures')
      }
      const { count: fixturesExpectedCount, error: fixturesCountError } = await supabase
        .from('fixtures')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', gwId)
      if (fixturesCountError) {
        throw new IngestLiveStatsError(`fixtures count check for gameweek ${gwId} failed: ${fixturesCountError.message}`, 'fixtures')
      }
      assertRowCountMatches(`fixtures (gameweek ${gwId})`, fixtureRows.length, fixturesExpectedCount ?? 0)

      const fixtureKickoffIsos = fixtureRows.map((f) => f.kickoff_time).filter((k): k is string => k !== null)

      // finished: true — every gwId here already passed the `finished` filter above.
      const eligibility: GameweekEligibilityResult = decideGameweekEligibility({
        gameweekId: gwId,
        finished: true,
        fixtureKickoffIsos,
        nowMs,
      })

      if (!eligibility.eligible) {
        console.log(`${JOB_NAME}: ${eligibility.reason}`)
        gameweeksNotYetPastLockdown++
        perGameweek.push({ gameweekId: gwId, eligible: false, reason: eligibility.reason })
        continue
      }
      console.log(`${JOB_NAME}: ${eligibility.reason}`)

      const liveUrl = `${API_BASE_URL}/event/${gwId}/live/`
      const liveJson = await fetchLiveJson(liveUrl)
      validateLiveStatsShape(liveJson, liveUrl)

      const parsed = parseLiveElements(liveJson.elements)
      const mapped = mapLiveRowsToPlayerCode(gwId, parsed.rows, playerCodeByElementId)

      // Reconciliation, checked, not just reported: every element read must land in exactly one
      // bucket — written, missing element id, missing numeric stat, or unmappable player_code.
      const reconciledCount =
        mapped.rows.length + parsed.skippedMissingElementId + parsed.skippedMissingNumericStat.length + mapped.unmappableElementIds.length
      if (reconciledCount !== liveJson.elements.length) {
        throw new IngestLiveStatsError(
          `gameweek ${gwId}: reconciliation failed — ${liveJson.elements.length} elements read but ` +
            `${reconciledCount} accounted for (written + skipped, all reasons). This should be impossible.`,
          liveUrl,
        )
      }

      for (let i = 0; i < mapped.rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = mapped.rows.slice(i, i + UPSERT_BATCH_SIZE)
        const { error: upsertError } = await supabase.from('gameweek_live_stats').upsert(batch, { onConflict: 'gameweek_id,player_code' })
        if (upsertError) {
          if (isMissingTable(upsertError, 'gameweek_live_stats')) {
            throw new IngestLiveStatsError(
              `the "gameweek_live_stats" table does not exist. Apply ${GAMEWEEK_LIVE_STATS_MIGRATION} first.`,
              'gameweek_live_stats',
            )
          }
          throw new IngestLiveStatsError(`upsert into "gameweek_live_stats" for gameweek ${gwId} failed: ${upsertError.message}`, 'gameweek_live_stats')
        }
      }

      totalRowsWritten += mapped.rows.length
      totalSkippedMissingElementId += parsed.skippedMissingElementId
      totalSkippedMissingNumericStat += parsed.skippedMissingNumericStat.length
      totalUnmappable += mapped.unmappableElementIds.length

      perGameweek.push({
        gameweekId: gwId,
        eligible: true,
        reason: eligibility.reason,
        elementsRead: liveJson.elements.length,
        rowsWritten: mapped.rows.length,
        skippedMissingElementId: parsed.skippedMissingElementId,
        skippedMissingNumericStat: parsed.skippedMissingNumericStat.length,
        skippedUnmappablePlayerCode: mapped.unmappableElementIds.length,
        fixtureRowsFetched: fixtureRows.length,
        fixtureRowsExpectedByCount: fixturesExpectedCount ?? 0,
        fixturesPages,
      })
    }

    const eligibleGameweekCount = finishedGwIds.length - gameweeksNotYetPastLockdown
    const details: JsonRecord = {
      finishedGameweekIds: finishedGwIds,
      eligibleGameweekCount,
      gameweeksNotYetPastLockdown,
      perGameweek,
      rowsWritten: totalRowsWritten,
      rowsSkippedMissingElementId: totalSkippedMissingElementId,
      rowsSkippedMissingNumericStat: totalSkippedMissingNumericStat,
      rowsSkippedUnmappablePlayerCode: totalUnmappable,
      gameweekRowsFetched: gwRows.length,
      gameweekRowsExpectedByCount: gwExpectedCount ?? 0,
      gameweekPages: gwPages,
      playerRowsFetched: playerRows.length,
      playerRowsExpectedByCount: playerExpectedCount ?? 0,
      playerPages,
    }

    const message =
      eligibleGameweekCount > 0
        ? `${JOB_NAME}: wrote ${totalRowsWritten} row(s) across ${eligibleGameweekCount} of ${finishedGwIds.length} finished gameweek(s) ` +
          `(${gameweeksNotYetPastLockdown} not yet past lockdown; skipped ${totalSkippedMissingElementId} with no numeric element id, ` +
          `${totalSkippedMissingNumericStat} with a missing/non-numeric stat, ${totalUnmappable} with no matching player_code).`
        : `${JOB_NAME}: none of ${finishedGwIds.length} finished gameweek(s) are past lockdown yet — nothing written.`
    console.log(message)
    await recordJobRun(supabase, { status: eligibleGameweekCount > 0 ? 'success' : 'skipped', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof IngestLiveStatsError
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

// Guarded, matching every other scripts/*.ts job: importing this module (e.g. from a test file,
// or FROM this module's own decideGameweekEligibility/fetchLiveJson import of
// settle-predictions.ts) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
