/**
 * Types for the commit action (ticket #84, feature-list item 19). Small,
 * local copy of the recommendation fields this module reads/writes, rather
 * than importing from `src/lib/verdict/` — same precedent as that module's
 * own header comment (and `src/components/pitchAvailability.ts` before it):
 * a feature owns a small local copy of a domain type it merely touches,
 * rather than importing across an unrelated module boundary. `src/lib/verdict/`
 * is explicitly out of scope for this ticket's diff.
 */

/**
 * Everything needed to commit one plan for one gameweek — mirrors
 * `recommendation_decisions.snapshot`'s seven named fields exactly (see the
 * migration's own comment), plus the two identifying columns
 * (`gameweek_id`, `plan_index`) the row is keyed on. `planIndex` is always
 * `0` (Plan A) for this ticket — kept as a field, not a literal, only so a
 * future ticket committing Plan B/C doesn't need to touch this type.
 */
export interface CommitTarget {
  gameweekId: number
  planIndex: number
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: number
  /** The recommendation's own `solver_run_id` — not part of
   *  `VerdictRecommendationData` (verdict/api.ts never selects or returns
   *  it), so `src/lib/commit/api.ts` reads it directly from
   *  `recommendations` via `fetchCommitContext` rather than threading it
   *  through the verdict card's own fetch. */
  solverRunId: number | null
}

/** What a stored `recommendation_decisions` row looks like once read back —
 *  only the field `derive.ts` needs to decide "already committed", plus the
 *  timestamp shown once it has. */
export interface StoredCommitDecision {
  decidedAt: string
}

/** Everything the commit control needs to know before it can render:
 *  whether this (gameweek, plan) is already committed, and the
 *  `solver_run_id` to snapshot if the user commits it now. Fetched together
 *  (src/lib/commit/api.ts's fetchCommitContext) so the control needs only
 *  one round trip before it can show either state. */
export interface CommitContext {
  decision: StoredCommitDecision | null
  solverRunId: number | null
}

/**
 * Fully-resolved display state for the commit control — the component does
 * no further branching on the stored decision or a write error itself, same
 * split as `src/lib/verdict/derive.ts`'s `deriveVerdictView`.
 *
 * The action keeps its name through the whole flow (design-reference.md):
 * `buttonLabel` is 'Commit' before, 'Committed' after — never Submit, Save
 * or Done.
 */
export interface CommitView {
  isCommitted: boolean
  buttonLabel: string
  buttonDisabled: boolean
  /** Present only when a write attempt failed for a real reason (not the
   *  unique-violation race — see derive.ts's isAlreadyCommittedError). States
   *  what happened and what to do, per design-reference.md's interface-
   *  writing rule — never a generic "Something went wrong." */
  errorMessage: string | null
}
