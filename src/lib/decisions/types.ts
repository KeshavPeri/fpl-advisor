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
 * Why an override entry never carries a "recommended" side (see
 * decisions/ticket-103.md's HIGH-IMPACT entry for the full "because").
 * ============================================================================
 * `recommendation_decisions.snapshot` stores exactly seven keys for BOTH
 * `commit` and `override` rows — `is_roll`, `transfer_in_player_id`,
 * `transfer_out_player_id`, `captain_player_id`, `vice_captain_player_id`,
 * `hit_cost`, `solver_run_id` (the migration's own comment; confirmed in
 * `src/lib/commit/api.ts`'s `commitRecommendation` and
 * `src/lib/override/api.ts`'s `registerOverride`, which both write the same
 * seven keys). Every one of them describes what was DECIDED, never what the
 * solver had suggested — there is no `recommended_*` sibling anywhere in the
 * schema. `recommendations` and `solver_picks` are both upserted in place
 * per gameweek (no history), so a live join to either, after the fact, would
 * silently show today's recommendation mislabeled as the one an old override
 * was actually compared against — exactly what this ticket's own Notes
 * forbid. So `DecisionSourceRow` below carries only the decided (recorded)
 * fields, for both kinds, and `derive.ts` renders an explicit "not preserved"
 * note for an override's would-be comparison rather than fabricating one.
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
 * The frozen `snapshot` jsonb column, camelCased 1:1 — nothing renamed or
 * reshaped, so derive.ts's rendering can be checked directly against the
 * migration's own column comment. `hitCost` stays nullable here exactly as
 * stored: null on every override "by design" (a hand-typed points cost
 * would eventually be wrong; the real figure arrives from the FPL API after
 * the deadline) and never itself zero on that path — derive.ts must render
 * that as "not recorded", never as "0".
 */
export interface DecisionSnapshot {
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: number | null
  solverRunId: number | null
}

/** One `recommendation_decisions` row, already resolved to a gameweek name
 *  by api.ts — nothing else joined in (see the file header: there is
 *  deliberately no "recommended" counterpart here). */
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
   * Present only for `kind === 'override'` — the honest gap note (per
   * decisions/ticket-103.md's ruling) stating that the original
   * recommendation was not preserved and cannot be shown or compared. Null
   * for a commit, which by definition matches whatever was recommended.
   */
  recommendationGapNote: string | null
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
