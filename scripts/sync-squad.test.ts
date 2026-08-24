// Unit tests for scripts/sync-squad.ts's pure functions — ticket #14.
//
// These exercise the parsing, squad_position mapping and reconciliation
// logic directly, without a live Supabase project (none is available to
// this Builder's session; see the ticket report for what was verified
// against the *real* FPL API instead — entry/1/'s live response and
// entry/1/event/1/picks/'s live 404, both confirmed by direct curl and by
// running the shipped script itself with FPL_ENTRY_ID unset).
//
// fetchWithRetry's 404/5xx/network-error branching is covered here against
// a local HTTP server (no external dependency, no live network needed) —
// this is the literal code path the real script runs, just pointed at a
// controlled host instead of fantasy.premierleague.com.

import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSquadPickRows,
  computeDiff,
  fetchWithRetry,
  MAX_PICKS_LOOKBACK,
  parseChips,
  parseEntryData,
  parsePicks,
  picksConfirmedMessage,
  picksDiffMessage,
  picksEstablishedMessage,
  picksNotPublishedMessage,
  resolvePicks,
  type ApiPick,
  type ExistingPickRow,
  type PicksLookupResult,
  type PlayerInfo,
} from './sync-squad.js'

// ============================================================================
// parseEntryData — the "no deadline passed yet" DoD item hinges entirely on
// this correctly reading last_deadline_bank/last_deadline_value as null.
// ============================================================================

describe('parseEntryData', () => {
  it('reads bank/value/transfers/points/rank from a real entry/{id}/ shape', () => {
    const result = parseEntryData(
      {
        last_deadline_bank: 5,
        last_deadline_value: 998,
        last_deadline_total_transfers: 3,
        summary_overall_points: 120,
        summary_overall_rank: 456789,
      },
      'https://fantasy.premierleague.com/api/entry/1/'
    )
    expect(result).toEqual({
      bank: 5,
      squadValue: 998,
      totalTransfers: 3,
      overallPoints: 120,
      overallRank: 456789,
      overallRankCoercedToNull: false,
    })
  })

  it('reads null bank/value exactly as entry/1/ returns them before GW1 — verified live 11 Aug 2026', () => {
    // This is the literal response shape from `curl
    // https://fantasy.premierleague.com/api/entry/1/`, trimmed to the
    // fields this function reads.
    const result = parseEntryData(
      {
        last_deadline_bank: null,
        last_deadline_value: null,
        last_deadline_total_transfers: 0,
        summary_overall_points: null,
        summary_overall_rank: null,
        current_event: null,
      },
      'https://fantasy.premierleague.com/api/entry/1/'
    )
    expect(result.bank).toBeNull()
    expect(result.squadValue).toBeNull()
  })

  it('throws on a non-object response rather than silently returning nulls', () => {
    expect(() => parseEntryData([], 'url')).toThrow(/not a JSON object/)
    expect(() => parseEntryData('oops', 'url')).toThrow(/not a JSON object/)
  })

  // ==========================================================================
  // Ticket #77 — summary_overall_rank of 0 (or below) is FPL's sentinel for
  // "no overall rank yet," not a real rank. squads.overall_rank's check
  // constraint (overall_rank IS NULL OR overall_rank >= 1) correctly rejects
  // it, so it must become null before it reaches the upsert. Every input the
  // DoD names, one at a time.
  // ==========================================================================

  it.each([
    { input: 0, expected: null, coerced: true, label: 'zero — the FPL "unranked" sentinel' },
    { input: -1, expected: null, coerced: true, label: 'a negative number' },
    { input: null, expected: null, coerced: false, label: 'explicit null' },
    { input: 1, expected: 1, coerced: false, label: 'the lowest real rank' },
    { input: 1523104, expected: 1523104, coerced: false, label: 'a normal positive rank' },
  ])('summary_overall_rank $label ($input) -> overallRank $expected, coerced=$coerced', ({ input, expected, coerced }) => {
    const body: Record<string, unknown> = {
      last_deadline_bank: 5,
      last_deadline_value: 998,
      last_deadline_total_transfers: 3,
      summary_overall_points: 120,
      summary_overall_rank: input,
    }
    const result = parseEntryData(body, 'url')
    expect(result.overallRank).toBe(expected)
    expect(result.overallRankCoercedToNull).toBe(coerced)
  })

  it('coerces to null when summary_overall_rank is absent entirely, without flagging it as a coercion', () => {
    const result = parseEntryData(
      {
        last_deadline_bank: 5,
        last_deadline_value: 998,
        last_deadline_total_transfers: 3,
        summary_overall_points: 120,
        // summary_overall_rank deliberately omitted
      },
      'url'
    )
    expect(result.overallRank).toBeNull()
    expect(result.overallRankCoercedToNull).toBe(false)
  })

  it('keeps a real zero for summary_overall_points — only rank is coerced, per ticket #77', () => {
    const result = parseEntryData(
      {
        last_deadline_bank: 5,
        last_deadline_value: 998,
        last_deadline_total_transfers: 0,
        summary_overall_points: 0,
        summary_overall_rank: 0,
      },
      'url'
    )
    expect(result.overallPoints).toBe(0)
    expect(result.totalTransfers).toBe(0)
    expect(result.overallRank).toBeNull()
    expect(result.overallRankCoercedToNull).toBe(true)
  })
})

