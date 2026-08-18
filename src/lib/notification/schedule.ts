/**
 * Notification scheduling — ticket #59 (feature-list item 15, "the last
 * piece of the value loop"). Pure: decides WHICH trigger, if any, should
 * fire right now, given the deadline instant, the current instant, and
 * which scheduled triggers have already been sent successfully for this
 * gameweek. No I/O of any kind, and no `Date.now()` / argument-less
 * `new Date()` anywhere in this file — every instant is a parameter, so
 * this module is fully deterministic and testable with no faked clock
 * (this ticket's own DoD, verifiable by search).
 *
 * This module answers WHEN, never WHAT — `src/lib/notification/message.ts`
 * still owns message text and composition; this ticket's own Scope OUT
 * forbids touching it.
 *
 * ============================================================================
 * The rule, in one sentence: fire the tightest unsent window, and let the
 * wider one lapse.
 * ============================================================================
 * - More than 24h before the deadline: nothing fires — too early.
 * - At or inside 10h remaining: `deadline_10h`, REGARDLESS of whether
 *   `deadline_24h` already fired or was missed entirely. A missed 24h
 *   window is stale news by the time 10h is reached; it must never be sent
 *   late alongside (or instead of) the 10h one — this ticket's own DoD.
 * - Strictly between 10h (exclusive) and 24h (inclusive) remaining:
 *   `deadline_24h`.
 * - At or after the deadline (`hoursRemaining <= 0`, including exactly
 *   zero): nothing fires. A notification carrying a decision Keshav can no
 *   longer act on is worse than none — product-brief.md §1.
 *
 * Boundaries are inclusive at the threshold the TIGHTER window owns:
 * exactly 24.0h remaining fires `deadline_24h` (the "more than 24h, nothing
 * fires" rule is for STRICTLY more than 24h); exactly 10.0h remaining fires
 * `deadline_10h` (the tighter window claims the boundary it shares with the
 * wider one, consistent with "fire the tightest unsent window").
 *
 * A trigger already present in `sentTriggers` is never re-selected as the
 * candidate's target — but the REAL guarantee against a double send is the
 * partial unique index in
 * supabase/migrations/20260819090000_notification_trigger.sql, not this
 * check. Two overlapping runs can both evaluate this function and both see
 * an empty `sentTriggers` (a read-then-decide race) — this function existing
 * only avoids the pointless extra work of attempting a send that the
 * database would reject anyway; see that migration's own header for why the
 * index, not this check, is what actually prevents a double send.
 */

/** The two window triggers this module can select. Never 'manual' — that trigger is chosen by a human dispatching the workflow directly (scripts/send-telegram.ts), bypassing this module's window logic entirely (this ticket's own DoD). */
export type ScheduledTrigger = 'deadline_24h' | 'deadline_10h'

/** The full set of values `notifications.trigger` may hold — matches the CHECK constraint in supabase/migrations/20260819090000_notification_trigger.sql exactly. */
export type NotificationTrigger = 'manual' | ScheduledTrigger

const DEADLINE_24H_WINDOW_HOURS = 24
const DEADLINE_10H_WINDOW_HOURS = 10
const MS_PER_HOUR = 60 * 60 * 1000

export interface ScheduleDecisionInput {
  /** The gameweek deadline as an epoch-millisecond instant (e.g. `new Date(gw.deadline_time).getTime()`). `gameweeks.deadline_time` is `timestamptz` in UTC and this function does no timezone conversion whatsoever — it only differences two instants. Do not introduce a timezone into this module; Singapore time appears only in the message text (item 14), never here. */
  deadlineMs: number
  /** The current instant as an epoch-millisecond instant. Always a parameter — this module never reads the system clock. */
  nowMs: number
  /** Which SCHEDULED triggers (never 'manual' — a manual send does not occupy either window slot) already have a `notifications` row with `outcome = 'sent'` for this gameweek. */
  sentTriggers: ReadonlySet<ScheduledTrigger> | readonly ScheduledTrigger[]
}

export interface ScheduleDecision {
  /** The trigger to fire now, or null if nothing should fire. */
  trigger: ScheduledTrigger | null
  /** Hours remaining until the deadline — negative once the deadline has passed. Always present, even when `trigger` is null, so the caller can log and record it (this ticket's own DoD: `job_runs` must carry "the hours remaining"). */
  hoursRemaining: number
  /** Human-readable reason for the decision, for logs and `job_runs.message`. */
  reason: string
}

export function decideNotificationTrigger(input: ScheduleDecisionInput): ScheduleDecision {
  const hoursRemaining = (input.deadlineMs - input.nowMs) / MS_PER_HOUR
  const sent = input.sentTriggers instanceof Set ? input.sentTriggers : new Set(input.sentTriggers)

  if (hoursRemaining <= 0) {
    return {
      trigger: null,
      hoursRemaining,
      reason: `the deadline has passed (${hoursRemaining.toFixed(2)}h remaining) — nothing fires at or after the deadline.`,
    }
  }
  if (hoursRemaining > DEADLINE_24H_WINDOW_HOURS) {
    return {
      trigger: null,
      hoursRemaining,
      reason: `more than ${DEADLINE_24H_WINDOW_HOURS}h remain (${hoursRemaining.toFixed(2)}h) — outside both windows.`,
    }
  }

  // Tightest unsent window wins: at or inside 10h, only deadline_10h is ever
  // the candidate — whether deadline_24h already fired or was simply missed
  // makes no difference to which window is considered next.
  const candidate: ScheduledTrigger = hoursRemaining <= DEADLINE_10H_WINDOW_HOURS ? 'deadline_10h' : 'deadline_24h'

  if (sent.has(candidate)) {
    return {
      trigger: null,
      hoursRemaining,
      reason: `${candidate} was already sent for this gameweek (${hoursRemaining.toFixed(2)}h remaining) — not sending again.`,
    }
  }

  return {
    trigger: candidate,
    hoursRemaining,
    reason: `${hoursRemaining.toFixed(2)}h remaining, inside the ${candidate} window and not yet sent.`,
  }
}
