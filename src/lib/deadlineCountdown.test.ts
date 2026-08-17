import { describe, expect, it } from 'vitest'
import {
  computeRemaining,
  ESCALATE_WITHIN_MS,
  formatDeadlineInstant,
  formatRemaining,
} from './deadlineCountdown'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// FPL's own worked example for ticket #42: 2026-08-21T17:30:00Z is
// 2026-08-22 01:30 in Asia/Singapore (UTC+8, no DST) — the deadline rolls
// onto the next calendar date, which is exactly why the date must always
// render alongside the time, never a bare time.
const GW1_DEADLINE = '2026-08-21T17:30:00Z'
const GW1_DEADLINE_MS = new Date(GW1_DEADLINE).getTime()

describe('computeRemaining', () => {
  it('breaks an exact 5-day gap into days with zero hours/minutes/seconds', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - 5 * DAY)
    expect(remaining.hasPassed).toBe(false)
    expect(remaining).toMatchObject({ days: 5, hours: 0, minutes: 0, seconds: 0 })
  })

  it('breaks a mixed days+hours gap into the right units', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - (3 * DAY + 6 * HOUR))
    expect(remaining).toMatchObject({ days: 3, hours: 6 })
  })

  it('clamps a passed deadline to zero on every field — no negative units, no NaN', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS + 30 * MINUTE)
    expect(remaining.hasPassed).toBe(true)
    expect(remaining).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0 })
    expect(Number.isNaN(remaining.totalMs)).toBe(false)
    expect(Number.isNaN(remaining.days)).toBe(false)
  })

  it('escalates strictly inside the 24-hour threshold', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - (ESCALATE_WITHIN_MS - 1))
    expect(remaining.isEscalated).toBe(true)
  })

  it('does not escalate at exactly, or outside, the 24-hour threshold', () => {
    const atThreshold = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - ESCALATE_WITHIN_MS)
    const wellOutside = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - 3 * DAY)
    expect(atThreshold.isEscalated).toBe(false)
    expect(wellOutside.isEscalated).toBe(false)
  })

  it('never escalates a passed deadline, even one millisecond past it', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS + 1)
    expect(remaining.isEscalated).toBe(false)
  })

  it('produces identical remaining-time output regardless of the runtime timezone — deadline_time is timestamptz (UTC) and the arithmetic runs on the absolute instant, not a calendar', () => {
    const now = GW1_DEADLINE_MS - (2 * DAY + 3 * HOUR)
    const originalTz = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Kiritimati' // UTC+14
      const east = computeRemaining(GW1_DEADLINE, now)
      process.env.TZ = 'Etc/GMT+12' // UTC-12
      const west = computeRemaining(GW1_DEADLINE, now)
      expect(east).toEqual(west)
      expect(east).toMatchObject({ days: 2, hours: 3 })
    } finally {
      process.env.TZ = originalTz
    }
  })
})

describe('formatRemaining', () => {
  it('renders days + hours outside the 24-hour threshold', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - (3 * DAY + 6 * HOUR))
    expect(formatRemaining(remaining)).toBe('3d 6h')
  })

  it('renders hours + minutes inside 24h but outside the final hour — no seconds shown', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - (6 * HOUR + 18 * MINUTE))
    const formatted = formatRemaining(remaining)
    expect(formatted).toBe('6h 18m')
    expect(formatted).not.toMatch(/\d+s/)
  })

  it('renders minutes + seconds inside the final hour', () => {
    const remaining = computeRemaining(GW1_DEADLINE, GW1_DEADLINE_MS - (2 * MINUTE + 5 * SECOND))
    expect(formatRemaining(remaining)).toBe('2m 5s')
  })
})

describe('formatDeadlineInstant', () => {
  it('renders the GW1 deadline instant as "Sat 22 Aug, 01:30" — weekday-first date, 24-hour time, Asia/Singapore, date rolled to the 22nd', () => {
    expect(formatDeadlineInstant(GW1_DEADLINE)).toBe('Sat 22 Aug, 01:30')
  })

  it('renders identically in Asia/Singapore regardless of the runtime timezone', () => {
    const originalTz = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      expect(formatDeadlineInstant(GW1_DEADLINE)).toBe('Sat 22 Aug, 01:30')
    } finally {
      process.env.TZ = originalTz
    }
  })
})
