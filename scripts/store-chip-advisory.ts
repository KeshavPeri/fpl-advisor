// Store the chip advisory — ticket #126 (feature-list item 27), unblocked by
// the chip probe (#114). Runs after BOTH solves in
// .github/workflows/solver-run.yml: the normal (chip-free) solve, already
// stored by scripts/store-solver-output.ts (unmodified, out of this
// ticket's scope), and a second, chip-enabled solve this ticket adds.
//
// This script never invokes the solver and never touches the results CSV —
// everything it needs (the chip decision, the gameweek it would be played
// in, and each solution's objective score) lives in the two solves' own
// captured stdout logs, read via scripts/lib/solver-output.ts's
// parseSolverOutput(). See that module's own header for the Results-table
// parse and the per-gameweek CHIP-line cross-check it performs.
//
// ============================================================================
// Why this reads TWO log files, not one.
// ============================================================================
// The advisory is a DIFFERENCE: what a chip is worth this run, compared to
// the run without it. That baseline — the chip-free objective, per
// solution_index — is not something solver_runs stores on its own:
// solver_runs.objective_value is a single figure per execution (HiGHS's
// "Primal bound", effectively iteration 0's score), but this app's solves
// run num_iterations=3 (ticket #47), producing THREE distinct scores per
// solve, one per solution_index. Re-parsing the normal run's own log with
// the SAME parser used on the chip-enabled log is what recovers all three,
// not just the first — see scripts/lib/solver-output.ts.
//
// ============================================================================
// Never taken from different runs — the #72 trap.
// ============================================================================
// A sibling table that upserts the latest solve's picks by (solution_index,
// gameweek_id, player_id) once accumulated rows across runs with no run_id
// filter, producing a projected score of roughly double (#72). This script
// resolves exactly ONE solver_runs row — the freshest
// one for tonight's target gameweek, written moments earlier in this same
// workflow execution by store-solver-output.ts — and passes its id plus the
// SAME parsed chip-free log's solutions into buildChipAdvisoryRows() as
// plain parameters. There is no query inside that function, and no second
// chance for a different night's row to get pulled in.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads SUPABASE_URL, SUPABASE_SECRET_KEY (required), SOLVER_LOG_PATH (the
// NORMAL run's log — same default as scripts/store-solver-output.ts) and
// CHIP_SOLVER_LOG_PATH (the chip-enabled run's log, new to this ticket).
// Writes to job_runs (always) and public.chip_advisories (INSERT only —
// `.delete(` and `.upsert(` do not appear in this file; a re-run of the same
// gameweek adds new rows, matching solver_runs' own append-only shape, see
// that migration's header). Nothing this script reads or produces ever
// reaches the tables the normal transfer/captain recommendation is built
// from or stored in — this file deliberately never names either one, so
// that absence is itself grep-checkable (ticket #126's own DoD).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { parseSolverOutput, type ParsedSolverOutput, type SolverSolution } from './lib/solver-output.js'

const JOB_NAME = 'solver-run'
const CHIP_ADVISORIES_MIGRATION = 'supabase/migrations/20260828100000_chip_advisories.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const SOLVER_OUTPUT_MIGRATION = 'supabase/migrations/20260816090000_solver_output.sql'

const DEFAULT_SOLVER_LOG_PATH = './solver/solve.log'
const DEFAULT_CHIP_SOLVER_LOG_PATH = './solver/solve-chip.log'

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
      `${JOB_NAME}/store-chip-advisory: required environment variables are not set. ` +
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

interface PathEnv {
  solverLogPath: string
  chipSolverLogPath: string
}

function readPathEnv(): PathEnv {
  return {
    solverLogPath: process.env.SOLVER_LOG_PATH ?? DEFAULT_SOLVER_LOG_PATH,
    chipSolverLogPath: process.env.CHIP_SOLVER_LOG_PATH ?? DEFAULT_CHIP_SOLVER_LOG_PATH,
  }
}

// ============================================================================
// Errors
// ============================================================================

export class StoreChipAdvisoryError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'StoreChipAdvisoryError'
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
      console.error(`${JOB_NAME}/store-chip-advisory: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure — no I/O, unit-testable with no database. See the file header's
// "Never taken from different runs" section for why this takes an already-
// resolved solverRunId and an already-parsed chip-free solution set as
// plain parameters, rather than querying anything itself.
// ============================================================================

export interface ChipAdvisoryInsertRow {
  gameweek_id: number
  solution_index: number
  chip_code: string
  chip_gameweek_id: number
  chip_enabled_objective: number
  chip_free_objective: number
  solver_run_id: number
}

export class ChipAdvisoryBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChipAdvisoryBuildError'
  }
}

/**
 * Builds the rows to insert into public.chip_advisories. Only solutions that
 * played at least one chip produce a row (chips.length === 0 is a legitimate,
 * silent no-op — see scripts/lib/solver-output.ts). A solution present in
 * `chipSolutions` with no matching `solutionIndex` in `chipFreeSolutions`
 * throws rather than comparing against nothing — both solves share every
 * setting except chip_limits (this ticket's own scope), including
 * num_iterations, so their solution_index sets must match.
 */
export function buildChipAdvisoryRows(params: {
  gameweekId: number
  solverRunId: number
  chipSolutions: readonly SolverSolution[]
  chipFreeSolutions: readonly SolverSolution[]
}): ChipAdvisoryInsertRow[] {
  const { gameweekId, solverRunId, chipSolutions, chipFreeSolutions } = params
  const chipFreeByIndex = new Map(chipFreeSolutions.map((solution) => [solution.solutionIndex, solution]))

  const rows: ChipAdvisoryInsertRow[] = []
  for (const solution of chipSolutions) {
    if (solution.chips.length === 0) continue

    const chipFreeSolution = chipFreeByIndex.get(solution.solutionIndex)
    if (!chipFreeSolution) {
      throw new ChipAdvisoryBuildError(
        `chip-enabled solution ${solution.solutionIndex} has no matching solution_index in the chip-free run's own Results ` +
          'table — refusing to compute a delta against a baseline that does not exist for this solution.',
      )
    }

    for (const chip of solution.chips) {
      rows.push({
        gameweek_id: gameweekId,
        solution_index: solution.solutionIndex,
        chip_code: chip.chipCode,
        chip_gameweek_id: chip.gameweekId,
        chip_enabled_objective: solution.score,
        chip_free_objective: chipFreeSolution.score,
        solver_run_id: solverRunId,
      })
    }
  }
  return rows
}