// ============================================================================
// parseChips
// ============================================================================

describe('parseChips', () => {
  it('maps a populated chips array', () => {
    const result = parseChips({
      chips: [
        { name: 'wildcard', event: 5, time: '2026-09-20T10:00:00Z' },
        { name: 'bboost', event: 12, time: '2026-11-01T10:00:00Z' },
      ],
    })
    expect(result).toEqual([
      { name: 'wildcard', event: 5, time: '2026-09-20T10:00:00Z' },
      { name: 'bboost', event: 12, time: '2026-11-01T10:00:00Z' },
    ])
  })

  it('returns an empty array for the pre-season shape — verified live against entry/1/history/', () => {
    expect(parseChips({ current: [], past: [], chips: [] })).toEqual([])
  })

  it('degrades to an empty array rather than throwing on a missing/malformed field', () => {
    expect(parseChips({})).toEqual([])
    expect(parseChips({ chips: 'not-an-array' })).toEqual([])
    expect(parseChips(null)).toEqual([])
  })
})

// ============================================================================
// parsePicks — the 404 case itself is handled by the caller (main()) before
// this function is ever invoked; this covers the 200-with-body shape.
// ============================================================================

function makeApiPick(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    element: 1,
    position: 1,
    multiplier: 1,
    is_captain: false,
    is_vice_captain: false,
    ...overrides,
  }
}

describe('parsePicks', () => {
  it('parses a well-formed 15-pick response', () => {
    const picks = Array.from({ length: 15 }, (_, i) => makeApiPick({ element: i + 1, position: i + 1 }))
    const result = parsePicks({ picks }, 'url')
    expect(result).toHaveLength(15)
    expect(result[0]).toEqual({ element: 1, position: 1, isCaptain: false, isViceCaptain: false })
  })

  it('reads is_captain/is_vice_captain correctly', () => {
    const picks = Array.from({ length: 15 }, (_, i) => makeApiPick({ element: i + 1, position: i + 1 }))
    picks[0] = makeApiPick({ element: 1, position: 1, is_captain: true })
    picks[1] = makeApiPick({ element: 2, position: 2, is_vice_captain: true })
    const result = parsePicks({ picks }, 'url')
    expect(result[0].isCaptain).toBe(true)
    expect(result[1].isViceCaptain).toBe(true)
  })

  it('throws when the picks array is not exactly 15 long', () => {
    const picks = Array.from({ length: 14 }, (_, i) => makeApiPick({ element: i + 1, position: i + 1 }))
    expect(() => parsePicks({ picks }, 'url')).toThrow(/expected 15/)
  })

  it('throws when "picks" is missing entirely', () => {
    expect(() => parsePicks({}, 'url')).toThrow(/missing the "picks" array/)
  })
})

// ============================================================================
// buildSquadPickRows — squad_position mapping, is_starting/bench_order
// derivation, and the "missing player.code is a hard stop" DoD item.
// ============================================================================

