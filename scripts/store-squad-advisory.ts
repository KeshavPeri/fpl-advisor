// Store the wildcard/free-hit squad-rebuild advisory — ticket #134
// (feature-list item 28, first slice), extended by ticket #284 (the second
// half). Runs after BOTH solves in .github/workflows/squad-rebuild-probe.yml
// (nightly since #284, plus workflow_dispatch for an ad hoc check): a normal
// chip-free solve as a baseline, and a preseason: true rebuild solve that
// replaces the whole squad. See scripts/build-solver-input.ts's
// buildRebuildSolverConfig for how that config is built, and
// docs/solver-notes.md for the full write-up of what preseason: true does
// and why it is safe only here.
//
// TICKET #284 — this script now ALSO stores the fifteen players the rebuild
// solve actually picked, to public.chip_rebuild_picks, right after its own
// chip_advisories insert, in the SAME run: a points delta with nothing
// behind it is not useful without the squad that produced it (see this
// ticket's own WHY). Read from the rebuild solve's own results CSV —
// solution_index 0, the first rebuild gameweek only, never the rest of the
// five-gameweek horizon a preseason rebuild also touches — never the
// baseline's results CSV. If chip_rebuild_picks hasn't been migrated onto
// the live database yet, this script logs that and still records the
// chip_advisories row successfully (see buildChipRebuildPickRows and its
// call site in main() below) — the migration landing after merge must never
// regress the advisory ticket #134 already ships.
//
// TICKET #160: the rebuild solve is ALSO chip-free now. Before #160,
// buildRebuildSolverConfig granted the requested variant's chip (wc: 1 or
// fh: 1) ON TOP OF preseason: true, which let the solve rebuild the squad a
// second time — the first real dispatch (30 Aug 2026) showed a `CHIP WC`
// line and seven more transfers at GW5, on top of the GW3 preseason
// rebuild (docs/solver-notes.md has the log's own evidence). `chip_limits`
// is now the literal `{ bb: 0, wc: 0, fh: 0, tc: 0 }` for BOTH variants — the
// `REBUILD_VARIANT` this script reads still selects which advisory is
// produced (`chip_code` below), it just no longer implies the rebuild
// solve's own Results table will ever show that chip as played. See
// buildSquadAdvisoryRow's own comment below for what changed as a result.
//
// ============================================================================
// THE SAFETY CASE — read this before touching anything below.
// ============================================================================
// This script writes to public.chip_advisories (the SAME table ticket #126
// already uses for Bench Boost/Triple Captain timing — no migration for
// #134; chip_code just carries "WC" or "FH" instead of "TC"/"BB"),
// public.chip_rebuild_picks (NEW, ticket #284 — the fifteen players behind
// that advisory's own delta), and job_runs. It NEVER writes to solver_picks,
// recommendations, or any table the verdict card, the Telegram message, or
// the notification schedule reads. `.github/workflows/squad-rebuild-probe.
// yml` itself never calls store-solver-output.ts, generate-recommendations.
// ts or send-telegram.ts — see that workflow's own header for the full
// safety case.
//
// #134 originally said the rebuilt squad's actual fifteen players were
// "never read by this script at all" and that storing them was "a different
// feature, explicitly out of scope" — #284 is that feature. Each solve's
// own Results-table SCORE (via scripts/lib/solver-output.ts) is still used
// for the chip_advisories row exactly as before; the REBUILD solve's own
// results CSV (never the baseline's) is now ALSO read, but only for
// solution_index 0 and the first rebuild gameweek — never the rest of the
// horizon — and only to populate chip_rebuild_picks, a table read solely by
// the Chips screen's own squad-rebuild disclosure (never by
// recommendations/solver_picks/the Telegram message).
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
// chip a run was for), BASELINE_SOLVER_LOG_PATH, REBUILD_SOLVER_LOG_PATH,
// REBUILD_SOLVER_CONFIG_PATH and SOLVER_RESULTS_DIR (all optional, sensible
// defaults below — the last two are ticket #284's own additions, read to
// recover the rebuild solve's own results CSV). Writes to job_runs (always),
// public.chip_advisories and public.chip_rebuild_picks (INSERT only —
// `.delete(` and `.upsert(` do not appear in this file; a re-run adds new
// rows, matching chip_advisories' own append-only shape, see that
// migration's header).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import { readdir, readFile } from 'node:fs/promises'
import { BENCH_SIZE, SQUAD_SIZE, STARTING_XI_SIZE } from '../src/lib/squad/positions.ts'
import { parseSolverOutput, type ParsedSolverOutput, type SolverSolution } from './lib/solver-output.js'

