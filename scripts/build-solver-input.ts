// Build the solver's input files — ticket #41 (feature-list item 12, the
// second half). #29 proved the solver's toolchain installs cleanly in a
// GitHub Action at the pinned commit. This job builds the two files
// dev/solver.py needs to run against OUR data: `data/team.json` and a
// settings-override config passed to `run/solve.py --config <path>`. It
// never invokes the solver itself — that is a separate workflow step (see
// .github/workflows/solver-run.yml) — and it never regenerates the
// projections CSV; scripts/emit-projections-csv.ts (item 11, unmodified) has
// already written that by the time this job runs.
//
// ============================================================================
// DELIBERATELY UNAUTHENTICATED, FOREVER — the Tier 1 trap.
// ============================================================================
// dev/solver.py's own error message, when data/team.json is missing, points
// the user at FPL's authenticated in-progress-squad endpoint (the one
// requiring a logged-in session) and tells them to download the response
// from it. This app never signs in to FPL, never stores a credential, cookie
// or session, and never calls that endpoint (product-brief.md §6a and §5;
// see also scripts/sync-squad.ts's own header, which draws the identical
// line). That is the single reason the whole app needs no account, and it
// must not be undone here — not behind a flag, not "just for the solver".
// This job builds team.json from `squads` and `squad_picks` (#13/#14)
// instead — the app's own record of the squad, already public via the
// unauthenticated entry/{id}/ endpoint and already pre-approved personal
// data (product-brief.md §5). It also never selects the solver's other
// non-file team-data mode, the one that calls the FPL API itself to
// reconstruct the squad, which would make the solver a second thing in the
// system that decides what the squad is. One writer (this app's own
// database), one truth. Grep-verifiable per the ticket's DoD: the literal
// strings this paragraph is careful never to spell out do not appear
// anywhere in this repo.
//
// ============================================================================
// Horizon — derived, never a second hardcoded copy.
// ============================================================================
// The solver's shipped horizon is 8; dev/solver.py's prep_data raises
// ValueError on the first missing `{gw}_Pts` column, so running at the
// default horizon against our 5-gameweek CSV crashes on contact, every time
// (verified directly against the pinned commit's source, see the ticket).
// analyzeProjectionsCsv() below reads the ACTUAL header of the CSV this job
// is about to feed the solver and counts `{gw}_Pts` columns — it does not
// re-read scripts/project-points.ts's PROJECTION_HORIZON constant, so the two
// can never independently drift into disagreement; if they ever do, the CSV
// itself is the thing this job trusts.
//
// ============================================================================
// Purchase/selling price — Tier 3, decided here (decisions/ticket-41.md).
// ============================================================================
// squad_picks does not store what Keshav actually paid for a player. For the
// first solve, purchase_price and selling_price are both set to the
// player's CURRENT players.now_cost. Correct before GW1 (nothing bought or
// sold yet); mildly wrong afterwards, since a risen player is worth slightly
// less to sell than his headline price. A real purchase-price ledger is a
// follow-up ticket. Recorded in docs/projection-model-backlog.md.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads SUPABASE_URL, SUPABASE_SECRET_KEY (required), PROJECTIONS_CSV_PATH,
// TEAM_JSON_PATH, SOLVER_CONFIG_PATH and SOLVER_SECS (all optional, sensible
// defaults below). Writes no table other than job_runs, and only on a real
// failure — see "No squad" and "One job_runs row per execution" below.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'

const JOB_NAME = 'solver-run'
const SQUAD_STATE_MIGRATION = 'supabase/migrations/20260811180000_squad_state.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

const DEFAULT_PROJECTIONS_CSV_PATH = './solver/data/fpladvisor.csv'
const DEFAULT_TEAM_JSON_PATH = './solver/data/team.json'
const DEFAULT_SOLVER_CONFIG_PATH = './solver/data/solver-config.json'

/** dev/solver.py's shipped hit_cost default — not read by prep_data from team.json's transfers.cost, but the ticket's DoD requires the field present regardless (see file header). */
export const HIT_COST = 4

