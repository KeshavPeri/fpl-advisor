import { supabase } from '../supabase'
import type { ConfidenceBand, CoverageEntry, VerdictRecommendationData } from './types.ts'

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
}

interface ReasonRow {
  order_index: number
  reason: string
}

interface PlayerNameRow {
  id: number
  web_name: string
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
        'net_points_rounded, confidence_band, coverage, gameweeks(name)'
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
  }
}