const JOB_NAME = 'squad-rebuild-probe'
const CHIP_ADVISORIES_MIGRATION = 'supabase/migrations/20260828100000_chip_advisories.sql'
const CHIP_REBUILD_PICKS_MIGRATION = 'supabase/migrations/20260926090000_chip_rebuild_picks.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const SOLVER_OUTPUT_MIGRATION = 'supabase/migrations/20260816090000_solver_output.sql'

const DEFAULT_BASELINE_SOLVER_LOG_PATH = './solver/solve.log'
const DEFAULT_REBUILD_SOLVER_LOG_PATH = './solver/solve-rebuild.log'
/** Ticket #284. Matches squad-rebuild-probe.yml's own workflow-level `REBUILD_SOLVER_CONFIG_PATH` env default. Read for its "datasource" field only — the same recover-rather-than-rederive reasoning scripts/store-solver-output.ts's own SolverConfigFile read uses — so the results-CSV filename stem this script looks for can never disagree with what scripts/build-solver-input.ts actually wrote. */
const DEFAULT_REBUILD_SOLVER_CONFIG_PATH = './solver/data/solver-config-rebuild.json'
/** Ticket #284. Matches squad-rebuild-probe.yml's own workflow-level `SOLVER_RESULTS_DIR` env default, and scripts/store-solver-output.ts's own default for the same directory. */
const DEFAULT_SOLVER_RESULTS_DIR = './solver/data/results'

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
  /** Ticket #284. */
  rebuildSolverConfigPath: string
  /** Ticket #284. */
  solverResultsDir: string
}

