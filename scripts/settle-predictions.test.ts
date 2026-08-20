// Unit tests for scripts/settle-predictions.ts's pure functions — ticket #73. No live Supabase
// (none is available to this Builder's session — see decisions/ticket-73.md for what was
// verified against the real FPL API instead: a direct curl of event/1/live/, confirmed live and
// returning HTTP 200 with `{"elements":[]}` and HTTP 404 for an out-of-range id). fetchLiveJson's
// retry/error branching IS exercised here against a local HTTP server (no external dependency),
// matching scripts/sync-squad.test.ts's identical precedent for fetchWithRetry.

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSettlementRows,
  computeAggregateErrorStats,
  computeError,
  decideGameweekEligibility,
  fetchLiveJson,
  parseLiveActuals,
  SettleError,
  validateLiveShape,
  type UnsettledPredictionRow,
} from './settle-predictions.ts'

const MINUTE_MS = 60 * 1000

// ============================================================================
// computeError — signed, actual - projected.
// ============================================================================

describe('computeError', () => {
  it('is positive when actual exceeds projected — the model under-projected', () => {
    expect(computeError(12, 5)).toBe(7)
  })

  it('is negative when actual falls short of projected — the model over-projected', () => {
    expect(computeError(2, 8)).toBe(-6)
  })

  it('is zero for a perfectly calibrated projection', () => {
    expect(computeError(6, 6)).toBe(0)
  })
})

// ============================================================================
// computeAggregateErrorStats
// ============================================================================

describe('computeAggregateErrorStats', () => {
  it('computes mean absolute and mean signed error over a mix of over/under projections', () => {
    // errors: +7, -6, +1 -> signed mean (7-6+1)/3 = 0.666..., absolute mean (7+6+1)/3 = 4.666...
    const stats = computeAggregateErrorStats([7, -6, 1])
    expect(stats.meanSignedError).toBeCloseTo(0.6667, 3)
    expect(stats.meanAbsoluteError).toBeCloseTo(4.6667, 3)
  })

  it('reveals systematic bias that mean absolute error alone hides — all-negative errors average to a negative signed mean but a positive absolute mean', () => {
    const stats = computeAggregateErrorStats([-3, -5, -4])
    expect(stats.meanSignedError).toBeCloseTo(-4, 5)
    expect(stats.meanAbsoluteError).toBeCloseTo(4, 5)
  })

  it('returns null (not 0) for an empty error set', () => {
    const stats = computeAggregateErrorStats([])
    expect(stats.meanAbsoluteError).toBeNull()
    expect(stats.meanSignedError).toBeNull()
  })
})

// ============================================================================
// decideGameweekEligibility — the lockdown rule's settlement-specific wrapper.
// scripts/lib/lockdown.test.ts already covers the underlying boundary/BST arithmetic in detail;
// these tests cover the "finished" gate and the no-fixtures guard this wrapper adds.
// ============================================================================