describe('buildSquadPickRows', () => {
  // A minimal legal 15-man squad: 2 GK, 5 DEF, 5 MID, 3 FWD, positions
  // 1-11 starting (a 4-4-2 with GK1), 12-15 bench.
  const elementTypeByElement: Record<number, PlayerInfo['elementType']> = {
    1: 1,
    2: 1, // GK
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2, // DEF
    8: 3,
    9: 3,
    10: 3,
    11: 3,
    12: 3, // MID
    13: 4,
    14: 4,
    15: 4, // FWD
  }
  const playerMap = new Map<number, PlayerInfo>(
    Object.entries(elementTypeByElement).map(([id, elementType]) => [
      Number(id),
      { code: Number(id) * 1000, elementType },
    ])
  )

  function starterPick(element: number, position: number, overrides: Partial<ApiPick> = {}): ApiPick {
    return { element, position, isCaptain: false, isViceCaptain: false, ...overrides }
  }

  // A realistic starting/bench split matching the block above: GK1 starts
  // (pos 1), GK2 benched (pos 12, reserve keeper convention); 4 of 5 DEF
  // start, 1 benched; 4 of 5 MID start (one is captain), 1 benched, 2 of 3
  // FWD start, 1 benched.
  const apiPicks: ApiPick[] = [
    starterPick(1, 1), // GK starter
    starterPick(3, 2),
    starterPick(4, 3),
    starterPick(5, 4),
    starterPick(6, 5), // 4 DEF starters
    starterPick(8, 6),
    starterPick(9, 7),
    starterPick(10, 8, { isCaptain: true }),
    starterPick(11, 9), // 4 MID starters, one captain
    starterPick(13, 10),
    starterPick(14, 11, { isViceCaptain: true }), // 2 FWD starters, one vice-captain
    starterPick(2, 12), // bench GK
    starterPick(7, 13), // bench DEF
    starterPick(12, 14), // bench MID
    starterPick(15, 15), // bench FWD
  ]

  it('assigns squad_position by fixed position blocks (1-2 GK, 3-7 DEF, 8-12 MID, 13-15 FWD)', () => {
    const { rows, missingElementIds } = buildSquadPickRows(apiPicks, playerMap, 7)
    expect(missingElementIds).toEqual([])
    expect(rows).toHaveLength(15)

    const byElement = new Map(rows.map((r) => [r.player_id, r]))
    expect(byElement.get(1)?.squad_position).toBe(1) // GK block starts at 1
    expect(byElement.get(2)?.squad_position).toBe(2)
    expect(byElement.get(3)?.squad_position).toBeGreaterThanOrEqual(3) // DEF block
    expect(byElement.get(3)?.squad_position).toBeLessThanOrEqual(7)
    expect(byElement.get(13)?.squad_position).toBeGreaterThanOrEqual(13) // FWD block
    expect(byElement.get(13)?.squad_position).toBeLessThanOrEqual(15)
  })

  it('sets is_starting from the API pick position (<=11) and bench_order from position-11', () => {
    const { rows } = buildSquadPickRows(apiPicks, playerMap, 7)
    const byElement = new Map(rows.map((r) => [r.player_id, r]))

    expect(byElement.get(1)?.is_starting).toBe(true)
    expect(byElement.get(1)?.bench_order).toBeNull()

    expect(byElement.get(2)?.is_starting).toBe(false) // API position 12
    expect(byElement.get(2)?.bench_order).toBe(1)
    expect(byElement.get(15)?.is_starting).toBe(false) // API position 15
    expect(byElement.get(15)?.bench_order).toBe(4)
  })

  it('carries player_code (resolved from the id->code map) and captaincy through', () => {
    const { rows } = buildSquadPickRows(apiPicks, playerMap, 7)
    const byElement = new Map(rows.map((r) => [r.player_id, r]))
    expect(byElement.get(10)?.player_code).toBe(10000)
    expect(byElement.get(10)?.is_captain).toBe(true)
    expect(byElement.get(14)?.is_vice_captain).toBe(true)
  })

  it('reports missing element ids instead of writing a NOT NULL-violating player_code', () => {
    const incompleteMap = new Map(playerMap)
    incompleteMap.delete(1) // GK1 no longer resolvable
    const { rows, missingElementIds } = buildSquadPickRows(apiPicks, incompleteMap, 7)
    expect(rows).toEqual([])
    expect(missingElementIds).toEqual([1])
  })
})

