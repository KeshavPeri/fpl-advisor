import { supabase } from '../supabase'
import type {
  AlternativePlanData,
  ConfidenceBand,
  CoverageEntry,
  PlayerProjectionData,
  PlayerProjectionDriver,
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
  /** Which of the (at most three, contiguous-from-zero — see
   *  src/lib/recommendation/distinctness.ts's assignContiguousPlanIndices)
   *  distinct plans stored for this gameweek this row is. 0 is Plan A, the
   *  one this app recommends; 1 and 2 (when present) are ticket #102's
   *  alternatives. */
  plan_index: number
  /** Ticket #277 — the recommendation's own solve time, set explicitly by
   *  scripts/generate-recommendations.ts on every upsert. Read here (Plan
   *  A's own row only) instead of falling back to a projection row's
   *  computed_at, which was the reasoning-screen footer bug this ticket
   *  fixes. */
  updated_at: string
}

/** Just enough to find the latest gameweek that has ANY stored
 *  recommendation, without hardcoding a `plan_index` filter — see
 *  fetchReasoning's own comment on why. */
interface LatestGameweekRow {
  gameweek_id: number
}

interface ReasonRow {
  plan_index: number
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

/** Raw shape of `player_projections.components` — `baseline-v1` writes only
 *  `points`; `gbm-v1` (ticket #131) writes only `drivers` (plus fields this
 *  screen does not read, e.g. `trained_through`, `has_odds`). Both keys are
 *  optional here for the same reason: one query now reads both model
 *  versions in one pass (ticket #266), and neither model's row carries the
 *  other's key. */
interface ProjectionComponentsShape {
  points?: Record<string, number>
  drivers?: PlayerProjectionDriver[]
}

interface ProjectionRow {
  player_id: number
  components: ProjectionComponentsShape | null
  model_version: string
  computed_at: string
  /** `gbm-v1` only — `baseline-v1` rows carry the same column (NOT NULL on
   *  the table), but this screen's baseline breakdown comes entirely from
   *  `components.points`, never this column, so it is only read for what
   *  it means on a `gbm-v1` row: `learned.expectedPoints`. */
  expected_points: number
}

/**
 * Reads the most recently stored recommendation for the latest gameweek —
 * every plan (`plan_index` 0, 1 and 2 when present), NOT just Plan A —
 * deliberately NOT filtered to any particular gameweek at the top level,
 * same "always show the latest plan that exists at all" contract as
 * src/lib/verdict/api.ts's fetchVerdict (product-brief.md §6a). Returns null
 * only when no recommendation exists for ANY gameweek yet — the screen's
 * empty-state invitation.
 *
 * Finding "the latest gameweek" no longer filters on `plan_index` at all
 * (ticket #102): #60's `assignContiguousPlanIndices` guarantees every
 * gameweek that has any stored recommendation has a `plan_index = 0` row, so
 * the plain max-`gameweek_id` row already identifies the right gameweek —
 * a `plan_index` filter here would be redundant, not required. The second
 * read below then pulls every plan for that one gameweek in a single
 * request, ordered ascending, so Plan A is always `planRows[0]`.
 *
 * Every sub-read below is deliberately bounded by an explicit filter
 * (specific player ids, one gameweek's plans, or the recommendation's own
 * gameweek + solution + run) rather than an unfiltered table scan, so none
 * of them can approach Supabase's silent 1,000-row cap regardless of how
 * large player_projections or solver_picks grow — contrast
 * scripts/project-points.ts's own read of the FULL players table, which
 * does paginate because it has no such bound. There is nothing here for a
 * pagination loop to do, same reasoning as before #102, just now covering
 * up to three plan rows and their reasons instead of one.
 */
export async function fetchReasoning(): Promise<ReasoningRecommendationData | null> {
  const { data: latestRows, error: latestError } = await supabase
    .from('recommendations')
    .select('gameweek_id')
    .order('gameweek_id', { ascending: false })
    .limit(1)
    .returns<LatestGameweekRow[]>()

  if (latestError) raise(latestError)

  const latestGameweekId = (latestRows ?? [])[0]?.gameweek_id
  if (latestGameweekId === undefined) return null

  const { data, error } = await supabase
    .from('recommendations')
    .select(
      'gameweek_id, is_roll, transfer_in_player_id, transfer_out_player_id, ' +
        'captain_player_id, vice_captain_player_id, hit_cost, gross_points_rounded, ' +
        'net_points_rounded, confidence_band, coverage, gameweeks(name), solution_index, ' +
        'solver_run_id, plan_index, updated_at'
    )
    .eq('gameweek_id', latestGameweekId)
    .order('plan_index', { ascending: true })
    .returns<RecommendationRow[]>()

  if (error) raise(error)

  // Bounded to at most three rows (see the header comment above) — Plan A
  // is whichever row carries plan_index 0, not just planRows[0], so a
  // future storage order change can't silently swap in an alternative.
  const planRows = data ?? []
  const recRow = planRows.find((row) => row.plan_index === 0)
  if (!recRow) return null

  const alternateRows = planRows
    .filter((row) => row.plan_index !== 0)
    .sort((a, b) => a.plan_index - b.plan_index)

  const gwRelation = Array.isArray(recRow.gameweeks) ? recRow.gameweeks[0] : recRow.gameweeks
  const gameweekName = gwRelation?.name ?? `Gameweek ${recRow.gameweek_id}`

  // Every reason line for every plan stored this gameweek, in order —
  // unlike the verdict card (Plan A, order_index 0 only), the reasoning
  // screen renders the full stored list for Plan A and carries each
  // alternative's own reasons through for the alternatives section.
  // Grouped by plan_index below rather than fetched once per plan — still
  // one bounded request (this gameweek's reason rows only, a few dozen at
  // most), never N requests for N plans.
  const { data: reasonRows, error: reasonError } = await supabase
    .from('recommendation_reasons')
    .select('plan_index, order_index, reason')
    .eq('gameweek_id', recRow.gameweek_id)
    .order('plan_index', { ascending: true })
    .order('order_index', { ascending: true })
    .returns<ReasonRow[]>()

  if (reasonError) raise(reasonError)

  const reasonsByPlan = new Map<number, string[]>()
  for (const row of reasonRows ?? []) {
    const bucket = reasonsByPlan.get(row.plan_index)
    if (bucket) {
      bucket.push(row.reason)
    } else {
      reasonsByPlan.set(row.plan_index, [row.reason])
    }
  }

  // Named players across EVERY plan (Plan A's four roles plus each
  // alternative's transfer-in/out and captain) — still bounded (at most
  // 4 + 3*3 = 13 ids before deduping), never the whole players table.
  const playerIds = Array.from(
    new Set(
      [
        recRow.transfer_in_player_id,
        recRow.transfer_out_player_id,
        recRow.captain_player_id,
        recRow.vice_captain_player_id,
        ...alternateRows.flatMap((row) => [
          row.transfer_in_player_id,
          row.transfer_out_player_id,
          row.captain_player_id,
        ]),
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
  // playerIds.length x 2 (at most 8 rows: baseline-v1 and gbm-v1 per
  // player), never the whole ~600-row-per-gameweek table, so this cannot
  // hit the 1,000-row cap regardless of table size.
  //
  // baseline-v1 AND gbm-v1 (ticket #266, widened from baseline-v1-only
  // #260): the two rows for one player are merged into a single
  // PlayerProjectionData below, kept apart by model_version rather than
  // read as two separate maps, so every other caller of `projections`
  // (derive.ts) still does one lookup per player. Whichever row is
  // processed first, the merge below reads any value already set by the
  // other row via `existing` rather than overwriting it, so row order from
  // Postgrest never matters.
  const projections = new Map<number, PlayerProjectionData>()
  if (playerIds.length > 0) {
    try {
      const { data: projectionRows, error: projectionError } = await supabase
        .from('player_projections')
        .select('player_id, components, model_version, computed_at, expected_points')
        .eq('gameweek_id', recRow.gameweek_id)
        .in('model_version', ['baseline-v1', 'gbm-v1'])
        .in('player_id', playerIds)
        .returns<ProjectionRow[]>()

      if (projectionError) throw projectionError
      for (const row of projectionRows ?? []) {
        const existing = projections.get(row.player_id)
        if (row.model_version === 'gbm-v1') {
          projections.set(row.player_id, {
            playerId: row.player_id,
            points: existing?.points ?? {},
            // modelVersion/computedAt stay the baseline-v1 pair (ticket
            // #266's own scope: "keep the existing points breakdown field
            // as the baseline-v1 one") — only falling back to gbm-v1's own
            // when no baseline-v1 row resolved for this player at all, so
            // these two fields are never left unset.
            modelVersion: existing?.modelVersion ?? row.model_version,
            computedAt: existing?.computedAt ?? row.computed_at,
            learned: {
              modelVersion: row.model_version,
              expectedPoints: row.expected_points,
              drivers: row.components?.drivers ?? [],
            },
          })
        } else {
          projections.set(row.player_id, {
            playerId: row.player_id,
            points: row.components?.points ?? {},
            modelVersion: row.model_version,
            computedAt: row.computed_at,
            learned: existing?.learned,
          })
        }
      }
    } catch {
      // Leave `projections` as whatever it already resolved — derive.ts
      // renders an explicit "unavailable" breakdown per player still
      // missing an entry, never a blank screen.
    }
  }

  // Alternatives (ticket #102) — every plan_index 1/2 row for this
  // gameweek, in order. Reasons default to [] (never dropped, never
  // erroring) when a plan has no recommendation_reasons rows of its own —
  // see reasonsByPlan above and this ticket's DoD on a plan with missing
  // reasons.
  const alternatives: AlternativePlanData[] = alternateRows.map((row) => ({
    planIndex: row.plan_index,
    isRoll: row.is_roll,
    transferInPlayerId: row.transfer_in_player_id,
    transferOutPlayerId: row.transfer_out_player_id,
    captainPlayerId: row.captain_player_id,
    hitCost: row.hit_cost,
    grossPointsRounded: row.gross_points_rounded,
    netPointsRounded: row.net_points_rounded,
    confidenceBand: row.confidence_band,
    coverage: row.coverage ?? [],
    reasons: reasonsByPlan.get(row.plan_index) ?? [],
  }))

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
    reasons: reasonsByPlan.get(0) ?? [],
    playerNames,
    horizon,
    startingXI,
    projections,
    alternatives,
    updatedAt: recRow.updated_at,
  }
}