describe('decideGameweekEligibility — not finished', () => {
  it('is ineligible for an unfinished gameweek regardless of how much time has passed', () => {
    const result = decideGameweekEligibility({
      gameweekId: 5,
      finished: false,
      fixtureKickoffIsos: ['2020-01-01T12:00:00Z'], // long, long past lockdown if it counted
      nowMs: Date.parse('2026-08-20T00:00:00Z'),
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/not marked finished/)
  })
})

describe('decideGameweekEligibility — finished but before lockdown', () => {
  it('is ineligible one minute before the lockdown instant', () => {
    const kickoff = '2026-12-12T15:00:00Z' // GMT -> lockdown 2026-12-13T09:00:00Z
    const lockdownMs = Date.UTC(2026, 11, 13, 9, 0, 0)
    const result = decideGameweekEligibility({
      gameweekId: 5,
      finished: true,
      fixtureKickoffIsos: [kickoff],
      nowMs: lockdownMs - MINUTE_MS,
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/lockdown/)
    expect(result.reason).toMatch(/has not passed yet/)
  })
})

describe('decideGameweekEligibility — finished and past lockdown', () => {
  it('is eligible one minute after the lockdown instant', () => {
    const kickoff = '2026-12-12T15:00:00Z'
    const lockdownMs = Date.UTC(2026, 11, 13, 9, 0, 0)
    const result = decideGameweekEligibility({
      gameweekId: 5,
      finished: true,
      fixtureKickoffIsos: [kickoff],
      nowMs: lockdownMs + MINUTE_MS,
    })
    expect(result.eligible).toBe(true)
    expect(result.reason).toMatch(/is finished and past its/)
  })
})

describe('decideGameweekEligibility — finished but no fixtures to anchor a lockdown instant', () => {
  it('is ineligible rather than throwing', () => {
    const result = decideGameweekEligibility({
      gameweekId: 5,
      finished: true,
      fixtureKickoffIsos: [],
      nowMs: Date.parse('2026-08-20T00:00:00Z'),
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/no fixture kickoff times/)
  })
})

// ============================================================================
// validateLiveShape
// ============================================================================

describe('validateLiveShape', () => {
  it('accepts a well-formed response', () => {
    expect(() => validateLiveShape({ elements: [] }, 'url')).not.toThrow()
  })

  it('throws SettleError when the response is not a JSON object', () => {
    expect(() => validateLiveShape([], 'url')).toThrow(SettleError)
    expect(() => validateLiveShape('oops', 'url')).toThrow(SettleError)
  })

  it('throws SettleError when "elements" is missing or not an array', () => {
    expect(() => validateLiveShape({}, 'url')).toThrow(/elements/)
    expect(() => validateLiveShape({ elements: 'nope' }, 'url')).toThrow(/elements/)
  })
})

// ============================================================================
// parseLiveActuals — the source of "left unsettled, not settled as zero".
// ============================================================================

describe('parseLiveActuals', () => {
  it('parses a real-shaped element with numeric stats', () => {
    const map = parseLiveActuals([{ id: 101, stats: { total_points: 9, minutes: 90 } }])
    expect(map.get(101)).toEqual({ points: 9, minutes: 90 })
  })

  it('includes a genuine, measured zero — a player who featured for zero points is settled, not skipped', () => {
    const map = parseLiveActuals([{ id: 202, stats: { total_points: 0, minutes: 90 } }])
    expect(map.get(202)).toEqual({ points: 0, minutes: 90 })
  })

  it('excludes an element with a missing "stats" object entirely', () => {
    const map = parseLiveActuals([{ id: 303 }])
    expect(map.has(303)).toBe(false)
  })

  it('excludes an element whose stats.total_points is missing', () => {
    const map = parseLiveActuals([{ id: 404, stats: { minutes: 90 } }])
    expect(map.has(404)).toBe(false)
  })

  it('excludes an element whose stats.total_points is non-numeric', () => {
    const map = parseLiveActuals([{ id: 505, stats: { total_points: 'DNP', minutes: 0 } }])
    expect(map.has(505)).toBe(false)
  })

  it('excludes an element with a missing or non-numeric "id"', () => {
    const map = parseLiveActuals([{ stats: { total_points: 3, minutes: 90 } }, { id: 'abc', stats: { total_points: 3, minutes: 90 } }])
    expect(map.size).toBe(0)
  })

  it('carries a null minutes through rather than fabricating one, when only total_points is present', () => {
    const map = parseLiveActuals([{ id: 606, stats: { total_points: 2 } }])
    expect(map.get(606)).toEqual({ points: 2, minutes: null })
  })
})

// ============================================================================
// buildSettlementRows
// ============================================================================

function makeRow(overrides: Partial<UnsettledPredictionRow> = {}): UnsettledPredictionRow {
  return {
    gameweek_id: 5,
    player_id: 101,
    model_version: 'baseline-v1',
    player_code: 5001,
    projected_points: 4.5,
    projected_minutes: 82,
    components: { playerLevel: {} },
    captured_at: '2026-08-15T10:00:00Z',
    settled_at: null,
    ...overrides,
  }
}

const SETTLED_AT_ISO = '2026-08-22T09:00:00Z'

describe('buildSettlementRows — settles a row with a matching actual', () => {
  it('writes actual_points, actual_minutes, settled_at and a correctly signed error', () => {
    const row = makeRow({ player_id: 101, projected_points: 4.5 })
    const actuals = new Map([[101, { points: 9, minutes: 90 }]])
    const result = buildSettlementRows([row], actuals, SETTLED_AT_ISO)

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({
      gameweek_id: 5,
      player_id: 101,
      model_version: 'baseline-v1',
      actual_points: 9,
      actual_minutes: 90,
      settled_at: SETTLED_AT_ISO,
      error: 4.5, // 9 - 4.5
    })
    expect(result.settledPlayerIds).toEqual([101])
    expect(result.errors).toEqual([4.5])
  })

  it('preserves projected_points/projected_minutes/components/player_code/captured_at unchanged, since upsert requires every NOT NULL column', () => {
    const row = makeRow({ projected_points: 6, projected_minutes: 70, player_code: 999, components: { x: 1 }, captured_at: '2026-08-15T10:00:00Z' })
    const actuals = new Map([[101, { points: 3, minutes: 45 }]])
    const result = buildSettlementRows([row], actuals, SETTLED_AT_ISO)
    expect(result.updates[0]).toMatchObject({
      projected_points: 6,
      projected_minutes: 70,
      player_code: 999,
      components: { x: 1 },
      captured_at: '2026-08-15T10:00:00Z',
    })
  })
})

describe('buildSettlementRows — a player with no actual available is left unsettled, not settled as zero', () => {
  it('does not appear in updates, and is reported separately from a genuine zero', () => {
    const noActualRow = makeRow({ player_id: 202 })
    const zeroActualRow = makeRow({ player_id: 303, projected_points: 2 })
    const actuals = new Map([[303, { points: 0, minutes: 0 }]]) // 202 absent entirely
    const result = buildSettlementRows([noActualRow, zeroActualRow], actuals, SETTLED_AT_ISO)

    expect(result.unsettledPlayerIds).toEqual([202])
    expect(result.settledPlayerIds).toEqual([303])
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({ player_id: 303, actual_points: 0, error: -2 })
  })
})

describe('buildSettlementRows — an already-settled row is not re-settled', () => {
  it('skips a row whose settled_at is already non-null, even when a matching actual is supplied', () => {
    const alreadySettledRow = makeRow({ player_id: 404, settled_at: '2026-08-21T09:00:00Z' })
    const actuals = new Map([[404, { points: 10, minutes: 90 }]])
    const result = buildSettlementRows([alreadySettledRow], actuals, SETTLED_AT_ISO)

    expect(result.updates).toHaveLength(0)
    expect(result.settledPlayerIds).toEqual([])
    expect(result.alreadySettledPlayerIds).toEqual([404])
  })

  it('leaves an unrelated unsettled row in the same batch unaffected', () => {
    const alreadySettledRow = makeRow({ player_id: 404, settled_at: '2026-08-21T09:00:00Z' })
    const freshRow = makeRow({ player_id: 505, projected_points: 3 })
    const actuals = new Map([
      [404, { points: 10, minutes: 90 }],
      [505, { points: 5, minutes: 90 }],
    ])
    const result = buildSettlementRows([alreadySettledRow, freshRow], actuals, SETTLED_AT_ISO)

    expect(result.alreadySettledPlayerIds).toEqual([404])
    expect(result.settledPlayerIds).toEqual([505])
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({ player_id: 505, error: 2 })
  })
})

// ============================================================================
// fetchLiveJson — exercised against a local HTTP server, same approach as
// scripts/sync-squad.test.ts's fetchWithRetry tests. Uses the real retry/backoff code path,
// just pointed at a controlled host instead of fantasy.premierleague.com.
// ============================================================================

describe('fetchLiveJson', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    server = undefined
  })

  function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
    return new Promise((resolve) => {
      server = createServer(handler)
      server.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (address && typeof address === 'object') {
          resolve(`http://127.0.0.1:${address.port}`)
        }
      })
    })
  }

  it('returns the parsed JSON body on a 200 response', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ elements: [{ id: 1, stats: { total_points: 5, minutes: 90 } }] }))
    })
    const result = await fetchLiveJson(url)
    expect(result).toEqual({ elements: [{ id: 1, stats: { total_points: 5, minutes: 90 } }] })
  })

  it('fails immediately on a 404 without retrying', async () => {
    let requestCount = 0
    const url = await listen((_req, res) => {
      requestCount++
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'No Event matches the given query.' }))
    })
    await expect(fetchLiveJson(url)).rejects.toThrow(SettleError)
    expect(requestCount).toBe(1)
  })

  it('retries on a 500 and eventually succeeds', async () => {
    let requestCount = 0
    const url = await listen((_req, res) => {
      requestCount++
      if (requestCount < 3) {
        res.writeHead(500)
        res.end('server error')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ elements: [] }))
    })
    const result = await fetchLiveJson(url)
    expect(result).toEqual({ elements: [] })
    expect(requestCount).toBe(3)
  })
})
