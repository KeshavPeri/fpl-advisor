// Unit tests for src/lib/chips/derive.ts — ticket #85. Every case is a named
// test, matching the ticket's own definition-of-done bullets one-for-one so
// a reviewer can check them off directly against this file. No clock is
// ever faked: every instant is passed in explicitly, per this module's own
// no-I/O contract (src/lib/notification/schedule.test.ts's own convention).

import { describe, expect, it } from 'vitest'
import {
  CHIP_ADVISORY_HORIZON_NOTE,
  CHIP_DISPLAY_NAMES,
  FIRST_CHIP_SET_LAST_GAMEWEEK,
  SOLVER_CHIP_DISPLAY_NAMES,
  SQUAD_ADVISORY_DISPLAY_NAMES,
  SQUAD_ADVISORY_HORIZON_NOTE,
  deriveChipState,
} from './derive.ts'
import type { ChipAdvisoryRow, ChipSourceData, GameweekDeadline, SquadAdvisoryRow } from './types.ts'

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
    chipAdvisories: [],
    squadAdvisories: [],
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

// ============================================================================
// deriveChipState.expiryWarning — ticket #97 (item 26). "Gameweeks remaining"
// is the unit throughout, per the ticket's own pre-answered table:
//   more than 8  -> none      5 to 8 -> noted      3 to 4 -> pressing      2 or fewer -> final
// plus the chip-count adjustment: 2+ unused chips in the active set moves
// the band up one level.
//
// `nowForGameweeksRemaining(x)` reuses the exact "current gameweek" rule
// deriveChipState itself applies (resolveCurrentGameweekId: the lowest
// gameweek whose deadline hasn't passed) so each test controls
// `gameweeksRemaining` precisely without touching any of this file's own
// no-clock/no-hardcoded-date rules — every instant here is still derived
// from the fixture `gameweeks` array, never a literal date.
// gameweeksRemaining = FIRST_CHIP_SET_LAST_GAMEWEEK - currentGameweekId + 1,
// so currentGameweekId = FIRST_CHIP_SET_LAST_GAMEWEEK + 1 - gameweeksRemaining;
// "just before that gameweek's own deadline" makes it the current one.
// ============================================================================

function nowForGameweeksRemaining(gameweeksRemaining: number): number {
  const targetGameweekId = FIRST_CHIP_SET_LAST_GAMEWEEK + 1 - gameweeksRemaining
  const targetGameweek = gameweeks.find((gw) => gw.id === targetGameweekId)
  if (!targetGameweek) throw new Error(`test fixture has no gameweek id ${targetGameweekId}`)
  return targetGameweek.deadlineMs - 1
}

/** Exactly one first-set chip left unused (Triple Captain) — isolates the base gameweeks-remaining band from the chip-count escalation rule, which only fires at 2+ unused. */
const THREE_OF_FOUR_USED = [
  { name: 'wildcard', event: 5, time: '2026-09-01T10:00:00Z' },
  { name: 'freehit', event: 6, time: '2026-09-08T10:00:00Z' },
  { name: 'bboost', event: 7, time: '2026-09-15T10:00:00Z' },
]

describe('deriveChipState — expiryWarning band thresholds, one unused chip (no chip-count escalation)', () => {
  it('9 gameweeks remaining (more than 8) is none', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(9))
    expect(state.expiryWarning).toEqual({ band: 'none' })
  })

  it('8 gameweeks remaining is noted', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(8))
    expect(state.expiryWarning.band).toBe('noted')
  })

  it('5 gameweeks remaining is noted', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(5))
    expect(state.expiryWarning.band).toBe('noted')
  })

  it('4 gameweeks remaining is pressing', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(4))
    expect(state.expiryWarning.band).toBe('pressing')
  })

  it('3 gameweeks remaining is pressing', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(3))
    expect(state.expiryWarning.band).toBe('pressing')
  })

  it('2 gameweeks remaining (2 or fewer) is final', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(2))
    expect(state.expiryWarning.band).toBe('final')
  })

  it('names Triple Captain and states gameweeksRemaining on a non-none band', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(3))
    expect(state.expiryWarning).toMatchObject({
      band: 'pressing',
      gameweeksRemaining: 3,
      chipsAtRisk: [{ id: '3xc', displayName: 'Triple Captain' }],
    })
  })
})

