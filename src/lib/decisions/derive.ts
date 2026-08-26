/**
 * Pure derivation for the decision history screen (ticket #103). No I/O —
 * same split as src/lib/verdict/derive.ts, src/lib/chips/derive.ts and
 * src/lib/accuracy/derive.ts: api.ts does every network round trip and
 * resolves raw rows into the camelCased types in ./types.ts, this file does
 * every bit of arithmetic and wording, the screen renders this file's output
 * with no further logic of its own. `now` is always a parameter (the current
 * instant, milliseconds since epoch) — this file itself reads no clock,
 * matching src/lib/chips/derive.ts's own convention (`deriveChipState(source,
 * Date.now())`, called once, at the call site).
 *
 * See ./types.ts's own header for why an override entry carries a
 * "recommended" side only sometimes (ticket #107) — the short version:
 * `recommendation_decisions.snapshot` stores what was decided for both
 * kinds, and this module NEVER reads `recommendations` or `solver_picks`
 * live (both are upserted in place with no history, so a live join would
 * silently show today's recommendation mislabeled as an old decision's —
 * decisions/ticket-103.md's ruling, unchanged by #107). What #107 added is
 * an eighth snapshot key, `recommended`, written at override-registration
 * time from the recommendation the confirm panel already had in hand —
 * present for every override from #107 onward, absent (null) for a commit
 * and for every override registered before #107. This file renders a
 * field-by-field comparison when `recommended` is present, and the
 * original honest "not preserved" note when it is absent — the same "say
 * what's missing, don't fabricate" idiom this file already needs for an
 * unresolvable player id.
 */
import type {
  DecisionComparisonField,
  DecisionComparisonStatus,
  DecisionComparisonView,
  DecisionEntryView,
  DecisionGameweek,
  DecisionHistoryHeadline,
  DecisionHistorySource,
  DecisionHistoryView,
  DecisionSnapshot,
  DecisionSourceRow,
  RecommendedSnapshot,
  RecordedDecisionText,
} from './types.ts'
import { formatSyncTimestamp } from '../format'

/** Fallback for a player id that doesn't resolve against the current
 *  season's `players` table — same wording src/lib/verdict/derive.ts's own
 *  `nameFor` already uses for the identical situation, so the app doesn't
 *  speak two different phrases for the same fact. Exported so api.ts/tests
 *  can reference the exact string rather than a second copy that could
 *  drift. Named test: "an unresolvable player id renders as this label and
 *  the entry still appears in the output."
 */
export const UNKNOWN_PLAYER_LABEL = 'Unknown player'

/** Never recorded — never "0", never "£0", never the literal string "null".
 *  Named test: "an override's null hit_cost renders this text, not zero." */
export const HIT_COST_NOT_RECORDED_TEXT = 'Hit cost not recorded'

/** The honest gap note for an override entry (decisions/ticket-103.md's
 *  ruling) — a named constant so every test and every render reference the
 *  same string, not two copies that can drift apart, same convention
 *  src/lib/override/derive.ts's own IDENTICAL_TO_RECOMMENDATION_MESSAGE
 *  sets. States plainly what's missing and why, per design-reference.md's
 *  interface-writing rules (no apology, no vagueness) — it does not say
 *  "unknown" (that word is reserved for the unresolved-player case above)
 *  and it does not imply the override was right or wrong either way. */
export const RECOMMENDATION_NOT_PRESERVED_NOTE =
  "What the model recommended at the time wasn't preserved, so it can't be shown or compared here — only what was recorded."

/** What a comparison field renders when `recommended` is present but that
 *  specific key is missing from it (ticket #107 DoD) — never "null", never
 *  a guessed value, never a thrown error. Named so the test and the render
 *  share one string. */
export const FIELD_NOT_RECORDED_TEXT = 'Not recorded'

/** Rendered in place of a per-field difference list when a `recommended`
 *  side is present and every field matches what was decided — the override
 *  screen refuses to let this happen going forward (it rejects an entry
 *  identical to the recommendation), but a stored row is a fact and this
 *  reader must not assume that refusal held for every row it reads. */
export const NO_DIFFERENCE_FROM_RECOMMENDATION_MESSAGE =
  'This matched the recommendation on every recorded field — nothing differed.'

/** Invitation, not a mood — design-reference.md. Names what's missing (no
 *  decision recorded yet) and how one gets recorded (commit or override,
 *  from the verdict card), matching src/screens/HomeScreen.tsx's own
 *  no-squad invitation in tone. */
export const EMPTY_STATE_MESSAGE =
  'No decisions recorded yet. Commit a recommendation from the verdict card, or register an ' +
  'override if you did something else, and it appears here.'

function playerLabel(id: number | null, names: ReadonlyMap<number, string>): string {
  if (id === null) return 'None'
  return names.get(id) ?? UNKNOWN_PLAYER_LABEL
}

