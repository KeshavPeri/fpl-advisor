// FPL-Core-Insights ingest job — ticket #12.
//
// Fetches CSVs over plain HTTPS from the FPL-Core-Insights repo (no
// credential, no clone — individual files only) and upserts:
//   - public.player_match_stats: per-player, per-match defensive/attacking
//     stats (tackles, interceptions, blocks, clearances, recoveries, xG, xA
//     and a few adjacent counting stats) — the raw inputs to later defcon
//     modelling. Nothing here is derived; see the ticket's out-of-scope list.
//   - public.teams.elo: ClubElo ratings, from the source's teams.csv.
//
// One job_runs row per execution, matching the #10 heartbeat pattern: never
// upserted, so runs accumulate as an audit log. Reads exactly two
// environment variables — SUPABASE_URL and SUPABASE_SECRET_KEY — same as
// scripts/heartbeat.ts. No fallback names, no browser-bundle-prefixed
// variables: this runs in a GitHub Actions job, never in the browser.
//
// SEASON DIRECTORY NOT YET PUBLISHED IS A NORMAL STATE, NOT A FAILURE.
// The source publishes a season's directory only once that season exists.
// If the season-root manifest (players.csv) 404s, this job records that
// plainly in job_runs and exits 0 — it must not page anybody for a season
// that simply hasn't been published yet (true for 2026-2027 as of the
// ticket's writing; see the ticket #12 Builder report for what was actually
// observed live on 11 Aug 2026, which had moved on since the ticket was
// written — the source can and does change from day to day).
//
// A GENUINE FAILURE — an unreachable host, an unexpected non-200/404 HTTP
// status, or a file that exists but does not parse as CSV (or is missing an
// expected column, meaning the source's schema changed) — exits non-zero and
// writes a failed job_runs row naming the file.
//
// Per-gameweek data lives at
//   {season}/By Gameweek/GW{n}/playermatchstats.csv
// (note the literal space, percent-encoded below as %20 — the season root
// itself has no such file, see gameweekUrl()). Gameweeks are walked
// sequentially from 1; the first 404 stops the walk, since gameweeks are
// always published in order and a later ticket does not need this job to
// keep probing weeks that cannot exist yet. A 200 response with zero data
// rows (header only — a gameweek not yet played) is not an error either; the
// walk simply continues to the next gameweek.
//
// No FK from player_match_stats.player_id to players.id — see the migration
// file's header comment for why (FPL element ids are not stable across
// season boundaries, verified against real fetched data). This job stores
// player_id honestly and does not drop rows over it.
//
// player_code (ticket #22): players.csv carries both player_id and the
// source's stable player_code, so every match-stat row is stamped with the
// player_code for its player_id, built as a player_id -> player_code map
// from that same season's players.csv fetched below. This is the join key
// that survives a season boundary — see
// supabase/migrations/20260811180000_player_match_stats_player_code.sql's
// header for the "because". A row whose player_id has no entry in that
// map (source files are generated separately; a small gap is expected) is
// still written, with player_code left null — never skipped over this.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'

const JOB_NAME = 'ingest-core-insights'

// The season identifier appears exactly once as a configurable default,
// here — every URL is built from this (or the CORE_INSIGHTS_SEASON env
// override), never hardcoded again below.
const DEFAULT_SEASON = '2025-2026'

const SOURCE_BASE_URL = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data'
const MAX_GAMEWEEKS = 38 // a Premier League season is 38 gameweeks; the walk stops at the first 404 well before this in practice
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'

function seasonRootUrl(season: string, file: string): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/${file}`
}

function gameweekUrl(season: string, gameweek: number): string {
  // "By Gameweek" is a fixed path segment (not derived from configuration),
  // so its %20 encoding is written once, here, rather than computed.
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/By%20Gameweek/GW${gameweek}/playermatchstats.csv`
}

// ============================================================================
// Supabase env — identical contract to scripts/heartbeat.ts.
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

interface PostgrestLikeError {
  code?: string
  message?: string
}

// See scripts/heartbeat.ts for why both error shapes are checked: PGRST205
// is PostgREST's own code for "relation not in schema cache" (hosted
// Supabase, table not migrated yet); 42P01 is bare Postgres's undefined_table.
function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// job_runs
// ============================================================================

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: Record<string, unknown>
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
// Fetching and parsing
// ============================================================================

