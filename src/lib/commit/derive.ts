/**
 * Pure derivation for the commit control (ticket #84, feature-list item
 * 19). No I/O — same split as `src/lib/verdict/derive.ts`: the component
 * owns the network round trip, this file decides what to render from what
 * came back, and VerdictCard does no further branching once it has a
 * `CommitView`. (Deliberately not naming the two things this file must
 * never touch, in its own comments — see this ticket's DoD: the read/write
 * client and the effect hook that calls it must not appear here even as a
 * mention.)
 */
import type { CommitView, StoredCommitDecision } from './types.ts'

/**
 * Postgres' `unique_violation` SQLSTATE code — matches the unique index on
 * `(gameweek_id, plan_index, kind)` created by this ticket's own migration
 * (recommendation_decisions, dated 23 Aug 2026). Named here, not re-typed
 * at the call site, so there is exactly one place that has to know the
 * magic string.
 */
export const UNIQUE_VIOLATION_CODE = '23505'

/**
 * True when a write failure is the unique index doing exactly its job — a
 * second commit landing on a gameweek that already has one. DoD: "does not
 * write a second row and does not surface an error to the user — the
 * unique index is the guarantee, the interface must not depend on it
 * firing." The FIRST guard is the UI's own disabled button once a commit
 * exists (deriveCommitView below), so this should rarely run in practice;
 * this is what stops the race it's defending against (two open tabs, a
 * duplicate tap that got past a stale render) from ever reading as a
 * failure. The write module calls this after an insert error and, when
 * it's true, re-reads the row instead of raising.
 */
export function isAlreadyCommittedError(errorCode: string | null | undefined): boolean {
  return errorCode === UNIQUE_VIOLATION_CODE
}

/**
 * Fully-resolved display state for the commit control.
 *
 * `decision` is what makes the committed state survive a reload: it comes
 * from a table read done just before this function runs, never from
 * anything held only in component state across that read — a non-null
 * `decision` here means a `recommendation_decisions` row for this exact
 * (gameweek, plan) already exists, full stop.
 *
 * `writeErrorMessage` is the raw message from a failed write attempt (via
 * `src/lib/format.ts`'s `toErrorMessage`, same convention as every other
 * catch block in this app) — null when there's been no attempt, or the
 * attempt succeeded, or the "failure" was actually the unique index firing
 * (see isAlreadyCommittedError; the caller never passes that one through as
 * a real error). This function turns a raw message into the specific,
 * actionable text design-reference.md requires: what failed and what to
 * do, never a generic error and never a silent no-op.
 *
 * The action keeps its name through the whole flow (design-reference.md):
 * 'Commit' before, 'Committed' after — never Submit, Save or Done.
 */
export function deriveCommitView(
  decision: StoredCommitDecision | null,
  writeErrorMessage: string | null
): CommitView {
  if (decision) {
    return {
      isCommitted: true,
      buttonLabel: 'Committed',
      buttonDisabled: true,
      errorMessage: null,
    }
  }

  return {
    isCommitted: false,
    buttonLabel: 'Commit',
    buttonDisabled: false,
    errorMessage: writeErrorMessage
      ? `Couldn't record the commit: ${writeErrorMessage}. Tap Commit to try again.`
      : null,
  }
}
