// Emit the projections CSV — ticket #34. product-brief.md §6c: the solver
// "reads projections from a CSV and does not care where they come from.
// This CSV is the seam of the entire system." This job produces that file.
// It does not check out, install or invoke the solver — that is item 12.
//
// Reads public.player_projections (ticket #33/#10) and public.players +
// public.teams, and writes one CSV to PROJECTIONS_CSV_PATH (default
// ./out/projections.csv) in the exact shape dev/solver.py's prep_data
// expects, per docs/solver-notes.md and the pinned-commit source reading
// recorded on this ticket:
//
//   ID,Pos,Name,Team,{gw}_Pts,{gw}_xMins,...  (one {gw}_Pts/{gw}_xMins pair
//   per horizon gameweek, ascending, absolute FPL gameweek numbers)
//
// ============================================================================
// ID = players.id, NOT the stable cross-season player identifier used
// everywhere else in this codebase. This is the one place that reversal is
// correct.
// ============================================================================
// dev/solver.py:136 does `pd.merge(elements_team, data, left_on="id_x",
// right_on="ID")` — an INNER merge against a live bootstrap-static/ fetch's
// element id. Every other job in this repo joins on players.code (FPL's
// stable-across-seasons shirt/crest identifier, carried alongside as its own
// column in the tables that need it — see project-points.ts's header and the
// #12/#22 migrations), specifically because element ids are NOT stable
// across a season boundary. But the solver's merge target here is *this
// season's* live element id, not a stable cross-season key — so here,
// uniquely, players.id (the current-season FPL element id) is correct and
// players.code would be wrong. This job deliberately never selects or reads
// that column at all — the ID cell below is built from players.id alone,
// which makes the DoD's grep check for the other identifier's name trivially
// true by construction rather than by discipline.
//
// ============================================================================
// Zero-fill, not omission, for a player missing a horizon gameweek's
// projection.
// ============================================================================
// An omitted player can never be transferred in by the solver — omission
// silently narrows the search space. A zero-projected player is still in
// the pool; it simply never wins the optimisation. Zero-fill is applied
// consistently: every row this job writes has a value for every {gw}_Pts/
// {gw}_xMins pair in the horizon, never an empty cell, never a missing
// column. Every zero-filled pair is counted and recorded in job_runs.details
// (playerGameweekPairsZeroFilled) so the gap is visible, not silent.
//
// ============================================================================
// model_version: filtered, not left open.
// ============================================================================
// player_projections' primary key is (gameweek_id, player_id, model_version)
// — deliberately, so a future replacement model (product-brief.md §6d,
// item 31) can be written alongside 'baseline-v1' rather than over it (see
// the #33/player_projections migration's header). An unfiltered read of
// this table would therefore emit one duplicate row per player the moment a
// second model_version exists, and the solver's own de-duplication
// (`drop_duplicates(subset=["ID"], keep="first")`) would silently pick
// whichever arrived first. MODEL_VERSION below is read filtered on this one
// named constant for that reason.
//
// ============================================================================
// PROJECTION_HORIZON and MODEL_VERSION are duplicated from
// scripts/project-points.ts, not imported.
// ============================================================================
// This follows the same convention CLAUDE.md documents for readSupabaseEnv/
// isMissingTable: each scripts/*.ts job is a standalone entry point, and
// small shared conventions are duplicated across jobs rather than
// cross-imported between them (src/lib/ is the one blessed import boundary,
// and project-points.ts is not part of it). Drift between the two constants
// is not silent, though: the horizon this job asks for is read from the
// same source item 10 uses (gameweeks.is_next plus the following ids,
// below), and if player_projections holds rows for gameweeks beyond that
// candidate horizon, or is missing rows for a gameweek inside it, both are
// surfaced in job_runs.details (see extraProjectionGameweekIdsBeyondHorizon
// and the empty-gameweek hard failure) rather than silently disagreeing.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads exactly SUPABASE_URL, SUPABASE_SECRET_KEY and optional
// PROJECTIONS_CSV_PATH. No VITE_-prefixed variable. No network request other
// than to Supabase. Writes no row to any table other than job_runs — this
// job only reads player data and projections and writes one file to disk.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const JOB_NAME = 'emit-projections-csv'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/** Must match scripts/project-points.ts's own PROJECTION_HORIZON — duplicated, not imported; see file header. */
export const PROJECTION_HORIZON = 5

