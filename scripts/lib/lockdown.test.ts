// Unit tests for scripts/lib/lockdown.ts — ticket #73. Every case is a named test mirroring the
// ticket's own DoD bullets one-for-one. No clock is ever faked: every instant is an explicit
// argument, per this module's own no-I/O contract (LOCKDOWN_TIME_ZONE / LOCKDOWN_HOUR_LOCAL are
// re-derived independently below with Date.UTC, not imported as magic numbers, so a test that
// passed by construction can't hide a bug in the module itself).

import { describe, expect, it } from 'vitest'
import { computeLockdownInstant, isPastLockdown, LockdownError, LOCKDOWN_TIME_ZONE } from './lockdown.ts'

const MINUTE_MS = 60 * 1000

describe('LOCKDOWN_TIME_ZONE', () => {
  it('is the literal string "Europe/London" — the DST-observing IANA zone, not a fixed UTC offset', () => {
    expect(LOCKDOWN_TIME_ZONE).toBe('Europe/London')
  })
})

describe('computeLockdownInstant — outside British Summer Time (GMT, UTC+0)', () => {
  // Saturday 12 December 2026, 15:00 UTC kickoff -- the UK is on GMT
  // (UTC+0) in December (BST 2026 ends 25 Oct, resumes 29 Mar 2027), so
  // 09:00 London the next day is 09:00 UTC, not offset at all.
  const kickoff = '2026-12-12T15:00:00Z'
  const expectedLockdownMs = Date.UTC(2026, 11, 13, 9, 0, 0) // 13 Dec 2026, 09:00 UTC

  it('rolls to 09:00 UTC the day after the match, with no DST offset applied', () => {
    expect(computeLockdownInstant([kickoff]).getTime()).toBe(expectedLockdownMs)
  })

  it('one minute before the boundary is not yet past lockdown', () => {
    expect(isPastLockdown([kickoff], expectedLockdownMs - MINUTE_MS)).toBe(false)
  })

  it('one minute after the boundary is past lockdown', () => {
    expect(isPastLockdown([kickoff], expectedLockdownMs + MINUTE_MS)).toBe(true)
  })

  it('exactly at the boundary counts as past lockdown (inclusive)', () => {
    expect(isPastLockdown([kickoff], expectedLockdownMs)).toBe(true)
  })
})

describe('computeLockdownInstant — inside British Summer Time (BST, UTC+1)', () => {
  // Saturday 11 July 2026, 19:00 UTC kickoff (a typical evening TV slot).
  // The UK is on BST (UTC+1) in July, so 09:00 London the next day is
  // 08:00 UTC -- one hour earlier than the GMT case above, proving the
  // module reads the actual DST offset for the date in question rather
  // than a fixed offset.
  const kickoff = '2026-07-11T19:00:00Z'
  const expectedLockdownMs = Date.UTC(2026, 6, 12, 8, 0, 0) // 12 Jul 2026, 08:00 UTC

  it('rolls to 08:00 UTC the day after the match, one hour ahead of the GMT case', () => {
    expect(computeLockdownInstant([kickoff]).getTime()).toBe(expectedLockdownMs)
  })

  it('one minute before the boundary is not yet past lockdown', () => {
    expect(isPastLockdown([kickoff], expectedLockdownMs - MINUTE_MS)).toBe(false)
  })

  it('one minute after the boundary is past lockdown', () => {
    expect(isPastLockdown([kickoff], expectedLockdownMs + MINUTE_MS)).toBe(true)
  })
})

describe('computeLockdownInstant — anchors on the LATEST fixture kickoff, not the earliest or an average', () => {
  it('uses the last of three same-day kickoffs, ignoring the earlier two entirely', () => {
    const earlyKickoff = '2026-09-19T12:30:00Z'
    const midKickoff = '2026-09-19T15:00:00Z'
    const finalKickoff = '2026-09-19T19:30:00Z' // this is the one that should anchor lockdown
    const expectedLockdownMs = Date.UTC(2026, 8, 20, 8, 0, 0) // BST in September -> 08:00 UTC

    const result = computeLockdownInstant([midKickoff, earlyKickoff, finalKickoff]).getTime()
    expect(result).toBe(expectedLockdownMs)

    // Proves it, rather than merely asserting the right answer: a version
    // that (wrongly) anchored on the earliest kickoff would still roll to
    // the same calendar day here, so also check against a case where
    // earliest and latest kickoff fall on different London calendar days.
    const lateNightKickoff = '2026-09-19T23:15:00Z' // 20 Sep, 00:15 BST -> already the next London day
    const crossDayResult = computeLockdownInstant([earlyKickoff, lateNightKickoff]).getTime()
    const expectedCrossDayLockdownMs = Date.UTC(2026, 8, 21, 8, 0, 0) // day after the 20th, not the 19th
    expect(crossDayResult).toBe(expectedCrossDayLockdownMs)
  })
})

describe('computeLockdownInstant — calendar rollover across a month/year boundary', () => {
  it('rolls 31 December into 1 January of the following year', () => {
    const kickoff = '2026-12-31T20:00:00Z'
    const expectedLockdownMs = Date.UTC(2027, 0, 1, 9, 0, 0) // GMT in Jan -> 09:00 UTC
    expect(computeLockdownInstant([kickoff]).getTime()).toBe(expectedLockdownMs)
  })
})

describe('computeLockdownInstant — refuses to guess with no fixtures', () => {
  it('throws LockdownError on an empty fixture list', () => {
    expect(() => computeLockdownInstant([])).toThrow(LockdownError)
  })
})

describe('computeLockdownInstant — refuses an unparseable kickoff instant', () => {
  it('throws LockdownError rather than silently producing an Invalid Date', () => {
    expect(() => computeLockdownInstant(['not-a-real-date'])).toThrow(LockdownError)
  })
})
