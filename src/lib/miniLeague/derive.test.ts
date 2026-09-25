// Unit tests for src/lib/miniLeague/derive.ts — ticket #271.
//
// Covers the DoD's four named cases: Keshav in 1st, in the middle, in last place, and when his
// entry isn't in the league at all.

import { describe, expect, it } from 'vitest'
import { deriveMiniLeagueView, EMPTY_STATE_MESSAGE } from './derive.ts'
import type { MiniLeagueStandingRow } from './types.ts'

const GAMEWEEK_ID = 5

function row(overrides: Partial<MiniLeagueStandingRow> & { entryId: number }): MiniLeagueStandingRow {
  return {
    leagueId: 848654,
    gameweekId: GAMEWEEK_ID,
    entryName: `Team ${overrides.entryId}`,
    playerName: `Manager ${overrides.entryId}`,
    rank: null,
    lastRank: null,
    total: null,
    eventTotal: null,
    fetchedAt: '2026-09-20T09:00:00Z',
    ...overrides,
  }
}

// A 4-manager league, rank order 1..4 by entryId 1..4, so a test can pick any manager's entryId
// as "Keshav" and know exactly what should surround him.
function fourManagerLeague(): MiniLeagueStandingRow[] {
  return [
    row({ entryId: 1, rank: 1, lastRank: 1, total: 300, eventTotal: 70 }),
    row({ entryId: 2, rank: 2, lastRank: 3, total: 280, eventTotal: 65 }),
    row({ entryId: 3, rank: 3, lastRank: 2, total: 260, eventTotal: 60 }),
    row({ entryId: 4, rank: 4, lastRank: 4, total: 240, eventTotal: 55 }),
  ]
}

describe('deriveMiniLeagueView — no data', () => {
  it('returns hasData: false with the named empty-state message for an empty row set', () => {
    const view = deriveMiniLeagueView([], '1')
    expect(view.hasData).toBe(false)
    expect(view.emptyStateMessage).toBe(EMPTY_STATE_MESSAGE)
    expect(view.gameweekId).toBeNull()
    expect(view.leagueSize).toBe(0)
    expect(view.you).toBeNull()
    expect(view.rows).toEqual([])
  })
})

describe('deriveMiniLeagueView — Keshav in 1st', () => {
  it('has no row above, a below row, gapToLeader 0, and correct movement', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '1')
    expect(view.hasData).toBe(true)
    expect(view.entryNotInLeague).toBe(false)
    expect(view.you?.entryId).toBe(1)
    expect(view.leader?.entryId).toBe(1)
    expect(view.above).toBeNull()
    expect(view.below?.entryId).toBe(2)
    expect(view.gapToLeader).toBe(0)
    expect(view.gapToAbove).toBeNull()
    // lastRank 1, rank 1 -> no movement.
    expect(view.movement).toBe(0)
    expect(view.leagueSize).toBe(4)
    expect(view.gameweekId).toBe(GAMEWEEK_ID)
    // leader === you here, so the table dedupes to 2 rows: you/leader, below.
    expect(view.rows.map((r) => r.entryId)).toEqual([1, 2])
  })
})

describe('deriveMiniLeagueView — Keshav in the middle', () => {
  it('has a leader, an above row, a below row, and both gaps computed', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '2')
    expect(view.hasData).toBe(true)
    expect(view.you?.entryId).toBe(2)
    expect(view.leader?.entryId).toBe(1)
    expect(view.above?.entryId).toBe(1)
    expect(view.below?.entryId).toBe(3)
    expect(view.gapToLeader).toBe(20) // 300 - 280
    expect(view.gapToAbove).toBe(20) // above === leader here
    // lastRank 3, rank 2 -> moved up 1.
    expect(view.movement).toBe(1)
    // leader === above here, so the table dedupes to 3 rows: leader/above, you, below.
    expect(view.rows.map((r) => r.entryId)).toEqual([1, 2, 3])
  })

  it('computes distinct gapToLeader and gapToAbove when above is not the leader', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '3')
    expect(view.you?.entryId).toBe(3)
    expect(view.leader?.entryId).toBe(1)
    expect(view.above?.entryId).toBe(2)
    expect(view.below?.entryId).toBe(4)
    expect(view.gapToLeader).toBe(40) // 300 - 260
    expect(view.gapToAbove).toBe(20) // 280 - 260
    // lastRank 2, rank 3 -> fell 1.
    expect(view.movement).toBe(-1)
    expect(view.rows.map((r) => r.entryId)).toEqual([1, 2, 3, 4])
  })
})

describe('deriveMiniLeagueView — Keshav in last place', () => {
  it('has no row below, and gapToLeader/gapToAbove both computed', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '4')
    expect(view.hasData).toBe(true)
    expect(view.you?.entryId).toBe(4)
    expect(view.leader?.entryId).toBe(1)
    expect(view.above?.entryId).toBe(3)
    expect(view.below).toBeNull()
    expect(view.gapToLeader).toBe(60) // 300 - 240
    expect(view.gapToAbove).toBe(20) // 260 - 240
    // lastRank 4, rank 4 -> no movement.
    expect(view.movement).toBe(0)
    // leader, above, you: 3 distinct rows, no below.
    expect(view.rows.map((r) => r.entryId)).toEqual([1, 3, 4])
  })
})

describe('deriveMiniLeagueView — Keshav is not in this league', () => {
  it('sets entryNotInLeague, leaves you/above/below/gaps/movement null, and still shows a leaderboard', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '999')
    expect(view.hasData).toBe(true)
    expect(view.entryNotInLeague).toBe(true)
    expect(view.you).toBeNull()
    expect(view.above).toBeNull()
    expect(view.below).toBeNull()
    expect(view.gapToLeader).toBeNull()
    expect(view.gapToAbove).toBeNull()
    expect(view.movement).toBeNull()
    expect(view.leader?.entryId).toBe(1)
    // Fallback table: top 3 by rank.
    expect(view.rows.map((r) => r.entryId)).toEqual([1, 2, 3])
  })

  it('treats an unset VITE_FPL_ENTRY_ID (null) the same way as a non-matching one', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), null)
    expect(view.entryNotInLeague).toBe(true)
    expect(view.you).toBeNull()
  })

  it('treats a malformed entry id string as not matching, without throwing', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), 'not-a-number')
    expect(view.entryNotInLeague).toBe(true)
    expect(view.you).toBeNull()
  })
})

describe('deriveMiniLeagueView — nulls in the underlying data', () => {
  it('leaves movement null when lastRank is null (e.g. the league\'s first recorded gameweek)', () => {
    const rows = [
      row({ entryId: 1, rank: 1, lastRank: null, total: 100, eventTotal: 100 }),
      row({ entryId: 2, rank: 2, lastRank: null, total: 90, eventTotal: 90 }),
    ]
    const view = deriveMiniLeagueView(rows, '2')
    expect(view.movement).toBeNull()
  })

  it('leaves gaps null when a total is missing', () => {
    const rows = [
      row({ entryId: 1, rank: 1, lastRank: 1, total: null, eventTotal: null }),
      row({ entryId: 2, rank: 2, lastRank: 2, total: 90, eventTotal: 90 }),
    ]
    const view = deriveMiniLeagueView(rows, '2')
    expect(view.gapToLeader).toBeNull()
    expect(view.gapToAbove).toBeNull()
  })
})
