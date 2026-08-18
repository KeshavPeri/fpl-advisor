/**
 * Message composition — ticket #55 (feature-list item 14, "so acknowledging
 * the notification and deciding are the same act"). Pure string assembly
 * from already-resolved inputs — no lookup, no I/O, no fetch. See this
 * file's own header comment for why this module never rebuilds the
 * recommendation's own facts (captain, hit cost, confidence wording) from
 * scratch.
 *
 * ============================================================================
 * Why this module composes from stored TEXT, not from recommendation data.
 * ============================================================================
 * `src/lib/recommendation/reasons.ts` (ticket #47) already builds exactly
 * this wording — sentence case, plain verbs, FPL's own vocabulary, no
 * emoji — as `recommendation_reasons` rows, and its own file header says so
 * explicitly: "item 14 (Telegram) uses the first line as the headline."
 * Rebuilding that composition here from raw recommendation columns would
 * duplicate ticket #47's logic (and this ticket's Scope OUT explicitly
 * forbids touching `src/lib/recommendation/` or changing the recommendation
 * itself) AND risk the two texts drifting apart — the reasoning screen
 * (item 21) and the Telegram message would then say different things about
 * the same plan. Instead: `scripts/send-telegram.ts` reads the stored
 * `recommendation_reasons` rows verbatim and this module only arranges them
 * — headline first, then the rest, then Plan B, then an optional
 * solver-status caveat — and enforces the message-level rules that ARE this
 * ticket's own (truncation to Telegram's limit; the solver-status caveat;
 * staleness/failure framing). Plan B is likewise just plan_index 1's own
 * order_index 0 line ("named in one line" — that line already IS one line,
 * written by the same ticket #47 logic).
 */
import { composeSolverCaveat, type SolverStatusInfo } from './solverStatus.ts'

/** Telegram's own `sendMessage` `text` length ceiling, in UTF-16 code units (matching plain JS `.length`; Telegram actually counts UTF-8 bytes for multi-byte characters, but this app's message text is plain ASCII English, so the two never diverge in practice — see this ticket's DoD: "under Telegram's 4,096-char limit"). */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

const TRUNCATION_MARKER = '\n\n[Message truncated — see the app for the full plan.]'

/**
 * Cuts `fullText` to fit Telegram's limit, always keeping `headline` intact
 * at the start — this ticket's DoD: "oversized input truncated at a stated
 * boundary with headline and decision always preserved." `headline` and
 * "the decision" are the same thing in this app's messages: the DoD's own
 * "headline first: first line states the decision" rule means whatever text
 * this module puts first IS the decision, so preserving one preserves both.
 *
 * Every `composeXMessage` function below builds its output starting with
 * its own headline text, so `fullText` always starts with `headline`
 * already; the fallback branch below only exists so that invariant is
 * enforced by code, not merely by convention, in case a future caller gets
 * the argument order wrong.
 */