// ============================================================================
// computeDiff — set-based, independent of squad_position ordering.
// ============================================================================

describe('computeDiff', () => {
  function pick(playerId: number, overrides: Partial<ExistingPickRow> = {}): ExistingPickRow {
    return { player_id: playerId, is_starting: true, is_captain: false, is_vice_captain: false, ...overrides }
  }

  const existing: ExistingPickRow[] = [
    pick(1, { is_captain: true }),
    pick(2, { is_vice_captain: true }),
    pick(3),
    pick(4, { is_starting: false }),
  ]

  it('returns null for an identical squad', () => {
    const apiRows = existing.map((r) => ({
      gameweek_id: 7,
      squad_position: 1,
      player_id: r.player_id,
      player_code: r.player_id * 1000,
      is_starting: r.is_starting,
      bench_order: r.is_starting ? null : 1,
      is_captain: r.is_captain,
      is_vice_captain: r.is_vice_captain,
    }))
    expect(computeDiff(existing, apiRows)).toBeNull()
  })

  it('detects an added and a removed player without flagging unrelated players', () => {
    const apiRows = existing
      .filter((r) => r.player_id !== 4) // player 4 removed
      .map((r) => ({
        gameweek_id: 7,
        squad_position: 1,
        player_id: r.player_id,
        player_code: r.player_id * 1000,
        is_starting: r.is_starting,
        bench_order: null,
        is_captain: r.is_captain,
        is_vice_captain: r.is_vice_captain,
      }))
    apiRows.push({
      gameweek_id: 7,
      squad_position: 1,
      player_id: 5, // player 5 added
      player_code: 5000,
      is_starting: true,
      bench_order: null,
      is_captain: false,
      is_vice_captain: false,
    })

    const diff = computeDiff(existing, apiRows)
    expect(diff).not.toBeNull()
    expect(diff?.addedPlayerIds).toEqual([5])
    expect(diff?.removedPlayerIds).toEqual([4])
  })

  it('detects a captaincy change and a starting/bench move independently', () => {
    const apiRows = existing.map((r) => ({
      gameweek_id: 7,
      squad_position: 1,
      player_id: r.player_id,
      player_code: r.player_id * 1000,
      is_starting: r.player_id === 3 ? false : r.is_starting, // player 3 moved to bench
      bench_order: r.player_id === 3 ? 2 : r.is_starting ? null : 1,
      is_captain: r.player_id === 2, // captain moved from 1 to 2
      is_vice_captain: r.player_id === 1,
    }))
    const diff = computeDiff(existing, apiRows)
    expect(diff).not.toBeNull()
    expect(diff?.captainChanged).toBe(true)
    expect(diff?.viceCaptainChanged).toBe(true)
    expect(diff?.startingChangedPlayerIds).toEqual([3])
    expect(diff?.addedPlayerIds).toEqual([])
    expect(diff?.removedPlayerIds).toEqual([])
  })
})

// ============================================================================
// fetchWithRetry against a local HTTP server — the exact function the real
// script calls for entry/{id}/, history/ and picks/. This is the same
// 404-handling code path scripts/sync-squad.ts exercises live against
// fantasy.premierleague.com every night until the GW1 deadline passes; here
// it's pointed at a controlled server so the 5xx-retry and network-error
// branches are also verifiable without depending on FPL's live uptime.
// ============================================================================

describe('fetchWithRetry', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
    return new Promise((resolve) => {
      server = createServer(handler)
      server.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected server address')
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
  }

  it('returns {status: 404} immediately, without retrying — the picks-not-yet-published path', async () => {
    let requestCount = 0
    const baseUrl = await listen((_req, res) => {
      requestCount++
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'Not found.' }))
    })

    const result = await fetchWithRetry(`${baseUrl}/entry/1/event/1/picks/`)
    expect(result.status).toBe(404)
    expect(requestCount).toBe(1) // no retry burned on a 404
  })

  it('returns a parsed 200 body', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ last_deadline_bank: 5 }))
    })

    const result = await fetchWithRetry(`${baseUrl}/entry/1/`)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ last_deadline_bank: 5 })
  })

  it('retries a 5xx with backoff, then succeeds once the server recovers', async () => {
    let requestCount = 0
    const baseUrl = await listen((_req, res) => {
      requestCount++
      if (requestCount < 3) {
        res.writeHead(503)
        res.end('service unavailable')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    const result = await fetchWithRetry(`${baseUrl}/entry/1/`)
    expect(result.status).toBe(200)
    expect(requestCount).toBe(3)
  })

  it('throws after exhausting all attempts against a host that only ever 5xxs', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(500)
      res.end('always broken')
    })

    await expect(fetchWithRetry(`${baseUrl}/entry/1/`)).rejects.toThrow(/failed after 4 attempts/)
  })
})

