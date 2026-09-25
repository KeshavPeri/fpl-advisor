// Unit tests for src/lib/miniLeague/derive.ts — ticket #271, redesigned by ticket #276.
//
// Covers the DoD's named cases: Keshav at 1st, 2nd and 10th of 21 (top 3 + you ± 1, no
// duplicates), the lead/gap numbers, the entry-not-in-league fallback, and null handling.

import { describe, expect, it } from 'vitest'
import { deriveMiniLeagueView, EMPTY_STATE_MESSAGE } from './derive.ts'
import type { MiniLeagueRowEntry, MiniLeagueStandingRow } from './types.ts'

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

/** A 21-manager league, rank N == entryId N == total (400 - 5*(N-1)), so any manager's rank,
 *  entryId and score are all mutually derivable in the tests below. */
function twentyOneManagerLeague(): MiniLeagueStandingRow[] {
  return Array.from({ length: 21 }, (_, i) => {
    const rank = i + 1
    return row({ entryId: rank, rank, lastRank: rank, total: 400 - 5 * (rank - 1), eventTotal: 60 })
  })
}

function rowIds(entries: readonly MiniLeagueRowEntry[]): (number | 'divider')[] {
  return entries.map((entry) => (entry.kind === 'divider' ? 'divider' : entry.row.entryId))
}

describe('deriveMiniLeagueView — no data', () => {
  it('returns hasData: false with the named empty-state message for an empty row set', () => {
    const view = deriveMiniLeagueView([], '1')
    expect(view.hasData).toBe(false)
    expect(view.emptyStateMessage).toBe(EMPTY_STATE_MESSAGE)
    expect(view.gameweekId).toBeNull()
    expect(view.leagueSize).toBe(0)
    expect(view.you).toBeNull()
    expect(view.isLeading).toBe(false)
    expect(view.rows).toEqual([])
  })
})

describe('deriveMiniLeagueView — rows: top 3 + you ± 1, no duplicates (ticket #276 DoD)', () => {
  it('you at 1st of 21: rows are exactly the top 3, no divider, no duplicates', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '1')
    expect(view.you?.rank).toBe(1)
    expect(rowIds(view.rows)).toEqual([1, 2, 3])
  })

  it('you at 2nd of 21: rows are exactly the top 3 (already contains you), no divider', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '2')
    expect(view.you?.rank).toBe(2)
    expect(rowIds(view.rows)).toEqual([1, 2, 3])
  })

  it('you at 10th of 21: top 3, a divider, then you ± 1 — seven entries, no duplicate rank', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '10')
    expect(view.you?.rank).toBe(10)
    expect(rowIds(view.rows)).toEqual([1, 2, 3, 'divider', 9, 10, 11])
    const rankEntries = view.rows.filter((entry) => entry.kind === 'row')
    expect(new Set(rankEntries.map((entry) => entry.row.entryId)).size).toBe(rankEntries.length)
  })

  it('you at 4th of 21 (adjacent to the top 3): no divider, since 3 and 4 are consecutive ranks', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '4')
    expect(rowIds(view.rows)).toEqual([1, 2, 3, 4, 5])
  })

  it('you at 21st (last) of 21: top 3, a divider, then you ± 1 with no row below (there is none)', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '21')
    expect(rowIds(view.rows)).toEqual([1, 2, 3, 'divider', 20, 21])
  })
})

describe('deriveMiniLeagueView — lead/gap numbers', () => {
  it('you at 1st: gapToLeader 0, isLeading true, leadOverSecond is the gap to rank 2', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '1')
    expect(view.gapToLeader).toBe(0)
    expect(view.isLeading).toBe(true)
    expect(view.gapToAbove).toBeNull() // no row above the leader
    expect(view.leadOverSecond).toBe(5) // 400 - 395
  })

  it('you at 10th: not leading, leadOverSecond null, gapToLeader/gapToAbove both computed', () => {
    const view = deriveMiniLeagueView(twentyOneManagerLeague(), '10')
    expect(view.isLeading).toBe(false)
    expect(view.leadOverSecond).toBeNull()
    expect(view.gapToLeader).toBe(45) // 400 - 355
    expect(view.gapToAbove).toBe(5) // 360 - 355
  })

  it('movement: lastRank - rank, positive is up, negative is down, zero is unchanged', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '2')
    expect(view.movement).toBe(1) // lastRank 3, rank 2
    const fell = deriveMiniLeagueView(fourManagerLeague(), '3')
    expect(fell.movement).toBe(-1) // lastRank 2, rank 3
    const flat = deriveMiniLeagueView(fourManagerLeague(), '1')
    expect(flat.movement).toBe(0)
  })
})

describe('deriveMiniLeagueView — Keshav in 1st (small league)', () => {
  it('has no row above, gapToLeader 0, isLeading true, and the leader/you row appears once', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '1')
    expect(view.hasData).toBe(true)
    expect(view.entryNotInLeague).toBe(false)
    expect(view.you?.entryId).toBe(1)
    expect(view.leader?.entryId).toBe(1)
    expect(view.above).toBeNull()
    expect(view.gapToLeader).toBe(0)
    expect(view.isLeading).toBe(true)
    expect(view.leadOverSecond).toBe(20) // 300 - 280
    expect(view.leagueSize).toBe(4)
    expect(view.gameweekId).toBe(GAMEWEEK_ID)
    // A 4-manager league's top 3 already covers everyone but rank 4 — you (rank 1) is in it.
    expect(rowIds(view.rows)).toEqual([1, 2, 3])
  })
})

describe('deriveMiniLeagueView — Keshav is not in this league', () => {
  it('sets entryNotInLeague, leaves you/above/gaps/movement/isLeading at their null/false defaults, still shows the top 3', () => {
    const view = deriveMiniLeagueView(fourManagerLeague(), '999')
    expect(view.hasData).toBe(true)
    expect(view.entryNotInLeague).toBe(true)
    expect(view.you).toBeNull()
    expect(view.above).toBeNull()
    expect(view.gapToLeader).toBeNull()
    expect(view.gapToAbove).toBeNull()
    expect(view.leadOverSecond).toBeNull()
    expect(view.movement).toBeNull()
    expect(view.isLeading).toBe(false)
    expect(view.leader?.entryId).toBe(1)
    expect(rowIds(view.rows)).toEqual([1, 2, 3])
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

  it('leaves gaps and leadOverSecond null when a total is missing', () => {
    const rows = [
      row({ entryId: 1, rank: 1, lastRank: 1, total: null, eventTotal: null }),
      row({ entryId: 2, rank: 2, lastRank: 2, total: 90, eventTotal: 90 }),
    ]
    const view = deriveMiniLeagueView(rows, '2')
    expect(view.gapToLeader).toBeNull()
    expect(view.gapToAbove).toBeNull()

    const leaderView = deriveMiniLeagueView(rows, '1')
    expect(leaderView.isLeading).toBe(false) // gapToLeader is null, not 0, when total is missing
    expect(leaderView.leadOverSecond).toBeNull()
  })

  it('never inserts a divider around a null rank — leaves the rows adjacent instead of guessing', () => {
    const rows = [
      row({ entryId: 1, rank: null, lastRank: null, total: 100, eventTotal: 100 }),
      row({ entryId: 2, rank: null, lastRank: null, total: 90, eventTotal: 90 }),
      row({ entryId: 3, rank: null, lastRank: null, total: 80, eventTotal: 80 }),
    ]
    const view = deriveMiniLeagueView(rows, '3')
    expect(rowIds(view.rows)).not.toContain('divider')
  })
})
