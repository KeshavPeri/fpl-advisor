import { supabase } from '../supabase'
import type {
  ConfidenceBand,
  CoverageEntry,
  GameweekPick,
  VerdictRecommendationData,
} from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() — supabase-js resolves
 * `{ data: null, error }` on a Postgrest-level failure rather than
 * rejecting, so every caller re-throws as a real Error here. See that
 * file's comment / src/lib/format.ts's toErrorMessage for the full "because".
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

interface RecommendationRow {
  gameweek_id: number
  is_roll: boolean
  transfer_in_player_id: number | null
  transfer_out_player_id: number | null
  captain_player_id: number
  vice_captain_player_id: number
  hit_cost: number
  gross_points_rounded: number
  net_points_rounded: number
  confidence_band: ConfidenceBand
  coverage: CoverageEntry[] | null
  gameweeks: { name: string } | { name: string }[] | null
  /** The solver's OWN iteration index this plan was built from (ticket #68)
   *  — joins into solver_picks alongside gameweek_id. NOT the same as
   *  plan_index; see the recommendations migration's own comment. */
  solution_index: number
  /** Which solver_runs row this plan's picks came from (ticket #72) — see
   *  the recommendations migration's own comment on this column. Nullable:
   *  older rows written before this column existed, or any future write
   *  path that omits it, fall back to resolveRunId's most-recent-run
   *  lookup below rather than summing every run for the gameweek. */
  solver_run_id: number | null
}

/** One solver_runs row, read only to resolve a run id when the
 *  recommendation's own solver_run_id is null (ticket #72). */
interface SolverRunRow {
  id: number
}

interface ReasonRow {
  order_index: number
  reason: string
}

interface PlayerNameRow {
  id: number
  web_name: string
}

/** One starting-XI solver_picks row for this recommendation's own
 *  gameweek_id + solution_index (ticket #68). expected_points is the
 *  solver's raw per-player xP, NOT multiplier-applied — see
 *  scripts/store-solver-output.ts and the solver_output migration's own
 *  comment — so captain doubling is applied in derive.ts, not here. */
interface SolverPickRow {
  expected_points: number
  is_captain: boolean
  is_lineup: boolean
}

/**
 * Reads the most recently stored Plan A (plan_index = 0) — deliberately NOT
 * filtered to any particular gameweek. product-brief.md §6a: on a failed or
 * not-yet-run job, the app must show the previous run's recommendation
 * clearly marked with its age rather than nothing, so this always returns
 * the latest plan that exists at all. The caller (VerdictCard, via
 * deriveVerdictView in ./derive.ts) compares its gameweekId against the
 * current target gameweek to decide fresh vs stale — this function does no
 * such comparison itself, matching the pure/impure split used by
 * src/lib/squad/api.ts and src/lib/deadlineCountdown.ts elsewhere in this
 * app.
 *
 * Returns null only when no recommendation exists for ANY gameweek yet —
 * VerdictCard's "no recommendation" invitation state.
 *
 * Player names (captain, vice-captain, transfer in/out) are resolved here,
 * not left to the caller, so `deriveVerdictView` stays pure and so the
 * captain/vice-captain line and the coverage note (recommendations.coverage
 * carries only playerId, not a name) can both be built in words without a
 * second round-trip from the component.
 */
