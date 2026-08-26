/**
 * Types for the decision history screen (ticket #103, feature-list item 24
 * follow-on — the ledger of what Keshav actually did, as opposed to what he
 * was told to do). Small, local copies of the recommendation/decision shapes
 * this module reads, rather than importing from `src/lib/commit/` or
 * `src/lib/override/` — same precedent those two modules' own header
 * comments set for each other (and for `src/lib/verdict/` before them): a
 * feature owns a small local copy of a domain type it merely touches, rather
 * than importing across an unrelated module boundary. Both of those modules
 * are explicitly out of scope for this ticket's diff.
 *
 * ============================================================================
 * Why an override entry carries a "recommended" side ONLY SOMETIMES (ticket
 * #107 — see decisions/ticket-103.md's HIGH-IMPACT entry for the original
 * "because", and decisions/ticket-107.md for how it was reversed at the
 * write path).
 * ============================================================================
 * `recommendation_decisions.snapshot` stores seven DECIDED keys for BOTH
 * `commit` and `override` rows — `is_roll`, `transfer_in_player_id`,
 * `transfer_out_player_id`, `captain_player_id`, `vice_captain_player_id`,
 * `hit_cost`, `solver_run_id` (the migration's own comment; confirmed in
 * `src/lib/commit/api.ts`'s `commitRecommendation`). Neither table
 * (`recommendations`, `solver_picks`) that could otherwise supply "what was
 * recommended" keeps any history — both are upserted in place per gameweek
 * — so a live join to either, after the fact, would silently show today's
 * recommendation mislabeled as the one an old decision was actually
 * compared against. That is still true and still forbidden (Notes,
 * ticket-103.md and ticket-107.md alike): this module NEVER reads
 * `recommendations` or `solver_picks`, and never will.
 *
 * What changed at #107: `src/lib/override/api.ts`'s `registerOverride` now
 * writes an EIGHTH top-level snapshot key, `recommended` — a nested object
 * carrying the same seven field names, sourced from the recommendation the
 * override's confirm panel already had in hand at write time (never from a
 * later, live read). A `commit` row still carries no `recommended` — a
 * commit IS the recommendation, so there is nothing to compare (Scope). An
 * `override` row written BEFORE #107 also carries no `recommended` — that
 * data was never captured and cannot be reconstructed or backfilled
 * (out of scope by ticket-107.md, permanently: "that data does not exist
 * and must not be invented"). So `DecisionSnapshot.recommended` below is
 * `null` for a commit, `null` for a pre-#107 override, and a
 * `RecommendedSnapshot` for every override registered from #107 onward —
 * and `derive.ts` renders the honest "not preserved" gap note in exactly
 * the first two cases, and a field-by-field comparison in the third.
 */

export type DecisionKind = 'commit' | 'override'

/** One `gameweeks` row, trimmed to what this module needs — resolving a
 *  decision's gameweek name, and computing how many gameweeks have elapsed
 *  this season. */
export interface DecisionGameweek {
  id: number
  name: string
  /** ISO instant. A gameweek counts as "elapsed" once its deadline has
   *  passed — see derive.ts's `isElapsed` — because that is the point after
   *  which a decision could no longer be made for it, not whether its
   *  matches have finished being played. */
  deadlineTime: string
}

/**
 * The recommended side of an override snapshot (ticket #107) — the same
 * seven field names as `DecisionSnapshot` below, but every field is
 * OPTIONAL. `snapshot` is a free-shaped `jsonb` column with no schema
 * enforcement, so a stored `recommended` object is not guaranteed to carry
 * every key (DoD: "a `recommended` object present but missing a key
 * renders that field as not recorded rather than erroring or showing
 * 'null'"). A missing key here means exactly that — not recorded — and
 * derive.ts's comparison must render it that way, never by guessing a
 * value or throwing.
 */
export interface RecommendedSnapshot {
  isRoll?: boolean
  transferInPlayerId?: number | null
  transferOutPlayerId?: number | null
  captainPlayerId?: number
  viceCaptainPlayerId?: number
  hitCost?: number
  solverRunId?: number | null
}

/**
 * The frozen `snapshot` jsonb column, camelCased 1:1 — nothing renamed or
 * reshaped, so derive.ts's rendering can be checked directly against the
 * migration's own column comment. `hitCost` stays nullable here exactly as
 * stored: null on every override "by design" (a hand-typed points cost
 * would eventually be wrong; the real figure arrives from the FPL API after
 * the deadline) and never itself zero on that path — derive.ts must render
 * that as "not recorded", never as "0".
 *
 * `recommended` (ticket #107) is `null` for a commit, `null` for an override
 * registered before #107, and a `RecommendedSnapshot` for an override
 * registered from #107 onward — see this file's header for the full
 * "because". It is never itself `undefined`: api.ts normalizes a missing
 * key in the raw jsonb to `null` before this type is ever populated, so
 * every reader has exactly one "absent" value to check for, not two.
 */
export interface DecisionSnapshot {
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: number | null
  solverRunId: number | null
  recommended: RecommendedSnapshot | null
}

/** One `recommendation_decisions` row, already resolved to a gameweek name
 *  by api.ts — nothing else joined in beyond `snapshot.recommended`, which
 *  is read from the SAME stored row, never from a live join (see the file
 *  header). */
