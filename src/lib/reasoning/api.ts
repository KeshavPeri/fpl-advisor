import { supabase } from '../supabase'
import type {
  ConfidenceBand,
  CoverageEntry,
  PlayerProjectionData,
  ReasoningRecommendationData,
  StartingXIPick,
} from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() / src/lib/verdict/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
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
  solution_index: number
  /** See src/lib/verdict/api.ts's own comment on this column — nullable,
   *  older rows fall back to the most-recent solver_runs row for the
   *  gameweek rather than summing every run. */
  solver_run_id: number | null
}

interface ReasonRow {
  order_index: number
  reason: string
}

interface PlayerNameRow {
  id: number
  web_name: string
}

interface SolverRunRow {
  id: number
  horizon: number
}

/** One starting-XI solver_picks row for this recommendation's own
 *  gameweek_id + solution_index + solver run (ticket #72's run filter,
 *  applied the same way src/lib/verdict/api.ts applies it). player_id is
 *  selected (unlike verdict's equivalent query) so derive.ts can identify
 *  which starter is the captain's nearest rival, not just sum a total. */
interface SolverPickRow {
  player_id: number
  expected_points: number
  is_captain: boolean
}

interface ProjectionComponentsShape {
  points?: Record<string, number>
}

interface ProjectionRow {
  player_id: number
  components: ProjectionComponentsShape | null
  model_version: string
  computed_at: string
}

/**
 * Reads the most recently stored Plan A (plan_index = 0) — deliberately NOT
 * filtered to any particular gameweek, same "always show the latest plan
 * that exists at all" contract as src/lib/verdict/api.ts's fetchVerdict
 * (product-brief.md §6a). Returns null only when no recommendation exists
 * for ANY gameweek yet — the screen's empty-state invitation.
 *
 * Every sub-read below is deliberately bounded by an explicit filter
 * (specific player ids, or the recommendation's own gameweek + solution +
 * run) rather than an unfiltered table scan, so none of them can approach
 * Supabase's silent 1,000-row cap regardless of how large
 * player_projections or solver_picks grow — contrast
 * scripts/project-points.ts's own read of the FULL players table, which
 * does paginate because it has no such bound. There is nothing here for a
 * pagination loop to do.
 */
export async function fetchReasoning(): Promise<ReasoningRecommendationData | null> {
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

  // Every reason line, in order — unlike the verdict card (order_index 0
  // only), the reasoning screen renders the full stored list.
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

  // Resolve the run id AND its horizon. Same fallback as verdict/api.ts:
  // when the recommendation's own solver_run_id is null, fall back to the
  // most recently created solver_runs row for this gameweek rather than
  // guessing or summing every run. Deliberately NOT routed through raise():
  // a failed or missing solver_runs/solver_picks/player_projections read
  // must degrade that one section to "unavailable" (see derive.ts), never
  // blank the whole screen the way raise() would.
  let runId: number | null = recRow.solver_run_id
  let horizon: number | null = null
  try {
    if (runId === null) {
      const { data: runRows, error: runError } = await supabase
        .from('solver_runs')
        .select('id, horizon')
        .eq('gameweek_id', recRow.gameweek_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .returns<SolverRunRow[]>()

      if (runError) throw runError
      const resolved = (runRows ?? [])[0] ?? null
      runId = resolved?.id ?? null
      horizon = resolved?.horizon ?? null
    } else {
      const { data: runRows, error: runError } = await supabase
        .from('solver_runs')
        .select('id, horizon')
        .eq('id', runId)
        .limit(1)
        .returns<SolverRunRow[]>()

      if (runError) throw runError
      horizon = (runRows ?? [])[0]?.horizon ?? null
    }
  } catch {
    horizon = null
  }

  let startingXI: StartingXIPick[] | null = null
  try {
    if (runId !== null) {
      const { data: pickRows, error: pickError } = await supabase
        .from('solver_picks')
        .select('player_id, expected_points, is_captain')
        .eq('gameweek_id', recRow.gameweek_id)
        .eq('solution_index', recRow.solution_index)
        .eq('is_lineup', true)
        .eq('run_id', runId)
        .returns<SolverPickRow[]>()

      if (pickError) throw pickError
      if (pickRows && pickRows.length > 0) {
        startingXI = pickRows.map((row) => ({
          playerId: row.player_id,
          expectedPoints: row.expected_points,
          isCaptain: row.is_captain,
        }))
      }
    }
  } catch {
    startingXI = null
  }

  // Component breakdown for the four named players only — bounded by
  // playerIds.length (at most 4), never the whole ~600-row-per-gameweek
  // table, so this cannot hit the 1,000-row cap regardless of table size.
  // Ordered by computed_at ascending so that IF more than one row exists
  // for the same player (a future second model_version alongside
  // 'baseline-v1', per that column's own migration comment) the map ends up
  // holding the most recently computed one, without hardcoding a
  // model_version string to filter by.
  const projections = new Map<number, PlayerProjectionData>()
  if (playerIds.length > 0) {
    try {
      const { data: projectionRows, error: projectionError } = await supabase
        .from('player_projections')
        .select('player_id, components, model_version, computed_at')
        .eq('gameweek_id', recRow.gameweek_id)
        .in('player_id', playerIds)
        .order('computed_at', { ascending: true })
        .returns<ProjectionRow[]>()

      if (projectionError) throw projectionError
      for (const row of projectionRows ?? []) {
        projections.set(row.player_id, {
          playerId: row.player_id,
          points: row.components?.points ?? {},
          modelVersion: row.model_version,
          computedAt: row.computed_at,
        })
      }
    } catch {
      // Leave `projections` as whatever it already resolved — derive.ts
      // renders an explicit "unavailable" breakdown per player still
      // missing an entry, never a blank screen.
    }
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
    horizon,
    startingXI,
    projections,
  }
}
