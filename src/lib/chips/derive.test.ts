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
  buildSquadRebuildView,
  deriveChipState,
} from './derive.ts'
import type { ChipAdvisoryRow, ChipPlayerOption, ChipRebuildPickRow, ChipSourceData, GameweekDeadline, SquadAdvisoryRow } from './types.ts'

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
    players: [],
    existingSquadPlayerIds: null,
    ...overrides,
  }
}

/** A SquadAdvisoryRow with no stored picks (ticket #284) — the pre-#284 shape most of this
 *  file's existing squad-advisory tests exercise (delta/displayName/rounding only). Every field
 *  new since #284 gets a fixture-friendly default so those tests read exactly as they did before
 *  this ticket; the dedicated "See the squad" describe block below overrides `picks` explicitly. */
function squadAdvisoryRow(overrides: Partial<SquadAdvisoryRow> & Pick<SquadAdvisoryRow, 'chipCode' | 'delta'>): SquadAdvisoryRow {
  return { id: 1, gameweekId: 7, picks: [], ...overrides }
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
// Chip advisory — ticket #126 (feature-list item 27), collapsed for display
// by ticket #141. deriveChipState never reads a clock for this part; every
// case below is independent of nowMs.
//
// Storage (unchanged by #141): one ChipAdvisoryRow per (chip played,
// solution), for the solver's latest run — already filtered to that run by
// api.ts. deriveChipAdvisories collapses these into one ChipAdvisoryView per
// DISTINCT plan (a solution's own whole set of chip decisions): identical
// solutions collapse to one plan; solutions that genuinely disagree produce
// distinct plans, each carrying its own solutionCount/totalSolutionCount.
// ============================================================================

describe('deriveChipState — chip advisory (ticket #126, collapsed by #141)', () => {
  it('is empty, with a null note, when no chip_advisories rows are given', () => {
    const state = deriveChipState(sourceData({ chipAdvisories: [] }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories).toEqual([])
    expect(state.chipAdvisoryNote).toBeNull()
  })

  it('three solutions naming the same chips in the same gameweeks render as ONE advisory listing those chips once', () => {
    // The exact real-world case the ticket exists for: three solutions
    // (0, 1, 2) all choose Bench Boost in gameweek 2 and Triple Captain in
    // gameweek 3, at the same +18 delta — six stored rows, one true plan.
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'BB', chipGameweekId: 2, delta: 18, solutionIndex: 0 },
      { chipCode: 'TC', chipGameweekId: 3, delta: 18, solutionIndex: 0 },
      { chipCode: 'BB', chipGameweekId: 2, delta: 18, solutionIndex: 1 },
      { chipCode: 'TC', chipGameweekId: 3, delta: 18, solutionIndex: 1 },
      { chipCode: 'BB', chipGameweekId: 2, delta: 18, solutionIndex: 2 },
      { chipCode: 'TC', chipGameweekId: 3, delta: 18, solutionIndex: 2 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)

    expect(state.chipAdvisories).toHaveLength(1)
    const [plan] = state.chipAdvisories
    expect(plan.decisions).toEqual([
      { chipCode: 'BB', displayName: 'Bench Boost', chipGameweekId: 2, gameweekLabel: 'Gameweek 2' },
      { chipCode: 'TC', displayName: 'Triple Captain', chipGameweekId: 3, gameweekLabel: 'Gameweek 3' },
    ])
    expect(plan.deltaWhole).toBe(18)
    expect(plan.solutionCount).toBe(3)
    expect(plan.totalSolutionCount).toBe(3)
  })

  it('solutions naming different chips or different gameweeks render as distinct advisories, each stating how many of the solutions chose it', () => {
    // Solutions 0 and 1 agree on Triple Captain in gameweek 2; solution 2
    // instead plays Bench Boost in gameweek 5 — two genuinely different
    // plans, not one collapsed one.
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'TC', chipGameweekId: 2, delta: 12, solutionIndex: 0 },
      { chipCode: 'TC', chipGameweekId: 2, delta: 12, solutionIndex: 1 },
      { chipCode: 'BB', chipGameweekId: 5, delta: 9, solutionIndex: 2 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)

    expect(state.chipAdvisories).toHaveLength(2)

    const [first, second] = state.chipAdvisories
    expect(first.decisions).toEqual([
      { chipCode: 'TC', displayName: 'Triple Captain', chipGameweekId: 2, gameweekLabel: 'Gameweek 2' },
    ])
    expect(first.deltaWhole).toBe(12)
    expect(first.solutionCount).toBe(2)
    expect(first.totalSolutionCount).toBe(3)

    expect(second.decisions).toEqual([
      { chipCode: 'BB', displayName: 'Bench Boost', chipGameweekId: 5, gameweekLabel: 'Gameweek 5' },
    ])
    expect(second.deltaWhole).toBe(9)
    expect(second.solutionCount).toBe(1)
    expect(second.totalSolutionCount).toBe(3)
  })

  it('a two-chip advisory produces exactly one points figure, never one per chip', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'BB', chipGameweekId: 2, delta: 18, solutionIndex: 0 },
      { chipCode: 'TC', chipGameweekId: 3, delta: 18, solutionIndex: 0 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)

    expect(state.chipAdvisories).toHaveLength(1)
    const [plan] = state.chipAdvisories
    expect(plan.decisions).toHaveLength(2)
    // Exactly one points figure exists on the plan itself...
    expect(typeof plan.deltaWhole).toBe('number')
    // ...and no per-chip figure exists anywhere for a reader to sum.
    for (const decision of plan.decisions) {
      expect(decision).not.toHaveProperty('deltaWhole')
      expect(decision).not.toHaveProperty('delta')
    }
  })

  it('a single-chip advisory renders correctly — one chip, one gameweek, one delta', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [{ chipCode: 'TC', chipGameweekId: 2, delta: 18, solutionIndex: 0 }]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)

    expect(state.chipAdvisories).toEqual([
      {
        decisions: [{ chipCode: 'TC', displayName: 'Triple Captain', chipGameweekId: 2, gameweekLabel: 'Gameweek 2' }],
        deltaWhole: 18,
        solutionCount: 1,
        totalSolutionCount: 1,
      },
    ])
  })

  it('rounds a delta like 6.5 up and 6.49 down — Math.round, not truncation', () => {
    // Different chips in different gameweeks, so each stays its own plan —
    // isolates the rounding behaviour from the collapsing behaviour above.
    const chipAdvisories: ChipAdvisoryRow[] = [
      { chipCode: 'TC', chipGameweekId: 2, delta: 6.5, solutionIndex: 0 },
      { chipCode: 'BB', chipGameweekId: 4, delta: 6.49, solutionIndex: 1 },
    ]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories).toHaveLength(2)
    expect(state.chipAdvisories[0].deltaWhole).toBe(7)
    expect(state.chipAdvisories[1].deltaWhole).toBe(6)
  })

  it('renders an unrecognised chip code as an explicit unknown-chip label rather than dropping it', () => {
    const chipAdvisories: ChipAdvisoryRow[] = [{ chipCode: 'WC', chipGameweekId: 3, delta: 4, solutionIndex: 0 }]
    const state = deriveChipState(sourceData({ chipAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.chipAdvisories[0].decisions[0].displayName).toBe('Unknown chip (WC)')
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
    const squadAdvisories: SquadAdvisoryRow[] = [squadAdvisoryRow({ chipCode: 'WC', delta: 46.8 })]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toEqual([
      { chipCode: 'WC', displayName: 'Wildcard', deltaWhole: 47, gameweekId: 7, gameweekLabel: 'Gameweek 7', squad: null },
    ])
  })

  it('resolves FH to "Free Hit"', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [squadAdvisoryRow({ chipCode: 'FH', delta: 30 })]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories[0].displayName).toBe('Free Hit')
  })

  it('can carry BOTH a Wildcard and a Free Hit row at once — two separate questions, two separate answers', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      squadAdvisoryRow({ chipCode: 'WC', delta: 47 }),
      squadAdvisoryRow({ chipCode: 'FH', delta: 31 }),
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toEqual([
      { chipCode: 'WC', displayName: 'Wildcard', deltaWhole: 47, gameweekId: 7, gameweekLabel: 'Gameweek 7', squad: null },
      { chipCode: 'FH', displayName: 'Free Hit', deltaWhole: 31, gameweekId: 7, gameweekLabel: 'Gameweek 7', squad: null },
    ])
  })

  it('rounds a delta like 6.5 up and 6.49 down — Math.round, not truncation', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      squadAdvisoryRow({ chipCode: 'WC', delta: 6.5 }),
      squadAdvisoryRow({ chipCode: 'FH', delta: 6.49 }),
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories[0].deltaWhole).toBe(7)
    expect(state.squadAdvisories[1].deltaWhole).toBe(6)
  })

  it('carries the fixed five-gameweek limitation sentence on the derived view whenever there is at least one squad advisory', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [squadAdvisoryRow({ chipCode: 'WC', delta: 47 })]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisoryNote).toBe(SQUAD_ADVISORY_HORIZON_NOTE)
    expect(state.squadAdvisoryNote).toMatch(/five-gameweek/)
  })

  it('the squad-advisory note and the chip-timing advisory note are independent — one can be present without the other', () => {
    const state = deriveChipState(
      sourceData({ chipAdvisories: [], squadAdvisories: [squadAdvisoryRow({ chipCode: 'WC', delta: 47 })] }),
      GW19_DEADLINE_MS - 1,
    )
    expect(state.chipAdvisoryNote).toBeNull()
    expect(state.squadAdvisoryNote).toBe(SQUAD_ADVISORY_HORIZON_NOTE)
  })

  it('SQUAD_ADVISORY_DISPLAY_NAMES maps exactly the two squad-rebuild chip codes', () => {
    expect(SQUAD_ADVISORY_DISPLAY_NAMES).toEqual({ WC: 'Wildcard', FH: 'Free Hit' })
  })

  // Ticket #284: "the chips derive picks the latest advisory per chip" — api.ts now passes
  // through EVERY matching chip_advisories WC/FH row (never pre-deduped in the query, see that
  // file's own comment), so this reduction must happen here and be provable without a database.
  it('keeps only the LATEST row per chip code — highest id wins, an older probe for the same chip is discarded entirely', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      squadAdvisoryRow({ id: 5, chipCode: 'WC', delta: 10 }),
      squadAdvisoryRow({ id: 9, chipCode: 'WC', delta: 47 }), // the newer WC probe — this one should win
      squadAdvisoryRow({ id: 3, chipCode: 'FH', delta: 20 }),
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toHaveLength(2)
    expect(state.squadAdvisories.find((a) => a.chipCode === 'WC')?.deltaWhole).toBe(47)
    expect(state.squadAdvisories.find((a) => a.chipCode === 'FH')?.deltaWhole).toBe(20)
  })

  it('the highest id wins regardless of input order — appearing first does not matter', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      squadAdvisoryRow({ id: 9, chipCode: 'WC', delta: 47 }),
      squadAdvisoryRow({ id: 5, chipCode: 'WC', delta: 10 }),
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories).toHaveLength(1)
    expect(state.squadAdvisories[0].deltaWhole).toBe(47)
  })

  it('Wildcard and Free Hit are deduped independently — a Wildcard probe from last night and a Free Hit probe from this morning can both be the latest at once', () => {
    const squadAdvisories: SquadAdvisoryRow[] = [
      squadAdvisoryRow({ id: 1, chipCode: 'WC', delta: 5 }),
      squadAdvisoryRow({ id: 2, chipCode: 'WC', delta: 8 }),
      squadAdvisoryRow({ id: 10, chipCode: 'FH', delta: 12 }),
      squadAdvisoryRow({ id: 11, chipCode: 'FH', delta: 15 }),
    ]
    const state = deriveChipState(sourceData({ squadAdvisories }), GW19_DEADLINE_MS - 1)
    expect(state.squadAdvisories.map((a) => a.deltaWhole).sort((a, b) => a - b)).toEqual([8, 15])
  })
})