// ============================================================================
// resolvePicks — ticket #101's carry-forward look-back. A local HTTP server
// stands in for fantasy.premierleague.com, same style as fetchWithRetry's
// tests above, but with per-path routing so each test controls exactly
// which gameweek's picks/ succeeds. requestLog records the path of every
// request made, so tests can assert precisely how many picks/ calls
// happened and in what order — this is the real fetchWithRetry function
// running against a controlled host, not a mock of it.
// ============================================================================

describe('resolvePicks', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  type Route = { status: number; body?: unknown }

  function listenWithRoutes(routes: Record<string, Route>): Promise<{ baseUrl: string; requestLog: string[] }> {
    const requestLog: string[] = []
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        const path = req.url ?? ''
        requestLog.push(path)
        const route = routes[path]
        if (!route) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ detail: 'Not found.' }))
          return
        }
        res.writeHead(route.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(route.body ?? { detail: 'error' }))
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address === null || typeof address === 'string') throw new Error('unexpected server address')
        resolve({ baseUrl: `http://127.0.0.1:${address.port}`, requestLog })
      })
    })
  }

  it('carries picks forward from gameweek N-1 onto the target gameweek when the target 404s and N-1 returns 200', async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/2/picks/': { status: 404 },
      '/entry/1/event/1/picks/': { status: 200, body: { picks: [{ element: 99 }] } },
    })

    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 2, [1])

    expect(result.outcome).toBe('carried_forward')
    expect(result.sourceGameweekId).toBe(1)
    expect(result.body).toEqual({ picks: [{ element: 99 }] })
    expect(result.lookbackCount).toBe(1)
    expect(result.primaryStatus).toBe(404)
    expect(requestLog).toEqual(['/entry/1/event/2/picks/', '/entry/1/event/1/picks/'])
  })

  it('never runs the look-back when the target itself returns 200 — identical to pre-#101 behaviour', async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/2/picks/': { status: 200, body: { picks: [{ element: 7 }] } },
      // Deliberately no route for gw1 — if the fallback ever fired, this
      // would 404 from the "no route" branch and the assertions below
      // would fail on requestLog / lookbackCount.
    })

    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 2, [1])

    expect(result.outcome).toBe('direct')
    expect(result.sourceGameweekId).toBe(2)
    expect(result.body).toEqual({ picks: [{ element: 7 }] })
    expect(result.lookbackCount).toBe(0)
    expect(requestLog).toEqual(['/entry/1/event/2/picks/']) // fallback never ran
  })

  it('reports not_published with no source gameweek when every candidate in the window 404s', async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/4/picks/': { status: 404 },
      '/entry/1/event/3/picks/': { status: 404 },
      '/entry/1/event/2/picks/': { status: 404 },
      '/entry/1/event/1/picks/': { status: 404 },
    })

    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 4, [3, 2, 1])

    expect(result.outcome).toBe('not_published')
    expect(result.sourceGameweekId).toBeNull()
    expect(result.body).toBeNull()
    expect(result.lookbackCount).toBe(3)
    expect(requestLog).toEqual([
      '/entry/1/event/4/picks/',
      '/entry/1/event/3/picks/',
      '/entry/1/event/2/picks/',
      '/entry/1/event/1/picks/',
    ])
  })

  it('stops at the first 200 and does not check gameweeks further back', async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/5/picks/': { status: 404 },
      '/entry/1/event/4/picks/': { status: 404 },
      '/entry/1/event/3/picks/': { status: 200, body: { picks: [{ element: 3 }] } },
      '/entry/1/event/2/picks/': { status: 200, body: { picks: [{ element: 2 }] } }, // must never be reached
    })

    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 5, [4, 3, 2])

    expect(result.outcome).toBe('carried_forward')
    expect(result.sourceGameweekId).toBe(3)
    expect(result.lookbackCount).toBe(2)
    expect(requestLog).toEqual(['/entry/1/event/5/picks/', '/entry/1/event/4/picks/', '/entry/1/event/3/picks/'])
  })

  it(`never looks back more than MAX_PICKS_LOOKBACK (${MAX_PICKS_LOOKBACK}) gameweeks even when an older candidate would succeed`, async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/10/picks/': { status: 404 },
      '/entry/1/event/9/picks/': { status: 404 },
      '/entry/1/event/8/picks/': { status: 404 },
      '/entry/1/event/7/picks/': { status: 404 },
      '/entry/1/event/6/picks/': { status: 200, body: { picks: [{ element: 6 }] } }, // 4 back — must never be reached
    })

    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 10, [9, 8, 7, 6])

    expect(result.outcome).toBe('not_published')
    expect(result.lookbackCount).toBe(MAX_PICKS_LOOKBACK)
    expect(requestLog).toEqual([
      '/entry/1/event/10/picks/',
      '/entry/1/event/9/picks/',
      '/entry/1/event/8/picks/',
      '/entry/1/event/7/picks/',
    ])
    expect(requestLog).not.toContain('/entry/1/event/6/picks/')
  })

  it('throws when the target picks/ call itself returns a non-404/200 status, rather than treating it as "not published"', async () => {
    const { baseUrl } = await listenWithRoutes({
      '/entry/1/event/2/picks/': { status: 403 },
    })

    await expect(resolvePicks(fetchWithRetry, baseUrl, '1', 2, [1])).rejects.toThrow(/unexpected HTTP 403/)
  })

  it('throws when a look-back candidate returns a non-404/200 status, rather than silently reading it as an empty gameweek', async () => {
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/2/picks/': { status: 404 },
      '/entry/1/event/1/picks/': { status: 403 },
    })

    await expect(resolvePicks(fetchWithRetry, baseUrl, '1', 2, [1])).rejects.toThrow(
      /look-back to gameweek 1 returned unexpected HTTP 403/
    )
    // The bad status was reached (not skipped past) — it just wasn't
    // treated as a normal 404.
    expect(requestLog).toEqual(['/entry/1/event/2/picks/', '/entry/1/event/1/picks/'])
  })

  it('respects the caller-supplied look-back order (nearest-first) rather than resorting it', async () => {
    // main() is responsible for sorting priorGameweekIds nearest-first;
    // resolvePicks trusts the order it's given and just walks it.
    const { baseUrl, requestLog } = await listenWithRoutes({
      '/entry/1/event/5/picks/': { status: 404 },
      '/entry/1/event/3/picks/': { status: 404 },
      '/entry/1/event/4/picks/': { status: 200, body: { picks: [] } },
    })

    // Deliberately out of nearest-first order: 3 before 4.
    const result = await resolvePicks(fetchWithRetry, baseUrl, '1', 5, [3, 4])

    expect(result.sourceGameweekId).toBe(4)
    expect(requestLog).toEqual(['/entry/1/event/5/picks/', '/entry/1/event/3/picks/', '/entry/1/event/4/picks/'])
  })
})