export function truncateMessage(fullText: string, headline: string): string {
  if (fullText.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return fullText

  const budget = Math.max(TELEGRAM_MAX_MESSAGE_LENGTH - TRUNCATION_MARKER.length, 0)

  if (!fullText.startsWith(headline) || headline.length > budget) {
    // Defensive fallback — see doc comment above. Keeps as much of the
    // headline as the budget allows rather than losing it entirely.
    return headline.slice(0, budget) + TRUNCATION_MARKER
  }

  return fullText.slice(0, budget) + TRUNCATION_MARKER
}

/** Plan B is always sent as the single stored headline line for plan_index 1 (recommendation_reasons' own order_index 0) — see this file's header. Null when no Plan B exists (a single-solution solve; not a failure, see ticket #47's own confidence.ts comment on this). */
export function composePlanBLine(planBHeadline: string): string {
  return `Plan B: ${planBHeadline}`
}

export interface CurrentMessageInput {
  /** `recommendation_reasons` rows for plan_index 0, ordered by order_index, `reason` column only. Line 0 is the headline/decision per ticket #47's own file header. Must be non-empty — a recommendation with no stored reasoning is a data-integrity failure the caller should raise before reaching this function, not something this function silently tolerates. */
  reasonLines: readonly string[]
  /** plan_index 1's own order_index-0 reason line, verbatim, or null if there is no Plan B. */
  planB: string | null
  solverStatus: SolverStatusInfo
}

/** The current gameweek's own recommendation, sent as a fresh, live plan — the normal case. */
export function composeCurrentMessage(input: CurrentMessageInput): string {
  if (input.reasonLines.length === 0) {
    throw new Error('composeCurrentMessage requires at least one reason line — an empty recommendation cannot be sent.')
  }

  const headline = input.reasonLines[0]
  const sections: string[] = [input.reasonLines.join('\n')]

  if (!input.solverStatus.isOptimal && input.solverStatus.status !== null) {
    sections.push(composeSolverCaveat(input.solverStatus.status))
  }
  if (input.planB !== null) {
    sections.push(composePlanBLine(input.planB))
  }

  return truncateMessage(sections.join('\n\n'), headline)
}

export interface StaleMessageInput {
  /** `recommendation_reasons` rows for plan_index 0 of the STALE (old) recommendation being sent, ordered by order_index. */
  reasonLines: readonly string[]
  recommendationGameweekId: number
  currentGameweekId: number
  planB: string | null
  solverStatus: SolverStatusInfo
}

/**
 * A recommendation that exists but is for an OLDER gameweek than the one
 * currently being planned for — product-brief.md §6a/§6d's "never present
 * stale recommendations as current," applied here as "state its age
 * explicitly" (this ticket's own DoD gives the alternative — a plain
 * failure notice — to `composeNoRecommendationMessage` instead, for when
 * there is no recommendation at all).
 *
 * The decision itself still leads (reasonLines[0], same as the current-plan
 * case) — the age notice reads as a caveat on a real answer, not as a
 * different kind of message that buries the decision.
 */
export function composeStaleMessage(input: StaleMessageInput): string {
  if (input.reasonLines.length === 0) {
    throw new Error('composeStaleMessage requires at least one reason line — an empty recommendation cannot be sent.')
  }

  const headline = input.reasonLines[0]
  const gap = input.currentGameweekId - input.recommendationGameweekId
  const ageLine =
    `This is the gameweek ${input.recommendationGameweekId} plan, ${gap} gameweek${gap === 1 ? '' : 's'} old — ` +
    `gameweek ${input.currentGameweekId} has no recommendation yet.`

  const sections: string[] = [headline, ageLine]
  const rest = input.reasonLines.slice(1)
  if (rest.length > 0) sections.push(rest.join('\n'))
  if (!input.solverStatus.isOptimal && input.solverStatus.status !== null) {
    sections.push(composeSolverCaveat(input.solverStatus.status))
  }
  if (input.planB !== null) {
    sections.push(composePlanBLine(input.planB))
  }

  return truncateMessage(sections.join('\n\n'), headline)
}

/**
 * product-brief.md §6c: infeasible "almost always means squad state is
 * wrong, not that the solver broke... the app must say the registered squad
 * doesn't reconcile and prompt Keshav to re-check it, rather than showing a
 * generic error." This is that specific message, never the generic one.
 */
export function composeInfeasibleMessage(gameweekId: number): string {
  const headline = `The squad for gameweek ${gameweekId} doesn't reconcile with FPL.`
  const body =
    `The solve for gameweek ${gameweekId} came back infeasible. This almost always means the registered squad ` +
    'doesn\'t match what FPL actually holds — re-check the last transfer and squad state before the next run.'
  return truncateMessage(`${headline}\n${body}`, headline)
}

/**
 * The general "no usable recommendation" failure notice — product-brief.md
 * §6a/§6c/§6d: a failure sends a failure notice, never silence. Used both
 * for "nothing has ever been generated" and for any solver failure mode
 * that is not specifically infeasible (crash, no-incumbent timeout,
 * install/binary-missing) — `scripts/send-telegram.ts` decides which case
 * applies; this function only renders the outcome.
 */
export function composeNoRecommendationMessage(gameweekId: number): string {
  const headline = `No recommendation is available for gameweek ${gameweekId}.`
  const body = 'Nothing usable has been generated yet — check the solver run before the next deadline.'
  return truncateMessage(`${headline}\n${body}`, headline)
}
