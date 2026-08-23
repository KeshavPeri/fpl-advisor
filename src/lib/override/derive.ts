/**
 * Pure derivation for override registration (ticket #91, feature-list item
 * 20). No I/O — same split as src/lib/verdict/derive.ts and
 * src/lib/commit/derive.ts: a screen owns the network round trips, this
 * file decides what to render (and whether a write may happen at all) from
 * what came back, and OverrideScreen.tsx does no further branching once it
 * has one of these view objects. The read/write client and the effect hook
 * that calls it must never appear here even as a mention (DoD).
 */
import type { PositionCode } from '../squad/positions'
import type {
  OverrideEntry,
  OverridePlayerOption,
  OverrideRecommendation,
  StoredOverrideDecision,
  TransferChoice,
  OverrideTarget,
} from './types.ts'

/**
 * Postgres' `unique_violation` SQLSTATE code — matches the unique index on
 * (gameweek_id, plan_index, kind) created by 20260823090000_
 * recommendation_decisions.sql (ticket #84's migration; this ticket adds no
 * migration of its own — see Context). Named here, not re-typed at the call
 * site, same convention as src/lib/commit/derive.ts's own constant.
 */
export const UNIQUE_VIOLATION_CODE = '23505'

/**
 * True when a write failure is the unique index doing exactly its job — a
 * second 'override' registration landing on a gameweek that already has
 * one (two open tabs, a duplicate tap that got past a stale render). The
 * FIRST guard is the screen's own access check (deriveOverrideAccess
 * below), so this should rarely fire; this is what stops the race it
 * defends against from ever reading as a failure. Same shape as
 * src/lib/commit/derive.ts's isAlreadyCommittedError.
 */
export function isAlreadyRegisteredError(errorCode: string | null | undefined): boolean {
  return errorCode === UNIQUE_VIOLATION_CODE
}

/**
 * Whether the override screen may offer its form for this (gameweek, plan):
 * - a stored commit hides the entry point entirely (DoD: "A gameweek with
 *   an existing commit row does not offer the override entry point").
 * - a stored override shows the registered record instead of the form
 *   (DoD: "shows the registered override rather than the form").
 * - otherwise the form is open.
 * Commit is checked first — an already-committed gameweek can never also
 * carry an override under this screen's own rules, but the check order
 * matters if the two ever did coexist (see types.ts's own comment: the
 * unique index is per-kind, so the database does not forbid it).
 */
export type OverrideAccessStatus = 'blocked-commit' | 'registered' | 'open'

export function deriveOverrideAccess(
  commitDecidedAt: string | null,
  existingOverride: StoredOverrideDecision | null
): OverrideAccessStatus {
  if (commitDecidedAt !== null) return 'blocked-commit'
  if (existingOverride !== null) return 'registered'
  return 'open'
}

/**
 * Turns a raw mode selection plus the two player pickers into a typed
 * TransferChoice, or null while the choice is still incomplete. 'roll'
 * needs nothing further; 'transfer' needs both players picked. Kept as its
 * own pure function so the screen never assembles this union by hand (and
 * so the "no derivation on the screen" rule holds for the transfer field
 * exactly as it does for the rest of the entry).
 */
export type TransferModeSelection = 'unset' | 'roll' | 'transfer'

export function buildTransferChoice(
  mode: TransferModeSelection,
  outPlayerId: number | null,
  inPlayerId: number | null
): TransferChoice | null {
  if (mode === 'roll') return { kind: 'roll' }
  if (mode === 'transfer' && outPlayerId !== null && inPlayerId !== null) {
    return { kind: 'transfer', outPlayerId, inPlayerId }
  }
  return null
}

/**
 * Every reason the current entry is not yet complete, in plain words —
 * drives both the "Continue" button's disabled state and an inline hint on
 * the entry step. Empty array means the entry is complete.
 */
export function missingEntryFields(entry: OverrideEntry): string[] {
  const missing: string[] = []
  if (entry.captainPlayerId === null) missing.push('Pick a captain')
  if (entry.viceCaptainPlayerId === null) missing.push('Pick a vice-captain')
  if (
    entry.captainPlayerId !== null &&
    entry.viceCaptainPlayerId !== null &&
    entry.captainPlayerId === entry.viceCaptainPlayerId
  ) {
    missing.push('Captain and vice-captain must be different players')
  }
  if (entry.transfer === null) {
    missing.push('Say whether the transfer was rolled or made')
  }
  return missing
}

export function isEntryComplete(entry: OverrideEntry): boolean {
  return missingEntryFields(entry).length === 0
}

/** The squad's 15 players, as selectable options — filters the wider pool
 *  down to the ids squad_picks carries for this gameweek. Used for the
 *  captain, vice-captain and transfer-out selectors alike (Scope: all three
 *  are "chosen from the 15 players in squad_picks for that gameweek"). */
