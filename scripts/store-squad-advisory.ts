// Store the wildcard/free-hit squad-rebuild advisory — ticket #134
// (feature-list item 28, first slice). Runs after BOTH solves in
// .github/workflows/squad-rebuild-probe.yml (workflow_dispatch only, never
// part of the nightly chain): a normal chip-free solve as a baseline, and a
// preseason: true, single-chip-variant (wc OR fh, never both) rebuild solve
// that replaces the whole squad. See scripts/build-solver-input.ts's
// buildRebuildSolverConfig for how that config is built, and
// docs/solver-notes.md for the full write-up of what preseason: true does
// and why it is safe only here.
//
// ============================================================================
// THE SAFETY CASE — read this before touching anything below.
// ============================================================================
// This script writes exactly ONE row to public.chip_advisories (the SAME
// table ticket #126 already uses for Bench Boost/Triple Captain timing —
// no migration; chip_code just carries "WC" or "FH" instead of "TC"/"BB")
// and one row to job_runs. It NEVER writes to solver_picks, recommendations,
// or any table the verdict card, the Telegram message, or the notification
// schedule reads. `.github/workflows/squad-rebuild-probe.yml` itself never
// calls store-solver-output.ts, generate-recommendations.ts or
// send-telegram.ts — see that workflow's own header for the full safety
// case. The rebuilt squad's actual fifteen players are never read by this
// script at all: only each solve's own Results-table SCORE (via
// scripts/lib/solver-output.ts) is used. Reading which players the solver
// would pick is the point of looking (the workflow uploads that as an
// artefact); storing them is a different feature, explicitly out of scope.
//
// ============================================================================
// solver_run_id — reused, never written by this script.
// ============================================================================
// public.chip_advisories.solver_run_id is NOT NULL with a real FK to
// solver_runs(id). This script's own two solves are isolated probes and
// deliberately never produce a solver_runs row of their own (that would
// require calling store-solver-output.ts, which the workflow's own DoD
// forbids by name). Instead, exactly like scripts/store-chip-advisory.ts's
// own step 3, this script resolves the FRESHEST solver_runs row already on
// file for the target gameweek — written by an earlier, real
// solver-run.yml execution — and uses its id purely as the FK anchor this
// advisory is filed against. It never reads or writes anything else on that
// row, and never claims this probe's own solve produced it.
//
// ============================================================================
// Why the baseline is genuinely re-solved, not read from solver_runs.
// ============================================================================
// solver_runs.objective_value is a real number, but it is from whatever
// night's nightly run happened to run last — possibly stale projections,
// and definitely a different solve process than tonight's rebuild. The
// ticket's own scope requires "the normal chip-free solve as a baseline...
// [b]oth on the same projections CSV and the same horizon" as the rebuild,
// so the workflow always runs its own fresh baseline solve alongside the
// rebuild solve, and this script re-parses THAT baseline log — never
// solver_runs.objective_value — for the comparison. See
// buildSquadAdvisoryRow below.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads SUPABASE_URL, SUPABASE_SECRET_KEY (required), REBUILD_VARIANT
// (required, 'wc' or 'fh' — no default; this script refuses to guess which
// chip a run was for), BASELINE_SOLVER_LOG_PATH and REBUILD_SOLVER_LOG_PATH
// (both optional, sensible defaults below). Writes to job_runs (always) and
// public.chip_advisories (INSERT only — `.delete(` and `.upsert(` do not
// appear in this file; a re-run adds a new row, matching chip_advisories'
// own append-only shape, see that migration's header).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { parseSolverOutput, type ParsedSolverOutput, type SolverSolution } from './lib/solver-output.js'

const JOB_NAME = 'squad-rebuild-probe'
const CHIP_ADVISORIES_MIGRATION = 'supabase/migrations/20260828100000_chip_advisories.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const SOLVER_OUTPUT_MIGRATION = 'supabase/migrations/20260816090000_solver_output.sql'

const DEFAULT_BASELINE_SOLVER_LOG_PATH = './solver/solve.log'
const DEFAULT_REBUILD_SOLVER_LOG_PATH = './solver/solve-rebuild.log'

export type SquadRebuildVariant = 'wc' | 'fh'
/** The chip_advisories.chip_code value for each variant — verbatim uppercase, matching the solver's own Results-table token shape ("WC5", "FH5"), same convention TC/BB already use. */
const CHIP_CODE_BY_VARIANT: Readonly<Record<SquadRebuildVariant, 'WC' | 'FH'>> = { wc: 'WC', fh: 'FH' }

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
      `${JOB_NAME}/store-squad-advisory: required environment variables are not set. ` +
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

interface PathEnv {
  baselineLogPath: string
  rebuildLogPath: string
}

function readPathEnv(): PathEnv {
  return {
    baselineLogPath: process.env.BASELINE_SOLVER_LOG_PATH ?? DEFAULT_BASELINE_SOLVER_LOG_PATH,
    rebuildLogPath: process.env.REBUILD_SOLVER_LOG_PATH ?? DEFAULT_REBUILD_SOLVER_LOG_PATH,
  }
}

