// Store the solver's output — ticket #41 (feature-list item 12, the second
// half). Runs after the solve step in .github/workflows/solver-run.yml. This
// script never invokes the solver and never regenerates its input — it reads
// what scripts/build-solver-input.ts wrote (the config, to recover the
// horizon/datasource it derived) and what the bare `run/solve.py` step
// produced (its captured stdout+stderr log, and any results CSV(s) under
// solver/data/results/), and writes the result to Supabase.
//
// It does not interpret the result — no recommendation, no Plan A/B/C, no
// confidence band, no captain advice in words, no stored reasoning. Item 13
// reads what this ticket stores.
//
// ============================================================================
// Why the solve's own status has to come from the captured log.
// ============================================================================
// dev/solver.py's solve_multi_period_fpl(), at the pinned commit, never
// checks HiGHS's own model status before reading out a solution — it calls
// val() on every decision variable unconditionally. Verified directly by
// running the pinned solver end-to-end, deliberately, against three
// outcomes:
//   - a normal solve: exits 0, HiGHS prints "Status            Optimal",
//     writes a results CSV.
//   - a solve that hits its time limit but has a feasible incumbent: exits
//     0, HiGHS prints "Status            Time limit reached" with a nonzero
//     Gap, STILL writes a results CSV — this is the "non-optimal but
//     usable" case product-brief.md §6c requires be stored, and stored as
//     non-optimal.
//   - a solve that hits its time limit with NO incumbent, or a genuinely
//     infeasible model: exits 1. HiGHS still prints its Status line
//     ("Time limit reached" with Solution status "-", or "Infeasible")
//     before run/solve.py crashes with a KeyError trying to sort an empty
//     picks DataFrame — no results CSV is written.
// The only reliable signal for which of these happened is therefore the
// HiGHS "Solving report" block in the captured log, not the process's exit
// code (which is 0 in two of the three cases above) and not "did a results
// CSV appear" alone (which cannot distinguish infeasible from a genuine
// no-incumbent timeout). parseSolverLog()/classifySolve() below encode
// exactly this, and are pure and unit-tested against fixtures captured from
// those three real runs.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, plus SOLVER_CONFIG_PATH,
// SOLVER_LOG_PATH and SOLVER_RESULTS_DIR (all optional, defaults below).
// Never deletes a row (`.delete(` does not appear in this file) — solver_runs
// is inserted (append-only, one row per execution, matching job_runs' own
// shape) and solver_picks is upserted, keyed on (solution_index, gameweek_id,
// player_id), so a re-run of the same gameweek replaces that gameweek's
// picks in place rather than accumulating duplicates.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import { readdir, readFile } from 'node:fs/promises'

const JOB_NAME = 'solver-run'
const SOLVER_OUTPUT_MIGRATION = 'supabase/migrations/20260816090000_solver_output.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

const DEFAULT_SOLVER_CONFIG_PATH = './solver/data/solver-config.json'
const DEFAULT_SOLVER_LOG_PATH = './solver/solve.log'
const DEFAULT_SOLVER_RESULTS_DIR = './solver/data/results'

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
      `${JOB_NAME}/store-solver-output: required environment variables are not set. ` +
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

interface PathEnv {
  solverConfigPath: string
  solverLogPath: string
  solverResultsDir: string
}

function readPathEnv(): PathEnv {
  return {
    solverConfigPath: process.env.SOLVER_CONFIG_PATH ?? DEFAULT_SOLVER_CONFIG_PATH,
    solverLogPath: process.env.SOLVER_LOG_PATH ?? DEFAULT_SOLVER_LOG_PATH,
    solverResultsDir: process.env.SOLVER_RESULTS_DIR ?? DEFAULT_SOLVER_RESULTS_DIR,
  }
}

// ============================================================================
// Errors
// ============================================================================