describe('deriveChipState — expiryWarning is none when every first-set chip has been used', () => {
  it('reports none even at 2 gameweeks remaining, where an unused chip would be final', () => {
    const allFourUsed = [
      { name: 'wildcard', event: 5, time: '2026-09-01T10:00:00Z' },
      { name: 'freehit', event: 6, time: '2026-09-08T10:00:00Z' },
      { name: 'bboost', event: 7, time: '2026-09-15T10:00:00Z' },
      { name: '3xc', event: 8, time: '2026-09-22T10:00:00Z' },
    ]
    const state = deriveChipState(sourceData({ chipsUsed: allFourUsed }), nowForGameweeksRemaining(2))
    expect(state.expiryWarning).toEqual({ band: 'none' })
  })
})

describe('deriveChipState — expiryWarning is none once the first set has expired (the second set is active)', () => {
  it('reports none after the Gameweek 19 deadline, with unused first-set chips remaining', () => {
    const state = deriveChipState(sourceData({ chipsUsed: [] }), GW19_DEADLINE_MS + 1)
    expect(state.firstSet.expired).toBe(true)
    expect(state.expiryWarning).toEqual({ band: 'none' })
  })
})

describe('deriveChipState — expiryWarning chip-count escalation: more unused chips is more urgent, not just less time', () => {
  it('one unused chip at 4 gameweeks remaining is pressing', () => {
    const state = deriveChipState(sourceData({ chipsUsed: THREE_OF_FOUR_USED }), nowForGameweeksRemaining(4))
    expect(state.expiryWarning.band).toBe('pressing')
  })

  it('two unused chips at 4 gameweeks remaining is final — escalated one level past the one-chip case above', () => {
    const twoOfFourUsed = [
      { name: 'wildcard', event: 5, time: '2026-09-01T10:00:00Z' },
      { name: 'freehit', event: 6, time: '2026-09-08T10:00:00Z' },
    ]
    const state = deriveChipState(sourceData({ chipsUsed: twoOfFourUsed }), nowForGameweeksRemaining(4))
    expect(state.expiryWarning.band).toBe('final')
    if (state.expiryWarning.band !== 'none') {
      expect(state.expiryWarning.chipsAtRisk.map((c) => c.id)).toEqual(['bboost', '3xc'])
    }
  })

  it('the escalation never promotes none to noted — 9 gameweeks remaining with all four chips unused stays none', () => {
    const state = deriveChipState(sourceData({ chipsUsed: [] }), nowForGameweeksRemaining(9))
    expect(state.expiryWarning).toEqual({ band: 'none' })
  })
})

// ============================================================================
// Chip advisory — ticket #126 (feature-list item 27). deriveChipState never
// reads a clock for this part; every case below is independent of nowMs.
// ============================================================================