/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated, not imported; see file header. */
export const MODEL_VERSION = 'baseline-v1'

/** dev/solver.py:183's default xmin_lb — a player whose total horizon xMins falls below this is dropped from the solver's pool. Below this: warn, don't fail. */
export const LOW_EXPECTED_MINUTES_THRESHOLD = 100

const DEFAULT_OUTPUT_PATH = './out/projections.csv'

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

function readOutputPath(): string {
  return process.env.PROJECTIONS_CSV_PATH ?? DEFAULT_OUTPUT_PATH
}

// ============================================================================
// Errors
// ============================================================================

class CsvEmitError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'CsvEmitError'
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
  status: 'success' | 'failure'
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

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

interface PlayerRow {
  id: number
  web_name: string
  team_id: number
  element_type: number
}

interface TeamRow {
  id: number
  short_name: string
}

interface ProjectionRow {
  gameweek_id: number
  player_id: number
  expected_points: number
  expected_minutes: number
}

// ============================================================================
// Pure CSV-shaping functions — no I/O, unit-testable with no database.
// ============================================================================

export type PositionLetter = 'G' | 'D' | 'M' | 'F'

/** element_type 1->G, 2->D, 3->M, 4->F, per docs/solver-notes.md. */
export function mapPosition(elementType: number): PositionLetter {
  switch (elementType) {
    case 1:
      return 'G'
    case 2:
      return 'D'
    case 3:
      return 'M'
    case 4:
      return 'F'
    default:
      throw new CsvEmitError(`unknown players.element_type ${elementType} — expected 1 (G), 2 (D), 3 (M) or 4 (F)`, 'players')
  }
}