function readPathEnv(): PathEnv {
  return {
    baselineLogPath: process.env.BASELINE_SOLVER_LOG_PATH ?? DEFAULT_BASELINE_SOLVER_LOG_PATH,
    rebuildLogPath: process.env.REBUILD_SOLVER_LOG_PATH ?? DEFAULT_REBUILD_SOLVER_LOG_PATH,
    rebuildSolverConfigPath: process.env.REBUILD_SOLVER_CONFIG_PATH ?? DEFAULT_REBUILD_SOLVER_CONFIG_PATH,
    solverResultsDir: process.env.SOLVER_RESULTS_DIR ?? DEFAULT_SOLVER_RESULTS_DIR,
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

export interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

/** Ticket #284. Discriminated result of attempting the chip_rebuild_picks insert — see resolveChipRebuildPicksInsertOutcome below. */
export type ChipRebuildPicksInsertOutcome =
  | { outcome: 'stored'; count: number }
  | { outcome: 'skipped'; reason: string }

/**
 * Ticket #284's own DoD: "the store step still writes the advisory when the picks table is
 * missing." By the time this function is ever called, the chip_advisories row is ALREADY
 * committed (main()'s own step 4 runs before step 5's picks logic) — this function's only job is
 * deciding whether a chip_rebuild_picks write failure should also fail the whole job (any genuine
 * error — thrown, same as every other write failure in this script) or be treated as an expected,
 * transitional state that still reports success (the migration landing after this PR merges — see
 * the file header's own note on why a missing TABLE is never conflated with a genuine failure).
 * Pure — no I/O — so this exact decision is unit-testable against a bare error object, no
 * database and no filesystem, which is what proves the DoD's "still writes the advisory" claim:
 * this function is only ever reached AFTER that write already succeeded, and a missing-table
 * error here provably never becomes a thrown exception.
 */
export function resolveChipRebuildPicksInsertOutcome(
  error: PostgrestLikeError | null,
  pickCount: number,
): ChipRebuildPicksInsertOutcome {
  if (error === null) return { outcome: 'stored', count: pickCount }
  if (isMissingTable(error, 'chip_rebuild_picks')) {
    return {
      outcome: 'skipped',
      reason: `the "chip_rebuild_picks" table does not exist yet. Apply ${CHIP_REBUILD_PICKS_MIGRATION} to see the squad on the Chips screen.`,
    }
  }
  throw new StoreSquadAdvisoryError(`chip_rebuild_picks insert failed: ${error.message}`, 'chip_rebuild_picks')
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
 * TICKET #160: the rebuild solve is now chip-free too (buildRebuildSolverConfig's chip_limits is
 * `{ bb: 0, wc: 0, fh: 0, tc: 0 }` for both variants — see that function's own comment). Before
 * #160 this function required the rebuild solution to have actually played the REQUESTED
 * variant's chip, and read `chip_gameweek_id` off that chip's own token (e.g. the "5" in "WC5").
 * Neither is possible any more — the chip is never granted, so it can never appear in the
 * Results table — so:
 *   - `chip_code` is still `CHIP_CODE_BY_VARIANT[variant]`, exactly as before: it labels WHICH
 *     advisory this run produced, independent of what the (now chip-free) rebuild solve's own
 *     Results table shows. `variant` is the only source of truth for it.
 *   - `chip_gameweek_id` is now `gameweekId` — the target gameweek the whole rebuild was solved
 *     for — rather than a chip token's own gameweek. There is no longer a distinct "the chip
 *     plays later in the horizon" gameweek to read: preseason: true rebuilds the squad
 *     immediately, for the gameweek this run was dispatched for.
 *   - The rebuild solution playing ANY chip is now the anomaly (guard 2 below), mirroring the
 *     baseline's own "must be chip-free" guard (3) — chip_limits forbids it for the rebuild too,
 *     so a chip appearing there means the solver played something it was never granted.
 *
 * Throws — never guesses — on any of three things that would otherwise silently mislabel or
 * misvalue the row:
 *   1. Either solve's Results table has no solution_index 0 at all.
 *   2. The rebuild solution played ANY chip — chip_limits is all zero for the rebuild solve
 *      (ticket #160), so a chip appearing in its Results table is a solver anomaly worth
 *      surfacing, not an advisory worth storing.
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

  if (rebuildPrimary.chips.length > 0) {
    throw new SquadAdvisoryBuildError(
      `the rebuild solve's own solution_index 0 played chip(s) [${formatChips(rebuildPrimary.chips)}] — since ticket ` +
        '#160, chip_limits is all zero for the rebuild solve too (preseason: true alone is the rebuild being measured; ' +
        'see scripts/build-solver-input.ts\'s buildRebuildSolverConfig). Refusing to store an advisory for a chip the ' +
        'solve was never granted permission to play.',
    )
  }

  if (baselinePrimary.chips.length > 0) {
    throw new SquadAdvisoryBuildError(
      `the baseline solve's own solution_index 0 played chip(s) [${formatChips(baselinePrimary.chips)}] — expected a ` +
        'genuinely chip-free baseline. Refusing to compare the rebuild against a contaminated baseline.',
    )
  }

  return {
    gameweek_id: gameweekId,
    solution_index: 0,
    chip_code: chipCode,
    chip_gameweek_id: gameweekId,
    chip_enabled_objective: rebuildPrimary.score,
    chip_free_objective: baselinePrimary.score,
    solver_run_id: solverRunId,
  }
}

/**
 * Ticket #160's "counter proving 'three solutions, one answer' is visible on every future run".
 * Pure — no I/O, same pattern as buildSquadAdvisoryRow above — so it is unit-testable directly
 * against SolverSolution fixtures with no database.
 *
 * The first real dispatch (30 Aug 2026) found all three of the rebuild solve's iterations
 * (Plan A/B/C) reported the SAME objective value, 295.54, differing only in which bench
 * goalkeeper was picked: `ITERATION_CRITERION`'s `this_gw_transfer_in` (scripts/build-solver-input.ts)
 * has nothing to vary when preseason: true makes the whole squad unconstrained and every "transfer"
 * is a buy. This ticket reports that finding via a counter in job_runs.details — it does not
 * attempt to fix it (see docs/solver-notes.md and the ticket's own Notes: "no attempt to make
 * Plan A/B/C meaningful in rebuild mode").
 *
 * Counts DISTINCT objective values, not distinct solutions — three solutions with the same score
 * but different bench picks (exactly what was observed) count as 1, not 3, which is the whole
 * point: this is a proxy for "did the alternates actually differ", not a row count.
 */
export function countDistinctObjectiveValues(solutions: readonly SolverSolution[]): number {
  return new Set(solutions.map((s) => s.score)).size
}

// ============================================================================
// chip_rebuild_picks — ticket #284. Pure — no I/O, same discipline as
// buildSquadAdvisoryRow above: every input is already resolved/already
// parsed, passed as a plain parameter, so a value from a different run or a
// different gameweek can never reach a row here (the #72 trap).
// ============================================================================

export interface ChipRebuildPickRow {
  chip_advisory_id: number
  player_id: number
  player_code: number | null
  position: string
  is_starting: boolean
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
  expected_points: number
}

export class ChipRebuildPicksBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChipRebuildPicksBuildError'
  }
}

/**
 * Maps ONE row of the rebuild solve's results CSV onto one chip_rebuild_picks row. Columns are
 * the same shape scripts/store-solver-output.ts's own mapResultsCsvRow reads (id, week, pos,
 * lineup, bench, captain, vicecaptain, iter, xP — verified by reading dev/solver.py's source and
 * by an actual run, per that function's own comment) plus the raw `pos` column verbatim, matching
 * the "third-party output is ground truth" convention chip_advisories.chip_code and
 * solver_runs.solver_status already use in this codebase. `bench` is -1 for a starting player,
 * 0-3 for bench — shifted by +1 to match squad_picks.bench_order's / solver_picks.bench_order's
 * 1-4 convention, the exact same mapping mapResultsCsvRow uses (duplicated here rather than
 * imported: this is a different script's row shape, chip_rebuild_picks, not solver_picks).
 */
export function mapRebuildResultsCsvRow(
  row: Record<string, string>,
  chipAdvisoryId: number,
  playerCode: number | null,
): ChipRebuildPickRow {
  const benchRaw = Number(row.bench)
  return {
    chip_advisory_id: chipAdvisoryId,
    player_id: Number(row.id),
    player_code: playerCode,
    position: row.pos,
    is_starting: row.lineup === '1',
    bench_order: benchRaw >= 0 ? benchRaw + 1 : null,
    is_captain: row.captain === '1',
    is_vice_captain: row.vicecaptain === '1',
    expected_points: Number(row.xP),
  }
}

/**
 * Filters the rebuild solve's FULL results CSV (every gameweek in the five-gameweek horizon,
 * every solution) down to the fifteen rows this advisory actually explains — solution_index 0
 * (the Results table's "iter 0" row, the same solution buildSquadAdvisoryRow above reads for the
 * comparison) and `targetGameweekId` (the SAME gameweek the whole advisory was filed for —
 * buildSquadAdvisoryRow's own comment: "the target gameweek the whole rebuild was solved for";
 * there is no separate "chip's own gameweek" for a preseason rebuild to read instead) — and
 * validates the ticket's own DoD shape before building rows: exactly SQUAD_SIZE (15) rows,
 * STARTING_XI_SIZE (11) starting and BENCH_SIZE (4) bench, exactly one captain and one
 * vice-captain. Throws, never guesses — same discipline as buildSquadAdvisoryRow's own three
 * guards; a malformed or unexpectedly-shaped squad must surface as a job failure, not a silently
 * wrong or partial row set.
 */
export function buildChipRebuildPickRows(params: {
  chipAdvisoryId: number
  targetGameweekId: number
  csvRows: readonly Record<string, string>[]
  codeByPlayerId: ReadonlyMap<number, number | null>
}): ChipRebuildPickRow[] {
  const { chipAdvisoryId, targetGameweekId, csvRows, codeByPlayerId } = params

  const relevantRows = csvRows.filter(
    (row) => Number(row.iter) === 0 && Number(row.week) === targetGameweekId,
  )
  if (relevantRows.length !== SQUAD_SIZE) {
    throw new ChipRebuildPicksBuildError(
      `expected exactly ${SQUAD_SIZE} rows for solution_index 0, gameweek ${targetGameweekId} in the rebuild solve's ` +
        `results CSV, found ${relevantRows.length}.`,
    )
  }

  const rows = relevantRows.map((row) =>
    mapRebuildResultsCsvRow(row, chipAdvisoryId, codeByPlayerId.get(Number(row.id)) ?? null),
  )

  const startingCount = rows.filter((r) => r.is_starting).length
  const benchCount = rows.length - startingCount
  if (startingCount !== STARTING_XI_SIZE || benchCount !== BENCH_SIZE) {
    throw new ChipRebuildPicksBuildError(
      `expected ${STARTING_XI_SIZE} starting and ${BENCH_SIZE} bench players, found ${startingCount} starting and ` +
        `${benchCount} bench.`,
    )
  }

  const captainCount = rows.filter((r) => r.is_captain).length
  const viceCaptainCount = rows.filter((r) => r.is_vice_captain).length
  if (captainCount !== 1 || viceCaptainCount !== 1) {
    throw new ChipRebuildPicksBuildError(
      `expected exactly one captain and one vice-captain, found ${captainCount} captain(s) and ` +
        `${viceCaptainCount} vice-captain(s).`,
    )
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

/** Ticket #284 — same shape scripts/store-solver-output.ts's own PlayerCodeRow reads. */
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
    // 4. Build and insert the advisory row. `.select('id').single()` reads
    //    back its own generated identity — needed as the FK anchor for the
    //    fifteen chip_rebuild_picks rows in step 5 below (ticket #284).
    // --------------------------------------------------------------------
    const row = buildSquadAdvisoryRow({
      gameweekId: nextGw.id,
      solverRunId,
      variant,
      rebuildSolutions: rebuildParsed.solutions,
      baselineSolutions: baselineParsed.solutions,
    })

    const { data: insertedAdvisory, error: insertError } = await supabase
      .from('chip_advisories')
      .insert(row)
      .select('id')
      .single()
    if (insertError) {
      if (isMissingTable(insertError, 'chip_advisories')) {
        throw new StoreSquadAdvisoryError(
          `the "chip_advisories" table does not exist. Apply ${CHIP_ADVISORIES_MIGRATION} first.`,
          'chip_advisories',
        )
      }
      throw new StoreSquadAdvisoryError(`chip_advisories insert failed: ${insertError.message}`, 'chip_advisories')
    }
    const chipAdvisoryId = (insertedAdvisory as { id: number }).id

    // --------------------------------------------------------------------
    // 5. Ticket #284 — the fifteen players behind that advisory's own
    //    delta, from the REBUILD solve's own results CSV (never the
    //    baseline's). A missing chip_rebuild_picks TABLE is swallowed —
    //    logged, counted in job_runs.details, and the run still reports
    //    success — because the migration lands after this PR merges (see
    //    the file header); any OTHER failure here (a malformed CSV, an
    //    unexpected pick count, a genuine Supabase error) still throws, same
    //    as every other step above — the advisory row already committed in
    //    step 4 is not rolled back, matching this script's existing
    //    "insert now, let a later failure surface as job_runs failure"
    //    posture (see e.g. the solver_runs pattern scripts/store-solver-
    //    output.ts documents).
    // --------------------------------------------------------------------
    let picksStored: number | null = null
    let picksSkippedReason: string | null = null
    try {
      const rebuildConfigText = await readFile(paths.rebuildSolverConfigPath, 'utf8')
      const rebuildConfig = JSON.parse(rebuildConfigText) as { datasource?: unknown }
      if (typeof rebuildConfig.datasource !== 'string' || rebuildConfig.datasource === '') {
        throw new StoreSquadAdvisoryError(
          `rebuild solver config at ${paths.rebuildSolverConfigPath} is missing "datasource".`,
          'rebuild_solver_config',
        )
      }
      const datasource = rebuildConfig.datasource

      let resultFilenames: string[] = []
      try {
        const entries = await readdir(paths.solverResultsDir)
        resultFilenames = entries.filter((f) => f.startsWith(`${datasource}_`) && f.endsWith('.csv')).sort()
      } catch {
        resultFilenames = []
      }
      if (resultFilenames.length === 0) {
        throw new StoreSquadAdvisoryError(
          `no rebuild results CSV found under ${paths.solverResultsDir} matching "${datasource}_*.csv" — the rebuild ` +
            'solve step may not have produced one.',
          'rebuild_results_csv',
        )
      }

      const csvRows: Array<Record<string, string>> = []
      for (const filename of resultFilenames) {
        const csvText = await readFile(`${paths.solverResultsDir}/${filename}`, 'utf8')
        csvRows.push(...(parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>))
      }

      const playerIds = [...new Set(csvRows.filter((r) => Number(r.iter) === 0 && Number(r.week) === nextGw.id).map((r) => Number(r.id)))]
      const { data: playerRows, error: playerError } = await supabase
        .from('players')
        .select('id, code')
        .in('id', playerIds)
        .returns<PlayerCodeRow[]>()
      if (playerError) {
        throw new StoreSquadAdvisoryError(`players lookup failed: ${playerError.message}`, 'players')
      }
      const codeByPlayerId = new Map<number, number | null>((playerRows ?? []).map((p) => [p.id, p.code]))

      const pickRows = buildChipRebuildPickRows({
        chipAdvisoryId,
        targetGameweekId: nextGw.id,
        csvRows,
        codeByPlayerId,
      })

      const { error: picksInsertError } = await supabase.from('chip_rebuild_picks').insert(pickRows)
      const outcome = resolveChipRebuildPicksInsertOutcome(picksInsertError, pickRows.length)
      if (outcome.outcome === 'stored') {
        picksStored = outcome.count
      } else {
        picksSkippedReason = outcome.reason
        console.error(`${JOB_NAME}/store-squad-advisory: ${picksSkippedReason} The chip_advisories row above was still stored.`)
      }
    } catch (picksErr) {
      if (picksErr instanceof StoreSquadAdvisoryError || picksErr instanceof ChipRebuildPicksBuildError) {
        throw picksErr
      }
      const picksMessage = picksErr instanceof Error ? picksErr.message : String(picksErr)
      throw new StoreSquadAdvisoryError(`unexpected failure storing chip_rebuild_picks: ${picksMessage}`, 'chip_rebuild_picks')
    }

    const message =
      `${JOB_NAME}/store-squad-advisory: stored a ${row.chip_code} squad-rebuild advisory for gameweek ${nextGw.id} ` +
      `(delta ${(row.chip_enabled_objective - row.chip_free_objective).toFixed(2)}), compared against solver_runs id ${solverRunId}. ` +
      (picksStored !== null ? `Stored ${picksStored} chip_rebuild_picks row(s).` : `Picks not stored: ${picksSkippedReason}`)
    console.log(message)

    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: {
        gameweekId: nextGw.id,
        solverRunId,
        variant,
        chipAdvisoryId,
        chipEnabledObjective: row.chip_enabled_objective,
        chipFreeObjective: row.chip_free_objective,
        baselinePoolSizeAfter: baselineParsed.poolSizeAfter,
        rebuildPoolSizeAfter: rebuildParsed.poolSizeAfter,
        // Ticket #160: how many DISTINCT objective values the rebuild solve's own solutions
        // (up to 3, Plan A/B/C) carried — see countDistinctObjectiveValues' own comment above.
        // The first real dispatch (30 Aug 2026) found this was 1, not 3.
        rebuildDistinctObjectiveCount: countDistinctObjectiveValues(rebuildParsed.solutions),
        // Ticket #284.
        picksStored,
        picksSkippedReason,
      },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof StoreSquadAdvisoryError
        ? err.message
        : err instanceof SquadAdvisoryBuildError
          ? err.message
          : err instanceof ChipRebuildPicksBuildError
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
