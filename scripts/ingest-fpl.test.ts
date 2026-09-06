// Unit tests for scripts/ingest-fpl.ts — ticket #219.
//
// This file's Supabase writes and live bootstrap-static/fixtures/ fetches
// can't be exercised without a real network call and a live Supabase
// project (neither available to this Builder's session — same limitation
// scripts/ingest-core-insights.test.ts and every scripts/project-points.ts-
// adjacent test file already documents). `mapPlayers` and
// `countPlayersWithPenaltiesOrder` are pure functions with no I/O of their
// own, so they are exercised directly on constructed bootstrap-static-
// shaped rows instead.
//
// Scope: this ticket's own definition of done asks specifically for
// penalties_order coverage across null, 1, 2 and 3 — the tests below cover
// exactly that, plus the counter that reports how many players in a batch
// carry a non-null value. Every OTHER mapPlayers field (goals_scored,
// status, expected_goals, ...) is unchanged by this ticket and untested
// here — this file adds coverage for what #219 touched, it does not
// retroactively backfill a full mapPlayers test suite ticket #11 never
// wrote.

import { describe, expect, it } from 'vitest'
import { countPlayersWithPenaltiesOrder, mapPlayers } from './ingest-fpl.js'

/** Minimal bootstrap-static "elements" row — only the fields a test below actually varies. Every other mapPlayers field reads through num()/str()/bool(), which already default a missing field to null/0/'a' — see ingest-fpl.ts's own field-access helpers. */
function element(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 1, code: 100, web_name: 'Test Player', ...overrides }
}

describe('mapPlayers — penalties_order (ticket #219)', () => {
  it('maps a null penalties_order to null, not 0 (most players have no penalty-taking role)', () => {
    const [row] = mapPlayers([element({ id: 1, code: 101, penalties_order: null })])
    expect(row.penalties_order).toBeNull()
  })

  it('maps penalties_order 1 (first-choice taker) through verbatim', () => {
    const [row] = mapPlayers([element({ id: 2, code: 102, penalties_order: 1 })])
    expect(row.penalties_order).toBe(1)
  })

  it('maps penalties_order 2 (second-choice taker) through verbatim', () => {
    const [row] = mapPlayers([element({ id: 3, code: 103, penalties_order: 2 })])
    expect(row.penalties_order).toBe(2)
  })

  it('maps penalties_order 3 (third-choice taker) through verbatim', () => {
    const [row] = mapPlayers([element({ id: 4, code: 104, penalties_order: 3 })])
    expect(row.penalties_order).toBe(3)
  })

  it('maps a field entirely absent from the source row (an older API shape) to null, same as an explicit null', () => {
    const raw = element({ id: 5, code: 105 })
    delete raw.penalties_order
    const [row] = mapPlayers([raw])
    expect(row.penalties_order).toBeNull()
  })

  it('does not clamp or reject a value above 3 — the source has been observed to publish up to 5', () => {
    const [row] = mapPlayers([element({ id: 6, code: 106, penalties_order: 5 })])
    expect(row.penalties_order).toBe(5)
  })
})

describe('countPlayersWithPenaltiesOrder (ticket #219)', () => {
  it('counts only non-null values, across null/1/2/3', () => {
    const rows = mapPlayers([
      element({ id: 1, code: 101, penalties_order: null }),
      element({ id: 2, code: 102, penalties_order: 1 }),
      element({ id: 3, code: 103, penalties_order: 2 }),
      element({ id: 4, code: 104, penalties_order: 3 }),
      element({ id: 5, code: 105, penalties_order: null }),
    ])
    expect(countPlayersWithPenaltiesOrder(rows)).toBe(3)
  })

  it('returns 0 for an all-null batch', () => {
    const rows = mapPlayers([
      element({ id: 1, code: 101, penalties_order: null }),
      element({ id: 2, code: 102, penalties_order: null }),
    ])
    expect(countPlayersWithPenaltiesOrder(rows)).toBe(0)
  })

  it('returns the full length for an all-non-null batch', () => {
    const rows = mapPlayers([
      element({ id: 1, code: 101, penalties_order: 1 }),
      element({ id: 2, code: 102, penalties_order: 4 }),
    ])
    expect(countPlayersWithPenaltiesOrder(rows)).toBe(2)
  })

  it('returns 0 for an empty batch', () => {
    expect(countPlayersWithPenaltiesOrder([])).toBe(0)
  })
})
