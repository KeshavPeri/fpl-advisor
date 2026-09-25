// Unit tests for scripts/ingest-mini-league.ts — ticket #271.
//
// This file's Supabase writes and live bootstrap-static/leagues-classic/ fetches can't be
// exercised without a real network call and a live Supabase project (same limitation every
// other scripts/*.ts test file in this repo documents — see ingest-fpl.test.ts). The pure/
// injectable functions this module exports are exercised directly instead:
//   - resolveLatestFinishedGameweekId — on constructed bootstrap-static "events"-shaped rows.
//   - fetchAllStandingsPages — against a stubbed fetchJson keyed by URL, returning the two real
//     fixture JSON files in scripts/fixtures/ (the DoD's "pagination across two pages from
//     fixture JSON").
//   - mapStandingsResults / parseStandingsPage / readLeagueId — on constructed/real inputs.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  fetchAllStandingsPages,
  mapStandingsResults,
  parseStandingsPage,
  readLeagueId,
  resolveLatestFinishedGameweekId,
  type JsonRecord,
} from './ingest-mini-league.js'

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('resolveLatestFinishedGameweekId', () => {
  it('returns the highest id among finished events', () => {
    const events: JsonRecord[] = [
      { id: 1, finished: true },
      { id: 2, finished: true },
      { id: 3, finished: false },
    ]
    expect(resolveLatestFinishedGameweekId(events)).toBe(2)
  })

  it('ignores unfinished events entirely, even if their id is higher', () => {
    const events: JsonRecord[] = [
      { id: 1, finished: true },
      { id: 5, finished: false },
    ]
    expect(resolveLatestFinishedGameweekId(events)).toBe(1)
  })

  it('returns null when no event has finished yet (pre-GW1)', () => {
    const events: JsonRecord[] = [
      { id: 1, finished: false },
      { id: 2, finished: false },
    ]
    expect(resolveLatestFinishedGameweekId(events)).toBeNull()
  })

  it('returns null for an empty events array', () => {
    expect(resolveLatestFinishedGameweekId([])).toBeNull()
  })

  it('skips a finished event whose id is missing/unparseable rather than crashing', () => {
    const events: JsonRecord[] = [
      { id: 'not-a-number', finished: true },
      { id: 4, finished: true },
    ]
    expect(resolveLatestFinishedGameweekId(events)).toBe(4)
  })
})

describe('parseStandingsPage', () => {
  it('parses a real fixture page, extracting results and has_next', () => {
    const page1 = loadFixture('mini-league-standings-page-1.json')
    const { results, hasNext } = parseStandingsPage(page1, 'https://example.invalid/page1')
    expect(hasNext).toBe(true)
    expect(results).toHaveLength(2)
  })

  it('reads has_next: false on the final page', () => {
    const page2 = loadFixture('mini-league-standings-page-2.json')
    const { results, hasNext } = parseStandingsPage(page2, 'https://example.invalid/page2')
    expect(hasNext).toBe(false)
    expect(results).toHaveLength(1)
  })

  it('throws when the response has no "standings" object', () => {
    expect(() => parseStandingsPage({ league: {} }, 'https://example.invalid')).toThrow(
      /missing the "standings" object/
    )
  })

  it('throws when standings.results is not an array', () => {
    expect(() => parseStandingsPage({ standings: { results: 'nope' } }, 'https://example.invalid')).toThrow(
      /standings\.results is not an array/
    )
  })
})

describe('fetchAllStandingsPages — pagination across two pages from fixture JSON', () => {
  it('follows has_next across both fixture pages and aggregates every result', async () => {
    const page1 = loadFixture('mini-league-standings-page-1.json')
    const page2 = loadFixture('mini-league-standings-page-2.json')

    const requestedUrls: string[] = []
    const fetchJson = async (url: string): Promise<unknown> => {
      requestedUrls.push(url)
      if (url.includes('page_standings=1')) return page1
      if (url.includes('page_standings=2')) return page2
      throw new Error(`unexpected URL requested: ${url}`)
    }

    const { results, pageCount } = await fetchAllStandingsPages(fetchJson, 'https://example.invalid/api', 848654)

    expect(pageCount).toBe(2)
    expect(results).toHaveLength(3)
    expect(requestedUrls).toEqual([
      'https://example.invalid/api/leagues-classic/848654/standings/?page_standings=1',
      'https://example.invalid/api/leagues-classic/848654/standings/?page_standings=2',
    ])
    // Order preserved: page 1's two entries first, then page 2's one entry.
    expect((results[0] as { entry: number }).entry).toBe(111)
    expect((results[1] as { entry: number }).entry).toBe(222)
    expect((results[2] as { entry: number }).entry).toBe(333)
  })

  it('stops after a single page when has_next is false on the first page', async () => {
    const page2 = loadFixture('mini-league-standings-page-2.json')
    let calls = 0
    const fetchJson = async (): Promise<unknown> => {
      calls++
      return page2
    }

    const { results, pageCount } = await fetchAllStandingsPages(fetchJson, 'https://example.invalid/api', 1)
    expect(calls).toBe(1)
    expect(pageCount).toBe(1)
    expect(results).toHaveLength(1)
  })
})

describe('mapStandingsResults', () => {
  it('maps entry/entry_name/player_name/rank/last_rank/total/event_total straight through', () => {
    const page1 = loadFixture('mini-league-standings-page-1.json') as {
      standings: { results: JsonRecord[] }
    }
    const { rows, skippedCount } = mapStandingsResults(page1.standings.results)
    expect(skippedCount).toBe(0)
    expect(rows).toEqual([
      {
        entryId: 111,
        entryName: 'Ink Dynasty',
        playerName: 'Keshav Peri',
        rank: 1,
        lastRank: 2,
        total: 210,
        eventTotal: 68,
      },
      {
        entryId: 222,
        entryName: 'Second Best',
        playerName: 'Alex Chen',
        rank: 2,
        lastRank: 1,
        total: 205,
        eventTotal: 60,
      },
    ])
  })

  it('skips a result with no resolvable entry id, and counts it', () => {
    const results: JsonRecord[] = [
      { entry: 'not-a-number', entry_name: 'Broken' },
      { entry: 5, entry_name: 'Fine', player_name: 'Someone', rank: 1, last_rank: 1, total: 10, event_total: 10 },
    ]
    const { rows, skippedCount } = mapStandingsResults(results)
    expect(skippedCount).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].entryId).toBe(5)
  })

  it('returns an empty result for an empty input', () => {
    expect(mapStandingsResults([])).toEqual({ rows: [], skippedCount: 0 })
  })
})

describe('readLeagueId', () => {
  it('reads the real config/mini-league.json and returns 848654', () => {
    const configPath = fileURLToPath(new URL('../config/mini-league.json', import.meta.url))
    expect(readLeagueId(configPath)).toBe(848654)
  })

  it('throws on a file with no leagueId field', () => {
    const badConfigPath = fileURLToPath(new URL('./fixtures/mini-league-standings-page-1.json', import.meta.url))
    expect(() => readLeagueId(badConfigPath)).toThrow(/must contain an integer "leagueId" field/)
  })

  it('throws when the file does not exist', () => {
    expect(() => readLeagueId('/nonexistent/path/mini-league.json')).toThrow(/could not read/)
  })
})