// ============================================================================
// Carry-forward + the existing reconcile path — ticket #101 DoD: a squad
// already stored for the target gameweek must not be silently overwritten
// by a carry-forward. buildSquadPickRows/computeDiff are the exact same
// functions a same-gameweek sync uses; this proves they work unchanged
// when the source picks came from an earlier gameweek than the rows they
// produce (gameweek_id is the *target*, not the source).
// ============================================================================

describe('carry-forward picks reconciled through the existing (unmodified) reconcile path', () => {
  const elementTypeByElement: Record<number, PlayerInfo['elementType']> = {
    1: 1,
    2: 1,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 3,
    9: 3,
    10: 3,
    11: 3,
    12: 3,
    13: 4,
    14: 4,
    15: 4,
  }
  const playerMap = new Map<number, PlayerInfo>(
    Object.entries(elementTypeByElement).map(([id, elementType]) => [Number(id), { code: Number(id) * 1000, elementType }])
  )

  function starterPick(element: number, position: number, overrides: Partial<ApiPick> = {}): ApiPick {
    return { element, position, isCaptain: false, isViceCaptain: false, ...overrides }
  }

  // A gameweek-1 squad (the carry-forward source) — used to build rows
  // tagged with gameweek 2 (the target), exactly as main() does: apiPicks
  // come from an earlier gameweek, but buildSquadPickRows is called with
  // the *target*'s gameweekId.
  const gw1ApiPicks: ApiPick[] = [
    starterPick(1, 1),
    starterPick(3, 2),
    starterPick(4, 3),
    starterPick(5, 4),
    starterPick(6, 5),
    starterPick(8, 6),
    starterPick(9, 7),
    starterPick(10, 8, { isCaptain: true }),
    starterPick(11, 9),
    starterPick(13, 10),
    starterPick(14, 11, { isViceCaptain: true }),
    starterPick(2, 12),
    starterPick(7, 13),
    starterPick(12, 14),
    starterPick(15, 15),
  ]

  it('builds 15 rows tagged with the TARGET gameweek id even though the picks came from an earlier gameweek', () => {
    const targetGameweekId = 2
    const { rows, missingElementIds } = buildSquadPickRows(gw1ApiPicks, playerMap, targetGameweekId)
    expect(missingElementIds).toEqual([])
    expect(rows).toHaveLength(15)
    expect(rows.every((r) => r.gameweek_id === targetGameweekId)).toBe(true)
  })

  it('detects a difference (and would not overwrite) when the target gameweek already has a different stored squad', () => {
    const targetGameweekId = 2
    const { rows: carriedForwardRows } = buildSquadPickRows(gw1ApiPicks, playerMap, targetGameweekId)

    // A squad already on file for gameweek 2 (manual entry, or an earlier
    // run) that differs from the gw1 carry-forward by one transfer:
    // player 15 (bench FWD) swapped for player 16.
    const existingForTarget: ExistingPickRow[] = carriedForwardRows
      .filter((r) => r.player_id !== 15)
      .map((r) => ({ player_id: r.player_id, is_starting: r.is_starting, is_captain: r.is_captain, is_vice_captain: r.is_vice_captain }))
    existingForTarget.push({ player_id: 16, is_starting: false, is_captain: false, is_vice_captain: false })

    const diff = computeDiff(existingForTarget, carriedForwardRows)
    expect(diff).not.toBeNull()
    expect(diff?.addedPlayerIds).toEqual([15])
    expect(diff?.removedPlayerIds).toEqual([16])
    // The reconcile path only ever *reports* the diff (main() does not
    // call any insert/update here) — this test documents that computeDiff
    // is the single source of truth for "is this a difference", exactly as
    // it is for a same-gameweek sync.
  })

  it('finds no difference when the target gameweek already holds exactly the carried-forward squad', () => {
    const targetGameweekId = 2
    const { rows: carriedForwardRows } = buildSquadPickRows(gw1ApiPicks, playerMap, targetGameweekId)
    const existingForTarget: ExistingPickRow[] = carriedForwardRows.map((r) => ({
      player_id: r.player_id,
      is_starting: r.is_starting,
      is_captain: r.is_captain,
      is_vice_captain: r.is_vice_captain,
    }))

    expect(computeDiff(existingForTarget, carriedForwardRows)).toBeNull()
  })
})