export function squadMemberOptions(
  players: readonly OverridePlayerOption[],
  squadPlayerIds: ReadonlySet<number>
): OverridePlayerOption[] {
  return players.filter((p) => squadPlayerIds.has(p.id))
}

/** The position of a given player id within a player list, or null if the
 *  id is null or not found — used to resolve the transfer-out player's own
 *  position before filtering the transfer-in pool. */
export function elementTypeOf(
  players: readonly OverridePlayerOption[],
  playerId: number | null
): PositionCode | null {
  if (playerId === null) return null
  return players.find((p) => p.id === playerId)?.elementType ?? null
}

/**
 * The transfer-in selector's option list: same position as the player going
 * out, and never a player already in the 15 (Scope + DoD, "Named test for
 * each rule"). Returns nothing until a transfer-out player is chosen — there
 * is no position to filter by yet.
 */
export function selectableTransferInPlayers(
  players: readonly OverridePlayerOption[],
  squadPlayerIds: ReadonlySet<number>,
  transferOutElementType: PositionCode | null
): OverridePlayerOption[] {
  if (transferOutElementType === null) return []
  return players.filter((p) => p.elementType === transferOutElementType && !squadPlayerIds.has(p.id))
}

function playerLabel(id: number | null, names: ReadonlyMap<number, string>): string {
  if (id === null) return 'None'
  return names.get(id) ?? `Player ${String(id)}`
}

function transferLabel(
  isRoll: boolean,
  outId: number | null,
  inId: number | null,
  names: ReadonlyMap<number, string>
): string {
  if (isRoll) return 'Rolled the transfer'
  return `${playerLabel(outId, names)} out, ${playerLabel(inId, names)} in`
}

/** One field of the confirm-panel comparison — what was recommended, what
 *  will be recorded, and whether the two differ. `label` is the exact word
 *  the confirm panel renders next to it. */
export interface OverrideFieldComparison {
  label: string
  recommendedText: string
  actualText: string
  differs: boolean
}

export interface OverrideComparison {
  captain: OverrideFieldComparison
  viceCaptain: OverrideFieldComparison
  transfer: OverrideFieldComparison
  /** The label of every field that differs, in captain/vice-captain/transfer
   *  order — what the confirm panel highlights (DoD: "names every field
   *  that differs"). */
  differingFieldLabels: string[]
  isIdenticalToRecommendation: boolean
}

/**
 * Builds the side-by-side confirm-panel comparison. Requires a COMPLETE
 * entry (throws otherwise) — the screen only reaches this once
 * missingEntryFields(entry) is empty, via deriveOverrideFlowView below,
 * which is also what proves the "no confirmable state until the confirm
 * step is reached, and reaching it requires a complete entry" DoD item.
 */
export function compareToRecommendation(
  recommendation: OverrideRecommendation,
  entry: OverrideEntry,
  playerNames: ReadonlyMap<number, string>
): OverrideComparison {
  if (entry.captainPlayerId === null || entry.viceCaptainPlayerId === null || entry.transfer === null) {
    throw new Error('compareToRecommendation called with an incomplete entry')
  }

  const actualIsRoll = entry.transfer.kind === 'roll'
  const actualOutId = entry.transfer.kind === 'transfer' ? entry.transfer.outPlayerId : null
  const actualInId = entry.transfer.kind === 'transfer' ? entry.transfer.inPlayerId : null

  const captainDiffers = entry.captainPlayerId !== recommendation.captainPlayerId
  const viceCaptainDiffers = entry.viceCaptainPlayerId !== recommendation.viceCaptainPlayerId
  const transferDiffers =
    actualIsRoll !== recommendation.isRoll ||
    actualOutId !== recommendation.transferOutPlayerId ||
    actualInId !== recommendation.transferInPlayerId

  const captain: OverrideFieldComparison = {
    label: 'Captain',
    recommendedText: playerLabel(recommendation.captainPlayerId, playerNames),
    actualText: playerLabel(entry.captainPlayerId, playerNames),
    differs: captainDiffers,
  }
  const viceCaptain: OverrideFieldComparison = {
    label: 'Vice-captain',
    recommendedText: playerLabel(recommendation.viceCaptainPlayerId, playerNames),
    actualText: playerLabel(entry.viceCaptainPlayerId, playerNames),
    differs: viceCaptainDiffers,
  }
  const transfer: OverrideFieldComparison = {
    label: 'Transfer',
    recommendedText: transferLabel(
      recommendation.isRoll,
      recommendation.transferOutPlayerId,
      recommendation.transferInPlayerId,
      playerNames
    ),
    actualText: transferLabel(actualIsRoll, actualOutId, actualInId, playerNames),
    differs: transferDiffers,
  }

  const differingFieldLabels = [captain, viceCaptain, transfer]
    .filter((field) => field.differs)
    .map((field) => field.label)

  return {
    captain,
    viceCaptain,
    transfer,
    differingFieldLabels,
    isIdenticalToRecommendation: differingFieldLabels.length === 0,
  }
}