/**
 * dev/solver.py:181's default xmin_lb is 100; the SHIPPED comprehensive_settings.json
 * overrides it to 300, which — summed across a 5-gameweek horizon — demands an average of
 * 60 expected minutes a week just to enter the pool. That eliminates every rotation option
 * and a large share of the 45% of the squad list with no Premier League history at all
 * (product-brief.md §8's data-coverage confidence). 150 is a guess, labelled as one: the
 * surviving pool size is reported in job_runs every run so it can be tuned from evidence.
 * See decisions/ticket-41.md.
 */
export const XMIN_LB = 150

/**
 * The solver's own time limit (HiGHS `secs`), NOT the workflow job's timeout-minutes — the
 * job's own timeout-minutes must stay comfortably larger (see .github/workflows/solver-run.yml)
 * so a slow solve returns its best incumbent rather than being killed mid-write.
 */
export const SOLVER_TIME_LIMIT_SECS = 300

const MAX_ALLOWED_HORIZON = 5

/**
 * dev/solver.py's `iteration_criteria` setting for the alternate-solution search (ticket #47's
 * `num_iterations: 3`). The shipped `this_gw_transfer_in_out` requires only the transfer IN or
 * OUT player to differ between alternatives — and varying the OUT player alone is nearly free
 * for the optimiser, so the first real run produced three plans with the SAME incoming player,
 * the SAME captain and identical scores, differing only in which bench player was sold (ticket
 * #60's own Context section). `this_gw_transfer_in` instead requires the INCOMING player to
 * differ — the actual decision a human is choosing between when reading "Plan B". See
 * decisions/ticket-60.md.
 */
export const ITERATION_CRITERION = 'this_gw_transfer_in'

/**
 * Ticket #95. `buildSolverConfig` never used to set this explicitly, so it silently inherited
 * the shipped `data/user_settings.json`'s `keep_top_ev_percent: 5` at the pinned commit
 * (45131c5a41d7caadb5cb626c012bfa9111dca7a2) — the solver has only ever surfaced a handful of
 * distinct transfer targets as a result.
 *
 * dev/solver.py's actual use of this percentile (NOT a percentage of anything intuitive):
 *   cutoff = merged_data["total_ev"].quantile((100 - keep_top_ev_percent) / 100)
 *   safe_players_due_ev = merged_data[(merged_data["total_ev"] > cutoff)]["ID"].tolist()
 * `safe_players_due_ev` (the "safe" set) is EXEMPT from every other pool filter below
 * (EV-per-price efficiency, minutes floor) — so this is the widest lever in the pipeline. At
 * the shipped 5% (~30 of ~600 players) it is narrower than one gameweek's genuinely reasonable
 * transfer targets spread across 4 positions and 20 clubs.
 *
 * Widened to 25 (~150 players) — deliberately, not by measurement: wide enough to plausibly
 * contain a real gameweek's worth of options, still much narrower than the full pool.
 * Deliberately NOT 100 — solve time grows with pool size, and a solver timeout is meant to be a
 * visible signal that the pool is too wide, not something hidden by making the pool so wide the
 * solve simply never finishes. NEITHER this constant NOR EV_PER_PRICE_CUTOFF below is tuned or
 * measured — this is a deliberate widening, argued from the filter mechanics, not evidence. The
 * next ticket to touch this area should narrow with a number, not an argument. See
 * docs/solver-notes.md for the full audit of shipped-vs-overridden solver settings.
 */
export const KEEP_TOP_EV_PERCENT = 25