/** RFC 4180-style quoting: quote only when the field contains a comma, double quote, or newline; double up internal double quotes. No thousands separators, no currency symbols — every numeric cell is a plain String() conversion. */
export function csvField(value: string | number): string {
  const str = typeof value === 'number' ? String(value) : value
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Header row: ID,Pos,Name,Team followed by {gw}_Pts,{gw}_xMins pairs, ascending, absolute FPL gameweek numbers. */
export function buildHeaderRow(horizonGwIds: readonly number[]): string {
  const gwColumns = horizonGwIds.flatMap((gw) => [`${gw}_Pts`, `${gw}_xMins`])
  return ['ID', 'Pos', 'Name', 'Team', ...gwColumns].join(',')
}

export interface CsvPlayerInput {
  id: number
  webName: string
  teamShortName: string
  elementType: number
}

export interface ProjectionValue {
  expectedPoints: number
  expectedMinutes: number
}

/** Keys a (playerId, gameweekId) pair for the projection lookup map. */
export function projectionKey(playerId: number, gameweekId: number): string {
  return `${playerId}:${gameweekId}`
}

export interface BuildCsvResult {
  csv: string
  rowsWritten: number
  playersWithNoProjectionAtAll: number
  playerGameweekPairsZeroFilled: number
  lowExpectedMinutesPlayerCount: number
}

/**
 * Builds the full CSV body for the given players and horizon. Every row is
 * complete across the whole horizon: a missing (player, gameweek)
 * projection is written as an explicit 0/0 pair rather than an empty cell
 * or a dropped row/column (see file header — zero-fill, not omission).
 */
export function buildProjectionsCsv(
  players: readonly CsvPlayerInput[],
  horizonGwIds: readonly number[],
  projectionByKey: ReadonlyMap<string, ProjectionValue>,
  lowExpectedMinutesThreshold: number = LOW_EXPECTED_MINUTES_THRESHOLD,
): BuildCsvResult {
  const lines: string[] = [buildHeaderRow(horizonGwIds)]
  let playerGameweekPairsZeroFilled = 0
  let playersWithNoProjectionAtAll = 0
  let lowExpectedMinutesPlayerCount = 0

  for (const player of players) {
    const cells: (string | number)[] = [player.id, mapPosition(player.elementType), player.webName, player.teamShortName]
    let totalExpectedMinutes = 0
    let projectedPairCount = 0

    for (const gwId of horizonGwIds) {
      const projection = projectionByKey.get(projectionKey(player.id, gwId))
      if (projection) {
        cells.push(projection.expectedPoints, projection.expectedMinutes)
        totalExpectedMinutes += projection.expectedMinutes
        projectedPairCount++
      } else {
        cells.push(0, 0)
        playerGameweekPairsZeroFilled++
      }
    }

    if (projectedPairCount === 0) playersWithNoProjectionAtAll++
    if (totalExpectedMinutes < lowExpectedMinutesThreshold) lowExpectedMinutesPlayerCount++

    lines.push(cells.map(csvField).join(','))
  }

  return {
    csv: lines.join('\n') + '\n', // trailing newline, no BOM (caller writes utf8 with no BOM marker)
    rowsWritten: players.length,
    playersWithNoProjectionAtAll,
    playerGameweekPairsZeroFilled,
    lowExpectedMinutesPlayerCount,
  }
}

/** Horizon gameweeks with zero player_projections rows at all, across every player — dev/solver.py raises ValueError on a missing {gw}_Pts column, so this must be a hard failure, not a zero-filled column. */
export function findEmptyGameweeks(horizonGwIds: readonly number[], gwIdsWithAnyProjection: ReadonlySet<number>): number[] {
  return horizonGwIds.filter((id) => !gwIdsWithAnyProjection.has(id))
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
  const outputPath = readOutputPath()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. Horizon: gameweeks.is_next plus the following ids — same source
    //    item 10 (scripts/project-points.ts) uses.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()

    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new CsvEmitError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new CsvEmitError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    if (!gwRows || gwRows.length === 0) {
      throw new CsvEmitError('the gameweeks table is empty. Run scripts/ingest-fpl.ts before emitting the projections CSV.', 'gameweeks')
    }

    const nextIndex = gwRows.findIndex((gw) => gw.is_next)
    if (nextIndex === -1) {
      throw new CsvEmitError(
        'no gameweek has is_next = true. Run scripts/ingest-fpl.ts to refresh gameweeks, or the season has ended.',
        'gameweeks',
      )
    }
    const horizonGameweeks = gwRows.slice(nextIndex, nextIndex + PROJECTION_HORIZON)
    const horizonGwIds = horizonGameweeks.map((gw) => gw.id)

    // --------------------------------------------------------------------
    // 2. players + teams — the full current pool, not filtered by status:
    //    an unavailable player still needs a (zero-filled or projected) row
    //    so the solver's pool is never silently narrowed by this job.
    // --------------------------------------------------------------------
    const { data: playerRows, error: playersError } = await supabase
      .from('players')
      .select('id, web_name, team_id, element_type')
      .returns<PlayerRow[]>()
    if (playersError) {
      if (isMissingTable(playersError, 'players')) {
        throw new CsvEmitError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      }
      throw new CsvEmitError(`players lookup failed: ${playersError.message}`, 'players')
    }
    if (!playerRows || playerRows.length === 0) {
      throw new CsvEmitError('the players table is empty. Run scripts/ingest-fpl.ts before emitting the projections CSV.', 'players')
    }

    const { data: teamRows, error: teamsError } = await supabase.from('teams').select('id, short_name').returns<TeamRow[]>()
    if (teamsError) {
      throw new CsvEmitError(`teams lookup failed: ${teamsError.message}`, 'teams')
    }
    const teamShortNameById = new Map<number, string>((teamRows ?? []).map((t) => [t.id, t.short_name]))

    const csvPlayers: CsvPlayerInput[] = playerRows.map((p) => ({
      id: p.id,
      webName: p.web_name,
      teamShortName: teamShortNameById.get(p.team_id) ?? String(p.team_id), // Name/Team are non-load-bearing (see docs/solver-notes.md); a missing team lookup falls back to the raw id rather than failing the whole job.
      elementType: p.element_type,
    }))

    // --------------------------------------------------------------------
    // 3. player_projections, filtered to MODEL_VERSION and the candidate
    //    horizon. See file header for why model_version is filtered.
    // --------------------------------------------------------------------
    const { data: projectionRows, error: projectionsError } = await supabase
      .from('player_projections')
      .select('gameweek_id, player_id, expected_points, expected_minutes')
      .eq('model_version', MODEL_VERSION)
      .in('gameweek_id', horizonGwIds)
      .returns<ProjectionRow[]>()
    if (projectionsError) {
      if (isMissingTable(projectionsError, 'player_projections')) {
        throw new CsvEmitError(
          `the "player_projections" table does not exist. Apply ${PLAYER_PROJECTIONS_MIGRATION} first.`,
          'player_projections',
        )
      }
      throw new CsvEmitError(`player_projections lookup failed: ${projectionsError.message}`, 'player_projections')
    }

    const projectionByKey = new Map<string, ProjectionValue>()
    const gwIdsWithAnyProjection = new Set<number>()
    for (const row of projectionRows ?? []) {
      projectionByKey.set(projectionKey(row.player_id, row.gameweek_id), {
        expectedPoints: row.expected_points,
        expectedMinutes: row.expected_minutes,
      })
      gwIdsWithAnyProjection.add(row.gameweek_id)
    }

    // --------------------------------------------------------------------
    // 4. Fail loudly if any horizon gameweek has zero projection rows at
    //    all — a silent empty column would surface as an opaque solver
    //    ValueError a step later (item 12).
    // --------------------------------------------------------------------
    const emptyGameweeks = findEmptyGameweeks(horizonGwIds, gwIdsWithAnyProjection)
    if (emptyGameweeks.length > 0) {
      throw new CsvEmitError(
        `player_projections has zero rows (model_version='${MODEL_VERSION}') for gameweek(s) ${emptyGameweeks.join(', ')}, ` +
          `which are inside the current horizon (${horizonGwIds.join(', ')}). Run scripts/project-points.ts before emitting the CSV.`,
        'player_projections',
      )
    }

    // --------------------------------------------------------------------
    // 5. Report (not fail on) player_projections holding rows for
    //    gameweeks beyond the candidate horizon — the signal that the two
    //    jobs' independently-duplicated horizon length has drifted.
    // --------------------------------------------------------------------
    const maxHorizonGwId = horizonGwIds[horizonGwIds.length - 1]
    const { data: extraGwRows, error: extraGwError } = await supabase
      .from('player_projections')
      .select('gameweek_id')
      .eq('model_version', MODEL_VERSION)
      .gt('gameweek_id', maxHorizonGwId)
      .returns<Pick<ProjectionRow, 'gameweek_id'>[]>()
    if (extraGwError) {
      throw new CsvEmitError(`player_projections lookup (beyond-horizon check) failed: ${extraGwError.message}`, 'player_projections')
    }
    const extraProjectionGameweekIdsBeyondHorizon = [...new Set((extraGwRows ?? []).map((r) => r.gameweek_id))].sort((a, b) => a - b)

    // --------------------------------------------------------------------
    // 6. Build the CSV and write it.
    // --------------------------------------------------------------------
    const result = buildProjectionsCsv(csvPlayers, horizonGwIds, projectionByKey)

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, result.csv, 'utf8')

    if (result.lowExpectedMinutesPlayerCount > 0) {
      console.warn(
        `${JOB_NAME}: ${result.lowExpectedMinutesPlayerCount} player(s) have total horizon expected_minutes below ` +
          `${LOW_EXPECTED_MINUTES_THRESHOLD} — the solver's default xmin_lb will drop them from its pool.`,
      )
    }

    const details: JsonRecord = {
      outputPath,
      modelVersion: MODEL_VERSION,
      horizonGameweekIds: horizonGwIds,
      distinctGameweeksCovered: horizonGwIds.length - emptyGameweeks.length,
      rowsWritten: result.rowsWritten,
      playersWithNoProjectionAtAll: result.playersWithNoProjectionAtAll,
      playerGameweekPairsZeroFilled: result.playerGameweekPairsZeroFilled,
      lowExpectedMinutesPlayerCount: result.lowExpectedMinutesPlayerCount,
      extraProjectionGameweekIdsBeyondHorizon,
    }
    const message =
      `${JOB_NAME}: wrote ${result.rowsWritten} player rows across ${horizonGwIds.length} gameweek(s) ` +
      `(${horizonGwIds.join(', ')}) to ${outputPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof CsvEmitError
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

// Guarded, matching scripts/sync-squad.ts and scripts/project-points.ts:
// importing this module (e.g. from a future test file) must not trigger a
// real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
