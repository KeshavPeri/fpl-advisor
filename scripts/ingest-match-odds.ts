// Ingest The Odds API's soccer_epl h2h market into public.fixture_odds — ticket #238.
//
// GET https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=...
// Free tier, 500 requests/month. Measured against the live key on 15 Sept 2026: one call returned
// 20 fixtures (roughly four gameweeks of forward coverage, ~24 days), every fixture carried 21
// bookmakers, and the call cost 1 credit (a daily run costs about 30/month).
//
// ============================================================================
// The horizon is whatever the API serves — no fixed day-window, one sanity cap.
// ============================================================================
// A fixture is stored whenever its two clubs both resolve to a known team code. There is no
// day-count window on top of that — the API's own coverage IS the horizon (a fixed window would
// throw away three gameweeks of usable signal, per the ticket). The one guard kept is
// MAX_FIXTURE_DAYS_OUT (35 days, src/lib/projection/marketOdds.ts) — a defence against a
// malformed or long-dated market, not a horizon rule, and it should never fire in normal
// operation.
//
// ============================================================================
// The failure mode this job must not repeat.
// ============================================================================
// scripts/ingest-core-insights.ts's fotmob_name -> team-code mapping went blank for four
// gameweeks and every opponent_team_code silently became null — see teamStrength.ts's own
// header. So: the name map (scripts/lib/oddsClubNames.ts) is an explicit, committed table, never
// a fuzzy match. An unmapped name is never guessed — the fixture is skipped and counted, by name,
// in job_runs.details. And the job FAILS LOUDLY (non-zero exit) when fewer than 80% of the
// fixtures it fetched resolve to a known club (MIN_CLUB_RESOLUTION_RATE) — silence on a broken
// mapping is the specific defect this repo has hit twice.
//
// ============================================================================
// Median across bookmakers, not the mean and not one chosen book.
// ============================================================================
// Robust to a single stale or mispriced feed — src/lib/projection/marketOdds.ts's
// medianOddsAcrossBooks/removeOverround do the actual arithmetic; this file's own job is turning
// one raw Odds-API fixture into that pure module's input shape (or explaining why it can't).
//
// ============================================================================
// Append-only — every successful call INSERTs, never upserts.
// ============================================================================
// public.fixture_odds (supabase/migrations/20260917090000_fixture_odds.sql) grants INSERT to
// service_role and no UPDATE/DELETE at all — the database enforces append-only, this file never
// even attempts an upsert.
//
// Reads SUPABASE_URL, SUPABASE_SECRET_KEY and ODDS_API_KEY. ODDS_API_KEY is already live in the
// repository secrets (owner-provisioned, 15 Sept 2026) — reading it here is not a new-credential
// Tier 1 action. The API key is never logged, including inside an error message (see
// maskApiKeyInUrl below).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_FIXTURE_DAYS_OUT,
  medianOddsAcrossBooks,
  MIN_CLUB_RESOLUTION_RATE,
  removeOverround,
  type MarketOddsPrices,
} from '../src/lib/projection/marketOdds.ts'
import { ODDS_CLUB_NAME_TO_TEAM_CODE } from './lib/oddsClubNames.ts'

const JOB_NAME = 'ingest-match-odds'
const FIXTURE_ODDS_MIGRATION = 'supabase/migrations/20260917090000_fixture_odds.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/** The only remote odds host this script ever talks to — same escape-hatch convention every other external-fetching job in scripts/ defines (e.g. FPL_API_BASE_URL). */
const DEFAULT_ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4'
const ODDS_API_BASE_URL = process.env.ODDS_API_BASE_URL ?? DEFAULT_ODDS_API_BASE_URL

const SPORT_KEY = 'soccer_epl'
const MARKET_KEY = 'h2h'
const DRAW_OUTCOME_NAME = 'Draw'

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 500

// ============================================================================
// Env
// ============================================================================

interface OddsEnv {
  supabaseUrl: string
  supabaseSecretKey: string
  oddsApiKey: string
}