class IngestError extends Error {}

async function fetchCsv(url: string): Promise<{ status: number; text: string }> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IngestError(`could not reach ${url}: ${message}`)
  }
  const text = await response.text()
  return { status: response.status, text }
}

function parseCsvRecords(text: string, url: string, requiredColumns: string[]): Array<Record<string, string>> {
  let records: Array<Record<string, string>>
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IngestError(`${url} exists but does not parse as CSV: ${message}`)
  }

  if (records.length === 0) {
    if (text.trim().length === 0) {
      throw new IngestError(`${url} exists but is empty (no header row)`)
    }
    // Header row present, zero data rows — a gameweek not yet played, or an
    // aggregate file legitimately empty. Not a parse failure.
    return records
  }

  const columns = Object.keys(records[0])
  const missing = requiredColumns.filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new IngestError(
      `${url} exists but is missing expected column(s) [${missing.join(', ')}] — the source's schema may have changed`
    )
  }
  return records
}

const PLAYERS_REQUIRED_COLUMNS = ['player_code', 'player_id', 'first_name', 'second_name', 'web_name', 'team_code', 'position']
const TEAMS_REQUIRED_COLUMNS = ['code', 'id', 'name', 'short_name', 'elo']
const MATCH_STATS_REQUIRED_COLUMNS = [
  'player_id',
  'match_id',
  'minutes_played',
  'goals',
  'assists',
  'xg',
  'xa',
  'xgot',
  'shots_on_target',
  'tackles',
  'tackles_won',
  'interceptions',
  'recoveries',
  'blocks',
  'clearances',
  'headed_clearances',
  'saves',
  'goals_conceded',
  'goals_prevented',
]

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function toNumeric(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// ============================================================================
// teams.elo
// ============================================================================

interface TeamUpsertRow {
  id: number
  name: string
  short_name: string
  code: number | null
  strength: number | null
  strength_overall_home: number | null
  strength_overall_away: number | null
  strength_attack_home: number | null
  strength_attack_away: number | null
  strength_defence_home: number | null
  strength_defence_away: number | null
  pulse_id: number | null
  elo: number | null
  updated_at: string
}

function toTeamRow(record: Record<string, string>): TeamUpsertRow | null {
  const id = toInt(record.id)
  if (id === null || !record.name || !record.short_name) return null
  return {
    id,
    name: record.name,
    short_name: record.short_name,
    code: toInt(record.code),
    strength: toInt(record.strength),
    strength_overall_home: toInt(record.strength_overall_home),
    strength_overall_away: toInt(record.strength_overall_away),
    strength_attack_home: toInt(record.strength_attack_home),
    strength_attack_away: toInt(record.strength_attack_away),
    strength_defence_home: toInt(record.strength_defence_home),
    strength_defence_away: toInt(record.strength_defence_away),
    pulse_id: toInt(record.pulse_id),
    elo: toNumeric(record.elo),
    updated_at: new Date().toISOString(),
  }
}

// Upserts full team rows (id, name, short_name, strengths, pulse_id, elo),
// not just the elo column. Tier 2 decision, "because": this ticket's own
// tests must be able to populate teams.elo standalone, without depending on
// ticket #11 (the bootstrap-static ingest, built concurrently, not
// guaranteed to have run first) having already inserted team rows. An
// elo-only upsert would fail its INSERT branch on the NOT NULL name/
// short_name columns for a team that doesn't exist yet. Every field written
// here has a same-named or clearly-equivalent column in the source's
// teams.csv, so this never invents data.
async function upsertTeams(supabase: SupabaseClient, records: Array<Record<string, string>>): Promise<number> {
  const rows = records.map(toTeamRow).filter((r): r is TeamUpsertRow => r !== null)
  if (rows.length === 0) return 0
  const { error } = await supabase.from('teams').upsert(rows, { onConflict: 'id' })
  if (error) {
    if (isMissingTable(error, 'teams')) {
      throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
    }
    throw new IngestError(`upsert into teams failed: ${error.message}`)
  }
  return rows.length
}

// ============================================================================
// player_match_stats
// ============================================================================

interface MatchStatRow {
  player_id: number
  player_code: number | null
  match_id: string
  season: string
  gameweek: number
  minutes_played: number | null
  goals: number | null
  assists: number | null
  xg: number | null
  xa: number | null
  xgot: number | null
  shots_on_target: number | null
  tackles: number | null
  tackles_won: number | null
  interceptions: number | null
  recoveries: number | null
  blocks: number | null
  clearances: number | null
  headed_clearances: number | null
  saves: number | null
  goals_conceded: number | null
  goals_prevented: number | null
  updated_at: string
}

function toMatchStatRow(
  record: Record<string, string>,
  season: string,
  gameweek: number,
  playerCodeByPlayerId: Map<number, number>
): MatchStatRow | null {
  const playerId = toInt(record.player_id)
  const matchId = record.match_id?.trim()
  if (playerId === null || !matchId) return null
  return {
    player_id: playerId,
    player_code: playerCodeByPlayerId.get(playerId) ?? null,
    match_id: matchId,
    season,
    gameweek,
    minutes_played: toInt(record.minutes_played),
    goals: toInt(record.goals),
    assists: toInt(record.assists),
    xg: toNumeric(record.xg),
    xa: toNumeric(record.xa),
    xgot: toNumeric(record.xgot),
    shots_on_target: toInt(record.shots_on_target),
    tackles: toInt(record.tackles),
    tackles_won: toInt(record.tackles_won),
    interceptions: toInt(record.interceptions),
    recoveries: toInt(record.recoveries),
    blocks: toInt(record.blocks),
    clearances: toInt(record.clearances),
    headed_clearances: toInt(record.headed_clearances),
    saves: toInt(record.saves),
    goals_conceded: toInt(record.goals_conceded),
    goals_prevented: toNumeric(record.goals_prevented),
    updated_at: new Date().toISOString(),
  }
}

interface PlayerMatchStatsUpsertResult {
  written: number
  // Rows written whose player_id had no entry in the season's players.csv
  // (ticket #22) — written with player_code left null, never skipped over
  // this. Reported in the run's job_runs row so the gap is visible.
  missingPlayerCode: number
}

async function upsertPlayerMatchStats(
  supabase: SupabaseClient,
  url: string,
  season: string,
  gameweek: number,
  records: Array<Record<string, string>>,
  playerCodeByPlayerId: Map<number, number>
): Promise<PlayerMatchStatsUpsertResult> {
  const rows: MatchStatRow[] = []
  let skipped = 0
  for (const record of records) {
    const row = toMatchStatRow(record, season, gameweek, playerCodeByPlayerId)
    if (row) {
      rows.push(row)
    } else {
      skipped++
    }
  }
  if (skipped > 0) {
    console.warn(`${JOB_NAME}: skipped ${skipped} row(s) in ${url} missing player_id or match_id`)
  }
  const missingPlayerCode = rows.filter((r) => r.player_code === null).length
  if (rows.length === 0) return { written: 0, missingPlayerCode: 0 }

  const { error } = await supabase.from('player_match_stats').upsert(rows, { onConflict: 'player_id,match_id' })
  if (error) {
    if (isMissingTable(error, 'player_match_stats')) {
      throw new IngestError(`table "player_match_stats" does not exist — apply ${PLAYER_MATCH_STATS_MIGRATION} first`)
    }
    throw new IngestError(`upsert into player_match_stats failed for ${url}: ${error.message}`)
  }
  return { written: rows.length, missingPlayerCode }
}

// ============================================================================
// player_code map — ticket #22. Built once per run from the same season's
// players.csv already fetched for logPlayerIdAlignmentNote(). player_code
// entries that fail to parse as an integer are skipped (not mapped), same as
// any other malformed numeric field in this file; the columns are already
// validated present by PLAYERS_REQUIRED_COLUMNS before this is called.
// ============================================================================

function buildPlayerCodeMap(playerRecords: Array<Record<string, string>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const record of playerRecords) {
    const playerId = toInt(record.player_id)
    const playerCode = toInt(record.player_code)
    if (playerId !== null && playerCode !== null) {
      map.set(playerId, playerCode)
    }
  }
  return map
}

