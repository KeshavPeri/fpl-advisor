/**
 * Pure time arithmetic + formatting for the home screen's deadline
 * countdown (ticket #42). Every function here takes the deadline — and,
 * where relevant, "now" — as plain arguments. Nothing here calls
 * `Date.now()` or a bare `new Date()`, and nothing touches the DOM, so
 * it's fully unit-testable without a clock or a browser. The live tick
 * (the one place that legitimately needs `Date.now()`) lives in
 * `src/components/DeadlineCountdown.tsx`, not here.
 *
 * `gameweeks.deadline_time` is a `timestamptz` (UTC) column. Parsing an
 * ISO instant with `new Date(iso)` and comparing `.getTime()` values
 * operates on the absolute instant the string names, not on any calendar
 * rendering of it — so the arithmetic below (computeRemaining) is
 * timezone-independent by construction, regardless of what timezone the
 * runtime happens to be in. Only *displaying* the deadline as a calendar
 * date/time is timezone-sensitive, which is why formatDeadlineInstant
 * pins `timeZone: 'Asia/Singapore'` explicitly rather than ever reading
 * the runtime's local zone.
 */

/**
 * The single named escalation threshold (ticket #42 DoD: "a single named
 * threshold constant"). Inside this many milliseconds of the deadline, the
 * countdown escalates — larger, accented, still never flashing/pulsing/red.
 */
export const ESCALATE_WITHIN_MS = 24 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface RemainingTime {
  /** Milliseconds until the deadline; zero or negative once it has passed. */
  totalMs: number
  /** True once `now` is at or past the deadline instant. */
  hasPassed: boolean
  /** True inside ESCALATE_WITHIN_MS of the deadline, and not yet passed. */
  isEscalated: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * Deterministic: takes `nowMs` as an argument rather than reading a clock,
 * so the same (deadlineIso, nowMs) pair always produces the same result.
 * Clamps every field to zero once the deadline has passed — callers never
 * see a negative unit or a NaN.
 */
export function computeRemaining(deadlineIso: string, nowMs: number): RemainingTime {
  const deadlineMs = new Date(deadlineIso).getTime()
  const totalMs = deadlineMs - nowMs
  const hasPassed = totalMs <= 0
  const clamped = Math.max(totalMs, 0)

  return {
    totalMs,
    hasPassed,
    isEscalated: !hasPassed && totalMs < ESCALATE_WITHIN_MS,
    days: Math.floor(clamped / DAY_MS),
    hours: Math.floor((clamped % DAY_MS) / HOUR_MS),
    minutes: Math.floor((clamped % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((clamped % MINUTE_MS) / 1000),
  }
}

/**
 * Renders remaining time per the ticket's pre-answered units rule: days +
 * hours outside the 24-hour threshold, hours + minutes inside it, minutes +
 * seconds inside the final hour (no seconds shown outside the final hour).
 * Only meaningful for a remaining (not yet passed) deadline — callers
 * branch on `hasPassed` first and render different copy for that case.
 */
export function formatRemaining(remaining: RemainingTime): string {
  if (remaining.totalMs >= ESCALATE_WITHIN_MS) {
    return `${remaining.days}d ${remaining.hours}h`
  }
  if (remaining.totalMs >= HOUR_MS) {
    return `${remaining.hours}h ${remaining.minutes}m`
  }
  return `${remaining.minutes}m ${remaining.seconds}s`
}

// Two separate formatters, not one combined one, deliberately. A single
// Intl.DateTimeFormat given both date and time fields punctuates the
// weekday/date/time boundaries itself, and that punctuation is ICU-version
// dependent — this repo's own src/lib/format.ts (formatSyncTimestamp)
// found that out the hard way: it assumes a comma lands between the date
// and the time and strips a leading one to compensate, but on this
// module's runtime ICU data there is no comma there at all, so its output
// renders as "Sat 22 Aug 01:30" with no separator, not the brief's "Sat 22
// Aug, 01:30" (see decisions/ticket-42.md). Formatting the date and time
// as two independent parts and joining them with a literal ", " sidesteps
// that ICU dependency entirely, which is why this file doesn't reuse
// formatSyncTimestamp.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * The deadline as a calendar date/time, always in Asia/Singapore
 * (UTC+8, no DST), in the brief's exact format: weekday-first date,
 * 24-hour time — "Sat 22 Aug, 01:30" — never a bare time, since a
 * Singapore-local deadline routinely rolls onto the next calendar date
 * from the UK instant FPL publishes.
 */
export function formatDeadlineInstant(deadlineIso: string): string {
  const instant = new Date(deadlineIso)
  // DATE_FORMATTER's own weekday/day/month punctuation is ICU-dependent
  // (see the comment above) — strip whatever comma it does or doesn't
  // insert after the weekday, then join with our own literal ", " so the
  // output is exact and stable everywhere.
  const datePart = DATE_FORMATTER.format(instant).replace(',', '')
  const timePart = TIME_FORMATTER.format(instant)
  return `${datePart}, ${timePart}`
}
