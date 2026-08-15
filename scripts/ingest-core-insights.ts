// FPL-Core-Insights ingest job — ticket #12, team-write matching fixed by
// ticket #32.
//
// Fetches CSVs over plain HTTPS from the FPL-Core-Insights repo (no
// credential, no clone — individual files only) and upserts:
//   - public.player_match_stats: per-player, per-match defensive/attacking
//     stats (tackles, interceptions, blocks, clearances, recoveries, xG, xA
//     and a few adjacent counting stats) — the raw inputs to later defcon
//     modelling. Nothing here is derived; see the ticket's out-of-scope list.
//   - public.teams.elo: ClubElo ratings, from the source's teams.csv.
//
// TEAM WRITES ARE MATCHED ON teams.code, NEVER teams.id (ticket #32).
// FPL team ids are not stable across seasons — the same failure already
// proven for player ids one level up, in #12/#22. This job ingests the
// 2025-2026 season file (see DEFAULT_SEASON below) while scripts/ingest-fpl.ts
// ingests the 2026/27 bootstrap-static/ into the same public.teams table, and
// the two season's ids disagree for most clubs. Verified live on 15 Aug 2026
// by fetching both season files directly from the source:
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026/teams.csv
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/teams.csv
// Only 5 of the 20 team ids referred to the same club in both files — e.g.
// id 3 was Burnley (code 90) in 2025-2026 but Bournemouth (code 91) in
// 2026-2027; id 12 was Liverpool (code 14) then Ipswich Town (code 40).
// `teams.code`, by contrast, was identical for all 17 clubs present in both
// files, with the same `elo` value against that code in both. So this job
// never inserts a team row and never writes identity columns (name,
// short_name, code, pulse_id, any strength_*) — scripts/ingest-fpl.ts alone
// owns team identity (upserted on id, which is stable within one FPL
// season). This job only reads `id, code` off existing public.teams rows and
// updates `elo` on whichever row's `code` matches the CSV, exactly as
// player_match_stats.player_code already does one level up.
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
// Only the two columns this job actually reads (ticket #32) — it no longer
// touches id/name/short_name, so requiring them here would be a stale guard
// against columns nothing downstream of this file depends on any more.
export const TEAMS_REQUIRED_COLUMNS = ['code', 'elo']
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
// teams.elo — matched on code, never id (ticket #32). See the file header
// for the "because". This job never inserts a team row and writes exactly
// one column (elo, plus updated_at) on rows that already exist.
// ============================================================================

// A row read back from public.teams — just enough to join the CSV's code
// onto the table's id, which is what the update is actually keyed on.
export interface TeamIdentityRow {
  id: number
  code: number | null
}

export interface EloByCodeResult {
  // code -> elo, built only from rows whose elo cell parses as a number.
  eloByCode: Map<number, number>
  // Every code seen in the CSV, regardless of whether its elo parsed —
  // used to distinguish "code present but elo malformed" from "code not in
  // the CSV at all" when classifying public.teams rows below.
  seenCodes: Set<number>
  // Rows whose code parsed but whose elo cell was empty or non-numeric —
  // skipped rather than writing null over an existing rating.
  malformedElo: number
}

export function buildEloByCode(records: Array<Record<string, string>>): EloByCodeResult {
  const eloByCode = new Map<number, number>()
  const seenCodes = new Set<number>()
  let malformedElo = 0
  for (const record of records) {
    const code = toInt(record.code)
    if (code === null) continue // can't join this row onto anything; not a countable DoD case
    seenCodes.add(code)
    const elo = toNumeric(record.elo)
    if (elo === null) {
      malformedElo++
      continue
    }
    eloByCode.set(code, elo)
  }
  return { eloByCode, seenCodes, malformedElo }
}

async function fetchTeamIdentities(supabase: SupabaseClient): Promise<TeamIdentityRow[]> {
  const { data, error } = await supabase.from('teams').select('id, code')
  if (error) {
    if (isMissingTable(error, 'teams')) {
      throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
    }
    throw new IngestError(`reading teams failed: ${error.message}`)
  }
  return (data ?? []) as TeamIdentityRow[]
}