export interface DecisionSourceRow {
  gameweekId: number
  gameweekName: string
  planIndex: number
  kind: DecisionKind
  /** ISO instant — `recommendation_decisions.decided_at`. */
  decidedAt: string
  snapshot: DecisionSnapshot
}

/** Everything `deriveDecisionHistoryView` needs — every decision ever
 *  recorded (unordered; derive.ts does the newest-first sort), every
 *  gameweek (for the elapsed-gameweeks count), and player names resolved for
 *  every id referenced by any snapshot. */
export interface DecisionHistorySource {
  decisions: readonly DecisionSourceRow[]
  gameweeks: readonly DecisionGameweek[]
  /** Display name for every player id that could be resolved against the
   *  CURRENT season's `players` table. An id that cannot be resolved (players
   *  are re-keyed between seasons; `code` is the stable key, `id` is not)
   *  renders as an explicit unknown-player label rather than dropping the
   *  entry — see derive.ts's `playerLabel`. */
  playerNames: ReadonlyMap<number, string>
}

/** The recorded decision, in words — same shape for both kinds, since both
 *  write the same seven snapshot keys. Player ids are already resolved to
 *  names (or the explicit unknown-player label). */
export interface RecordedDecisionText {
  transferText: string
  captainText: string
  viceCaptainText: string
  /** Never "0" for an unrecorded hit and never the literal string "null" —
   *  see DecisionSnapshot's own comment on `hitCost`. */
  hitCostText: string
}

/** Whether one field of the recommended-vs-decided comparison (ticket #107)
 *  differed, matched, or could not be determined at all because the
 *  `recommended` object was missing that key. */
export type DecisionComparisonStatus = 'differs' | 'matches' | 'not-recorded'

/** One field of the comparison — captain, vice-captain or transfer, same
 *  three fields `src/lib/override/derive.ts`'s own `OverrideComparison`
 *  compares at write time (a local copy, not an import — see this file's
 *  header on why a feature owns its own shape rather than crossing a
 *  module boundary). `recommendedText` reads `FIELD_NOT_RECORDED_TEXT`
 *  exactly when `status === 'not-recorded'`. */
export interface DecisionComparisonField {
  label: string
  recommendedText: string
  status: DecisionComparisonStatus
}

/** Fully-resolved recommended-vs-decided comparison for one override entry
 *  — present only when that entry's `snapshot.recommended` is non-null
 *  (ticket #107). `summaryText` is ready to render as-is: the honest "no
 *  difference" note when nothing differed, or which field(s) differed and
 *  what was recommended for each. */
export interface DecisionComparisonView {
  captain: DecisionComparisonField
  viceCaptain: DecisionComparisonField
  transfer: DecisionComparisonField
  /** Every field whose status is 'differs', in captain/vice-captain/
   *  transfer order. Empty when nothing differed (including when every
   *  field's status is 'not-recorded' — there is nothing to name as
   *  differing when nothing could be compared at all). */
  differingFieldLabels: readonly string[]
  summaryText: string
}

/** Fully-resolved display data for one row of the history — the screen does
 *  no further derivation. */
export interface DecisionEntryView {
  /** `${gameweekId}-${planIndex}-${kind}` — unique per the table's own
   *  unique index on (gameweek_id, plan_index, kind), stable across
   *  re-renders, safe as a React list key. */
  id: string
  gameweekId: number
  gameweekName: string
  kind: DecisionKind
  /** "Committed" or "Registered override" — the exact verbs the commit
   *  control and the override screen already use for these actions
   *  (design-reference.md: an action keeps the same name through the whole
   *  flow), never a judgement word like "Accepted" or "Overruled". */
  kindLabel: string
  decidedAtIso: string
  decidedAtLabel: string
  recorded: RecordedDecisionText
  /**
   * Present only for `kind === 'override'` with no `recommended` side
   * stored (decisions/ticket-103.md's original ruling, narrowed by
   * ticket #107 to exactly this case) — the honest gap note stating that
   * the original recommendation was not preserved and cannot be shown or
   * compared. Null for a commit (which by definition matches whatever was
   * recommended) and null for an override that DOES carry a `recommended`
   * side — see `recommendationComparison` below, which is populated
   * instead in that case. Exactly one of the two is ever non-null.
   */
  recommendationGapNote: string | null
  /**
   * Present only for `kind === 'override'` with a `recommended` side
   * stored (ticket #107) — the field-by-field comparison. Null for a
   * commit and null for an override with no `recommended` side, where
   * `recommendationGapNote` above is populated instead.
   */
  recommendationComparison: DecisionComparisonView | null
}

/** The season's headline counts. Reconciles arithmetically by construction
 *  in the normal case (at most one decision per gameweek, the interface rule
 *  `src/lib/override/derive.ts`'s `deriveOverrideAccess` already enforces) —
 *  see derive.ts's own comment on what a mismatch here would mean. */
export interface DecisionHistoryHeadline {
  decisionsRecorded: number
  commits: number
  overrides: number
  gameweeksElapsed: number
  gameweeksWithNoDecision: number
}

/** Fully-resolved display state for the whole screen. */
export interface DecisionHistoryView {
  hasEntries: boolean
  /** Present only when hasEntries is false — names what is missing and how
   *  a decision gets recorded (design-reference.md: "an empty state is an
   *  invitation to act, not a mood"). */
  emptyStateMessage: string | null
  /** Newest first by decidedAt. Empty only alongside hasEntries: false. */
  entries: readonly DecisionEntryView[]
  headline: DecisionHistoryHeadline
}
