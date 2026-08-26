import { supabase } from '../supabase'
import { isAlreadyRegisteredError } from './derive.ts'
import type {
  OverrideDecisionsContext,
  OverrideRecommendation,
  OverrideTarget,
  StoredOverrideDecision,
} from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() / src/lib/commit/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
 * `code` is carried through so registerOverride below can tell a real
 * failure apart from the unique index doing its job.
 */
function raise(error: { message: string; code?: string }): never {
  throw new Error(error.message, { cause: error })
}

interface RecommendationRow {
  gameweek_id: number
  plan_index: number
  is_roll: boolean
  transfer_in_player_id: number | null
  transfer_out_player_id: number | null
  captain_player_id: number
  vice_captain_player_id: number
  solver_run_id: number | null
  // NOT NULL in the schema (20260817090000_recommendations.sql). Added by
  // ticket #107 solely so registerOverride can thread it into
  // snapshot.recommended below — the confirm panel does not display it.
  hit_cost: number
  gameweeks: { name: string } | { name: string }[] | null
}

/**
 * The recommendation an override is registered against — the most recently
 * stored Plan A (plan_index = 0), deliberately NOT filtered to any
 * particular gameweek. Same "always show the latest plan that exists at
 * all" contract as src/lib/verdict/api.ts's fetchVerdict and
 * src/lib/reasoning/api.ts's fetchReasoning (product-brief.md §6a) — a
 * small local copy of that query, not a shared import, matching the
 * precedent those two modules already set for each other (see
 * src/lib/commit/types.ts's own comment on why a feature owns a small local
 * copy rather than importing across a module boundary). Bounded by
 * `.limit(1)`, so this can never approach Supabase's silent 1,000-row cap
 * regardless of table size — nothing here for a pagination loop to do,
 * same reasoning src/lib/reasoning/api.ts's own header states for its
 * bounded reads.
 *
 * Returns null only when no recommendation exists for ANY gameweek yet.
 */
export async function fetchLatestRecommendation(): Promise<OverrideRecommendation | null> {
  const { data, error } = await supabase
    .from('recommendations')
    .select(
      'gameweek_id, plan_index, is_roll, transfer_in_player_id, transfer_out_player_id, ' +
        'captain_player_id, vice_captain_player_id, solver_run_id, hit_cost, gameweeks(name)'
    )
    .eq('plan_index', 0)
    .order('gameweek_id', { ascending: false })
    .limit(1)
    .returns<RecommendationRow[]>()

  if (error) raise(error)

  const row = (data ?? [])[0]
  if (!row) return null

  const gwRelation = Array.isArray(row.gameweeks) ? row.gameweeks[0] : row.gameweeks

  return {
    gameweekId: row.gameweek_id,
    planIndex: row.plan_index,
    gameweekName: gwRelation?.name ?? `Gameweek ${String(row.gameweek_id)}`,
    isRoll: row.is_roll,
    transferInPlayerId: row.transfer_in_player_id,
    transferOutPlayerId: row.transfer_out_player_id,
    captainPlayerId: row.captain_player_id,
    viceCaptainPlayerId: row.vice_captain_player_id,
    solverRunId: row.solver_run_id,
    hitCost: row.hit_cost,
  }
}

interface SquadPickRow {
  player_id: number
}

/**
 * The 15 player ids in this gameweek's squad_picks — bounded to exactly one
 * gameweek via `.eq`, and squad_picks carries at most 15 rows per gameweek
 * by its own unique index (20260811180000_squad_state.sql), so this cannot
 * approach the 1,000-row cap regardless of how many seasons of squad_picks
 * accumulate. Same "explicit filter, never an unfiltered scan" convention
 * src/lib/reasoning/api.ts's header comment states for its own bounded
 * reads — there is nothing here for a pagination loop to do either.
 *
 * Only ids are read: names and positions for these players come from the
 * wider player pool (src/lib/squad/api.ts's fetchPlayers, read but not
 * modified by this ticket — see Scope), so this avoids a second, redundant
 * join into `players` for data the screen already has to fetch anyway.
 */
export async function fetchSquadPlayerIds(gameweekId: number): Promise<number[]> {
  const { data, error } = await supabase
    .from('squad_picks')
    .select('player_id')
    .eq('gameweek_id', gameweekId)
    .returns<SquadPickRow[]>()

  if (error) raise(error)
  return (data ?? []).map((row) => row.player_id)
}

interface DecisionRow {
  kind: 'commit' | 'override'
  decided_at: string
  snapshot: {
    is_roll: boolean
    transfer_in_player_id: number | null
    transfer_out_player_id: number | null
    captain_player_id: number
    vice_captain_player_id: number
  }
}