/** Refusal text for an entry that is identical to the recommendation (DoD:
 *  "refused with a specific message telling Keshav to use Commit
 *  instead"). Named constant so the unit test and the render both reference
 *  the same string, not two copies that can drift apart. */
export const IDENTICAL_TO_RECOMMENDATION_MESSAGE =
  "This matches the recommendation exactly — there's nothing to override. Use Commit on the verdict card instead."

export type OverrideStep = 'enter' | 'confirm'

export interface OverrideFlowInput {
  step: OverrideStep
  entry: OverrideEntry
  recommendation: OverrideRecommendation
  playerNames: ReadonlyMap<number, string>
}

/**
 * Fully-resolved display state for the two-step flow. `comparison` is the
 * ONLY thing that makes the write button appear — it is populated exactly
 * when: step === 'confirm', the entry is complete, AND the entry is not
 * identical to the recommendation. Every other combination — still on the
 * entry step, on the confirm step with an incomplete entry, or on the
 * confirm step with an entry identical to the recommendation — leaves
 * `comparison` null. This is what proves the friction is real rather than
 * cosmetic: nothing downstream can register a write from a null
 * `comparison`.
 */
export interface OverrideFlowView {
  step: OverrideStep
  canContinue: boolean
  missingFields: string[]
  comparison: OverrideComparison | null
  refusalMessage: string | null
}

export function deriveOverrideFlowView(input: OverrideFlowInput): OverrideFlowView {
  const missingFields = missingEntryFields(input.entry)
  const canContinue = missingFields.length === 0

  if (input.step !== 'confirm' || !canContinue) {
    return { step: input.step, canContinue, missingFields, comparison: null, refusalMessage: null }
  }

  const comparison = compareToRecommendation(input.recommendation, input.entry, input.playerNames)
  if (comparison.isIdenticalToRecommendation) {
    return {
      step: 'confirm',
      canContinue,
      missingFields,
      comparison: null,
      refusalMessage: IDENTICAL_TO_RECOMMENDATION_MESSAGE,
    }
  }

  return { step: 'confirm', canContinue, missingFields, comparison, refusalMessage: null }
}

/**
 * Assembles the row to write from a completed, non-identical entry — the
 * caller (OverrideScreen) only invokes this once deriveOverrideFlowView has
 * returned a non-null `comparison`, so the incomplete-entry throw below is
 * a defensive backstop, not a path the UI can reach. `hitCost` is always
 * the literal `null` — see types.ts's own comment on OverrideTarget.
 */
export function buildOverrideTarget(
  recommendation: OverrideRecommendation,
  entry: OverrideEntry
): OverrideTarget {
  if (entry.captainPlayerId === null || entry.viceCaptainPlayerId === null || entry.transfer === null) {
    throw new Error('buildOverrideTarget called with an incomplete entry')
  }
  const transfer = entry.transfer

  return {
    gameweekId: recommendation.gameweekId,
    planIndex: recommendation.planIndex,
    isRoll: transfer.kind === 'roll',
    transferInPlayerId: transfer.kind === 'transfer' ? transfer.inPlayerId : null,
    transferOutPlayerId: transfer.kind === 'transfer' ? transfer.outPlayerId : null,
    captainPlayerId: entry.captainPlayerId,
    viceCaptainPlayerId: entry.viceCaptainPlayerId,
    hitCost: null,
    solverRunId: recommendation.solverRunId,
  }
}

/** The registered-override read-only summary — same label/text shape as a
 *  comparison field's own text, reused so the "registered" state and the
 *  confirm panel describe the same decision in the same words. */
export interface RegisteredOverrideView {
  captainText: string
  viceCaptainText: string
  transferText: string
}

export function deriveRegisteredOverrideView(
  decision: StoredOverrideDecision,
  playerNames: ReadonlyMap<number, string>
): RegisteredOverrideView {
  return {
    captainText: playerLabel(decision.snapshot.captainPlayerId, playerNames),
    viceCaptainText: playerLabel(decision.snapshot.viceCaptainPlayerId, playerNames),
    transferText: transferLabel(
      decision.snapshot.isRoll,
      decision.snapshot.transferOutPlayerId,
      decision.snapshot.transferInPlayerId,
      playerNames
    ),
  }
}

/**
 * A write failure, turned into the specific, actionable text
 * design-reference.md requires: what failed and what to do, never a
 * generic error. Null in, null out — no attempt yet, or the attempt
 * succeeded, or the "failure" was actually the unique index doing its job
 * (isAlreadyRegisteredError; the caller never passes that one through as a
 * real error). Same shape as src/lib/commit/derive.ts's own error-message
 * branch inside deriveCommitView.
 */
export function deriveOverrideWriteErrorMessage(rawMessage: string | null): string | null {
  if (!rawMessage) return null
  return `Couldn't register the override: ${rawMessage}. Tap Register override to try again.`
}