function readEnv(): OddsEnv | null {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY
  const oddsApiKey = process.env.ODDS_API_KEY
  const missing: string[] = []
  if (!supabaseUrl) missing.push('SUPABASE_URL')
  if (!supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY')
  if (!oddsApiKey) missing.push('ODDS_API_KEY')

  if (missing.length > 0) {
    console.error(
      `${JOB_NAME}: required environment variables are not set. ` +
        'SUPABASE_URL, SUPABASE_SECRET_KEY and ODDS_API_KEY must all be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { supabaseUrl: supabaseUrl as string, supabaseSecretKey: supabaseSecretKey as string, oddsApiKey: oddsApiKey as string }
}

// ============================================================================
// Errors
// ============================================================================

export class OddsIngestError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'OddsIngestError'
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
// Fetch — same retry shape as scripts/settle-predictions.ts's fetchLiveJson: network errors and
// 5xx are retried with exponential backoff, 4xx fails immediately. Duplicated rather than
// imported: a different host, a different error surface, and (unlike that file) a URL carrying a
// secret that must never appear in a thrown message — see maskApiKeyInUrl below.
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`
    return err.message
  }
  return String(err)
}

/** Replaces the apiKey query-string value with a fixed placeholder — used in every log line and thrown message this file produces, so the live key is never written to console output, job_runs, or a GitHub Actions log. */
export function maskApiKeyInUrl(url: string): string {
  return url.replace(/([?&]apiKey=)[^&]+/i, '$1***')
}

async function fetchOddsApiJson(url: string): Promise<unknown> {
  const maskedUrl = maskApiKeyInUrl(url)
  let lastReason = 'unknown error'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return await response.json()
      }

      lastReason = `HTTP ${response.status} ${response.statusText}`
      if (response.status < 500) {
        throw new OddsIngestError(`request to ${maskedUrl} failed: ${lastReason}`, maskedUrl)
      }
      // 5xx falls through to the retry/backoff below.
    } catch (err) {
      if (err instanceof OddsIngestError) throw err
      lastReason = describeNetworkError(err)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      console.error(`${JOB_NAME}: ${maskedUrl} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastReason}), retrying in ${delay}ms`)
      await sleep(delay)
    }
  }

  throw new OddsIngestError(`request to ${maskedUrl} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`, maskedUrl)
}

// ============================================================================
// Raw response shape — validated defensively, matching every other external-fetching job's
// "the FPL API is undocumented and can change without notice" posture (here: a third-party API,
// same discipline).
// ============================================================================

export interface RawOddsApiOutcome {
  name: string
  price: number
}

export interface RawOddsApiMarket {
  key: string
  outcomes: RawOddsApiOutcome[]
}

export interface RawOddsApiBookmaker {
  key: string
  markets: RawOddsApiMarket[]
}

export interface RawOddsApiFixture {
  id?: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: RawOddsApiBookmaker[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validates the top-level shape only (an array of fixture-shaped objects) — per-bookmaker/per-market malformation is handled row-by-row by parseBookmakerH2hPrices below, which degrades to "skip this bookmaker" rather than failing the whole response. */
export function validateOddsApiShape(data: unknown, endpoint: string): asserts data is RawOddsApiFixture[] {
  if (!Array.isArray(data)) {
    throw new OddsIngestError(`${endpoint} response is not a JSON array`, endpoint)
  }
  for (let index = 0; index < data.length; index++) {
    const fixture = data[index]
    if (!isRecord(fixture)) {
      throw new OddsIngestError(`${endpoint} response element at index ${index} is not a JSON object`, endpoint)
    }
    if (typeof fixture.commence_time !== 'string' || typeof fixture.home_team !== 'string' || typeof fixture.away_team !== 'string') {
      throw new OddsIngestError(
        `${endpoint} response element at index ${index} is missing commence_time/home_team/away_team`,
        endpoint,
      )
    }
    if (!Array.isArray(fixture.bookmakers)) {
      throw new OddsIngestError(`${endpoint} response element at index ${index} is missing a "bookmakers" array`, endpoint)
    }
  }
}

// ============================================================================
// Per-bookmaker parsing — PURE. A malformed bookmaker (no h2h market, a missing outcome, a
// non-positive price) is skipped, never guessed — this is a lower-stakes version of the same "no
// fake zero" rule prediction_log/gameweek_live_stats already apply, extended to "no fake price".
// ============================================================================

export function parseBookmakerH2hPrices(bookmaker: RawOddsApiBookmaker, homeTeam: string, awayTeam: string): MarketOddsPrices | null {
  const market = bookmaker.markets.find((m) => m.key === MARKET_KEY)
  if (market === undefined) return null

  const priceByName = new Map(market.outcomes.map((o) => [o.name, o.price]))
  const home = priceByName.get(homeTeam)
  const away = priceByName.get(awayTeam)
  const draw = priceByName.get(DRAW_OUTCOME_NAME)

  if (typeof home !== 'number' || typeof away !== 'number' || typeof draw !== 'number') return null
  if (!(home > 0) || !(away > 0) || !(draw > 0)) return null

  return { home, draw, away }
}

// ============================================================================
// Per-fixture classification — PURE. Every raw fixture ends up in exactly one bucket, so the
// counters in main() reconcile exactly against the raw array length (same discipline
// scripts/ingest-gameweek-live-stats.ts's own reconciliation check uses).
// ============================================================================

export type ProcessedOddsFixture =
  | { status: 'unmapped-club'; unmappedNames: readonly string[] }
  | { status: 'too-far-out'; commenceTimeMs: number }
  | { status: 'no-usable-bookmaker-prices'; homeTeamCode: number; awayTeamCode: number; commenceTimeMs: number }
  | { status: 'ok'; homeTeamCode: number; awayTeamCode: number; commenceTimeMs: number; bookmakerPrices: readonly MarketOddsPrices[] }

/**
 * Classifies one raw Odds-API fixture. Club-name resolution is checked FIRST, regardless of the
 * day cap — MIN_CLUB_RESOLUTION_RATE (the 80% floor) is a statement about name-mapping quality
 * across everything the API returned, not about the day cap, so a fixture must not be able to
 * dodge the "unmapped" bucket by also being far out.
 */
export function classifyOddsApiFixture(raw: RawOddsApiFixture, nowMs: number): ProcessedOddsFixture {
  const homeTeamCode = ODDS_CLUB_NAME_TO_TEAM_CODE.get(raw.home_team) ?? null
  const awayTeamCode = ODDS_CLUB_NAME_TO_TEAM_CODE.get(raw.away_team) ?? null
  if (homeTeamCode === null || awayTeamCode === null) {
    const unmappedNames: string[] = []
    if (homeTeamCode === null) unmappedNames.push(raw.home_team)
    if (awayTeamCode === null) unmappedNames.push(raw.away_team)
    return { status: 'unmapped-club', unmappedNames }
  }

  const commenceTimeMs = new Date(raw.commence_time).getTime()
  const daysOut = (commenceTimeMs - nowMs) / (24 * 60 * 60 * 1000)
  if (daysOut > MAX_FIXTURE_DAYS_OUT) {
    return { status: 'too-far-out', commenceTimeMs }
  }

  const bookmakerPrices = raw.bookmakers
    .map((b) => parseBookmakerH2hPrices(b, raw.home_team, raw.away_team))
    .filter((p): p is MarketOddsPrices => p !== null)

  if (bookmakerPrices.length === 0) {
    return { status: 'no-usable-bookmaker-prices', homeTeamCode, awayTeamCode, commenceTimeMs }
  }

  return { status: 'ok', homeTeamCode, awayTeamCode, commenceTimeMs, bookmakerPrices }
}

// ============================================================================
// The 80% resolution floor — PURE.
// ============================================================================

export interface ClubResolutionFloorResult {
  totalFetched: number
  resolvedCount: number
  rate: number
  passed: boolean
}

/** totalFetched === 0 passes vacuously (rate 1) — an empty response is reported separately by main() as "nothing to ingest", never conflated with a broken name mapping. */
export function checkClubResolutionFloor(totalFetched: number, unmappedCount: number, minRate: number = MIN_CLUB_RESOLUTION_RATE): ClubResolutionFloorResult {
  if (totalFetched === 0) return { totalFetched, resolvedCount: 0, rate: 1, passed: true }
  const resolvedCount = totalFetched - unmappedCount
  const rate = resolvedCount / totalFetched
  return { totalFetched, resolvedCount, rate, passed: rate >= minRate }
}

// ============================================================================
// fixture_id resolution against public.fixtures — PURE. Matches on the (home team id, away team
// id) pair; if more than one public.fixtures row matches (should not happen inside a
// MAX_FIXTURE_DAYS_OUT-bounded horizon, but a reverse fixture technically could), picks the one
// whose kickoff_time is closest to the odds row's own commence_time rather than guessing.
// ============================================================================

export interface FixtureCandidate {
  id: number
  homeTeamId: number
  awayTeamId: number
  kickoffTimeMs: number | null
}

export function resolveFixtureIdForOdds(homeTeamId: number, awayTeamId: number, commenceTimeMs: number, candidates: readonly FixtureCandidate[]): number | null {
  const matches = candidates.filter((f) => f.homeTeamId === homeTeamId && f.awayTeamId === awayTeamId)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].id

  const withKnownKickoff = matches.filter((f): f is FixtureCandidate & { kickoffTimeMs: number } => f.kickoffTimeMs !== null)
  if (withKnownKickoff.length === 0) return matches[0].id

  return withKnownKickoff.reduce((closest, f) =>
    Math.abs(f.kickoffTimeMs - commenceTimeMs) < Math.abs(closest.kickoffTimeMs - commenceTimeMs) ? f : closest,
  ).id
}

// ============================================================================
// Building the row to insert — PURE. Wraps marketOdds.ts's medianOddsAcrossBooks/removeOverround
// (never reimplemented here) plus the fixture_id this file alone is responsible for resolving.
// ============================================================================

export interface FixtureOddsRow {
  fixture_id: number
  fetched_at: string
  book_count: number
  median_home: number
  median_draw: number
  median_away: number
  p_home: number
  p_draw: number
  p_away: number
  overround: number
}

export function buildFixtureOddsRow(fixtureId: number, bookmakerPrices: readonly MarketOddsPrices[], fetchedAtIso: string): FixtureOddsRow {
  const medianPrices = medianOddsAcrossBooks(bookmakerPrices)
  const { pHome, pDraw, pAway, overround } = removeOverround(medianPrices)
  return {
    fixture_id: fixtureId,
    fetched_at: fetchedAtIso,
    book_count: bookmakerPrices.length,
    median_home: medianPrices.home,
    median_draw: medianPrices.draw,
    median_away: medianPrices.away,
    p_home: pHome,
    p_draw: pDraw,
    p_away: pAway,
    overround,
  }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface TeamRow {
  id: number
  code: number | null
}

interface FixtureRow {
  id: number
  team_h: number
  team_a: number
  kickoff_time: string | null
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const nowMs = startedAt.getTime()
  const env = readEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.supabaseUrl, env.supabaseSecretKey)

  try {
    // --------------------------------------------------------------------
    // 1. teams (code -> id) and fixtures (team ids, kickoff) — both well
    //    under the 1,000-row db-max-rows ceiling (~20 and ~380 rows), same
    //    "left unpaginated" precedent project-points.ts's own reads use
    //    (decisions/ticket-43.md).
    // --------------------------------------------------------------------
    const { data: teamRows, error: teamsError } = await supabase.from('teams').select('id, code').returns<TeamRow[]>()
    if (teamsError) {
      if (isMissingTable(teamsError, 'teams')) {
        throw new OddsIngestError(`the "teams" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'teams')
      }
      throw new OddsIngestError(`teams lookup failed: ${teamsError.message}`, 'teams')
    }
    const teamIdByCode = new Map<number, number>()
    for (const t of teamRows ?? []) {
      if (t.code !== null) teamIdByCode.set(t.code, t.id)
    }

    const { data: fixtureRowsData, error: fixturesError } = await supabase
      .from('fixtures')
      .select('id, team_h, team_a, kickoff_time')
      .returns<FixtureRow[]>()
    if (fixturesError) {
      throw new OddsIngestError(`fixtures lookup failed: ${fixturesError.message}`, 'fixtures')
    }
    const fixtureCandidates: FixtureCandidate[] = (fixtureRowsData ?? []).map((f) => ({
      id: f.id,
      homeTeamId: f.team_h,
      awayTeamId: f.team_a,
      kickoffTimeMs: f.kickoff_time !== null ? new Date(f.kickoff_time).getTime() : null,
    }))

    // --------------------------------------------------------------------
    // 2. The Odds API — one call, h2h market, UK region, decimal odds.
    // --------------------------------------------------------------------
    const url = `${ODDS_API_BASE_URL}/sports/${SPORT_KEY}/odds?regions=uk&markets=${MARKET_KEY}&oddsFormat=decimal&apiKey=${env.oddsApiKey}`
    const maskedUrl = maskApiKeyInUrl(url)
    const json = await fetchOddsApiJson(url)
    validateOddsApiShape(json, maskedUrl)

    if (json.length === 0) {
      const message = `${JOB_NAME}: ${maskedUrl} returned zero fixtures — nothing to ingest.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { totalFetched: 0 }, startedAt })
      return
    }

    // --------------------------------------------------------------------
    // 3. Classify every fixture, reconcile, check the 80% resolution floor.
    // --------------------------------------------------------------------
    const classified = json.map((f) => ({ raw: f, outcome: classifyOddsApiFixture(f, nowMs) }))

    const unmapped = classified.filter((c): c is { raw: RawOddsApiFixture; outcome: Extract<ProcessedOddsFixture, { status: 'unmapped-club' }> } => c.outcome.status === 'unmapped-club')
    const tooFarOut = classified.filter((c) => c.outcome.status === 'too-far-out')
    const noUsableBookmakerPrices = classified.filter((c) => c.outcome.status === 'no-usable-bookmaker-prices')
    const ok = classified.filter((c): c is { raw: RawOddsApiFixture; outcome: Extract<ProcessedOddsFixture, { status: 'ok' }> } => c.outcome.status === 'ok')

    if (unmapped.length + tooFarOut.length + noUsableBookmakerPrices.length + ok.length !== json.length) {
      throw new OddsIngestError(
        `reconciliation failed — ${json.length} fixtures fetched but the four outcome buckets summed to ` +
          `${unmapped.length + tooFarOut.length + noUsableBookmakerPrices.length + ok.length}. This should be impossible.`,
        maskedUrl,
      )
    }

    // Counted BY NAME, per the ticket's own rule — never just a total.
    const unmappedNameCounts: Record<string, number> = {}
    for (const c of unmapped) {
      for (const name of c.outcome.unmappedNames) {
        unmappedNameCounts[name] = (unmappedNameCounts[name] ?? 0) + 1
      }
    }

    const resolutionFloor = checkClubResolutionFloor(json.length, unmapped.length)

    // --------------------------------------------------------------------
    // 4. For every 'ok' fixture: resolve fixture_id, build the row.
    // --------------------------------------------------------------------
    const fetchedAtIso = new Date().toISOString()
    const rowsToInsert: FixtureOddsRow[] = []
    let fixturesUnresolvedToFixtureId = 0

    for (const c of ok) {
      const homeTeamId = teamIdByCode.get(c.outcome.homeTeamCode)
      const awayTeamId = teamIdByCode.get(c.outcome.awayTeamCode)
      if (homeTeamId === undefined || awayTeamId === undefined) {
        fixturesUnresolvedToFixtureId++
        continue
      }
      const fixtureId = resolveFixtureIdForOdds(homeTeamId, awayTeamId, c.outcome.commenceTimeMs, fixtureCandidates)
      if (fixtureId === null) {
        fixturesUnresolvedToFixtureId++
        continue
      }
      rowsToInsert.push(buildFixtureOddsRow(fixtureId, c.outcome.bookmakerPrices, fetchedAtIso))
    }

    // --------------------------------------------------------------------
    // 5. Write — INSERT only, never an upsert (append-only, matching the
    //    migration's own grants, which do not include UPDATE).
    // --------------------------------------------------------------------
    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase.from('fixture_odds').insert(rowsToInsert)
      if (insertError) {
        if (isMissingTable(insertError, 'fixture_odds')) {
          throw new OddsIngestError(`the "fixture_odds" table does not exist. Apply ${FIXTURE_ODDS_MIGRATION} first.`, 'fixture_odds')
        }
        throw new OddsIngestError(`insert into "fixture_odds" failed: ${insertError.message}`, 'fixture_odds')
      }
    }

    const details: JsonRecord = {
      totalFetched: json.length,
      fixturesUnmappedClub: unmapped.length,
      unmappedClubNameCounts: unmappedNameCounts,
      fixturesTooFarOut: tooFarOut.length,
      fixturesNoUsableBookmakerPrices: noUsableBookmakerPrices.length,
      fixturesOk: ok.length,
      fixturesUnresolvedToFixtureId,
      rowsWritten: rowsToInsert.length,
      clubResolutionRate: resolutionFloor.rate,
      clubResolutionFloorPassed: resolutionFloor.passed,
      teamRowsFetched: teamRows?.length ?? 0,
      fixtureRowsFetched: fixtureRowsData?.length ?? 0,
    }

    const message =
      `${JOB_NAME}: ${maskedUrl} returned ${json.length} fixture(s). Wrote ${rowsToInsert.length} row(s) to fixture_odds ` +
      `(${unmapped.length} unmapped club(s), ${tooFarOut.length} too far out, ${noUsableBookmakerPrices.length} with no ` +
      `usable bookmaker price, ${fixturesUnresolvedToFixtureId} unresolved to a fixture_id). Club resolution rate: ` +
      `${(resolutionFloor.rate * 100).toFixed(1)}% (floor: ${(MIN_CLUB_RESOLUTION_RATE * 100).toFixed(0)}%).`

    if (!resolutionFloor.passed) {
      const failureMessage =
        `${message} FAILING LOUDLY — club-name resolution fell below the ${(MIN_CLUB_RESOLUTION_RATE * 100).toFixed(0)}% floor. ` +
        `Unmapped names: ${JSON.stringify(unmappedNameCounts)}. This usually means a club was promoted and needs a new row ` +
        'in scripts/lib/oddsClubNames.ts.'
      console.error(failureMessage)
      await recordJobRun(supabase, { status: 'failure', message: failureMessage, details, startedAt })
      process.exit(1)
      return
    }

    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof OddsIngestError
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