function toStoredOverrideDecision(row: DecisionRow): StoredOverrideDecision {
  return {
    decidedAt: row.decided_at,
    snapshot: {
      isRoll: row.snapshot.is_roll,
      transferInPlayerId: row.snapshot.transfer_in_player_id,
      transferOutPlayerId: row.snapshot.transfer_out_player_id,
      captainPlayerId: row.snapshot.captain_player_id,
      viceCaptainPlayerId: row.snapshot.vice_captain_player_id,
    },
  }
}

/**
 * Whether this exact (gameweek, plan) already has a 'commit' decision
 * and/or an 'override' decision — what the one-decision-per-gameweek
 * interface rule is built on (see types.ts's own comment on
 * OverrideDecisionsContext). One read, filtered to exactly this gameweek +
 * plan + the two kinds this screen cares about (never an unfiltered scan,
 * and bounded to at most two rows by the migration's own unique index),
 * matching the pagination convention src/lib/verdict/api.ts and
 * src/lib/reasoning/api.ts establish.
 */
export async function fetchOverrideDecisions(
  gameweekId: number,
  planIndex: number
): Promise<OverrideDecisionsContext> {
  const { data, error } = await supabase
    .from('recommendation_decisions')
    .select('kind, decided_at, snapshot')
    .eq('gameweek_id', gameweekId)
    .eq('plan_index', planIndex)
    .in('kind', ['commit', 'override'])
    .returns<DecisionRow[]>()

  if (error) raise(error)

  const rows = data ?? []
  const commitRow = rows.find((row) => row.kind === 'commit')
  const overrideRow = rows.find((row) => row.kind === 'override')

  return {
    commitDecidedAt: commitRow?.decided_at ?? null,
    existingOverride: overrideRow ? toStoredOverrideDecision(overrideRow) : null,
  }
}

/**
 * Writes one `recommendation_decisions` row with `kind = 'override'` — the
 * write this ticket exists for. Registers a DECISION; it never calls any
 * private, write-capable FPL endpoint of any kind (Tier 1 guard — see the
 * migration file and this ticket's own Context: the FPL API is never
 * authenticated by this app). `hit_cost` (the top-level, DECIDED key) is
 * always written as `null` in the snapshot — see types.ts's `OverrideTarget`
 * and the ticket's Notes on why a hit is never hand-typed here.
 *
 * Ticket #107: alongside the seven decided keys — unchanged in name,
 * position and value — the snapshot now also carries a `recommended` object
 * (the same seven field names, `target.recommended`, threaded straight from
 * the recommendation the confirm panel already compared the entry
 * against). This is the only line that changed for #107; every decided key
 * above is untouched.
 *
 * On a unique_violation (23505) — this exact (gameweek_id, plan_index,
 * 'override') already has a row, from an earlier registration or a race
 * with another open tab — this does NOT surface an error: it reads the
 * existing row back and returns that instead, same race handling as
 * src/lib/commit/api.ts's commitRecommendation. Any other error is raised
 * normally.
 */
export async function registerOverride(target: OverrideTarget): Promise<StoredOverrideDecision> {
  const { data, error } = await supabase
    .from('recommendation_decisions')
    .insert({
      gameweek_id: target.gameweekId,
      plan_index: target.planIndex,
      kind: 'override',
      snapshot: {
        is_roll: target.isRoll,
        transfer_in_player_id: target.transferInPlayerId,
        transfer_out_player_id: target.transferOutPlayerId,
        captain_player_id: target.captainPlayerId,
        vice_captain_player_id: target.viceCaptainPlayerId,
        hit_cost: null,
        solver_run_id: target.solverRunId,
        recommended: {
          is_roll: target.recommended.isRoll,
          transfer_in_player_id: target.recommended.transferInPlayerId,
          transfer_out_player_id: target.recommended.transferOutPlayerId,
          captain_player_id: target.recommended.captainPlayerId,
          vice_captain_player_id: target.recommended.viceCaptainPlayerId,
          hit_cost: target.recommended.hitCost,
          solver_run_id: target.recommended.solverRunId,
        },
      },
    })
    .select('kind, decided_at, snapshot')
    .single()
    .returns<DecisionRow>()

  if (!error) {
    return toStoredOverrideDecision(data)
  }

  if (isAlreadyRegisteredError(error.code)) {
    const existing = await fetchOverrideDecisions(target.gameweekId, target.planIndex)
    if (existing.existingOverride) return existing.existingOverride
    // Defensive: the database said a row already exists but a fresh read
    // couldn't find it (e.g. that second read itself failed transiently).
    // Falling through to raise() the ORIGINAL insert error is safer than
    // silently claiming success on a state we can no longer confirm — same
    // fallback src/lib/commit/api.ts's commitRecommendation takes.
  }

  raise(error)
}