// ============================================================================
// Row shapes read from Supabase
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

interface SolverRunIdRow {
  id: number
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
    // 1. Target gameweek — same anchor as build-solver-input.ts and
    //    store-solver-output.ts.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new StoreChipAdvisoryError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new StoreChipAdvisoryError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const nextGw = (gwRows ?? []).find((gw) => gw.is_next)
    if (!nextGw) {
      throw new StoreChipAdvisoryError('no gameweek has is_next = true.', 'gameweeks')
    }

    // --------------------------------------------------------------------
    // 2. The two captured logs — the normal (chip-free) run's, already on
    //    disk from earlier in this same workflow execution, and the
    //    chip-enabled run's.
    // --------------------------------------------------------------------
    let chipFreeLogText: string
    try {
      chipFreeLogText = await readFile(paths.solverLogPath, 'utf8')
    } catch {
      throw new StoreChipAdvisoryError(
        `normal solver log not found at ${paths.solverLogPath} — the normal solve must run and be stored before a chip ` +
          'advisory can be compared against it.',
        'solver_log',
      )
    }

    let chipLogText: string
    try {
      chipLogText = await readFile(paths.chipSolverLogPath, 'utf8')
    } catch {
      throw new StoreChipAdvisoryError(
        `chip-enabled solver log not found at ${paths.chipSolverLogPath} — the chip-enabled solve step may not have run.`,
        'chip_solver_log',
      )
    }

    let chipFreeParsed: ParsedSolverOutput
    try {
      chipFreeParsed = parseSolverOutput(chipFreeLogText)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new StoreChipAdvisoryError(`failed to parse the normal (chip-free) solver log: ${message}`, 'solver_log')
    }

    let chipParsed: ParsedSolverOutput
    try {
      chipParsed = parseSolverOutput(chipLogText)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new StoreChipAdvisoryError(`failed to parse the chip-enabled solver log: ${message}`, 'chip_solver_log')
    }

    // --------------------------------------------------------------------
    // 3. The normal run's own solver_runs row — the freshest one for this
    //    gameweek, written moments earlier by store-solver-output.ts. This
    //    is the comparison's anchor; see the file header.
    // --------------------------------------------------------------------
    const { data: runRows, error: runError } = await supabase
      .from('solver_runs')
      .select('id')
      .eq('gameweek_id', nextGw.id)
      .order('id', { ascending: false })
      .limit(1)
      .returns<SolverRunIdRow[]>()
    if (runError) {
      if (isMissingTable(runError, 'solver_runs')) {
        throw new StoreChipAdvisoryError(`the "solver_runs" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_runs')
      }
      throw new StoreChipAdvisoryError(`solver_runs lookup failed: ${runError.message}`, 'solver_runs')
    }
    const solverRunId = runRows?.[0]?.id
    if (solverRunId === undefined) {
      throw new StoreChipAdvisoryError(
        `no "solver_runs" row exists yet for gameweek ${nextGw.id} — the normal solve must run and store successfully ` +
          'before a chip advisory can be compared against it.',
        'solver_runs',
      )
    }

    // --------------------------------------------------------------------
    // 4. Build and insert — the only table this step writes to besides
    //    job_runs. See the file header for what it deliberately never
    //    touches.
    // --------------------------------------------------------------------
    const rows = buildChipAdvisoryRows({
      gameweekId: nextGw.id,
      solverRunId,
      chipSolutions: chipParsed.solutions,
      chipFreeSolutions: chipFreeParsed.solutions,
    })

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('chip_advisories').insert(rows)
      if (insertError) {
        if (isMissingTable(insertError, 'chip_advisories')) {
          throw new StoreChipAdvisoryError(
            `the "chip_advisories" table does not exist. Apply ${CHIP_ADVISORIES_MIGRATION} first.`,
            'chip_advisories',
          )
        }
        throw new StoreChipAdvisoryError(`chip_advisories insert failed: ${insertError.message}`, 'chip_advisories')
      }
    }

    const message =
      rows.length > 0
        ? `${JOB_NAME}/store-chip-advisory: stored ${rows.length} chip advisory row(s) for gameweek ${nextGw.id}, compared ` +
          `against solver_runs id ${solverRunId}.`
        : `${JOB_NAME}/store-chip-advisory: the chip-enabled solve for gameweek ${nextGw.id} played no chip in any ` +
          'solution — nothing to store.'
    console.log(message)

    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: {
        gameweekId: nextGw.id,
        solverRunId,
        chipPoolSizeAfter: chipParsed.poolSizeAfter,
        chipFreePoolSizeAfter: chipFreeParsed.poolSizeAfter,
        advisoryRowsStored: rows.length,
      },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof StoreChipAdvisoryError
        ? err.message
        : err instanceof ChipAdvisoryBuildError
          ? err.message
          : err instanceof Error
            ? `unexpected failure: ${err.message}`
            : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}/store-chip-advisory: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}/store-chip-advisory: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module
// (e.g. from a test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}/store-chip-advisory: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
