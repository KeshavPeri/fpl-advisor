/**
 * Types for override registration (ticket #91, feature-list item 20). Small,
 * local copies of the recommendation/decision fields this module reads and
 * writes, rather than importing across `src/lib/verdict/`, `src/lib/
 * reasoning/` or `src/lib/commit/` — same precedent
 * `src/lib/commit/types.ts`'s own header comment sets: a feature owns a
 * small local copy of a domain type it merely touches, rather than creating
 * a cross-module coupling. `PositionCode` is the one exception — imported
 * from `src/lib/squad/positions.ts`, which this ticket reads but does not
 * modify, because re-declaring FPL's four position codes a fourth time in
 * this app would be duplication with no offsetting isolation benefit (unlike
 * the recommendation/decision shapes above, which each feature genuinely
 * uses differently).
 */
import type { PositionCode } from '../squad/positions'

/** The recommendation an override is registered against — always the most
 *  recently stored Plan A (plan_index = 0), same "latest plan that exists at
 *  all" contract src/lib/verdict/api.ts and src/lib/reasoning/api.ts already
 *  use (product-brief.md §6a). */
export interface OverrideRecommendation {
  gameweekId: number
  planIndex: number
  gameweekName: string
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  /** Snapshotted into the written row unchanged — see src/lib/commit/
   *  api.ts's own comment on why this is read from `recommendations`
   *  directly rather than threaded through a different fetch. */
  solverRunId: number | null
}

/** One selectable player — the squad's 15, or the wider player pool for the
 *  transfer-in selector. Trimmed to exactly what selection and comparison
 *  need; a local shape rather than reusing `src/lib/squad/types.ts`'s
 *  `SelectablePlayer` (that type carries price/team/availability fields this
 *  screen never shows — an override entry records who, not cost or club). */
export interface OverridePlayerOption {
  id: number
  webName: string
  elementType: PositionCode
}

/** What was actually done with the transfer this gameweek — rolled, or one
 *  player out and one in. See Scope: "No multi-transfer entry" — a gameweek
 *  with two or more real transfers is recorded as a roll being overridden
 *  with a single transfer; the screen states that limitation rather than
 *  attempting to represent it. */
export type TransferChoice =
  | { kind: 'roll' }
  | { kind: 'transfer'; outPlayerId: number; inPlayerId: number }

/** The user's in-progress entry — every field starts unset. `transfer` is
 *  `null` until a mode (rolled / made a transfer) AND, for the transfer
 *  case, both players are chosen; see derive.ts's `buildTransferChoice`. */
export interface OverrideEntry {
  captainPlayerId: number | null
  viceCaptainPlayerId: number | null
  transfer: TransferChoice | null
}

/** The frozen record of what an override snapshot actually holds, read back
 *  from `recommendation_decisions.snapshot` — the five fields the interface
 *  cares about (hit_cost is always null for an override; solver_run_id is
 *  carried through to the write but not shown back). */
export interface StoredOverrideSnapshot {
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
}

export interface StoredOverrideDecision {
  decidedAt: string
  snapshot: StoredOverrideSnapshot
}

/** Whether this exact (gameweek, plan) already carries a decision of either
 *  kind — what makes the one-decision-per-gameweek interface rule possible.
 *  Notes (ticket #91): "an interface rule, not a database guarantee" — the
 *  unique index is per-kind, so a commit row and an override row for the
 *  same gameweek CAN coexist at the database level; this is the read that
 *  lets the screen refuse to offer either past the first. */
export interface OverrideDecisionsContext {
  commitDecidedAt: string | null
  existingOverride: StoredOverrideDecision | null
}

/** Everything registerOverride needs to write exactly one row. `hitCost` is
 *  typed as the literal `null` — never a number — because a hit figure is
 *  never hand-typed here; see the ticket's Notes ("the real figure already
 *  arrives from the FPL API … leave hit_cost null in the override
 *  snapshot"). Mirrors `recommendation_decisions.snapshot`'s seven named
 *  keys exactly, same convention as src/lib/commit/types.ts's
 *  `CommitTarget`. */
export interface OverrideTarget {
  gameweekId: number
  planIndex: number
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: null
  solverRunId: number | null
}