/**
 * Required, no default — unlike CHIP_PROBE elsewhere in this codebase, this script has no
 * sensible "off" behaviour: it exists only to be run for one specific variant, and guessing
 * which one on a missing/malformed value would risk mislabelling the row (see
 * buildSquadAdvisoryRow's own cross-check against the rebuild log for the second half of that
 * defence). Returns null (rather than throwing) on a bad value so main() can report it through
 * the same "no network call, exit 1" path readSupabaseEnv already uses for a missing credential —
 * there is nothing to record in job_runs yet at this point.
 */
function readVariantEnv(): SquadRebuildVariant | null {
  const raw = process.env.REBUILD_VARIANT
  if (raw === 'wc' || raw === 'fh') return raw
  console.error(
    `${JOB_NAME}/store-squad-advisory: REBUILD_VARIANT must be exactly "wc" or "fh" (got: ${JSON.stringify(raw ?? null)}). ` +
      'Making no network call.',
  )
  return null
}

// ============================================================================
// Errors
// ============================================================================

export class StoreSquadAdvisoryError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'StoreSquadAdvisoryError'
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
      console.error(`${JOB_NAME}/store-squad-advisory: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure — no I/O, unit-testable with no database. Mirrors
// scripts/store-chip-advisory.ts's buildChipAdvisoryRows: takes already-
// resolved/already-parsed inputs as plain parameters rather than querying
// anything itself, so a value from a different run can never reach a row
// here (the #72 trap — see that script's own header).
// ============================================================================

export interface SquadAdvisoryInsertRow {
  gameweek_id: number
  solution_index: number
  chip_code: 'WC' | 'FH'
  chip_gameweek_id: number
  chip_enabled_objective: number
  chip_free_objective: number
  solver_run_id: number
}

export class SquadAdvisoryBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SquadAdvisoryBuildError'
  }
}

function formatChips(chips: SolverSolution['chips']): string {
  return chips.length === 0 ? '(none)' : chips.map((c) => `${c.chipCode}${c.gameweekId}`).join(', ')
}

/**
 * Builds the ONE row to insert into public.chip_advisories for this run — the ticket's own DoD:
 * "One chip_advisories row is written per run." Always solution_index 0: the Results table's
 * "iter 0" row, same convention solver_runs.objective_value uses ("HiGHS's Primal bound,
 * effectively iteration 0's score" — see scripts/store-chip-advisory.ts's own header), so this
 * advisory reflects the solver's single best rebuild, not one of up to three alternates.
 *
 * Throws — never guesses — on any of three things that would otherwise silently mislabel or
 * misvalue the row:
 *   1. Either solve's Results table has no solution_index 0 at all.
 *   2. The rebuild solution's own chips did not include the REQUESTED variant's code — a rebuild
 *      solve that didn't actually play the chip it was configured to play is a solver anomaly
 *      worth surfacing, not an advisory worth storing.
 *   3. The baseline solution played ANY chip — the whole point of the baseline is that it is
 *      chip-free; a baseline that isn't is not a valid comparison.
 */
export function buildSquadAdvisoryRow(params: {
  gameweekId: number
  solverRunId: number
  variant: SquadRebuildVariant
  rebuildSolutions: readonly SolverSolution[]
  baselineSolutions: readonly SolverSolution[]
}): SquadAdvisoryInsertRow {
  const { gameweekId, solverRunId, variant, rebuildSolutions, baselineSolutions } = params
  const chipCode = CHIP_CODE_BY_VARIANT[variant]

  const rebuildPrimary = rebuildSolutions.find((s) => s.solutionIndex === 0)
  if (!rebuildPrimary) {
    throw new SquadAdvisoryBuildError(
      'the rebuild solve\'s Results table has no solution_index 0 — nothing to compare against the baseline.',
    )
  }
  const baselinePrimary = baselineSolutions.find((s) => s.solutionIndex === 0)
  if (!baselinePrimary) {
    throw new SquadAdvisoryBuildError(
      'the baseline (chip-free) solve\'s Results table has no solution_index 0 — nothing to compare the rebuild against.',
    )
  }

  if (baselinePrimary.chips.length > 0) {
    throw new SquadAdvisoryBuildError(
      `the baseline solve's own solution_index 0 played chip(s) [${formatChips(baselinePrimary.chips)}] — expected a ` +
        'genuinely chip-free baseline. Refusing to compare the rebuild against a contaminated baseline.',
    )
  }

  const chip = rebuildPrimary.chips.find((c) => c.chipCode === chipCode)
  if (!chip) {
    throw new SquadAdvisoryBuildError(
      `the rebuild solve (variant "${variant}") did not play ${chipCode} in its own solution_index 0 — Results table ` +
        `chips were [${formatChips(rebuildPrimary.chips)}]. Refusing to store an advisory for a chip that was never ` +
        'actually played.',
    )
  }

  return {
    gameweek_id: gameweekId,
    solution_index: 0,
    chip_code: chipCode,
    chip_gameweek_id: chip.gameweekId,
    chip_enabled_objective: rebuildPrimary.score,
    chip_free_objective: baselinePrimary.score,
    solver_run_id: solverRunId,
  }
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
  const variant = readVariantEnv()
  if (!variant) {
    process.exit(1)
    return
  }
  const paths = readPathEnv()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. Target gameweek — same anchor as scripts/build-solver-input.ts.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new StoreSquadAdvisoryError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new StoreSquadAdvisoryError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const nextGw = (gwRows ?? []).find((gw) => gw.is_next)
    if (!nextGw) {
      throw new StoreSquadAdvisoryError('no gameweek has is_next = true.', 'gameweeks')
    }

    // --------------------------------------------------------------------
    // 2. The two captured logs from THIS run — never a stored/older log.
    // --------------------------------------------------------------------
    let baselineLogText: string
    try {
      baselineLogText = await readFile(paths.baselineLogPath, 'utf8')
    } catch {
      throw new StoreSquadAdvisoryError(
        `baseline (chip-free) solver log not found at ${paths.baselineLogPath} — the baseline solve must run before a ` +
          'squad-rebuild advisory can be compared against it.',
        'baseline_solver_log',
      )
    }

    let rebuildLogText: string
    try {
      rebuildLogText = await readFile(paths.rebuildLogPath, 'utf8')
    } catch {
      throw new StoreSquadAdvisoryError(
        `rebuild solver log not found at ${paths.rebuildLogPath} — the rebuild solve step may not have run.`,
        'rebuild_solver_log',
      )
    }

    let baselineParsed: ParsedSolverOutput
    try {
      baselineParsed = parseSolverOutput(baselineLogText)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new StoreSquadAdvisoryError(`failed to parse the baseline (chip-free) solver log: ${message}`, 'baseline_solver_log')
    }

    let rebuildParsed: ParsedSolverOutput
    try {
      rebuildParsed = parseSolverOutput(rebuildLogText)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new StoreSquadAdvisoryError(`failed to parse the rebuild solver log: ${message}`, 'rebuild_solver_log')
    }

    // --------------------------------------------------------------------
    // 3. The FK anchor — the freshest solver_runs row already on file for
    //    this gameweek, written by an earlier, real solver-run.yml
    //    execution. This script never writes to solver_runs itself — see
    //    the file header's "solver_run_id — reused, never written" section.
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
        throw new StoreSquadAdvisoryError(`the "solver_runs" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_runs')
      }
      throw new StoreSquadAdvisoryError(`solver_runs lookup failed: ${runError.message}`, 'solver_runs')
    }
    const solverRunId = runRows?.[0]?.id
    if (solverRunId === undefined) {
      throw new StoreSquadAdvisoryError(
        `no "solver_runs" row exists yet for gameweek ${nextGw.id} — a normal solver-run.yml execution must have solved ` +
          'and stored successfully for this gameweek before a squad-rebuild advisory can be filed against it.',
        'solver_runs',
      )
    }

    // --------------------------------------------------------------------
    // 4. Build and insert — the only table this step writes to besides
    //    job_runs. See the file header's "THE SAFETY CASE" for what it
    //    deliberately never touches.
    // --------------------------------------------------------------------
    const row = buildSquadAdvisoryRow({
      gameweekId: nextGw.id,
      solverRunId,
      variant,
      rebuildSolutions: rebuildParsed.solutions,
      baselineSolutions: baselineParsed.solutions,
    })

    const { error: insertError } = await supabase.from('chip_advisories').insert(row)
    if (insertError) {
      if (isMissingTable(insertError, 'chip_advisories')) {
        throw new StoreSquadAdvisoryError(
          `the "chip_advisories" table does not exist. Apply ${CHIP_ADVISORIES_MIGRATION} first.`,
          'chip_advisories',
        )
      }
      throw new StoreSquadAdvisoryError(`chip_advisories insert failed: ${insertError.message}`, 'chip_advisories')
    }

    const message =
      `${JOB_NAME}/store-squad-advisory: stored a ${row.chip_code} squad-rebuild advisory for gameweek ${nextGw.id} ` +
      `(delta ${(row.chip_enabled_objective - row.chip_free_objective).toFixed(2)}), compared against solver_runs id ${solverRunId}.`
    console.log(message)

    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: {
        gameweekId: nextGw.id,
        solverRunId,
        variant,
        chipEnabledObjective: row.chip_enabled_objective,
        chipFreeObjective: row.chip_free_objective,
        baselinePoolSizeAfter: baselineParsed.poolSizeAfter,
        rebuildPoolSizeAfter: rebuildParsed.poolSizeAfter,
      },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof StoreSquadAdvisoryError
        ? err.message
        : err instanceof SquadAdvisoryBuildError
          ? err.message
          : err instanceof Error
            ? `unexpected failure: ${err.message}`
            : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}/store-squad-advisory: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}/store-squad-advisory: additionally failed to record the failed job_runs row: ${recordMessage}`)
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
    console.error(`${JOB_NAME}/store-squad-advisory: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