/** Same wording/branching as src/lib/override/derive.ts's own transferLabel
 *  — a local copy, not an import, per this module's own house rule (see
 *  types.ts's header): `isRoll` always wins over whatever the transfer id
 *  columns happen to hold, so a roll never misreads a stray non-null id, and
 *  a roll's null ids (the DoD's "missing optional field" case) never reach
 *  playerLabel at all. Takes the three fields directly (not a whole
 *  snapshot) so it renders equally for the decided side and the recommended
 *  side (buildComparison below reuses it for the latter). */
function transferTextFor(
  isRoll: boolean,
  outId: number | null,
  inId: number | null,
  names: ReadonlyMap<number, string>
): string {
  if (isRoll) return 'Rolled the transfer'
  return `${playerLabel(outId, names)} out, ${playerLabel(inId, names)} in`
}

function transferText(snapshot: DecisionSnapshot, names: ReadonlyMap<number, string>): string {
  return transferTextFor(snapshot.isRoll, snapshot.transferOutPlayerId, snapshot.transferInPlayerId, names)
}

function hitCostText(hitCost: number | null): string {
  if (hitCost === null) return HIT_COST_NOT_RECORDED_TEXT
  if (hitCost === 0) return 'No hit taken'
  return `Took a ${hitCost}-point hit`
}

/** Turns one stored snapshot into words — the same shape for a commit and
 *  an override, since both write the same seven keys (types.ts's own
 *  header). Never throws on a missing optional field: a roll's null
 *  transfer ids and an override's null hit_cost both have an explicit,
 *  correct rendering here rather than falling through to "null" or an
 *  exception. */
function recordedText(
  snapshot: DecisionSnapshot,
  names: ReadonlyMap<number, string>
): RecordedDecisionText {
  return {
    transferText: transferText(snapshot, names),
    captainText: playerLabel(snapshot.captainPlayerId, names),
    viceCaptainText: playerLabel(snapshot.viceCaptainPlayerId, names),
    hitCostText: hitCostText(snapshot.hitCost),
  }
}

const KIND_LABELS: Record<DecisionSourceRow['kind'], string> = {
  commit: 'Committed',
  override: 'Registered override',
}

/** One player-id comparison field (captain or vice-captain) — 'not-recorded'
 *  exactly when the key is missing from `recommended` (`typeof` guards
 *  against both an absent key and a malformed non-number value; DoD: never
 *  error, never show "null"). */
function fieldFromPlayerId(
  label: string,
  recommendedId: number | null | undefined,
  decidedId: number,
  names: ReadonlyMap<number, string>
): DecisionComparisonField {
  if (typeof recommendedId !== 'number') {
    return { label, recommendedText: FIELD_NOT_RECORDED_TEXT, status: 'not-recorded' }
  }
  const status: DecisionComparisonStatus = recommendedId === decidedId ? 'matches' : 'differs'
  return { label, recommendedText: playerLabel(recommendedId, names), status }
}

/** The transfer comparison field — known only when ALL THREE of `isRoll`,
 *  `transferInPlayerId` and `transferOutPlayerId` are present on
 *  `recommended`; a partial transfer recommendation (e.g. `isRoll` known
 *  but one player id missing) is treated as not-recorded rather than
 *  guessed at, matching the DoD's "missing key" rule at the level of the
 *  whole field, not a per-subkey best-effort. */
function transferFieldComparison(
  recommended: RecommendedSnapshot,
  decided: DecisionSnapshot,
  names: ReadonlyMap<number, string>
): DecisionComparisonField {
  const label = 'Transfer'
  if (
    typeof recommended.isRoll !== 'boolean' ||
    recommended.transferInPlayerId === undefined ||
    recommended.transferOutPlayerId === undefined
  ) {
    return { label, recommendedText: FIELD_NOT_RECORDED_TEXT, status: 'not-recorded' }
  }
  const recommendedText = transferTextFor(
    recommended.isRoll,
    recommended.transferOutPlayerId,
    recommended.transferInPlayerId,
    names
  )
  const differs =
    recommended.isRoll !== decided.isRoll ||
    recommended.transferOutPlayerId !== decided.transferOutPlayerId ||
    recommended.transferInPlayerId !== decided.transferInPlayerId
  return { label, recommendedText, status: differs ? 'differs' : 'matches' }
}

/**
 * The field-by-field comparison for an override that carries a `recommended`
 * side (ticket #107) — captain, vice-captain and transfer, the same three
 * fields `src/lib/override/derive.ts`'s `compareToRecommendation` compares
 * at write time. `summaryText` is ready to render: the honest "nothing
 * differed" note when `differingFieldLabels` is empty, otherwise which
 * field(s) differed and what was recommended for each.
 */