// ============================================================================
// buildSquadRebuildView — the "See the squad" disclosure (ticket #284).
// ============================================================================

function playerOption(id: number, webName: string, elementType: 1 | 2 | 3 | 4): ChipPlayerOption {
  return { id, webName, elementType }
}

/** 15 players spanning all four positions, matching REBUILD_PICKS below one-for-one by id. */
const REBUILD_PLAYERS: ChipPlayerOption[] = [
  playerOption(1, 'Keeper A', 1),
  playerOption(2, 'Defender A', 2),
  playerOption(3, 'Defender B', 2),
  playerOption(4, 'Defender C', 2),
  playerOption(5, 'Midfielder A', 3),
  playerOption(6, 'Midfielder B', 3),
  playerOption(7, 'Midfielder C', 3),
  playerOption(8, 'Midfielder D', 3),
  playerOption(9, 'Forward A', 4),
  playerOption(10, 'Forward B', 4),
  playerOption(11, 'Forward C', 4),
  playerOption(12, 'Keeper B', 1),
  playerOption(13, 'Defender D', 2),
  playerOption(14, 'Defender E', 2),
  playerOption(15, 'Midfielder E', 3),
]

function rebuildPick(playerId: number, overrides: Partial<ChipRebuildPickRow> = {}): ChipRebuildPickRow {
  return {
    playerId,
    playerCode: null,
    position: 'DEF',
    isStarting: true,
    benchOrder: null,
    isCaptain: false,
    isViceCaptain: false,
    expectedPoints: 4,
    ...overrides,
  }
}