export class StoreOutputError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'StoreOutputError'
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
      console.error(`${JOB_NAME}/store-solver-output: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure functions — no I/O, unit-testable against log/CSV fixtures with no
// database and no solver. See the file header for what each of the three
// real outcomes actually looks like.
// ============================================================================

export interface ParsedSolverLog {
  /** Verbatim HiGHS "Status" line from the "Solving report" block, e.g. "Optimal", "Time limit reached", "Infeasible". Null if the log never reached that block at all (a crash before solving — install/data problem, not a solve outcome). */
  status: string | null
  /** HiGHS's own "Primal bound" — null when no incumbent was found ("-inf"). */
  objectiveValue: number | null
  /** HiGHS's own total "Timing" figure, in seconds — null if not found. */
  secondsTaken: number | null
  /** From "Filtered player pool from X to Y players" — the pool size AFTER prep_data's xmin_lb/ev filters, i.e. what actually entered the solve. Null if the line never appeared (crashed before that point). */
  poolSizeAfter: number | null
}

export function parseSolverLog(logText: string): ParsedSolverLog {
  const statusMatch = /^[ \t]*Status[ \t]+(.+?)[ \t]*$/m.exec(logText)
  const primalMatch = /^[ \t]*Primal bound[ \t]+(-?[\d.]+|-?inf)[ \t]*$/m.exec(logText)
  const timingMatch = /^[ \t]*Timing[ \t]+([\d.]+)/m.exec(logText)
  const poolMatch = /Filtered player pool from \d+ to (\d+) players/.exec(logText)

  const objectiveValue = primalMatch && !primalMatch[1].includes('inf') ? Number(primalMatch[1]) : null

  return {
    status: statusMatch ? statusMatch[1].trim() : null,
    objectiveValue,
    secondsTaken: timingMatch ? Number(timingMatch[1]) : null,
    poolSizeAfter: poolMatch ? Number(poolMatch[1]) : null,
  }
}

export type SolveOutcome =
  | { kind: 'success'; solverStatus: string; isOptimal: boolean }
  | { kind: 'infeasible'; solverStatus: string }
  | { kind: 'no_incumbent'; solverStatus: string }
  | { kind: 'crashed' }

/**
 * Classifies what actually happened from the log's Status line plus whether a results CSV
 * was found — see the file header for why BOTH signals are required (exit code alone cannot
 * distinguish these). A status other than exactly "Optimal" is NEVER classified as optimal,
 * even on success — product-brief.md §6c: "a timed-out solution is usable but must be
 * labelled", never presented as a proven optimum.
 */
export function classifySolve(status: string | null, resultsCsvFound: boolean): SolveOutcome {
  if (status === null) return { kind: 'crashed' }
  if (/infeasible/i.test(status)) return { kind: 'infeasible', solverStatus: status }
  if (resultsCsvFound) return { kind: 'success', solverStatus: status, isOptimal: status === 'Optimal' }
  return { kind: 'no_incumbent', solverStatus: status }
}

export interface SolverPickRow {
  solution_index: number
  gameweek_id: number
  player_id: number
  player_code: number | null
  is_lineup: boolean
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
  is_transfer_in: boolean
  is_transfer_out: boolean
  expected_points: number
}

/**
 * Maps one row of the solver's results CSV (columns per run/solve.py's picks.append() at the
 * pinned commit: id, week, name, pos, type, team, buy_price, sell_price, xP, xMin, squad,
 * lineup, bench, captain, vicecaptain, transfer_in, transfer_out, multiplier, xp_cont, chip,
 * iter, ft, transfer_count — verified by reading dev/solver.py's source and by an actual run)
 * onto one solver_picks row. bench is -1 for a lineup player, 0-3 for bench (0 being the
 * reserve GK's slot) — shifted by +1 to match squad_picks.bench_order's 1-4 convention.
 */
export function mapResultsCsvRow(row: Record<string, string>, playerCode: number | null): SolverPickRow {
  const benchRaw = Number(row.bench)
  return {
    solution_index: Number(row.iter),
    gameweek_id: Number(row.week),
    player_id: Number(row.id),
    player_code: playerCode,
    is_lineup: row.lineup === '1',
    bench_order: benchRaw >= 0 ? benchRaw + 1 : null,
    is_captain: row.captain === '1',
    is_vice_captain: row.vicecaptain === '1',
    is_transfer_in: row.transfer_in === '1',
    is_transfer_out: row.transfer_out === '1',
    expected_points: Number(row.xP),
  }
}

// ============================================================================
// Row shapes read from Supabase
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

interface PlayerCodeRow {
  id: number
  code: number | null
}

interface SolverConfigFile {
  horizon: number
  datasource: string
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
  const paths = readPathEnv()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. The config scripts/build-solver-input.ts wrote — recovers horizon
    //    and datasource without re-deriving them a second, possibly
    //    inconsistent, way.
    // --------------------------------------------------------------------
    let configFile: SolverConfigFile
    let fullConfig: JsonRecord
    try {
      const configText = await readFile(paths.solverConfigPath, 'utf8')
      const parsed = JSON.parse(configText) as Partial<SolverConfigFile> & JsonRecord
      if (typeof parsed.horizon !== 'number' || typeof parsed.datasource !== 'string') {
        throw new StoreOutputError(`solver config at ${paths.solverConfigPath} is missing "horizon" or "datasource".`, 'config')
      }
      configFile = { horizon: parsed.horizon, datasource: parsed.datasource }
      // The FULL parsed config is what solver_runs.config stores (reproducibility/diffing —
      // see the migration's own comment), not just the two fields this script needs typed
      // access to.
      fullConfig = parsed
    } catch (err) {
      if (err instanceof StoreOutputError) throw err
      throw new StoreOutputError(
        `solver config not found or unreadable at ${paths.solverConfigPath}. scripts/build-solver-input.ts must run first.`,
        'config',
      )
    }

    // --------------------------------------------------------------------
    // 2. Target gameweek — same anchor as build-solver-input.ts.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new StoreOutputError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new StoreOutputError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const nextGw = (gwRows ?? []).find((gw) => gw.is_next)
    if (!nextGw) {
      throw new StoreOutputError('no gameweek has is_next = true.', 'gameweeks')
    }

    // --------------------------------------------------------------------
    // 3. The captured log — the sole source of truth for what the solver
    //    actually did. See the file header for why.
    // --------------------------------------------------------------------
    let logText: string
    try {
      logText = await readFile(paths.solverLogPath, 'utf8')
    } catch {
      throw new StoreOutputError(
        `solver log not found at ${paths.solverLogPath} — the solve step may not have run, or did not capture its output there.`,
        'solver_log',
      )
    }
    const parsedLog = parseSolverLog(logText)

    // --------------------------------------------------------------------
    // 4. Results CSV(s) — every file matching `${datasource}_*.csv` under
    //    the results directory. Normally exactly one (num_iterations is 1
    //    for this ticket — item 13 raises it), but every file produced is
    //    read, not just the newest, matching the workflow's own "every
    //    results CSV produced" artifact-upload requirement.
    // --------------------------------------------------------------------
    let resultFilenames: string[] = []
    try {
      const entries = await readdir(paths.solverResultsDir)
      resultFilenames = entries.filter((f) => f.startsWith(`${configFile.datasource}_`) && f.endsWith('.csv')).sort()
    } catch {
      resultFilenames = []
    }

    const outcome = classifySolve(parsedLog.status, resultFilenames.length > 0)

    const baseDetails: JsonRecord = {
      gameweekId: nextGw.id,
      horizon: configFile.horizon,
      datasource: configFile.datasource,
      solverStatus: parsedLog.status,
      objectiveValue: parsedLog.objectiveValue,
      secondsTaken: parsedLog.secondsTaken,
      poolSizeAfter: parsedLog.poolSizeAfter,
      resultFileCount: resultFilenames.length,
    }

    // Every reachable outcome except a full crash gives us enough to log a
    // solver_runs row — solver_runs is the append-only audit trail (see the
    // migration), so even an infeasible or no-incumbent attempt is worth
    // recording alongside its config. Its id is captured so a successful
    // solve's solver_picks rows can be traced back to the run that produced
    // them (solver_picks.run_id).
    let runId: number | null = null
    if (outcome.kind !== 'crashed') {
      const { data: runRow, error: runInsertError } = await supabase
        .from('solver_runs')
        .insert({
          gameweek_id: nextGw.id,
          solver_status: outcome.solverStatus,
          objective_value: parsedLog.objectiveValue,
          horizon: configFile.horizon,
          pool_size: parsedLog.poolSizeAfter,
          seconds_taken: parsedLog.secondsTaken,
          config: fullConfig,
        })
        .select('id')
        .single()
      if (runInsertError) {
        if (isMissingTable(runInsertError, 'solver_runs')) {
          throw new StoreOutputError(`the "solver_runs" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_runs')
        }
        throw new StoreOutputError(`solver_runs insert failed: ${runInsertError.message}`, 'solver_runs')
      }
      runId = (runRow as { id: number } | null)?.id ?? null
    }

    if (outcome.kind === 'crashed') {
      throw new StoreOutputError(
        'the solver produced no HiGHS status output at all — it crashed before reaching a solve. See the captured log artifact ' +
          '(solver-run-log) for the underlying error.',
        'solve',
      )
    }

    if (outcome.kind === 'infeasible') {
      throw new StoreOutputError(
        `the solve for gameweek ${nextGw.id} came back infeasible (status: "${outcome.solverStatus}"). This almost always means ` +
          `the registered squad does not reconcile with live FPL data — re-check the stored squad for gameweek ${nextGw.id} ` +
          '(squads/squad_picks) before re-running.',
        'solve',
      )
    }

    if (outcome.kind === 'no_incumbent') {
      throw new StoreOutputError(
        `the solver hit its time limit for gameweek ${nextGw.id} without finding any usable solution (status: ` +
          `"${outcome.solverStatus}", no results file was written). Consider raising the solver's time limit, or check for data ` +
          'problems in the squad or projections.',
        'solve',
      )
    }

    // --------------------------------------------------------------------
    // 5. Success (optimal or non-optimal-but-usable) — parse every results
    //    CSV found and upsert solver_picks.
    // --------------------------------------------------------------------
    const allRows: Array<Record<string, string>> = []
    for (const filename of resultFilenames) {
      const csvText = await readFile(`${paths.solverResultsDir}/${filename}`, 'utf8')
      const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
      allRows.push(...records)
    }

    const playerIds = [...new Set(allRows.map((r) => Number(r.id)))]
    const { data: playerRows, error: playerError } = await supabase
      .from('players')
      .select('id, code')
      .in('id', playerIds)
      .returns<PlayerCodeRow[]>()
    if (playerError) {
      throw new StoreOutputError(`players lookup failed: ${playerError.message}`, 'players')
    }
    const codeByPlayerId = new Map<number, number | null>((playerRows ?? []).map((p) => [p.id, p.code]))

    const picks = allRows.map((row) => ({ ...mapResultsCsvRow(row, codeByPlayerId.get(Number(row.id)) ?? null), run_id: runId }))

    const { error: pickUpsertError } = await supabase
      .from('solver_picks')
      .upsert(picks, { onConflict: 'solution_index,gameweek_id,player_id' })
    if (pickUpsertError) {
      if (isMissingTable(pickUpsertError, 'solver_picks')) {
        throw new StoreOutputError(`the "solver_picks" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_picks')
      }
      throw new StoreOutputError(`solver_picks upsert failed: ${pickUpsertError.message}`, 'solver_picks')
    }

    const optimalityNote = outcome.isOptimal ? 'proven optimal' : `NOT proven optimal (status: "${outcome.solverStatus}") — stored as such`
    const message =
      `${JOB_NAME}/store-solver-output: solve for gameweek ${nextGw.id} completed, ${optimalityNote}. ` +
      `Objective ${parsedLog.objectiveValue ?? 'unknown'}, ${picks.length} pick row(s) stored across ${resultFilenames.length} file(s).`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details: { ...baseDetails, picksStored: picks.length }, startedAt })
  } catch (err) {
    const message =
      err instanceof StoreOutputError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}/store-solver-output: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}/store-solver-output: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module (e.g.
// from a test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}/store-solver-output: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
