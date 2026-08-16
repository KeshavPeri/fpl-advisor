// Generate the weekly recommendation — ticket #47 (feature-list item 13,
// "the loop's last piece of thinking"). Runs after "Store solver output" in
// .github/workflows/solver-run.yml. Reads solver_runs/solver_picks
// (written by ticket #41's scripts/store-solver-output.ts) and
// public.player_match_stats (for the data-coverage check, product-brief.md
// §8), and writes Plan A/B/C to public.recommendations /
// public.recommendation_reasons.
//
// It does not run the solver and does not re-derive its picks — every
// number here comes from what ticket #41 already stored. See
// src/lib/recommendation/ for the pure functions this job wires together:
// the confidence band, the hit-cost arithmetic, bench-order interpretation,
// "what changed" (transfer in/out or an explicit roll), plan ranking, and
// the coverage check.
//
// ============================================================================
// `ft` and `transfer_count` — why this job derives them instead of reading
// the solver's own CSV columns.
// ============================================================================
// The solver's results CSV carries a `ft` (free transfers available) and a
// `transfer_count` (transfers made) column per row, and both arrive as
// floats with binary noise (`0.9999999999999996` for a true value of `1` —
// see this ticket's own Context section). But `scripts/store-solver-
// output.ts` (ticket #41, already merged and out of this ticket's scope —
// see its own Scope constraint) never persists either column into
// `solver_picks`; only `id, week, name, pos, type, team, buy_price,
// sell_price, xP, xMin, squad, lineup, bench, captain, vicecaptain,
// transfer_in, transfer_out, iter` are stored (verified by reading that
// migration and script directly). Re-deriving these two facts from data
// this job already has avoids touching #41's script or its migration,
// which this ticket's Scope constraint does not list:
//   - transfers made: the COUNT of `is_transfer_in` picks for a plan's
//     current gameweek — an exact integer, no floating-point noise enters
//     the picture at all.
//   - free transfers available: `squads.free_transfers` for the current
//     gameweek — the same integer value the solver itself was given via
//     `team.json`'s `transfers.limit` when scripts/build-solver-input.ts
//     built it.
// Both are still routed through src/lib/recommendation/rounding.ts's
// `roundSolverCount` before use regardless (a no-op on an already-exact
// integer) — see this ticket's DoD and that module's own tests
// (`0.9999999999999996` / `1.0000000000000044`) for the guard this
// defends, in case a future ticket wires the solver's raw columns in
// directly. This is a Tier 2 (HIGH-IMPACT) decision — see
// decisions/ticket-47.md.
//
// ============================================================================
// Which run's picks. solver_picks is "the current best plan", not history.
// ============================================================================
// solver_picks can hold rows written by different solver_runs executions at
// once (a horizon shift leaves an older gameweek's rows under an older
// run_id — see that migration's own header). This job reads every row,
// finds the HIGHEST run_id present, and uses only rows carrying it — the
// complete, self-consistent output of one execution, never a mix of two.
// The current gameweek is then the LOWEST gameweek_id among that run's own
// rows — "the first week in the solver's own output," never a hardcoded
// gameweek 1 and never today's wall-clock date (see this ticket's Notes).
//
// ============================================================================
// Wiring
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY. No VITE_-prefixed
// variable. Writes recommendations/recommendation_reasons (upsert only —
// `.delete(` does not appear anywhere in this file) and one job_runs row
// per execution, job_name 'solver-run' (matching build-solver-input.ts and
// store-solver-output.ts — every script in this one workflow shares a
// job_name so the workflow's history reads as one execution log).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import {
  applyCoverageFloor,
  buildReasonLines,
  checkCoverage,
  computeHitCost,
  computeNetPoints,
  computePlanScore,
  deriveConfidenceBand,
  deriveLineup,
  deriveTransferSummary,
  detectIterationShortfall,
  findCaptain,
  findViceCaptain,
  hasAnyCoverageGap,
  rankSolutions,
  roundSolverCount,
  type ConfidenceBand,
  type CoveragePlayerRef,
  type CoverageCheckedRole,
} from '../src/lib/recommendation/index.ts'

