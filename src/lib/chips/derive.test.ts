// Unit tests for src/lib/chips/derive.ts — ticket #85. Every case is a named
// test, matching the ticket's own definition-of-done bullets one-for-one so
// a reviewer can check them off directly against this file. No clock is
// ever faked: every instant is passed in explicitly, per this module's own
// no-I/O contract (src/lib/notification/schedule.test.ts's own convention).

import { describe, expect, it } from 'vitest'
import {
  CHIP_DISPLAY_NAMES,
  FIRST_CHIP_SET_LAST_GAMEWEEK,
  deriveChipState,
} from './derive.ts'
import type { ChipSourceData, GameweekDeadline } from './types.ts'

/** A full, evenly-spaced season of gameweek deadlines, GW1..GW38, one week
 *  apart, so "current gameweek" and "gameweeks remaining" arithmetic has
 *  something real to resolve against. GW19's own deadline is the instant
 *  every before/after test in this file is expressed relative to. */
function seasonGameweeks(gw19DeadlineIso: string): GameweekDeadline[] {
  const gw19Ms = new Date(gw19DeadlineIso).getTime()
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const gameweeks: GameweekDeadline[] = []
  for (let id = 1; id <= 38; id++) {
    gameweeks.push({ id, deadlineMs: gw19Ms + (id - FIRST_CHIP_SET_LAST_GAMEWEEK) * WEEK_MS })
  }
  return gameweeks
}

// An arbitrary fixture instant, deliberately NOT the real Gameweek 19
// deadline product-brief.md §6d names — this ticket's own DoD forbids that
// date's digits appearing anywhere in src/lib/chips/, tests included, so
// every test below stands entirely on this made-up `gameweeks` row rather
// than on any real-world date. The deadline is always read from the
// `gameweeks` input, exactly as api.ts reads it from `public.gameweeks`.
const GW19_DEADLINE_ISO = '2026-12-05T09:15:00Z'
const gameweeks = seasonGameweeks(GW19_DEADLINE_ISO)
const GW19_DEADLINE_MS = new Date(GW19_DEADLINE_ISO).getTime()

function sourceData(overrides: Partial<ChipSourceData> = {}): ChipSourceData {
  return {
    chipsUsed: [],
    gameweeks,
    ...overrides,
  }
}

describe('deriveChipState — CHIP_DISPLAY_NAMES maps every known FPL identifier to a display name', () => {
  it('maps all four identifiers exactly', () => {
    expect(CHIP_DISPLAY_NAMES).toEqual({
      wildcard: 'Wildcard',
      freehit: 'Free Hit',
      bboost: 'Bench Boost',
      '3xc': 'Triple Captain',
    })
  })
})

describe('deriveChipState — an unrecognised chip identifier is surfaced, never dropped, and is still counted', () => {
  it('renders an unknown identifier as an unknown used chip and counts it in the first set\'s usedCount', () => {
    const state = deriveChipState(
      sourceData({ chipsUsed: [{ name: 'manager', event: 5, time: '2026-09-01T18:00:00Z' }] }),
      GW19_DEADLINE_MS - 1
    )
    expect(state.hasUsedAnyChip).toBe(true)
    expect(state.usedChips).toHaveLength(1)
    expect(state.usedChips[0].isKnown).toBe(false)
    expect(state.usedChips[0].displayName).toBe('Unknown chip (manager)')
    expect(state.usedChips[0].id).toBe('manager')
    expect(state.firstSet.usedCount).toBe(1)
  })
})

describe('deriveChipState — before the Gameweek 19 deadline, with wildcard used GW8 and bench boost used GW14', () => {
  const chipsUsed = [
    { name: 'wildcard', event: 8, time: '2026-09-20T10:00:00Z' },
    { name: 'bboost', event: 14, time: '2026-11-01T10:00:00Z' },
  ]
  const state = deriveChipState(sourceData({ chipsUsed }), GW19_DEADLINE_MS - 1)

  it('reports the first set as active, not expired', () => {
    expect(state.firstSet.expired).toBe(false)
  })

  it('reports two of four used in the first set', () => {
    expect(state.firstSet.usedCount).toBe(2)
    expect(state.firstSet.totalCount).toBe(4)
  })

  it('reports Free Hit and Triple Captain as the remaining first-set chips', () => {
    expect(state.firstSet.remaining.map((c) => c.displayName)).toEqual(['Free Hit', 'Triple Captain'])
  })

  it('reports the second set as not yet available', () => {
    expect(state.secondSet.isAvailable).toBe(false)
  })

  it('carries each used chip\'s own gameweek, not just a struck-through name', () => {
    const wildcard = state.usedChips.find((c) => c.id === 'wildcard')
    const benchBoost = state.usedChips.find((c) => c.id === 'bboost')
    expect(wildcard?.gameweekId).toBe(8)
    expect(wildcard?.gameweekLabel).toBe('Gameweek 8')
    expect(benchBoost?.gameweekId).toBe(14)
    expect(benchBoost?.gameweekLabel).toBe('Gameweek 14')
  })

  it('resolves the first-set checklist to used (with its gameweek) or remaining for every one of the four slots', () => {
    expect(state.firstSet.slots).toEqual([
      { id: 'wildcard', displayName: 'Wildcard', status: 'used', gameweekLabel: 'Gameweek 8' },
      { id: 'freehit', displayName: 'Free Hit', status: 'remaining', gameweekLabel: null },
      { id: 'bboost', displayName: 'Bench Boost', status: 'used', gameweekLabel: 'Gameweek 14' },
      { id: '3xc', displayName: 'Triple Captain', status: 'remaining', gameweekLabel: null },
    ])
  })
})