export async function fetchVerdict(): Promise<VerdictRecommendationData | null> {
  const { data, error } = await supabase
    .from('recommendations')
    .select(
      'gameweek_id, is_roll, transfer_in_player_id, transfer_out_player_id, ' +
        'captain_player_id, vice_captain_player_id, hit_cost, gross_points_rounded, ' +
        'net_points_rounded, confidence_band, coverage, gameweeks(name), solution_index, ' +
        'solver_run_id'
    )
    .eq('plan_index', 0)
    .order('gameweek_id', { ascending: false })
    .limit(1)
    .returns<RecommendationRow[]>()

  if (error) raise(error)

  const recRow = (data ?? [])[0]
  if (!recRow) return null

  const gwRelation = Array.isArray(recRow.gameweeks) ? recRow.gameweeks[0] : recRow.gameweeks
  const gameweekName = gwRelation?.name ?? `Gameweek ${recRow.gameweek_id}`

  const { data: reasonRows, error: reasonError } = await supabase
    .from('recommendation_reasons')
    .select('order_index, reason')
    .eq('gameweek_id', recRow.gameweek_id)
    .eq('plan_index', 0)
    .order('order_index', { ascending: true })
    .returns<ReasonRow[]>()

  if (reasonError) raise(reasonError)

  const playerIds = Array.from(
    new Set(
      [
        recRow.transfer_in_player_id,
        recRow.transfer_out_player_id,
        recRow.captain_player_id,
        recRow.vice_captain_player_id,
      ].filter((id): id is number => id !== null)
    )
  )

  const playerNames = new Map<number, string>()
  if (playerIds.length > 0) {
    const { data: playerRows, error: playerError } = await supabase
      .from('players')
      .select('id, web_name')
      .in('id', playerIds)
      .returns<PlayerNameRow[]>()

    if (playerError) raise(playerError)
    for (const row of playerRows ?? []) {
      playerNames.set(row.id, row.web_name)
    }
  }

  // This gameweek's projected points (ticket #68, run-filtered by #72) — a
  // single additional read, filtered in the database to exactly this
  // recommendation's own gameweek_id + solution_index + solver run +
  // starting XI (is_lineup = true), never fetched-all-then-filtered-in-
  // memory. Deliberately NOT passed through raise(): a failed or missing
  // solver_picks (or solver_runs) read must fall back to an "unavailable"
  // figure on the card (see deriveVerdictView), not blank the whole card
  // the way raise() would via VerdictCard's error state — every other field
  // this function resolves is unaffected by either read failing.
  //
  // solver_picks holds more than one solver run's rows for the same
  // gameweek/solution (an earlier solve and a later one both leave rows
  // behind — see the ticket's evidence), so summing everything for a
  // gameweek/solution roughly doubles the figure. recommendations.solver_run_id
  // already identifies exactly which run this recommendation's picks came
  // from; when it is null (older rows, or any future write path that omits
  // it) fall back to the most recently created solver_runs row for this
  // gameweek — never sum across every run.
  let gameweekPicks: GameweekPick[] | null = null
  try {
    let runId = recRow.solver_run_id

    if (runId === null) {
      const { data: runRows, error: runError } = await supabase
        .from('solver_runs')
        .select('id')
        .eq('gameweek_id', recRow.gameweek_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .returns<SolverRunRow[]>()

      if (runError) throw runError
      runId = (runRows ?? [])[0]?.id ?? null
    }

    if (runId !== null) {
      const { data: pickRows, error: pickError } = await supabase
        .from('solver_picks')
        .select('expected_points, is_captain, is_lineup')
        .eq('gameweek_id', recRow.gameweek_id)
        .eq('solution_index', recRow.solution_index)
        .eq('is_lineup', true)
        .eq('run_id', runId)
        .returns<SolverPickRow[]>()

      if (pickError) throw pickError
      if (pickRows && pickRows.length > 0) {
        gameweekPicks = pickRows.map((row) => ({
          expectedPoints: row.expected_points,
          isCaptain: row.is_captain,
          isLineup: row.is_lineup,
        }))
      }
    }
  } catch {
    gameweekPicks = null
  }

  return {
    gameweekId: recRow.gameweek_id,
    gameweekName,
    isRoll: recRow.is_roll,
    transferInPlayerId: recRow.transfer_in_player_id,
    transferOutPlayerId: recRow.transfer_out_player_id,
    captainPlayerId: recRow.captain_player_id,
    viceCaptainPlayerId: recRow.vice_captain_player_id,
    hitCost: recRow.hit_cost,
    grossPointsRounded: recRow.gross_points_rounded,
    netPointsRounded: recRow.net_points_rounded,
    confidenceBand: recRow.confidence_band,
    coverage: recRow.coverage ?? [],
    reasons: (reasonRows ?? []).map((row) => row.reason),
    playerNames,
    gameweekPicks,
  }
}
