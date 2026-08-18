// Unit tests for src/lib/notification/schedule.ts — ticket #59. Every case
// is a named test, matching the ticket's own definition-of-done bullets
// one-for-one so a reviewer can check them off directly against this file.
// No clock is ever faked: every instant is passed in explicitly, per this
// module's own no-I/O contract.

import { describe, expect, it } from 'vitest'
import { decideNotificationTrigger, type ScheduledTrigger } from './schedule.ts'

const MS_PER_HOUR = 60 * 60 * 1000

/** A fixed, arbitrary deadline instant. Every test expresses "now" as an offset from this in hours, via hoursBefore() below, so the numbers in each test read as the hours-remaining figure the DoD itself uses. */
const DEADLINE_MS = new Date('2026-08-22T01:30:00Z').getTime()

function hoursBefore(hours: number): number {
  return DEADLINE_MS - hours * MS_PER_HOUR
}

function decide(hoursRemaining: number, sentTriggers: readonly ScheduledTrigger[] = []) {
  return decideNotificationTrigger({ deadlineMs: DEADLINE_MS, nowMs: hoursBefore(hoursRemaining), sentTriggers })
}

describe('decideNotificationTrigger — trigger takes exactly one of manual, deadline_24h, deadline_10h', () => {
  it('never returns a trigger outside {null, "deadline_24h", "deadline_10h"} across the whole timeline', () => {
    for (let h = -5; h <= 30; h += 0.5) {
      const decision = decide(h)
      expect([null, 'deadline_24h', 'deadline_10h']).toContain(decision.trigger)
    }
  })
})

describe('decideNotificationTrigger — more than 24 hours before the deadline: nothing fires', () => {
  it('at 24.5 hours remaining, nothing fires', () => {
    const decision = decide(24.5)
    expect(decision.trigger).toBeNull()
    expect(decision.hoursRemaining).toBeCloseTo(24.5)
  })
})

describe('decideNotificationTrigger — between 24 and 10 hours, nothing sent: deadline_24h fires', () => {
  it('at exactly 24.0 hours remaining, deadline_24h fires', () => {
    const decision = decide(24.0)
    expect(decision.trigger).toBe('deadline_24h')
  })

  it('at 15 hours remaining, deadline_24h fires', () => {
    const decision = decide(15)
    expect(decision.trigger).toBe('deadline_24h')
  })
})

describe('decideNotificationTrigger — at or inside 10 hours, nothing sent: deadline_10h fires, deadline_24h never does', () => {
  it('at 8 hours remaining with no prior sends, deadline_10h fires', () => {
    const decision = decide(8, [])
    expect(decision.trigger).toBe('deadline_10h')
  })

  it('the same 8-hour case never selects deadline_24h, whatever the sent set', () => {
    expect(decide(8, []).trigger).not.toBe('deadline_24h')
    expect(decide(8, ['deadline_24h']).trigger).not.toBe('deadline_24h')
  })
})

describe('decideNotificationTrigger — inside 10 hours with deadline_24h already sent: deadline_10h fires', () => {
  it('at 8 hours remaining, having already sent deadline_24h, deadline_10h still fires', () => {
    const decision = decide(8, ['deadline_24h'])
    expect(decision.trigger).toBe('deadline_10h')
  })
})

describe('decideNotificationTrigger — a trigger already sent for this gameweek never fires again', () => {
  it('deadline_24h does not re-fire at 15 hours once it has already been sent', () => {
    const decision = decide(15, ['deadline_24h'])
    expect(decision.trigger).toBeNull()
    expect(decision.reason).toContain('deadline_24h')
  })

  it('deadline_10h does not re-fire at 8 hours once it has already been sent', () => {
    const decision = decide(8, ['deadline_10h'])
    expect(decision.trigger).toBeNull()
    expect(decision.reason).toContain('deadline_10h')
  })
})

describe('decideNotificationTrigger — after the deadline has passed, nothing fires', () => {
  it('at -0.5 hours remaining (30 minutes past the deadline), nothing fires', () => {
    const decision = decide(-0.5)
    expect(decision.trigger).toBeNull()
    expect(decision.hoursRemaining).toBeCloseTo(-0.5)
  })

  it('at exactly zero hours remaining, nothing fires', () => {
    const decision = decide(0)
    expect(decision.trigger).toBeNull()
    expect(decision.hoursRemaining).toBe(0)
  })
})

describe('decideNotificationTrigger — boundaries are inclusive at the threshold the tighter window owns', () => {
  it('at exactly 10.0 hours remaining, deadline_10h fires (not deadline_24h, not nothing)', () => {
    const decision = decide(10.0)
    expect(decision.trigger).toBe('deadline_10h')
  })
})

describe('decideNotificationTrigger — hoursRemaining is always reported, even when nothing fires', () => {
  it('is present and correct on every branch: too early, in-window-but-sent, and past the deadline', () => {
    expect(decide(30).hoursRemaining).toBeCloseTo(30)
    expect(decide(15, ['deadline_24h']).hoursRemaining).toBeCloseTo(15)
    expect(decide(-2).hoursRemaining).toBeCloseTo(-2)
  })
})

describe('decideNotificationTrigger — accepts sentTriggers as either a Set or a plain array', () => {
  it('behaves identically whether sentTriggers is a Set or an array', () => {
    const asArray = decideNotificationTrigger({ deadlineMs: DEADLINE_MS, nowMs: hoursBefore(8), sentTriggers: ['deadline_24h'] })
    const asSet = decideNotificationTrigger({ deadlineMs: DEADLINE_MS, nowMs: hoursBefore(8), sentTriggers: new Set(['deadline_24h']) })
    expect(asArray.trigger).toBe('deadline_10h')
    expect(asSet.trigger).toBe('deadline_10h')
  })
})
