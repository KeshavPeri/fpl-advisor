// Shared gameweek-lockdown helper — ticket #73.
//
// product-brief.md §6d: "Gameweek lockdown is 09:00 UK time the morning after the final match,
// not one hour after the final whistle. The accuracy tracker must wait for lockdown before
// scoring itself, or it will compare against provisional bonus and defcon numbers." This module
// is the ONE place that rule is computed. scripts/settle-predictions.ts is the only caller today;
// it lives under scripts/lib/ (not inlined in that one file) so a future consumer of the same
// rule — the in-app rolling accuracy figure this ticket explicitly does not build — can import it
// rather than re-deriving it.
//
// PURE. Every function here takes the instant(s) it needs as a plain argument — no
// `Date.now()`, no argument-less `new Date()` anywhere in this file, so the whole rule is
// testable without a faked clock (same discipline as src/lib/deadlineCountdown.ts and
// src/lib/notification/schedule.ts).
//
// THE RULE, IN ONE SENTENCE: take the gameweek's final fixture's KICKOFF (not finish) time, roll
// forward to the next calendar day in Europe/London, and lock at 09:00 that day, in Europe/London
// wall-clock time. Kickoff, not finish, is a deliberate simplification the ticket's own Notes
// call for — a fixture that kicks off at 20:00 and runs long still rolls to "the day after this
// match", which is the intended behaviour (lockdown is the MORNING AFTER, generously, not a
// minute-precise trigger keyed to when a match actually ends).
//
// Europe/London, not a fixed UTC offset, because the UK observes DST (British Summer Time):
// 09:00 UK time is 08:00 UTC for roughly half the season and 09:00 UTC for the other half. Every
// wall-clock conversion below goes through Intl.DateTimeFormat with an explicit
// `timeZone: 'Europe/London'` so the correct offset for the ACTUAL CALENDAR DATE in question is
// always used, never a value hardcoded for "the UK" in general.

/** The one timezone this module is allowed to name. Never hardcode a UTC offset instead — see file header. */
export const LOCKDOWN_TIME_ZONE = 'Europe/London'

/** 09:00 local time, per product-brief.md §6d. */
export const LOCKDOWN_HOUR_LOCAL = 9

export class LockdownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LockdownError'
  }
}

interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

function partsToNumber(parts: Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((p) => p.type === type)
  if (!part) {
    throw new LockdownError(`Intl.DateTimeFormat did not produce a "${type}" part — cannot resolve ${LOCKDOWN_TIME_ZONE} time.`)
  }
  const n = Number(part.value)
  if (Number.isNaN(n)) {
    throw new LockdownError(`Intl.DateTimeFormat produced a non-numeric "${type}" part ("${part.value}").`)
  }
  return n
}

/** The Europe/London calendar date (year/month/day) a UTC instant falls on. */
function londonCalendarDate(instantMs: number): CalendarDate {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCKDOWN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(instantMs))
  return {
    year: partsToNumber(parts, 'year'),
    month: partsToNumber(parts, 'month'),
    day: partsToNumber(parts, 'day'),
  }
}

/** Calendar-day arithmetic only (no wall-clock/DST involved — this is pure y/m/d addition via a UTC-anchored epoch, which never wobbles with DST since it never represents a real local instant). */
function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const epochMs = Date.UTC(date.year, date.month - 1, date.day) + days * 24 * 60 * 60 * 1000
  const rolled = new Date(epochMs)
  return { year: rolled.getUTCFullYear(), month: rolled.getUTCMonth() + 1, day: rolled.getUTCDate() }
}

/**
 * Converts a Europe/London wall-clock time (calendar date + local hour/minute) to the UTC instant
 * it represents, honouring whichever DST offset is in effect on that specific calendar date. This
 * is the "reverse" direction Intl.DateTimeFormat does not provide directly: format a guess, read
 * off how far the guess's wall-clock reading drifted from the guess itself, and correct by that
 * drift. Standard technique for zoned-time-to-UTC conversion without a library dependency (no new
 * npm dependency — this ticket's own scope constraint).
 */
function londonWallTimeToUtcMs(date: CalendarDate, hourLocal: number, minuteLocal: number): number {
  const guessMs = Date.UTC(date.year, date.month - 1, date.day, hourLocal, minuteLocal, 0)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCKDOWN_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(guessMs))
  let hour = partsToNumber(parts, 'hour')
  if (hour === 24) hour = 0 // some ICU builds render midnight as "24" with hour12: false

  const wallClockReadingAsIfUtcMs = Date.UTC(
    partsToNumber(parts, 'year'),
    partsToNumber(parts, 'month') - 1,
    partsToNumber(parts, 'day'),
    hour,
    partsToNumber(parts, 'minute'),
    partsToNumber(parts, 'second'),
  )

  const driftMs = wallClockReadingAsIfUtcMs - guessMs
  return guessMs - driftMs
}

/**
 * The lockdown instant for a gameweek: 09:00 Europe/London on the calendar day AFTER the latest
 * of the given fixture kickoff instants (ISO strings, e.g. fixtures.kickoff_time). Throws
 * LockdownError on an empty list — a gameweek's lockdown is undefined without at least one
 * fixture to anchor it, and this function refuses to guess.
 */
export function computeLockdownInstant(fixtureKickoffIsos: readonly string[]): Date {
  if (fixtureKickoffIsos.length === 0) {
    throw new LockdownError('computeLockdownInstant: no fixture kickoff times given — cannot anchor a lockdown instant.')
  }

  const kickoffMsValues = fixtureKickoffIsos.map((iso) => {
    const ms = new Date(iso).getTime()
    if (Number.isNaN(ms)) {
      throw new LockdownError(`computeLockdownInstant: "${iso}" is not a parseable ISO instant.`)
    }
    return ms
  })
  const finalKickoffMs = Math.max(...kickoffMsValues)

  const finalKickoffLondonDate = londonCalendarDate(finalKickoffMs)
  const lockdownLondonDate = addCalendarDays(finalKickoffLondonDate, 1)
  const lockdownMs = londonWallTimeToUtcMs(lockdownLondonDate, LOCKDOWN_HOUR_LOCAL, 0)

  return new Date(lockdownMs)
}

/**
 * True once `nowMs` is at or past the lockdown instant computed from `fixtureKickoffIsos`. Pure —
 * `nowMs` is always a parameter, never read from the system clock here.
 */
export function isPastLockdown(fixtureKickoffIsos: readonly string[], nowMs: number): boolean {
  return nowMs >= computeLockdownInstant(fixtureKickoffIsos).getTime()
}