/** A full, valid 15-player rebuild squad: 11 starting (id 8 captain, id 11 vice), 4 bench (ids 12-15, bench_order 1-4). */
const REBUILD_PICKS: ChipRebuildPickRow[] = [
  rebuildPick(1, { position: 'GKP', expectedPoints: 3 }),
  rebuildPick(2, { position: 'DEF', expectedPoints: 4 }),
  rebuildPick(3, { position: 'DEF', expectedPoints: 4 }),
  rebuildPick(4, { position: 'DEF', expectedPoints: 4 }),
  rebuildPick(5, { position: 'MID', expectedPoints: 5 }),
  rebuildPick(6, { position: 'MID', expectedPoints: 5 }),
  rebuildPick(7, { position: 'MID', expectedPoints: 5 }),
  rebuildPick(8, { position: 'MID', expectedPoints: 5, isCaptain: true }),
  rebuildPick(9, { position: 'FWD', expectedPoints: 6 }),
  rebuildPick(10, { position: 'FWD', expectedPoints: 6 }),
  rebuildPick(11, { position: 'FWD', expectedPoints: 6, isViceCaptain: true }),
  rebuildPick(12, { position: 'GKP', isStarting: false, benchOrder: 1, expectedPoints: 2 }),
  rebuildPick(13, { position: 'DEF', isStarting: false, benchOrder: 2, expectedPoints: 2 }),
  rebuildPick(14, { position: 'DEF', isStarting: false, benchOrder: 3, expectedPoints: 2 }),
  rebuildPick(15, { position: 'MID', isStarting: false, benchOrder: 4, expectedPoints: 2 }),
]