/**
 * Ticket #95. `buildSolverConfig` never used to set this explicitly, so it silently inherited
 * the shipped `data/user_settings.json`'s `ev_per_price_cutoff: 30`.
 *
 * dev/solver.py's actual use of this percentile:
 *   ev_per_price = merged_data["total_ev"].div(merged_data["now_cost"])
 *   cutoff = ev_per_price.quantile(ev_per_price_cutoff / 100)
 *   merged_data = merged_data[(ev_per_price > cutoff) | (merged_data["ID"].isin(safe_players))].copy()
 * Players below this percentile of EV-per-price are dropped from the pool UNLESS already in
 * the keep_top_ev_percent "safe" set above. At the shipped 30%, this systematically prunes
 * EXPENSIVE players: their EV-per-price is structurally lower than cheap players' even when
 * their raw EV is high, since price is the divisor — and expensive players are exactly the ones
 * a transfer recommendation often turns on.
 *
 * Widened to 10 — removing only genuine dead weight (the bottom decile by efficiency) rather
 * than pruning on a metric that structurally disfavours expensive players. Not tuned or
 * measured — see KEEP_TOP_EV_PERCENT's comment above; the same caveat applies here.
 */
export const EV_PER_PRICE_CUTOFF = 10

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
      `${JOB_NAME}/build-solver-input: required environment variables are not set. ` +
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

interface PathEnv {
  projectionsCsvPath: string
  teamJsonPath: string
  solverConfigPath: string
  solverSecs: number
}

function readPathEnv(): PathEnv {
  const rawSecs = process.env.SOLVER_SECS
  const parsedSecs = rawSecs ? Number(rawSecs) : NaN
  return {
    projectionsCsvPath: process.env.PROJECTIONS_CSV_PATH ?? DEFAULT_PROJECTIONS_CSV_PATH,
    teamJsonPath: process.env.TEAM_JSON_PATH ?? DEFAULT_TEAM_JSON_PATH,
    solverConfigPath: process.env.SOLVER_CONFIG_PATH ?? DEFAULT_SOLVER_CONFIG_PATH,
    solverSecs: Number.isFinite(parsedSecs) && parsedSecs > 0 ? parsedSecs : SOLVER_TIME_LIMIT_SECS,
  }
}

/**
 * GitHub Actions' step-output mechanism: appends `name=value` lines to the file at
 * $GITHUB_OUTPUT. A no-op outside a Step with that env var set (local runs, tests calling
 * main() indirectly never do), matching the rest of this codebase's env-gated-behaviour
 * convention. This is how the workflow learns "no squad yet, skip the solve" without this
 * script needing to know anything about job control.
 */
async function writeGithubOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  await appendFile(outputPath, `${name}=${value}\n`, 'utf8')
}

// ============================================================================
// Errors
// ============================================================================

export class BuildInputError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'BuildInputError'
    this.context = context
  }
}

/**
 * Ticket #83. Mid-season a missing `squads` row for the target gameweek is a failure, not a
 * benign early-season state — `scripts/sync-squad.ts` runs 35 minutes before this job in
 * scheduled-jobs.yml and writes that row every gameweek, so its absence here means the sync
 * failed or never ran (see this file's own header). Writes squad_found=false to $GITHUB_OUTPUT
 * FIRST, before throwing, so .github/workflows/solver-run.yml's step gating sees 'false'
 * regardless of what happens to the thrown error afterwards. Then throws a BuildInputError —
 * main()'s existing catch block turns any BuildInputError into a job_runs row with
 * status: 'failure' (message = this error's message) and a non-zero exit, the same generic
 * mechanism every other failure path in this file already uses. Exported (rather than left
 * inline in main()) so both effects — the $GITHUB_OUTPUT write and the failure message — are
 * directly provable by a unit test without mocking Supabase; see build-solver-input.test.ts.
 */