function buildComparison(
  decided: DecisionSnapshot,
  recommended: RecommendedSnapshot,
  names: ReadonlyMap<number, string>
): DecisionComparisonView {
  const captain = fieldFromPlayerId('Captain', recommended.captainPlayerId, decided.captainPlayerId, names)
  const viceCaptain = fieldFromPlayerId(
    'Vice-captain',
    recommended.viceCaptainPlayerId,
    decided.viceCaptainPlayerId,
    names
  )
  const transfer = transferFieldComparison(recommended, decided, names)

  const differingFields = [captain, viceCaptain, transfer].filter((field) => field.status === 'differs')
  const differingFieldLabels = differingFields.map((field) => field.label)

  const summaryText =
    differingFieldLabels.length === 0
      ? NO_DIFFERENCE_FROM_RECOMMENDATION_MESSAGE
      : `Differed from the recommendation — ${differingFields
          .map((field) => `${field.label} (recommended ${field.recommendedText})`)
          .join('; ')}.`

  return { captain, viceCaptain, transfer, differingFieldLabels, summaryText }
}

function toEntryView(row: DecisionSourceRow, names: ReadonlyMap<number, string>): DecisionEntryView {
  const recommended = row.kind === 'override' ? row.snapshot.recommended : null

  return {
    id: `${row.gameweekId}-${row.planIndex}-${row.kind}`,
    gameweekId: row.gameweekId,
    gameweekName: row.gameweekName,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind],
    decidedAtIso: row.decidedAt,
    decidedAtLabel: formatSyncTimestamp(row.decidedAt),
    recorded: recordedText(row.snapshot, names),
    // A commit is, by definition, an acceptance of the recommendation as
    // given — there is nothing to note a gap about, and nothing to compare
    // (Scope, ticket #107). An override carries EITHER the honest
    // "not preserved" note (recommended is null — decisions/ticket-103.md's
    // original ruling, for every override before #107) OR the comparison
    // below (recommended is present — ticket #107), never both.
    recommendationGapNote: row.kind === 'override' && recommended === null ? RECOMMENDATION_NOT_PRESERVED_NOTE : null,
    recommendationComparison: recommended !== null ? buildComparison(row.snapshot, recommended, names) : null,
  }
}

/** A gameweek counts as elapsed once its deadline has passed — the point
 *  after which a decision could no longer be made for it. Deliberately NOT
 *  `gameweeks.finished` (matches being played is a later, separate event
 *  from the deadline a decision has to beat) — see types.ts's own comment
 *  on DecisionGameweek.deadlineTime. */
function isElapsed(gameweek: DecisionGameweek, nowMs: number): boolean {
  return new Date(gameweek.deadlineTime).getTime() <= nowMs
}

/**
 * The season's headline counts (product-brief.md §1: the app earns trust by
 * being measurable; this measures the loop, not the model). `commits` and
 * `overrides` are raw counts of decision rows, so `commits + overrides ===
 * decisionsRecorded` holds by construction, always. `gameweeksWithNoDecision`
 * is `gameweeksElapsed` minus the count of DISTINCT elapsed gameweeks that
 * have at least one decision row of either kind — so the full chain
 * (`decisionsRecorded + gameweeksWithNoDecision === gameweeksElapsed`) holds
 * exactly when every elapsed gameweek that has a decision has exactly one.
 * That is the normal case: `src/lib/override/derive.ts`'s
 * `deriveOverrideAccess` already refuses to offer an override once a
 * gameweek has a commit, so the interface never intentionally produces two.
 * This function does NOT collapse a gameweek that somehow holds both a
 * commit row and an override row (the unique index is per-kind, so the
 * database itself does not forbid it — see override/types.ts's own comment)
 * into one for this arithmetic; if that ever happens the three counts stop
 * reconciling, on purpose — the ticket's own DoD calls that the finding, not
 * a bug to paper over.
 */
function computeHeadline(
  decisions: readonly DecisionSourceRow[],
  gameweeks: readonly DecisionGameweek[],
  nowMs: number
): DecisionHistoryHeadline {
  const gameweeksElapsed = gameweeks.filter((gw) => isElapsed(gw, nowMs)).length

  const commits = decisions.filter((d) => d.kind === 'commit').length
  const overrides = decisions.filter((d) => d.kind === 'override').length
  const decisionsRecorded = commits + overrides

  const decidedGameweekIds = new Set(decisions.map((d) => d.gameweekId))
  const elapsedGameweekIds = new Set(
    gameweeks.filter((gw) => isElapsed(gw, nowMs)).map((gw) => gw.id)
  )
  let gameweeksWithDecision = 0
  for (const id of decidedGameweekIds) {
    if (elapsedGameweekIds.has(id)) gameweeksWithDecision += 1
  }
  const gameweeksWithNoDecision = gameweeksElapsed - gameweeksWithDecision

  return { decisionsRecorded, commits, overrides, gameweeksElapsed, gameweeksWithNoDecision }
}

export function deriveDecisionHistoryView(
  source: DecisionHistorySource,
  nowMs: number
): DecisionHistoryView {
  const headline = computeHeadline(source.decisions, source.gameweeks, nowMs)

  if (source.decisions.length === 0) {
    return {
      hasEntries: false,
      emptyStateMessage: EMPTY_STATE_MESSAGE,
      entries: [],
      headline,
    }
  }

  const entries = [...source.decisions]
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .map((row) => toEntryView(row, source.playerNames))

  return {
    hasEntries: true,
    emptyStateMessage: null,
    entries,
    headline,
  }
}