const JOB_NAME = 'solver-run'
const RECOMMENDATIONS_MIGRATION = 'supabase/migrations/20260817090000_recommendations.sql'
const SOLVER_OUTPUT_MIGRATION = 'supabase/migrations/20260816090000_solver_output.sql'
const SQUAD_STATE_MIGRATION = 'supabase/migrations/20260811180000_squad_state.sql'

/** Must match scripts/build-solver-input.ts's own `num_iterations` (3) — duplicated, not imported (scripts/*.ts jobs are standalone entry points, same convention as PROJECTION_HORIZON in scripts/emit-projections-csv.ts). Used only to size the shortfall report in job_runs.details; a solve that returns fewer distinct solutions than this is not a failure — see detectIterationShortfall. */
export const NUM_ITERATIONS_REQUESTED = 3

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
      `${JOB_NAME}/generate-recommendations: required environment variables are not set. ` +
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

export class GenerateRecommendationsError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'GenerateRecommendationsError'
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
      console.error(`${JOB_NAME}/generate-recommendations: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface SolverPickRow {
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
  run_id: number | null
}

interface SolverRunRow {
  id: number
  gameweek_id: number
  solver_status: string
}

interface SquadRow {
  gameweek_id: number
  free_transfers: number
}

interface PlayerRow {
  id: number
  web_name: string
}

interface MatchStatsCodeRow {
  player_code: number | null
}

// ============================================================================
// Pure helpers — no I/O, unit-testable with no database. Everything below
// this point that touches SolverPickRow[] is provable without Supabase.
// ============================================================================

/**
 * Which run's picks to build a recommendation from — the HIGHEST run_id
 * present among the given rows. `solver_picks` is upserted per-row by
 * `scripts/store-solver-output.ts`, so a horizon shift can leave rows from
 * an OLDER run under an older run_id sitting alongside a newer run's rows
 * (see this file's own header). Selecting the max run_id, then filtering
 * to only rows carrying it, is what keeps this job reading one execution's
 * complete, self-consistent output and never a mix of two. Returns null
 * when every row has a null run_id (should not happen for any row written
 * by ticket #41's script, but this function does not assume it).
 */
export function findLatestRunId(picks: readonly { run_id: number | null }[]): number | null {
  return picks.reduce<number | null>((max, p) => (p.run_id !== null && (max === null || p.run_id > max) ? p.run_id : max), null)
}

/**
 * The current gameweek — "the FIRST week in the solver's own output, not
 * gameweek 1 and not today's date" (this ticket's own Notes). The lowest
 * `gameweek_id` among the rows passed in — callers pass only the latest
 * run's own rows (see `findLatestRunId`), never the whole table, so this
 * cannot pick up a stale gameweek left over from an older, unrelated run.
 */
export function deriveCurrentGameweekId(runPicks: readonly { gameweek_id: number }[]): number {
  return runPicks.reduce((min, p) => Math.min(min, p.gameweek_id), Number.POSITIVE_INFINITY)
}

// ============================================================================
// Pure-ish local helpers — thin glue between the DB row shapes above and
// src/lib/recommendation/'s pure input types. No I/O.
// ============================================================================

export interface PlanPlayerRef {
  playerId: number
  playerCode: number | null
}

/** Extracts the {playerId, playerCode} pair from any of src/lib/recommendation/'s already-camelCase pick shapes (transfer summary, lineup/bench entries, captain/vice-captain) — never from a raw snake_case SolverPickRow, which is mapped to those shapes first. */
function toPlayerRef(pick: { playerId: number; playerCode: number | null }): PlanPlayerRef {
  return { playerId: pick.playerId, playerCode: pick.playerCode }
}

/** Builds the coverage refs for one plan: transfer-in/out (skipped for a roll) plus captain and vice-captain — the players actually named in the recommendation (product-brief.md §8). */
export function buildCoverageRefs(params: {
  isRoll: boolean
  transferIn: PlanPlayerRef | null
  transferOut: PlanPlayerRef | null
  captain: PlanPlayerRef
  viceCaptain: PlanPlayerRef
}): CoveragePlayerRef[] {
  const refs: CoveragePlayerRef[] = []
  const push = (role: CoverageCheckedRole, ref: PlanPlayerRef | null) => {
    if (ref) refs.push({ role, playerId: ref.playerId, playerCode: ref.playerCode })
  }
  if (!params.isRoll) {
    push('transferIn', params.transferIn)
    push('transferOut', params.transferOut)
  }
  push('captain', params.captain)
  push('viceCaptain', params.viceCaptain)
  return refs
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

  try {
    // --------------------------------------------------------------------
    // 1. Every solver_picks row. Paginated and count-verified — the same
    //    ceiling scripts/emit-projections-csv.ts and scripts/project-
    //    points.ts guard against (scripts/lib/paginate.ts's file header).
    //    Realistic size today: up to 15 players x 5 gameweeks x 3
    //    iterations = 225 rows, comfortably under the page size, but this
    //    job pages and count-checks regardless — see this ticket's DoD.
    // --------------------------------------------------------------------
    const {
      rows: allPicks,
      error: picksError,
      pages: picksPagesFetched,
    } = await fetchAllPages<SolverPickRow>((from, to) =>
      supabase
        .from('solver_picks')
        .select(
          'solution_index, gameweek_id, player_id, player_code, is_lineup, bench_order, is_captain, is_vice_captain, is_transfer_in, is_transfer_out, expected_points, run_id',
        )
        .range(from, to)
        .returns<SolverPickRow[]>(),
    )
    if (picksError) {
      if (isMissingTable(picksError, 'solver_picks')) {
        throw new GenerateRecommendationsError(`the "solver_picks" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_picks')
      }
      throw new GenerateRecommendationsError(`solver_picks lookup failed: ${picksError.message}`, 'solver_picks')
    }
    const { count: picksExpectedByCount, error: picksCountError } = await supabase
      .from('solver_picks')
      .select('*', { count: 'exact', head: true })
    if (picksCountError) {
      throw new GenerateRecommendationsError(`solver_picks count check failed: ${picksCountError.message}`, 'solver_picks')
    }
    assertRowCountMatches('solver_picks', allPicks.length, picksExpectedByCount ?? 0)

    // --------------------------------------------------------------------
    // 2. No solve at all yet — a normal state (e.g. before #41's workflow
    //    has ever produced output), not a failure. Exit 0, write nothing —
    //    same shape as scripts/build-solver-input.ts's "no squad" path.
    // --------------------------------------------------------------------
    if (allPicks.length === 0) {
      console.log(
        `${JOB_NAME}/generate-recommendations: "solver_picks" has no rows at all. Nothing to build a recommendation from — ` +
          'making no further request. Run the solver (scripts/store-solver-output.ts) before this job.',
      )
      process.exit(0)
      return
    }

    // --------------------------------------------------------------------
    // 3. The latest run's rows only — see file header for why the highest
    //    run_id, not solver_runs.gameweek_id, decides which rows are used.
    // --------------------------------------------------------------------
    const latestRunId = findLatestRunId(allPicks)
    if (latestRunId === null) {
      throw new GenerateRecommendationsError('every "solver_picks" row has a null run_id — cannot determine the latest solve.', 'solver_picks')
    }
    const runPicks = allPicks.filter((p) => p.run_id === latestRunId)

    const currentGw = deriveCurrentGameweekId(runPicks)

    // Cross-check against solver_runs.gameweek_id — logged, not enforced,
    // since the picks themselves are the source of truth here (file
    // header). A mismatch would mean this job's assumption about which
    // rows belong together has drifted from ticket #41's own bookkeeping.
    const { data: solverRunRow, error: solverRunError } = await supabase
      .from('solver_runs')
      .select('id, gameweek_id, solver_status')
      .eq('id', latestRunId)
      .maybeSingle<SolverRunRow>()
    if (solverRunError) {
      if (isMissingTable(solverRunError, 'solver_runs')) {
        throw new GenerateRecommendationsError(`the "solver_runs" table does not exist. Apply ${SOLVER_OUTPUT_MIGRATION} first.`, 'solver_runs')
      }
      throw new GenerateRecommendationsError(`solver_runs lookup failed: ${solverRunError.message}`, 'solver_runs')
    }
    if (solverRunRow && solverRunRow.gameweek_id !== currentGw) {
      console.warn(
        `${JOB_NAME}/generate-recommendations: solver_runs.id=${latestRunId} recorded gameweek_id ${solverRunRow.gameweek_id}, but its ` +
          `own solver_picks rows' lowest gameweek_id is ${currentGw}. Using ${currentGw} (derived from the picks themselves — see file header).`,
      )
    }

    // --------------------------------------------------------------------
    // 4. squads.free_transfers for the current gameweek — the same figure
    //    the solver itself was given (team.json's transfers.limit), not
    //    the solver's own noisy `ft` CSV column (file header). A single-
    //    row lookup, not paginated (squads.gameweek_id is a primary key).
    // --------------------------------------------------------------------
    const { data: squadRow, error: squadError } = await supabase
      .from('squads')
      .select('gameweek_id, free_transfers')
      .eq('gameweek_id', currentGw)
      .maybeSingle<SquadRow>()
    if (squadError) {
      if (isMissingTable(squadError, 'squads')) {
        throw new GenerateRecommendationsError(`the "squads" table does not exist. Apply ${SQUAD_STATE_MIGRATION} first.`, 'squads')
      }
      throw new GenerateRecommendationsError(`squads lookup failed: ${squadError.message}`, 'squads')
    }
    if (!squadRow) {
      throw new GenerateRecommendationsError(
        `no "squads" row for gameweek ${currentGw}, but solver_picks already holds a solve for it — the squad the solver was ` +
          'given is missing from this app\'s own record. Re-check squads/squad_picks before re-running.',
        'squads',
      )
    }
    const freeTransfersAvailable = roundSolverCount(squadRow.free_transfers)

    // --------------------------------------------------------------------
    // 5. Score and rank every distinct solution present, across the WHOLE
    //    solve horizon (not just the current gameweek) — the same
    //    quantity the multi-period solver itself was optimising for. See
    //    src/lib/recommendation/score.ts and ranking.ts.
    // --------------------------------------------------------------------
    const picksBySolution = new Map<number, SolverPickRow[]>()
    for (const pick of runPicks) {
      const list = picksBySolution.get(pick.solution_index) ?? []
      list.push(pick)
      picksBySolution.set(pick.solution_index, list)
    }

    const scoresBySolution = new Map<number, number>()
    for (const [solutionIndex, picks] of picksBySolution) {
      scoresBySolution.set(
        solutionIndex,
        computePlanScore(picks.map((p) => ({ isLineup: p.is_lineup, isCaptain: p.is_captain, expectedPoints: p.expected_points }))),
      )
    }

    const ranked = rankSolutions(scoresBySolution)
    const shortfall = detectIterationShortfall(NUM_ITERATIONS_REQUESTED, ranked.length)
    if (shortfall.isShortfall) {
      console.warn(
        `${JOB_NAME}/generate-recommendations: requested ${shortfall.requested} solutions, found ${shortfall.found} distinct ` +
          `solution_index value(s) for gameweek ${currentGw}. Storing what was found — not a failure (see ticket #47's DoD).`,
      )
    }

    // Base confidence band: the gap between Plan A (best score) and Plan B
    // (second-best), across the horizon. A single-solution solve has no
    // "B" to compare against — treated as maximally confident (Infinity
    // gap -> 'clear') since there is no competing alternative to hedge
    // against; the coverage floor below can still lower it per plan. Tier
    // 3, logged in decisions/ticket-47.md.
    const scoreGap = ranked.length >= 2 ? Math.abs(ranked[0].score - ranked[1].score) : Number.POSITIVE_INFINITY
    const baseBand: ConfidenceBand = deriveConfidenceBand(scoreGap)

    // --------------------------------------------------------------------
    // 6. Per-plan facts: lineup, transfer summary, hit cost, gross/net.
    // --------------------------------------------------------------------
    interface PlanBuild {
      planIndex: number
      solutionIndex: number
      score: number
      isRoll: boolean
      transferIn: PlanPlayerRef | null
      transferOut: PlanPlayerRef | null
      captain: PlanPlayerRef
      viceCaptain: PlanPlayerRef
      startingXI: PlanPlayerRef[]
      bench: PlanPlayerRef[]
      transfersMade: number
      hitCost: number
      grossPoints: number
      netPoints: number
    }

    const plans: PlanBuild[] = []
    for (const { solutionIndex, score, planIndex } of ranked) {
      const currentGwPicks = (picksBySolution.get(solutionIndex) ?? []).filter((p) => p.gameweek_id === currentGw)

      const { startingXI, bench } = deriveLineup(
        currentGwPicks.map((p) => ({
          playerId: p.player_id,
          playerCode: p.player_code,
          isLineup: p.is_lineup,
          benchOrder: p.bench_order,
          isCaptain: p.is_captain,
          isViceCaptain: p.is_vice_captain,
        })),
      )
      if (startingXI.length !== 11) {
        throw new GenerateRecommendationsError(
          `solution ${solutionIndex}, gameweek ${currentGw}: expected 11 starting players, found ${startingXI.length}. ` +
            'The stored solver output for this gameweek looks incomplete — re-check solver_picks before re-running.',
          'solver_picks',
        )
      }
      const captain = findCaptain(startingXI)
      const viceCaptain = findViceCaptain(startingXI)
      if (!captain || !viceCaptain) {
        throw new GenerateRecommendationsError(
          `solution ${solutionIndex}, gameweek ${currentGw}: missing a captain or vice-captain in the starting XI. ` +
            'The stored solver output for this gameweek looks incomplete — re-check solver_picks before re-running.',
          'solver_picks',
        )
      }

      const transferSummary = deriveTransferSummary(
        currentGwPicks.map((p) => ({
          playerId: p.player_id,
          playerCode: p.player_code,
          isTransferIn: p.is_transfer_in,
          isTransferOut: p.is_transfer_out,
        })),
      )
      const transfersMade = roundSolverCount(transferSummary.transfersMade)
      const hitCost = computeHitCost(transfersMade, freeTransfersAvailable)
      const grossPoints = score
      const netPoints = computeNetPoints(grossPoints, hitCost)

      plans.push({
        planIndex,
        solutionIndex,
        score,
        isRoll: transferSummary.isRoll,
        transferIn: transferSummary.transferIn ? toPlayerRef(transferSummary.transferIn) : null,
        transferOut: transferSummary.transferOut ? toPlayerRef(transferSummary.transferOut) : null,
        captain: toPlayerRef(captain),
        viceCaptain: toPlayerRef(viceCaptain),
        startingXI: startingXI.map(toPlayerRef),
        bench: bench.map(toPlayerRef),
        transfersMade,
        hitCost,
        grossPoints,
        netPoints,
      })
    }

    // --------------------------------------------------------------------
    // 7. Data-coverage check (product-brief.md §8) — every player named in
    //    a recommendation (transfer in/out, captain, vice-captain) across
    //    every plan, checked once in a single batch query.
    // --------------------------------------------------------------------
    const coverageRefsByPlan = new Map<number, CoveragePlayerRef[]>()
    const allCoverageCodes = new Set<number>()
    for (const plan of plans) {
      const refs = buildCoverageRefs(plan)
      coverageRefsByPlan.set(plan.planIndex, refs)
      for (const ref of refs) {
        if (ref.playerCode !== null) allCoverageCodes.add(ref.playerCode)
      }
    }

    const codesWithHistory = new Set<number>()
    if (allCoverageCodes.size > 0) {
      const codesArray = [...allCoverageCodes]
      const {
        rows: matchStatsRows,
        error: matchStatsError,
        pages: matchStatsPagesFetched,
      } = await fetchAllPages<MatchStatsCodeRow>((from, to) =>
        supabase.from('player_match_stats').select('player_code').in('player_code', codesArray).range(from, to).returns<MatchStatsCodeRow[]>(),
      )
      if (matchStatsError) {
        throw new GenerateRecommendationsError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
      }
      const { count: matchStatsExpectedByCount, error: matchStatsCountError } = await supabase
        .from('player_match_stats')
        .select('*', { count: 'exact', head: true })
        .in('player_code', codesArray)
      if (matchStatsCountError) {
        throw new GenerateRecommendationsError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
      }
      assertRowCountMatches('player_match_stats (coverage check)', matchStatsRows.length, matchStatsExpectedByCount ?? 0)
      void matchStatsPagesFetched // logged via job_runs.details below
      for (const row of matchStatsRows) {
        if (row.player_code !== null) codesWithHistory.add(row.player_code)
      }
    }

    // --------------------------------------------------------------------
    // 8. Player names for the reason lines — every player referenced by
    //    any plan (transfer in/out, captain, vice-captain, and every
    //    coverage-checked player, which is the same set).
    // --------------------------------------------------------------------
    const allPlayerIds = new Set<number>()
    for (const plan of plans) {
      if (plan.transferIn) allPlayerIds.add(plan.transferIn.playerId)
      if (plan.transferOut) allPlayerIds.add(plan.transferOut.playerId)
      allPlayerIds.add(plan.captain.playerId)
      allPlayerIds.add(plan.viceCaptain.playerId)
    }
    const playerIdsArray = [...allPlayerIds]
    const {
      rows: playerRows,
      error: playersError,
      pages: playersPagesFetched,
    } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('id, web_name').in('id', playerIdsArray).range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) {
      throw new GenerateRecommendationsError(`players lookup failed: ${playersError.message}`, 'players')
    }
    const { count: playersExpectedByCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .in('id', playerIdsArray)
    if (playersCountError) {
      throw new GenerateRecommendationsError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players (name lookup)', playerRows.length, playersExpectedByCount ?? 0)
    const playerNameById = new Map<number, string>(playerRows.map((p) => [p.id, p.web_name]))
    const nameFor = (ref: PlanPlayerRef): string => playerNameById.get(ref.playerId) ?? `Player ${ref.playerId}`

    // --------------------------------------------------------------------
    // 9. Assemble and upsert. Each plan's own confidence band is the
    //    shared base band, floored (never raised) by ITS OWN coverage gap
    //    — product-brief.md §8: "a recommendation whose transfer-in has no
    //    history drops one confidence band," which is a per-recommendation
    //    fact, not a whole-gameweek one.
    // --------------------------------------------------------------------
    const recommendationRows: JsonRecord[] = []
    const reasonRows: JsonRecord[] = []
    let plansWithCoverageGap = 0

    for (const plan of plans) {
      const coverageRefs = coverageRefsByPlan.get(plan.planIndex) ?? []
      const coverageResults = checkCoverage(coverageRefs, codesWithHistory)
      const coverageGap = hasAnyCoverageGap(coverageResults)
      if (coverageGap) plansWithCoverageGap++
      const confidenceBand = applyCoverageFloor(baseBand, coverageGap)

      const grossPointsRounded = Math.round(plan.grossPoints)
      const netPointsRounded = Math.round(plan.netPoints)

      recommendationRows.push({
        gameweek_id: currentGw,
        plan_index: plan.planIndex,
        solution_index: plan.solutionIndex,
        solver_run_id: latestRunId,
        is_roll: plan.isRoll,
        transfer_in_player_id: plan.transferIn?.playerId ?? null,
        transfer_in_player_code: plan.transferIn?.playerCode ?? null,
        transfer_out_player_id: plan.transferOut?.playerId ?? null,
        transfer_out_player_code: plan.transferOut?.playerCode ?? null,
        captain_player_id: plan.captain.playerId,
        captain_player_code: plan.captain.playerCode,
        vice_captain_player_id: plan.viceCaptain.playerId,
        vice_captain_player_code: plan.viceCaptain.playerCode,
        starting_xi: plan.startingXI,
        bench_order: plan.bench,
        free_transfers_available: freeTransfersAvailable,
        transfers_made: plan.transfersMade,
        hit_cost: plan.hitCost,
        gross_points: plan.grossPoints,
        gross_points_rounded: grossPointsRounded,
        net_points: plan.netPoints,
        net_points_rounded: netPointsRounded,
        confidence_band: confidenceBand,
        updated_at: new Date().toISOString(),
      })

      const coverageGapNames = coverageResults
        .filter((r) => !r.hasHistory)
        .map((r) => ({ role: r.role, name: playerNameById.get(r.playerId) ?? `Player ${r.playerId}` }))

      const lines = buildReasonLines({
        isRoll: plan.isRoll,
        transferInName: plan.transferIn ? nameFor(plan.transferIn) : null,
        transferOutName: plan.transferOut ? nameFor(plan.transferOut) : null,
        captainName: nameFor(plan.captain),
        viceCaptainName: nameFor(plan.viceCaptain),
        hitCost: plan.hitCost,
        transfersMade: plan.transfersMade,
        freeTransfersAvailable,
        grossPointsRounded,
        netPointsRounded,
        confidenceBand,
        coverageGaps: coverageGapNames,
      })

      lines.forEach((reason, orderIndex) => {
        reasonRows.push({ gameweek_id: currentGw, plan_index: plan.planIndex, order_index: orderIndex, reason, updated_at: new Date().toISOString() })
      })
    }

    const { error: recUpsertError } = await supabase.from('recommendations').upsert(recommendationRows, { onConflict: 'gameweek_id,plan_index' })
    if (recUpsertError) {
      if (isMissingTable(recUpsertError, 'recommendations')) {
        throw new GenerateRecommendationsError(`the "recommendations" table does not exist. Apply ${RECOMMENDATIONS_MIGRATION} first.`, 'recommendations')
      }
      throw new GenerateRecommendationsError(`recommendations upsert failed: ${recUpsertError.message}`, 'recommendations')
    }

    const { error: reasonsUpsertError } = await supabase
      .from('recommendation_reasons')
      .upsert(reasonRows, { onConflict: 'gameweek_id,plan_index,order_index' })
    if (reasonsUpsertError) {
      if (isMissingTable(reasonsUpsertError, 'recommendation_reasons')) {
        throw new GenerateRecommendationsError(
          `the "recommendation_reasons" table does not exist. Apply ${RECOMMENDATIONS_MIGRATION} first.`,
          'recommendation_reasons',
        )
      }
      throw new GenerateRecommendationsError(`recommendation_reasons upsert failed: ${reasonsUpsertError.message}`, 'recommendation_reasons')
    }

    const details: JsonRecord = {
      gameweekId: currentGw,
      solverRunId: latestRunId,
      solverStatus: solverRunRow?.solver_status ?? null,
      iterationsRequested: shortfall.requested,
      distinctSolutionsFound: shortfall.found,
      iterationShortfall: shortfall.isShortfall,
      plansStored: plans.length,
      baseConfidenceBand: baseBand,
      scoreGapPlanAToB: Number.isFinite(scoreGap) ? scoreGap : null,
      plansWithCoverageGap,
      freeTransfersAvailable,
      picksRowsFetched: allPicks.length,
      picksRowsExpectedByCount: picksExpectedByCount ?? 0,
      picksPagesFetched,
      playersRowsFetched: playerRows.length,
      playersPagesFetched,
    }
    const message =
      `${JOB_NAME}/generate-recommendations: stored ${plans.length} plan(s) for gameweek ${currentGw} ` +
      `(requested ${shortfall.requested}, found ${shortfall.found} distinct solution(s)). Base confidence band: ${baseBand}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof GenerateRecommendationsError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}/generate-recommendations: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}/generate-recommendations: additionally failed to record the failed job_runs row: ${recordMessage}`)
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
    console.error(`${JOB_NAME}/generate-recommendations: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