export interface TeamEloUpdatePlan {
  updates: Array<{ id: number; elo: number }>
  // CSV codes with a parsed elo but no matching row in public.teams — a club
  // relegated out of the current season. Skipped, not inserted.
  codesNotInTeams: number
  // public.teams rows whose code has no entry anywhere in the CSV (or whose
  // code is null) — left untouched.
  teamsCodesNotInCsv: number
  // A code shared by more than one public.teams row. Ambiguous — neither row
  // is updated, and this is not the same bucket as codesNotInTeams/
  // teamsCodesNotInCsv since it's a fault in the table, not a set mismatch.
  duplicateCodeConflicts: number
}

export function planTeamEloUpdates(existingTeams: TeamIdentityRow[], elo: EloByCodeResult): TeamEloUpdatePlan {
  const teamsByCode = new Map<number, TeamIdentityRow[]>()
  let teamsCodesNotInCsv = 0 // seeded below with null-code rows, then added to per-code below
  for (const team of existingTeams) {
    if (team.code === null) {
      teamsCodesNotInCsv++
      continue
    }
    const existing = teamsByCode.get(team.code)
    if (existing) existing.push(team)
    else teamsByCode.set(team.code, [team])
  }

  const updates: Array<{ id: number; elo: number }> = []
  let codesNotInTeams = 0
  let duplicateCodeConflicts = 0

  const allCodes = new Set<number>([...teamsByCode.keys(), ...elo.seenCodes])
  for (const code of allCodes) {
    const teams = teamsByCode.get(code) ?? []
    const inCsv = elo.seenCodes.has(code)

    if (teams.length === 0) {
      if (inCsv) codesNotInTeams++
      continue
    }
    if (!inCsv) {
      teamsCodesNotInCsv += teams.length
      continue
    }
    if (teams.length > 1) {
      duplicateCodeConflicts++
      continue
    }
    const value = elo.eloByCode.get(code)
    if (value !== undefined) {
      updates.push({ id: teams[0].id, elo: value })
    }
    // else: code is in the CSV but its elo cell was malformed — already
    // counted in elo.malformedElo above; no update, nothing else to count.
  }

  return { updates, codesNotInTeams, teamsCodesNotInCsv, duplicateCodeConflicts }
}

// One UPDATE per matched row, never an upsert — every id here was just read
// back from public.teams, so there is never a row to insert, only rows to
// leave alone or correct. `code`, `name`, `short_name`, `pulse_id` and every
// `strength_*` column are never referenced past this point.
async function applyTeamEloUpdates(
  supabase: SupabaseClient,
  updates: Array<{ id: number; elo: number }>
): Promise<number> {
  const updatedAt = new Date().toISOString()
  for (const update of updates) {
    const { error } = await supabase
      .from('teams')
      .update({ elo: update.elo, updated_at: updatedAt })
      .eq('id', update.id)
    if (error) {
      if (isMissingTable(error, 'teams')) {
        throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
      }
      throw new IngestError(`update of teams.elo failed for team id ${update.id}: ${error.message}`)
    }
  }
  return updates.length
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
          codesNotInTeams: 0,
          teamsCodesNotInCsv: 0,
          duplicateCodeConflicts: 0,
          malformedEloRows: 0,
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
    const eloResult = buildEloByCode(teamRecords)
    const existingTeams = await fetchTeamIdentities(supabase)
    const teamEloPlan = planTeamEloUpdates(existingTeams, eloResult)
    const teamsUpdated = await applyTeamEloUpdates(supabase, teamEloPlan.updates)
    if (teamEloPlan.duplicateCodeConflicts > 0) {
      console.warn(
        `${JOB_NAME}: ${teamEloPlan.duplicateCodeConflicts} team code(s) matched more than one ` +
          'public.teams row — left unchanged rather than guessing which row was meant'
      )
    }

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
      `${JOB_NAME}: season ${season} — ${teamsUpdated} team(s) updated (elo, matched on code), ` +
      `${teamEloPlan.codesNotInTeams} CSV code(s) not in public.teams, ` +
      `${teamEloPlan.teamsCodesNotInCsv} public.teams row(s) with no matching CSV code, ` +
      `${teamEloPlan.duplicateCodeConflicts} duplicate-code conflict(s), ` +
      `${eloResult.malformedElo} row(s) with a malformed elo cell skipped, ` +
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
        codesNotInTeams: teamEloPlan.codesNotInTeams,
        teamsCodesNotInCsv: teamEloPlan.teamsCodesNotInCsv,
        duplicateCodeConflicts: teamEloPlan.duplicateCodeConflicts,
        malformedEloRows: eloResult.malformedElo,
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
