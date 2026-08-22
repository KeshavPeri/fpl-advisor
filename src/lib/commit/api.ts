import { supabase } from '../supabase'
import { isAlreadyCommittedError } from './derive.ts'
import type { CommitContext, CommitTarget, StoredCommitDecision } from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() / src/lib/verdict/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
 * `code` is carried through (supabase-js's PostgrestError always has one,
 * even if empty) so commitRecommendation below can tell a real failure
 * apart from the unique index doing its job.
 */
function raise(error: { message: string; code?: string }): never {
  throw new Error(error.message, { cause: error })
}

interface DecisionRow {
  decided_at: string
}

interface RecommendationSolverRunRow {
  solver_run_id: number | null
}

/**
 * Everything the commit control needs before it can render: whether this
 * exact (gameweek, plan) already has a `kind = 'commit'` decision, and the
 * `solver_run_id` to snapshot if the user commits it now. Two independently
 * bounded reads (each filtered to one gameweek_id + plan_index — never an
 * unfiltered table scan), matching the pagination convention
 * `src/lib/verdict/api.ts` establishes: this table stays small for a long
 * time, but the rule is about the class of bug (Supabase silently caps at
 * 1,000 rows with no error and no flag), not the current row count.
 *
 * solver_run_id is read here rather than from VerdictRecommendationData
 * because that type (src/lib/verdict/types.ts) never carries it —
 * src/lib/verdict/ is out of scope for this ticket's diff (see ticket #84's
 * scope constraint).
 */
export async function fetchCommitContext(
  gameweekId: number,
  planIndex: number
): Promise<CommitContext> {
  const [decisionResult, recommendationResult] = await Promise.all([
    supabase
      .from('recommendation_decisions')
      .select('decided_at')
      .eq('gameweek_id', gameweekId)
      .eq('plan_index', planIndex)
      .eq('kind', 'commit')
      .limit(1)
      .returns<DecisionRow[]>(),
    supabase
      .from('recommendations')
      .select('solver_run_id')
      .eq('gameweek_id', gameweekId)
      .eq('plan_index', planIndex)
      .limit(1)
      .returns<RecommendationSolverRunRow[]>(),
  ])

  if (decisionResult.error) raise(decisionResult.error)
  if (recommendationResult.error) raise(recommendationResult.error)

  const decisionRow = (decisionResult.data ?? [])[0]
  const recommendationRow = (recommendationResult.data ?? [])[0]

  return {
    decision: decisionRow ? { decidedAt: decisionRow.decided_at } : null,
    solverRunId: recommendationRow?.solver_run_id ?? null,
  }
}

/**
 * Writes one `recommendation_decisions` row with `kind = 'commit'` and the
 * seven-field snapshot the migration's own comment names. Committing
 * records a decision — it never writes to any FPL endpoint (Tier 1 guard,
 * see the migration file and ticket #84's Context).
 *
 * On a unique_violation (23505) — this exact (gameweek_id, plan_index,
 * 'commit') already has a row, from an earlier tap or a race with another
 * open tab — this does NOT surface an error: it reads the existing row back
 * and returns that instead. DoD: "does not write a second row and does not
 * surface an error to the user — the unique index is the guarantee, the
 * interface must not depend on it firing." Any other error is raised
 * normally; the caller (VerdictCard) turns it into the specific message
 * `deriveCommitView` builds.
 */
export async function commitRecommendation(target: CommitTarget): Promise<StoredCommitDecision> {
  const { data, error } = await supabase
    .from('recommendation_decisions')
    .insert({
      gameweek_id: target.gameweekId,
      plan_index: target.planIndex,
      kind: 'commit',
      snapshot: {
        is_roll: target.isRoll,
        transfer_in_player_id: target.transferInPlayerId,
        transfer_out_player_id: target.transferOutPlayerId,
        captain_player_id: target.captainPlayerId,
        vice_captain_player_id: target.viceCaptainPlayerId,
        hit_cost: target.hitCost,
        solver_run_id: target.solverRunId,
      },
    })
    .select('decided_at')
    .single()
    .returns<DecisionRow>()

  if (!error) {
    return { decidedAt: data.decided_at }
  }

  if (isAlreadyCommittedError(error.code)) {
    const existing = await fetchCommitContext(target.gameweekId, target.planIndex)
    if (existing.decision) return existing.decision
    // Defensive: the database said a row already exists but a fresh read
    // couldn't find it (e.g. that second read itself failed transiently).
    // Falling through to raise() the ORIGINAL insert error is safer than
    // silently claiming success on a state we can no longer confirm.
  }

  raise(error)
}