describe('buildSquadRebuildView', () => {
  const playersById = new Map(REBUILD_PLAYERS.map((p) => [p.id, p]))

  it('returns null when there are no stored picks — the caller renders no disclosure rather than an empty one', () => {
    expect(buildSquadRebuildView([], playersById, null)).toBeNull()
  })

  it('groups the starting XI by position, in Goalkeepers/Defenders/Midfielders/Forwards order, and marks the captain', () => {
    const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, null)
    expect(squad).not.toBeNull()
    expect(squad!.positionGroups.map((g) => g.label)).toEqual(['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards'])
    expect(squad!.positionGroups[0].starters).toEqual([{ playerId: 1, name: 'Keeper A', isCaptain: false }])
    const midfielders = squad!.positionGroups[2].starters
    expect(midfielders.find((p) => p.playerId === 8)).toEqual({ playerId: 8, name: 'Midfielder D', isCaptain: true })
    expect(squad!.captainName).toBe('Midfielder D')
  })

  it('lists the bench separately, ordered by bench_order, never folded into a position group', () => {
    const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, null)
    expect(squad!.bench.map((p) => p.playerId)).toEqual([12, 13, 14, 15])
  })

  it("sums the starting XI's expected points for this one gameweek, captain's contribution doubled", () => {
    const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, null)
    // 3+4+4+4+5+5+5+6+6+6 (ten non-captain starters) + 5*2 (captain, id 8, doubled) = 48 + 10 = 58.
    expect(squad!.gameweekPointsWhole).toBe(58)
  })

  it('falls back to the raw CSV position string, in its own group, for a starter the current player pool no longer recognises — never silently dropped', () => {
    const playersMissingOne = new Map(REBUILD_PLAYERS.filter((p) => p.id !== 9).map((p) => [p.id, p]))
    const squad = buildSquadRebuildView(REBUILD_PICKS, playersMissingOne, null)
    const fallbackGroup = squad!.positionGroups.find((g) => g.label === 'FWD')
    expect(fallbackGroup).toBeDefined()
    expect(fallbackGroup!.starters).toEqual([{ playerId: 9, name: 'Player 9', isCaptain: false }])
    // The other two forwards are still resolved normally, in the real "Forwards" group.
    expect(squad!.positionGroups.find((g) => g.label === 'Forwards')!.starters.map((p) => p.playerId).sort()).toEqual([10, 11])
  })

  describe('In / Out vs your team', () => {
    it('known: false — no In/Out lists at all — when nothing has been saved for this gameweek', () => {
      const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, null)
      expect(squad!.comparison).toEqual({ known: false })
    })

    it('0 changes when the saved squad is exactly the rebuild squad', () => {
      const existingIds = new Set(REBUILD_PICKS.map((p) => p.playerId))
      const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, existingIds)
      expect(squad!.comparison).toEqual({ known: true, playersIn: [], playersOut: [] })
    })

    it('15 changes when the saved squad shares no player at all with the rebuild squad', () => {
      const existingIds = new Set(Array.from({ length: 15 }, (_, i) => i + 101))
      const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, existingIds)
      expect(squad!.comparison.known).toBe(true)
      if (!squad!.comparison.known) throw new Error('unreachable')
      expect(squad!.comparison.playersIn).toHaveLength(15)
      expect(squad!.comparison.playersOut).toHaveLength(15)
      expect(squad!.comparison.playersIn.map((p) => p.playerId).sort((a, b) => a - b)).toEqual(
        REBUILD_PICKS.map((p) => p.playerId).sort((a, b) => a - b)
      )
      expect(squad!.comparison.playersOut.map((p) => p.playerId).sort((a, b) => a - b)).toEqual([...existingIds].sort((a, b) => a - b))
    })

    it('a partial overlap reports only the genuine ins and outs, never the players unchanged between the two squads', () => {
      // Existing squad keeps players 1-13 (unchanged), drops 14 and 15, and holds two players
      // (201, 202) the rebuild doesn't pick at all.
      const existingIds = new Set([...Array.from({ length: 13 }, (_, i) => i + 1), 201, 202])
      const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, existingIds)
      expect(squad!.comparison.known).toBe(true)
      if (!squad!.comparison.known) throw new Error('unreachable')
      expect(squad!.comparison.playersIn.map((p) => p.playerId).sort((a, b) => a - b)).toEqual([14, 15])
      expect(squad!.comparison.playersOut.map((p) => p.playerId).sort((a, b) => a - b)).toEqual([201, 202])
    })

    it('names an "out" player even when their id is unresolvable in the current player pool, rather than dropping them', () => {
      const existingIds = new Set([999])
      const squad = buildSquadRebuildView(REBUILD_PICKS, playersById, existingIds)
      expect(squad!.comparison.known).toBe(true)
      if (!squad!.comparison.known) throw new Error('unreachable')
      expect(squad!.comparison.playersOut).toEqual([{ playerId: 999, name: 'Player 999' }])
    })
  })
})