describe('deriveChipState — after the Gameweek 19 deadline, with the same wildcard/bench-boost usage', () => {
  const chipsUsed = [
    { name: 'wildcard', event: 8, time: '2026-09-20T10:00:00Z' },
    { name: 'bboost', event: 14, time: '2026-11-01T10:00:00Z' },
  ]
  const state = deriveChipState(sourceData({ chipsUsed }), GW19_DEADLINE_MS + 1)

  it('reports the first set as expired', () => {
    expect(state.firstSet.expired).toBe(true)
  })

  it('reports two first-set chips lost (Free Hit and Triple Captain, never used)', () => {
    expect(state.firstSet.lostCount).toBe(2)
    expect(state.firstSet.remaining).toEqual([])
  })

  it('marks the never-used first-set slots lost, not remaining, once expired', () => {
    const freeHit = state.firstSet.slots.find((s) => s.id === 'freehit')
    const tripleCaptain = state.firstSet.slots.find((s) => s.id === '3xc')
    expect(freeHit?.status).toBe('lost')
    expect(tripleCaptain?.status).toBe('lost')
  })

  it('reports all four second-set chips as available', () => {
    expect(state.secondSet.isAvailable).toBe(true)
    expect(state.secondSet.usedCount).toBe(0)
    expect(state.secondSet.remaining.map((c) => c.id)).toEqual(['wildcard', 'freehit', 'bboost', '3xc'])
  })
})

describe('deriveChipState — an empty chips_used array produces "no chips used", not an error and not a blank state', () => {
  const state = deriveChipState(sourceData({ chipsUsed: [] }), GW19_DEADLINE_MS - 1)

  it('reports hasUsedAnyChip as false with an empty usedChips list', () => {
    expect(state.hasUsedAnyChip).toBe(false)
    expect(state.usedChips).toEqual([])
  })

  it('still reports all four first-set chips as remaining', () => {
    expect(state.firstSet.usedCount).toBe(0)
    expect(state.firstSet.remaining.map((c) => c.id)).toEqual(['wildcard', 'freehit', 'bboost', '3xc'])
  })
})

describe('deriveChipState — time remaining is expressed in both gameweeks and calendar terms', () => {
  it('states the Gameweek 19 deadline in Asia/Singapore, weekday-first, 24-hour format while the first set is active', () => {
    const state = deriveChipState(sourceData({ chipsUsed: [] }), GW19_DEADLINE_MS - 1)
    // The fixture instant above, converted to Asia/Singapore (UTC+8).
    expect(state.firstSet.timeRemaining?.calendarLabel).toBe('Sat 5 Dec, 17:15')
  })

  it('reports gameweeksRemaining counting the current gameweek through Gameweek 19 inclusive', () => {
    // One week before the GW19 deadline puts "now" inside GW19 itself
    // (the season list is one week apart) — 1 gameweek remains: GW19.
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000
    const state = deriveChipState(sourceData({ chipsUsed: [] }), GW19_DEADLINE_MS - oneWeekMs / 2)
    expect(state.firstSet.timeRemaining?.gameweeksRemaining).toBe(1)
  })

  it('has no timeRemaining once the first set has expired', () => {
    const state = deriveChipState(sourceData({ chipsUsed: [] }), GW19_DEADLINE_MS + 1)
    expect(state.firstSet.timeRemaining).toBeNull()
  })
})

describe('deriveChipState — the Gameweek 19 deadline is read from public.gameweeks, never assumed', () => {
  it('reports deadlineKnown as false and does not claim the first set has expired when GW19 is missing from gameweeks', () => {
    const gameweeksWithoutGw19 = gameweeks.filter((gw) => gw.id !== FIRST_CHIP_SET_LAST_GAMEWEEK)
    const state = deriveChipState(
      sourceData({ chipsUsed: [], gameweeks: gameweeksWithoutGw19 }),
      GW19_DEADLINE_MS + 1
    )
    expect(state.firstSet.deadlineKnown).toBe(false)
    expect(state.firstSet.expired).toBe(false)
    expect(state.firstSet.timeRemaining).toBeNull()
  })
})