export async function failNoSquad(gameweekId: number): Promise<never> {
  await writeGithubOutput('squad_found', 'false')
  throw new BuildInputError(
    `no squad is stored in "squads" for gameweek ${gameweekId}. The solver has nothing to solve against — check that ` +
      `scripts/sync-squad.ts ran successfully for gameweek ${gameweekId} (it should run before this job, in ` +
      'scheduled-jobs.yml), then re-check the registered squad.',
    'squads',
  )
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
// job_runs — job_name is 'solver-run' for every row this ticket's two
// scripts write, so the whole workflow's history reads as one execution log
// regardless of which script (or workflow step) detected the outcome. See
// "One job_runs row per execution" in ticket #41's DoD: exactly one of
// {this script's own failure write, an install/checkout-failure write in the
// workflow YAML, scripts/store-solver-output.ts's final write} fires per run
// on the pipeline's overall SUCCESS/FAILURE outcome — never more than one,
// because each only runs on the exit path that is exclusively its own.
//
// Ticket #95 adds a SECOND kind of row on top of that invariant, not a
// replacement for it: a 'success' row written by THIS script, right after
// solverConfig and the projections-CSV player count are known, carrying the
// widened pool-filter counters (see recordWideningJobRun below). It is
// deliberately independent of whether the downstream solve or
// store-solver-output.ts ever runs at all — the whole point of recording the
// widening here is that it must be provable even when the solve times out
// (25% is meant to be tunable from evidence; a timeout is the evidence that
// it's too wide, and that evidence must survive alongside the config that
// produced it). job_runs is an append-only audit log by design (see its
// migration's own COMMENT ON TABLE) — a second row per run for a distinct
// purpose is exactly what it exists for, not a violation of the invariant
// above.
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
      console.error(`${JOB_NAME}/build-solver-input: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure functions — no I/O, unit-testable with no database and no solver.
// ============================================================================

/** The projections CSV's filename stem IS the solver's `datasource` setting (dev/data_parser.py reads DATA_DIR / f"{datasource}.csv") — derived, not a second hardcoded name, so the two can never disagree. */
export function deriveDatasource(csvPath: string): string {
  const base = basename(csvPath)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

export interface CsvHorizonInfo {
  /** Ascending, absolute FPL gameweek ids — one per `{gw}_Pts` column found in the CSV's header. */
  horizonGwIds: number[]
  /** Gameweek ids inside horizonGwIds where every row's {gw}_Pts AND {gw}_xMins is exactly 0 — the zero-fill signature scripts/emit-projections-csv.ts leaves when player_projections has no rows at all for that gameweek (see that script's own file header). */
  emptyGameweekIds: number[]
}

/**
 * Reads the ACTUAL shape of the CSV this job is about to feed the solver — never
 * scripts/project-points.ts's PROJECTION_HORIZON constant — so the horizon this job asks
 * the solver for can never independently drift from what the CSV actually contains. See
 * the file header's "Horizon" section.
 */
export function analyzeProjectionsCsv(records: ReadonlyArray<Record<string, string>>): CsvHorizonInfo {
  if (records.length === 0) return { horizonGwIds: [], emptyGameweekIds: [] }

  const header = Object.keys(records[0])
  const horizonGwIds = header
    .map((col) => /^(\d+)_Pts$/.exec(col))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)

  const emptyGameweekIds = horizonGwIds.filter((gw) => {
    const ptsCol = `${gw}_Pts`
    const minsCol = `${gw}_xMins`
    return records.every((row) => Number(row[ptsCol] ?? 0) === 0 && Number(row[minsCol] ?? 0) === 0)
  })

  return { horizonGwIds, emptyGameweekIds }
}

export interface SolverConfig {
  horizon: number
  team_data: 'json'
  preseason: false
  xmin_lb: number
  keep_top_ev_percent: number
  ev_per_price_cutoff: number
  datasource: string
  chip_limits: { bb: 0; wc: 0; fh: 0; tc: 0 }
  secs: number
  solver: 'highs'
  num_iterations: 3
  iteration_criteria: typeof ITERATION_CRITERION
  verbose: true
  print_result_table: true
  print_squads: true
  print_transfer_chip_summary: true
}

/**
 * Builds the settings-override config passed to `run/solve.py --config <path>`. No file
 * inside the solver checkout is read or written by this function — it is pure JSON assembly.
 * `preseason` is set to `false` EXPLICITLY (not omitted) because the shipped
 * data/user_settings.json ships `preseason: true`, which replaces the whole squad with an
 * empty one (product-brief.md §3: full-squad building is out of scope until the wildcard
 * work) — omitting the key here would silently inherit that.
 *
 * `num_iterations: 3` — ticket #47 (feature-list item 13). product-brief.md §6c: the solver's
 * own `iteration`/`iteration_criteria` mechanism is "exactly the Plan A / Plan B / Plan C
 * requirement" — this is what raises it from item 12's `1`. `iteration_criteria` is set
 * explicitly (never left to a default) to `ITERATION_CRITERION`
 * (`this_gw_transfer_in`, ticket #60) so the alternative solutions differ in WHO comes in this
 * gameweek — the shipped `this_gw_transfer_in_out` only requires the in-OR-out player to differ,
 * and varying the out player is nearly free for the optimiser: the first real run produced three
 * plans with the same incoming player, same captain and identical scores, differing only in
 * which bench player was sold (ticket #60's Context section). See decisions/ticket-60.md. A
 * solve that returns fewer than three distinct solutions is not a failure —
 * scripts/generate-recommendations.ts stores whatever it got (collapsing any that are still the
 * same decision — src/lib/recommendation/distinctness.ts) and records the shortfall.
 *
 * `keep_top_ev_percent: KEEP_TOP_EV_PERCENT` (25) and `ev_per_price_cutoff: EV_PER_PRICE_CUTOFF`
 * (10) — ticket #95. Both are set EXPLICITLY (never left to the shipped
 * data/user_settings.json defaults of 5 and 30) because those shipped defaults were the reason
 * the solver had only ever surfaced a handful of distinct transfer targets. See each constant's
 * own comment above for the percentile semantics and the widening rationale; both values are a
 * deliberate widening, not a measured one — see docs/solver-notes.md.
 */
export function buildSolverConfig(params: { horizon: number; datasource: string; secs?: number }): SolverConfig {
  if (!Number.isInteger(params.horizon) || params.horizon <= 0) {
    throw new BuildInputError(`horizon must be a positive integer, got ${params.horizon}`, 'config')
  }
  if (params.horizon > MAX_ALLOWED_HORIZON) {
    throw new BuildInputError(
      `horizon derived from the projections CSV is ${params.horizon}, which exceeds ${MAX_ALLOWED_HORIZON}. ` +
        "scripts/project-points.ts's PROJECTION_HORIZON and this job's CSV-derived horizon have drifted out of sync — " +
        'see docs/projection-model-backlog.md and the ticket #41 Notes before raising either independently.',
      'config',
    )
  }
  if (!params.datasource) {
    throw new BuildInputError('datasource must not be empty', 'config')
  }

  return {
    horizon: params.horizon,
    team_data: 'json',
    preseason: false,
    xmin_lb: XMIN_LB,
    keep_top_ev_percent: KEEP_TOP_EV_PERCENT,
    ev_per_price_cutoff: EV_PER_PRICE_CUTOFF,
    datasource: params.datasource,
    chip_limits: { bb: 0, wc: 0, fh: 0, tc: 0 },
    secs: params.secs ?? SOLVER_TIME_LIMIT_SECS,
    solver: 'highs',
    num_iterations: 3,
    iteration_criteria: ITERATION_CRITERION,
    verbose: true,
    print_result_table: true,
    print_squads: true,
    print_transfer_chip_summary: true,
  }
}

export interface WideningJobRunDetails {
  /** Row count of the projections CSV this job read — the pool the two percentile filters below are computed against. */
  projectionsPlayerCount: number
  keepTopEvPercent: number
  evPerPriceCutoff: number
}

/**
 * Ticket #95's "counters proving the widening happened" — pure so the shape is provable without
 * mocking Supabase, matching this file's existing pattern for everything test-relevant. Always
 * reads the two widening constants directly (never a value threaded through from elsewhere), so
 * the job_runs row this feeds can never disagree with the config actually built in the same run.
 * Deliberately does NOT compute or accept a "post-filter pool size" — that number only exists in
 * dev/solver.py's own stdout at solve time, not visible to this job (see the file header).
 */
export function buildWideningJobRunDetails(projectionsPlayerCount: number): WideningJobRunDetails {
  return {
    projectionsPlayerCount,
    keepTopEvPercent: KEEP_TOP_EV_PERCENT,
    evPerPriceCutoff: EV_PER_PRICE_CUTOFF,
  }
}

export interface TeamJsonPickInput {
  playerId: number
  squadPosition: number
  isStarting: boolean
  isCaptain: boolean
  isViceCaptain: boolean
  /** players.now_cost at build time — used for BOTH purchase_price and selling_price. See the file header's "Purchase/selling price" note. */
  nowCost: number
  elementType: number
}

export interface TeamJsonSquadInput {
  /** squads.bank — tenths of a million, same convention as players.now_cost. */
  bank: number
  /** squads.squad_value — tenths of a million. */
  squadValue: number
  /** squads.free_transfers. */
  freeTransfers: number
}

export interface SolverTeamJson {
  picks: Array<{
    element: number
    position: number
    purchase_price: number
    selling_price: number
    element_type: number
    multiplier: number
    is_captain: boolean
    is_vice_captain: boolean
  }>
  chips: never[]
  transfers: {
    bank: number
    value: number
    cost: number
    limit: number
    made: number
  }
}

/**
 * Builds data/team.json's exact shape from OUR OWN squads/squad_picks rows — never from FPL's
 * authenticated endpoint (see file header). `multiplier`, `is_captain` and
 * `is_vice_captain` are not read by dev/solver.py's prep_data at the pinned commit (verified
 * by reading the source — only `element` and `selling_price` are), but are included to match
 * the shape the solver's own id-mode team-fetch helper produces, for any downstream tooling
 * that does read them.
 * `transfers.made` is set to 0 unconditionally: this app does not track transfers already
 * made against the current gameweek's free-transfer allowance separately from
 * squads.free_transfers, so "0 made, limit = free_transfers" is the correct fact for a squad
 * that has not yet used any of this gameweek's transfers. `transfers.made` IS read by
 * dev/solver.py (`my_data["transfers"]["limit"] - my_data["transfers"]["made"]`) — omitting it
 * would crash the solver with a KeyError, even though it is not named in the ticket's DoD list.
 */
export function buildTeamJson(squad: TeamJsonSquadInput, picks: readonly TeamJsonPickInput[]): SolverTeamJson {
  if (picks.length !== 15) {
    throw new BuildInputError(`squad_picks has ${picks.length} row(s) for this gameweek, expected exactly 15`, 'squad_picks')
  }

  return {
    picks: picks.map((p) => ({
      element: p.playerId,
      position: p.squadPosition,
      purchase_price: p.nowCost,
      selling_price: p.nowCost,
      element_type: p.elementType,
      multiplier: p.isCaptain ? 2 : p.isStarting ? 1 : 0,
      is_captain: p.isCaptain,
      is_vice_captain: p.isViceCaptain,
    })),
    chips: [],
    transfers: {
      bank: squad.bank,
      value: squad.squadValue,
      cost: HIT_COST,
      limit: squad.freeTransfers,
      made: 0,
    },
  }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

interface SquadRow {
  gameweek_id: number
  bank: number
  squad_value: number
  free_transfers: number
}

interface SquadPickRow {
  squad_position: number
  player_id: number
  is_starting: boolean
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
}

interface PlayerRow {
  id: number
  now_cost: number
  element_type: number
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
    // 1. Target gameweek — same anchor as scripts/emit-projections-csv.ts.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new BuildInputError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new BuildInputError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const nextGw = (gwRows ?? []).find((gw) => gw.is_next)
    if (!nextGw) {
      throw new BuildInputError(
        'no gameweek has is_next = true. Run scripts/ingest-fpl.ts to refresh gameweeks, or the season has ended.',
        'gameweeks',
      )
    }

    // --------------------------------------------------------------------
    // 2. Squad existence — mid-season this is a FAILURE, not a benign
    //    state (ticket #83). scripts/sync-squad.ts writes a `squads` row
    //    for every gameweek and runs 35 minutes before this job
    //    (scheduled-jobs.yml, 17:45 UTC, vs. this workflow's 18:20 UTC), so
    //    a missing row here means that sync failed or never ran. See
    //    failNoSquad() above for the write-then-throw mechanics.
    // --------------------------------------------------------------------
    const { data: squadRows, error: squadError } = await supabase
      .from('squads')
      .select('gameweek_id, bank, squad_value, free_transfers')
      .eq('gameweek_id', nextGw.id)
      .returns<SquadRow[]>()
    if (squadError) {
      if (isMissingTable(squadError, 'squads')) {
        throw new BuildInputError(`the "squads" table does not exist. Apply ${SQUAD_STATE_MIGRATION} first.`, 'squads')
      }
      throw new BuildInputError(`squads lookup failed: ${squadError.message}`, 'squads')
    }
    const squadRow = squadRows?.[0]
    if (!squadRow) {
      await failNoSquad(nextGw.id)
    }

    // --------------------------------------------------------------------
    // 3. Squad picks — must be exactly 15 rows.
    // --------------------------------------------------------------------
    const { data: pickRows, error: pickError } = await supabase
      .from('squad_picks')
      .select('squad_position, player_id, is_starting, bench_order, is_captain, is_vice_captain')
      .eq('gameweek_id', nextGw.id)
      .order('squad_position', { ascending: true })
      .returns<SquadPickRow[]>()
    if (pickError) {
      throw new BuildInputError(`squad_picks lookup failed: ${pickError.message}`, 'squad_picks')
    }
    if (!pickRows || pickRows.length !== 15) {
      throw new BuildInputError(
        `squad_picks has ${pickRows?.length ?? 0} row(s) for gameweek ${nextGw.id}, expected exactly 15. ` +
          'The registered squad is incomplete — re-check it (manual entry #13 or API sync #14) before solving.',
        'squad_picks',
      )
    }

    // --------------------------------------------------------------------
    // 4. Players — now_cost (purchase/selling price fallback) and
    //    element_type for each picked player.
    // --------------------------------------------------------------------
    const pickedPlayerIds = pickRows.map((p) => p.player_id)
    const { data: playerRows, error: playerError } = await supabase
      .from('players')
      .select('id, now_cost, element_type')
      .in('id', pickedPlayerIds)
      .returns<PlayerRow[]>()
    if (playerError) {
      throw new BuildInputError(`players lookup failed: ${playerError.message}`, 'players')
    }
    const playerById = new Map<number, PlayerRow>((playerRows ?? []).map((p) => [p.id, p]))
    const missingPlayerIds = pickedPlayerIds.filter((id) => !playerById.has(id))
    if (missingPlayerIds.length > 0) {
      throw new BuildInputError(
        `squad_picks references player id(s) ${missingPlayerIds.join(', ')} not present in "players". ` +
          'Run scripts/ingest-fpl.ts to refresh players, or re-check the stored squad.',
        'players',
      )
    }

    const teamJson = buildTeamJson(
      { bank: squadRow.bank, squadValue: squadRow.squad_value, freeTransfers: squadRow.free_transfers },
      pickRows.map((p) => {
        const player = playerById.get(p.player_id)! // presence checked above
        return {
          playerId: p.player_id,
          squadPosition: p.squad_position,
          isStarting: p.is_starting,
          isCaptain: p.is_captain,
          isViceCaptain: p.is_vice_captain,
          nowCost: player.now_cost,
          elementType: player.element_type,
        }
      }),
    )

    // --------------------------------------------------------------------
    // 5. Projections CSV — must exist, must have data rows, and every
    //    horizon gameweek must have at least one non-zero projection. Fails
    //    BEFORE the solver is ever invoked (a later ValueError from inside
    //    dev/solver.py would be a much less specific message for the same
    //    root cause).
    // --------------------------------------------------------------------
    let csvText: string
    try {
      csvText = await readFile(paths.projectionsCsvPath, 'utf8')
    } catch {
      throw new BuildInputError(
        `projections CSV not found at ${paths.projectionsCsvPath}. Run scripts/emit-projections-csv.ts (with a matching ` +
          'PROJECTIONS_CSV_PATH) before this job.',
        'projections_csv',
      )
    }
    if (csvText.trim().length === 0) {
      throw new BuildInputError(`projections CSV at ${paths.projectionsCsvPath} is empty.`, 'projections_csv')
    }
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
    if (records.length === 0) {
      throw new BuildInputError(`projections CSV at ${paths.projectionsCsvPath} has a header but no data rows.`, 'projections_csv')
    }

    const { horizonGwIds, emptyGameweekIds } = analyzeProjectionsCsv(records)
    if (horizonGwIds.length === 0) {
      throw new BuildInputError(
        `projections CSV at ${paths.projectionsCsvPath} has no {gw}_Pts columns — malformed input.`,
        'projections_csv',
      )
    }
    if (emptyGameweekIds.length > 0) {
      throw new BuildInputError(
        `projections CSV at ${paths.projectionsCsvPath} has zero projection rows for gameweek(s) ${emptyGameweekIds.join(', ')} ` +
          '(every player projects 0 points and 0 minutes) — run scripts/project-points.ts before this job.',
        'projections_csv',
      )
    }

    const datasource = deriveDatasource(paths.projectionsCsvPath)
    const solverConfig = buildSolverConfig({ horizon: horizonGwIds.length, datasource, secs: paths.solverSecs })

    // --------------------------------------------------------------------
    // 6. Write both files. No file inside the solver checkout other than
    //    these two (team.json and the config JSON, both under solver/data/
    //    by default) is ever written.
    // --------------------------------------------------------------------
    await mkdir(dirname(paths.teamJsonPath), { recursive: true })
    await writeFile(paths.teamJsonPath, JSON.stringify(teamJson, null, 2) + '\n', 'utf8')

    await mkdir(dirname(paths.solverConfigPath), { recursive: true })
    await writeFile(paths.solverConfigPath, JSON.stringify(solverConfig, null, 2) + '\n', 'utf8')

    const message =
      `${JOB_NAME}/build-solver-input: wrote ${paths.teamJsonPath} (15 picks) and ${paths.solverConfigPath} ` +
      `(horizon ${solverConfig.horizon}, datasource "${solverConfig.datasource}") for gameweek ${nextGw.id}.`
    console.log(message)

    await writeGithubOutput('squad_found', 'true')
    await writeGithubOutput('gameweek_id', String(nextGw.id))
    await writeGithubOutput('horizon', String(solverConfig.horizon))
    await writeGithubOutput('datasource', solverConfig.datasource)

    // --------------------------------------------------------------------
    // 7. Widening counters (ticket #95) — a job_runs row independent of the
    //    pipeline's overall success/failure write; see the "job_runs"
    //    section header above for why this is a deliberate second row, not
    //    a violation of the one-row-per-outcome invariant.
    // --------------------------------------------------------------------
    const wideningDetails = buildWideningJobRunDetails(records.length)
    const wideningMessage =
      `${JOB_NAME}/build-solver-input: solver pool widened deliberately (ticket #95) — ` +
      `keep_top_ev_percent=${wideningDetails.keepTopEvPercent}, ev_per_price_cutoff=${wideningDetails.evPerPriceCutoff}, ` +
      `projections CSV has ${wideningDetails.projectionsPlayerCount} players.`
    console.log(wideningMessage)
    await recordJobRun(supabase, {
      status: 'success',
      message: wideningMessage,
      details: { ...wideningDetails },
      startedAt,
    })
  } catch (err) {
    const message =
      err instanceof BuildInputError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}/build-solver-input: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}/build-solver-input: additionally failed to record the failed job_runs row: ${recordMessage}`)
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
    console.error(`${JOB_NAME}/build-solver-input: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