// ============================================================================
// job_runs.message wording — ticket #101 DoD: "the job's job_runs.message
// says in words that the squad was carried forward from gameweek N, rather
// than reporting a normal sync." Each function is a drop-in replacement
// for the pre-#101 message at that call site, so the 'direct' outcome must
// reproduce the exact old wording, and 'carried_forward' must name the
// source gameweek.
// ============================================================================

describe('carry-forward message wording', () => {
  const directLookup: PicksLookupResult = {
    outcome: 'direct',
    body: { picks: [] },
    url: 'https://fantasy.premierleague.com/api/entry/12345/event/2/picks/',
    sourceGameweekId: 2,
    lookbackCount: 0,
    primaryStatus: 200,
  }
  const carriedForwardLookup: PicksLookupResult = {
    outcome: 'carried_forward',
    body: { picks: [] },
    url: 'https://fantasy.premierleague.com/api/entry/12345/event/1/picks/',
    sourceGameweekId: 1,
    lookbackCount: 1,
    primaryStatus: 404,
  }
  const notPublishedLookup: PicksLookupResult = {
    outcome: 'not_published',
    body: null,
    url: null,
    sourceGameweekId: null,
    lookbackCount: 3,
    primaryStatus: 404,
  }

  it('picksEstablishedMessage reproduces the pre-#101 wording byte-for-byte for a direct (target 200) sync', () => {
    expect(picksEstablishedMessage(2, '12345', directLookup, '')).toBe(
      'sync-squad: squad for gameweek 2 established from FPL for entry 12345 (15 picks written).'
    )
  })

  it('picksEstablishedMessage names the source gameweek in words for a carried-forward sync', () => {
    const message = picksEstablishedMessage(2, '12345', carriedForwardLookup, '')
    expect(message).toContain('carried forward from gameweek 1')
    expect(message).not.toContain('established from FPL for entry')
  })

  it('picksConfirmedMessage reproduces the pre-#101 wording byte-for-byte for a direct sync', () => {
    expect(picksConfirmedMessage(2, '12345', directLookup, '')).toBe(
      'sync-squad: squad for gameweek 2 confirmed against FPL for entry 12345 — no changes.'
    )
  })

  it('picksConfirmedMessage names the source gameweek in words for a carried-forward sync', () => {
    expect(picksConfirmedMessage(2, '12345', carriedForwardLookup, '')).toContain('carried-forward picks')
  })

  it('picksDiffMessage reproduces the pre-#101 wording byte-for-byte for a direct sync', () => {
    expect(picksDiffMessage(2, '12345', directLookup, '1 player(s) added', '')).toBe(
      'sync-squad: squad for gameweek 2 differs from FPL (entry 12345) — not overwritten. 1 player(s) added.'
    )
  })

  it('picksDiffMessage names the source gameweek in words for a carried-forward sync', () => {
    expect(picksDiffMessage(2, '12345', carriedForwardLookup, '1 player(s) added', '')).toContain(
      "gameweek 1's carried-forward picks"
    )
  })

  it('picksNotPublishedMessage says picks are not published and, when a look-back happened, says none were found', () => {
    const message = picksNotPublishedMessage('12345', 2, notPublishedLookup, '')
    expect(message).toContain('picks not yet published')
    expect(message).toContain('Checked the preceding 3 gameweek(s)')
  })

  it('picksNotPublishedMessage omits the look-back note when no look-back ran (e.g. gameweek 1, no prior gameweeks exist)', () => {
    const noLookback: PicksLookupResult = { ...notPublishedLookup, lookbackCount: 0 }
    const message = picksNotPublishedMessage('12345', 2, noLookback, '')
    expect(message).not.toContain('Checked the preceding')
    expect(message).toBe(
      'sync-squad: picks not yet published for entry 12345, event 2 (404 from entry/12345/event/2/picks/). ' +
        'Entry-level state (bank, squad value, transfers, chips, points, rank) synced; existing squad picks left untouched.'
    )
  })
})

// ============================================================================
// Tier 1 boundary — grep-checkable per the DoD. This is a regression guard,
// not a substitute for actually reading the diff: it fails loudly if any
// future edit to this file introduces an authenticated-endpoint string.
// ============================================================================

describe('Tier 1 boundary — this file must never cross it', () => {
  const sourcePath = fileURLToPath(new URL('./sync-squad.ts', import.meta.url))
  const source = readFileSync(sourcePath, 'utf8')

  it.each(['my-team', 'login', 'cookie', 'Authorization'])('never contains the string "%s"', (forbidden) => {
    expect(source).not.toContain(forbidden)
  })

  it('still calls exactly the three public endpoints named in the file header', () => {
    expect(source).toContain('/entry/${entryId}/`')
    expect(source).toContain('/entry/${entryId}/history/`')
    expect(source).toContain('/entry/${entryId}/event/${')
  })
})