// ============================================================================
// player_id alignment — informational only, per the ticket. Logged so it is
// visible in every run's output; never used to filter or drop rows. See the
// migration file's header comment and the ticket #12 Builder report for what
// this looked like against real fetched data.
// ============================================================================

function logPlayerIdAlignmentNote(playerRecords: Array<Record<string, string>>): void {
  console.log(
    `${JOB_NAME}: fetched ${playerRecords.length} player row(s) from players.csv. ` +
      'player_match_stats.player_id is stored as-is with no FK to players.id — FPL element ids ' +
      'are not stable across season boundaries (verified against real data; see the migration file header).'
  )
}

// ============================================================================
// main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)
  const season = (process.env.CORE_INSIGHTS_SEASON ?? '').trim() || DEFAULT_SEASON

  try {
    const playersUrl = seasonRootUrl(season, 'players.csv')
    const playersResp = await fetchCsv(playersUrl)

    if (playersResp.status === 404) {
      const message =
        `${JOB_NAME}: season directory not found for season "${season}" (404 fetching ${playersUrl}). ` +
        'A not-yet-published season is a normal state, not a failure — nothing was written.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: {
          season,
          reason: 'season_directory_not_found',
          playersRows: 0,
          teamsUpdated: 0,
          gameweeksFound: 0,
          matchRowsWritten: 0,
        },
        startedAt,
      })
      return
    }
    if (playersResp.status !== 200) {
      throw new IngestError(`unexpected HTTP ${playersResp.status} fetching ${playersUrl}`)
    }

    const playerRecords = parseCsvRecords(playersResp.text, playersUrl, PLAYERS_REQUIRED_COLUMNS)
    logPlayerIdAlignmentNote(playerRecords)
    const playerCodeByPlayerId = buildPlayerCodeMap(playerRecords)

    const teamsUrl = seasonRootUrl(season, 'teams.csv')
    const teamsResp = await fetchCsv(teamsUrl)
    if (teamsResp.status !== 200) {
      throw new IngestError(`unexpected HTTP ${teamsResp.status} fetching ${teamsUrl}`)
    }
    const teamRecords = parseCsvRecords(teamsResp.text, teamsUrl, TEAMS_REQUIRED_COLUMNS)
    const teamsUpdated = await upsertTeams(supabase, teamRecords)

    let gameweeksFound = 0
    let matchRowsWritten = 0
    let matchRowsWithoutPlayerCode = 0
    for (let gw = 1; gw <= MAX_GAMEWEEKS; gw++) {
      const url = gameweekUrl(season, gw)
      const resp = await fetchCsv(url)
      if (resp.status === 404) {
        break
      }
      if (resp.status !== 200) {
        throw new IngestError(`unexpected HTTP ${resp.status} fetching ${url}`)
      }
      gameweeksFound++
      const records = parseCsvRecords(resp.text, url, MATCH_STATS_REQUIRED_COLUMNS)
      if (records.length === 0) {
        console.log(`${JOB_NAME}: GW${gw} playermatchstats.csv has no rows yet (season ${season}) — skipping`)
        continue
      }
      const result = await upsertPlayerMatchStats(supabase, url, season, gw, records, playerCodeByPlayerId)
      matchRowsWritten += result.written
      matchRowsWithoutPlayerCode += result.missingPlayerCode
    }

    const message =
      `${JOB_NAME}: season ${season} — ${teamsUpdated} team(s) updated (elo), ` +
      `${gameweeksFound} gameweek file(s) found, ${matchRowsWritten} player_match_stats row(s) upserted ` +
      `(${matchRowsWithoutPlayerCode} without a matching player_code in players.csv)`
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: {
        season,
        playersRows: playerRecords.length,
        teamsUpdated,
        gameweeksFound,
        matchRowsWritten,
        matchRowsWithoutPlayerCode,
      },
      startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: ${message}`)
    try {
      await recordJobRun(supabase, {
        status: 'failure',
        message: `${JOB_NAME}: ${message}`,
        details: { season },
        startedAt,
      })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`${JOB_NAME}: unexpected failure: ${message}`)
  process.exit(1)
})