describe('deriveChipState — chip advisory (ticket #126)', () => {
  it('is empty, with a null note, when no chip_advisories rows are given', () => {
    const state = deriveChipState(sourceData({ chipAdvisories: [] }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories).toEqual([])
    expect(state.chipAdvisoryNote).toBeNull()
  })

  it('resolves a known chip code to its display name, rounds the delta to a whole number, and formats the gameweek label', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'TC', chipGameweekId: 2, delta: 6.48, solutionIndex: 0 },
      { chipCode: 'BB', chipGameweekId: 4, delta: 6.48, solutionIndex: 0 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)

    expect(state.chipAdvisories).toEqual([
      { chipCode: 'TC', displayName: 'Triple Captain', gameweekLabel: 'Gameweek 2', deltaWhole: 6, solutionIndex: 0 },
      { chipCode: 'BB', displayName: 'Bench Boost', gameweekLabel: 'Gameweek 4', deltaWhole: 6, solutionIndex: 0 },
    ])
  })

  it('rounds a delta like 6.5 up and 6.49 down — Math.round, not truncation', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'TC', chipGameweekId: 2, delta: 6.5, solutionIndex: 0 },
      { chipCode: 'BB', chipGameweekId: 4, delta: 6.49, solutionIndex: 1 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories[0].deltaWhole).toBe(7)
    expect(state.chipAdvisories[1].deltaWhole).toBe(6)
  })

  it('renders an unrecognised chip code as an explicit unknown-chip label rather than dropping it', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [{ chipCode: 'WC', chipGameweekId: 3, delta: 4, solutionIndex: 0 }]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories[0].displayName).toBe('Unknown chip (WC)')
  })

  it('carries the fixed five-gameweek limitation sentence on the derived view whenever there is at least one advisory', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [{ chipCode: 'TC', chipGameweekId: 2, delta: 6, solutionIndex: 0 }]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisoryNote).toBe(CHIP_ADVISORY_HORIZON_NOTE)
    expect(state.chipAdvisoryNote).toMatch(/five gameweeks/)
  })

  it('SOLVER_CHIP_DISPLAY_NAMES maps exactly the two chip codes ever observed', () => {
    expect(SOLVER_CHIP_DISPLAY_NAMES).toEqual({ TC: 'Triple Captain', BB: 'Bench Boost' })
  })
})

// ============================================================================
// Squad-rebuild advisory — ticket #134 (feature-list item 28). Same
// clock-independence as the chip-timing advisory block above: every case
// below is independent of nowMs.
// ============================================================================

describe('deriveChipState — squad-rebuild advisory (ticket #134)', () => {
  it('is empty, with a null note, when no squad-rebuild rows are given', () => {
    const state = deriveChipState(sourceData({ squadAdvisories: [] }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toEqual([])
    expect(state.squadAdvisoryNote).toBeNull()
  })

  it('resolves WC to "Wildcard" and rounds the delta to a whole number', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [{ chipCode: 'WC', delta: 46.8 }]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toEqual([{ chipCode: 'WC', displayName: 'Wildcard', deltaWhole: 47 }])
  })

  it('resolves FH to "Free Hit"', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [{ chipCode: 'FH', delta: 30 }]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories[0].displayName).toBe('Free Hit')
  })

  it('can carry BOTH a Wildcard and a Free Hit row at once — two separate questions, two separate answers', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      { chipCode: 'WC', delta: 47 },
      { chipCode: 'FH', delta: 31 },
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toEqual([
      { chipCode: 'WC', displayName: 'Wildcard', deltaWhole: 47 },
      { chipCode: 'FH', displayName: 'Free Hit', deltaWhole: 31 },
    ])
  })

  it('rounds a delta like 6.5 up and 6.49 down — Math.round, not truncation', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      { chipCode: 'WC', delta: 6.5 },
      { chipCode: 'FH', delta: 6.49 },
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories[0].deltaWhole).toBe(7)
    expect(state.squadAdvisories[1].deltaWhole).toBe(6)
  })

  it('carries the fixed five-gameweek limitation sentence on the derived view whenever there is at least one squad advisory', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [{ chipCode: 'WC', delta: 47 }]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisoryNote).toBe(SQUAD_ADVISORY_HORIZON_NOTE)
    expect(state.squadAdvisoryNote).toMatch(/five-gameweek/)
  })

  it('the squad-advisory note and the chip-timing advisory note are independent — one can be present without the other', () => {
    const state = deriveChipState(
      sourceData({ chipAdvisories: [], squadAdvisories: [{ chipCode: 'WC', delta: 47 }] }),
      GW19_DEADLINE_MS - 1,
    )
    expect(state.chipAdvisoryNote).toBeNull()
    expect(state.squadAdvisoryNote).toBe(SQUAD_ADVISORY_HORIZON_NOTE)
  })

  it('SQUAD_ADVISORY_DISPLAY_NAMES maps exactly the two squad-rebuild chip codes', () => {
    expect(SQUAD_ADVISORY_DISPLAY_NAMES).toEqual({ WC: 'Wildcard', FH: 'Free Hit' })
  })
})
