// Unit tests for scripts/send-telegram.ts's pure/testable functions —
// ticket #55. No live Supabase project and no real Telegram bot: Telegram
// sends are exercised against `fetchImpl` injection (a local fake, never a
// real request to api.telegram.org — unreachable from this sandbox anyway,
// see this ticket's own Notes), and the env-check/gameweek-selection logic
// is pure and needs no I/O at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPlanSnapshot,
  determineCurrentGameweekId,
  main,
  readTelegramEnv,
  runSend,
  sendTelegramMessage,
  type GameweekRow,
  type PlanSnapshot,
  type RecommendationRowForSnapshot,
  type TelegramEnv,
} from './send-telegram.js'
import { applyWindowMarker, composeCurrentMessage } from '../src/lib/notification/index.ts'

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
}

// ============================================================================
// readTelegramEnv — the DoD's own three named cases, same contract as
// scripts/sync-squad.ts's unset-FPL_ENTRY_ID path: log the missing
// variable(s), return null, make no request.
// ============================================================================

describe('readTelegramEnv', () => {
  beforeEach(resetEnv)
  afterEach(resetEnv)

  it('both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID unset: returns null and names both missing variables', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = readTelegramEnv()
    expect(result).toBeNull()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_BOT_TOKEN'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_CHAT_ID'))
    logSpy.mockRestore()
  })

  it('TELEGRAM_BOT_TOKEN set, TELEGRAM_CHAT_ID unset ("token only"): returns null and names only the chat id as missing', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = readTelegramEnv()
    expect(result).toBeNull()
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('TELEGRAM_CHAT_ID')
    expect(logged).not.toContain('missing: TELEGRAM_BOT_TOKEN,')
    logSpy.mockRestore()
  })

  it('TELEGRAM_CHAT_ID set, TELEGRAM_BOT_TOKEN unset ("chat id only"): returns null and names only the bot token as missing', () => {
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = readTelegramEnv()
    expect(result).toBeNull()
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('TELEGRAM_BOT_TOKEN')
    logSpy.mockRestore()
  })

  it('both set: returns the values, trimmed of nothing extra, with no console output', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token'
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    const result = readTelegramEnv()
    expect(result).toEqual({ botToken: 'unit-test-token', chatId: 'unit-test-chat' })
  })

  it('blank-but-set values are treated the same as unset', () => {
    process.env.TELEGRAM_BOT_TOKEN = '   '
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    expect(readTelegramEnv()).toBeNull()
  })
})

// ============================================================================
// main() — with Telegram env unset, makes NO network call of any kind,
// including to Supabase. Proven here by spying on global fetch (which both
// Supabase's client and the Telegram send would use) and confirming it is
// never invoked, then confirming main() resolves without throwing.
// ============================================================================

describe('main() with Telegram env unset', () => {
  beforeEach(resetEnv)
  afterEach(resetEnv)

  it('makes no network request at all when both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main()).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('makes no network request at all when only TELEGRAM_BOT_TOKEN is set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main()).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('makes no network request at all when only TELEGRAM_CHAT_ID is set', async () => {
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main()).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    fetchSpy.mockRestore()
  })
})

// ============================================================================
// determineCurrentGameweekId
// ============================================================================

describe('determineCurrentGameweekId', () => {
  const gws: GameweekRow[] = [
    { id: 1, deadline_time: '2026-08-22T01:30:00Z' },
    { id: 2, deadline_time: '2026-08-29T01:30:00Z' },
    { id: 3, deadline_time: '2026-09-05T01:30:00Z' },
  ]

  it('picks the next gameweek whose deadline has not yet passed', () => {
    const now = new Date('2026-08-23T00:00:00Z').getTime() // after gw1's deadline, before gw2's
    expect(determineCurrentGameweekId(gws, now)).toBe(2)
  })

  it('falls back to the last known gameweek once every deadline has passed', () => {
    const now = new Date('2026-12-01T00:00:00Z').getTime()
    expect(determineCurrentGameweekId(gws, now)).toBe(3)
  })

  it('picks the very first gameweek before any deadline has passed', () => {
    const now = new Date('2026-01-01T00:00:00Z').getTime()
    expect(determineCurrentGameweekId(gws, now)).toBe(1)
  })

  it('does not assume input rows arrive pre-sorted', () => {
    const shuffled = [gws[2], gws[0], gws[1]]
    const now = new Date('2026-08-23T00:00:00Z').getTime()
    expect(determineCurrentGameweekId(shuffled, now)).toBe(2)
  })
})

// ============================================================================
// sendTelegramMessage — retry/backoff and error-text extraction, all
// against an injected fetchImpl. No real network call is ever made.
// ============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('sendTelegramMessage', () => {
  it('succeeds on the first attempt against a 200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: {} }))
    const result = await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, baseDelayMs: 1 })
    expect(result).toEqual({ ok: true, status: 200, errorText: null, attempts: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries after a network error and succeeds on the second attempt', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const result = await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, baseDelayMs: 1 })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('extracts Telegram\'s own error description from a non-2xx JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }))
    const result = await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, maxAttempts: 1, baseDelayMs: 1 })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.errorText).toBe('Bad Request: chat not found')
  })

  it('fails loudly after at most 3 attempts — no retry storm', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, description: 'Internal Server Error' }))
    const result = await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, baseDelayMs: 1 })
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('reports a network-error status as null with the underlying message, after exhausting attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed: getaddrinfo ENOTFOUND api.telegram.org'))
    const result = await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, baseDelayMs: 1 })
    expect(result.ok).toBe(false)
    expect(result.status).toBeNull()
    expect(result.errorText).toContain('ENOTFOUND')
  })

  it('never sends the bot token or chat id anywhere but the request it builds — the URL is assembled from the given params, not a hardcoded string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    await sendTelegramMessage({ botToken: 'unit-test-token', chatId: 'unit-test-chat', text: 'hello', fetchImpl, baseDelayMs: 1 })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botunit-test-token/sendMessage')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: 'unit-test-chat', text: 'hello' })
  })
})

// ============================================================================
// runSend — trigger-scoped duplicate suppression (ticket #90's own DoD).
// A minimal fake Postgrest layer, same convention as
// src/lib/verdict/api.test.ts's own fakeFrom: filtering happens INSIDE the
// fake "server" layer so a query that forgot a filter really does get rows
// back it should not have. Covers every table runSend() touches for a
// 'current' recommendation send (gameweeks, recommendations,
// recommendation_reasons, solver_runs, notifications, job_runs); no live
// Supabase project and no real Telegram bot — `fetch` itself is mocked, api.
// telegram.org is unreachable from this sandbox regardless (this ticket's
// own Notes).
// ============================================================================

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let tables: Tables = {}

function resetTables(overrides: Partial<Tables> = {}): void {
  tables = { gameweeks: [], recommendations: [], recommendation_reasons: [], solver_runs: [], notifications: [], job_runs: [], ...overrides }
}

function fakeFrom(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let isCountHead = false
  let single = false
  // Real supabase-js exposes an unawaited query builder's clauses via
  // `url.searchParams` (see scripts/lib/paginate.ts's ordering guard, ticket
  // #152) -- this fake reproduces just that one detail so `order()` calls
  // here actually register, rather than every fake query silently tripping
  // the guard's fail-closed path.
  const url = new URL(`https://example.supabase.co/rest/v1/${table}`)

  const builder = {
    url,
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) isCountHead = true
      return builder
    },
    eq(col: string, val: unknown) {
      filters.push((row) => row[col] === val)
      return builder
    },
    in(col: string, vals: readonly unknown[]) {
      filters.push((row) => vals.includes(row[col]))
      return builder
    },
    order(column: string, opts?: { ascending?: boolean; referencedTable?: string; foreignTable?: string }) {
      const referencedTable = opts?.referencedTable ?? opts?.foreignTable
      const key = referencedTable ? `${referencedTable}.order` : 'order'
      const existing = url.searchParams.get(key)
      url.searchParams.set(key, `${existing ? `${existing},` : ''}${column}.${opts?.ascending === false ? 'desc' : 'asc'}`)
      return builder
    },
    range() {
      return builder
    },
    limit() {
      return builder
    },
    returns() {
      return builder
    },
    maybeSingle() {
      single = true
      return builder
    },
    insert(payload: Row) {
      return {
        then(resolve: (result: { error: null }) => void) {
          const rows = tables[table] ?? (tables[table] = [])
          rows.push({ id: rows.length + 1, ...payload })
          resolve({ error: null })
        },
      }
    },
    then(resolve: (result: { data: unknown; error: null; count?: number }) => void) {
      const rows = tables[table] ?? []
      const matched = rows.filter((row) => filters.every((f) => f(row)))
      if (isCountHead) {
        resolve({ data: null, error: null, count: matched.length })
        return
      }
      if (single) {
        resolve({ data: matched[0] ?? null, error: null })
        return
      }
      resolve({ data: matched, error: null })
    },
  }
  return builder
}

const fakeSupabase = { from: (table: string) => fakeFrom(table) }

function futureIsoDate(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()
}

const UNIT_TEST_TELEGRAM_ENV: TelegramEnv = { botToken: 'unit-test-token', chatId: 'unit-test-chat' }
const ROLL_HEADLINE = 'Roll your transfer. No changes recommended this gameweek.'

describe('runSend — trigger-scoped duplicate suppression (ticket #90)', () => {
  beforeEach(() => {
    resetTables({
      gameweeks: [{ id: 9, deadline_time: futureIsoDate(72) }],
      recommendations: [{ gameweek_id: 9, plan_index: 0, solver_run_id: 1 }],
      recommendation_reasons: [{ gameweek_id: 9, plan_index: 0, order_index: 0, reason: ROLL_HEADLINE }],
      solver_runs: [{ id: 1, solver_status: 'Optimal' }],
    })
  })

  it('a stored deadline_24h row whose text is byte-identical to the pending deadline_10h message does NOT suppress the 10h send; a second, same-trigger send with that same text then IS suppressed', async () => {
    // The exact text runSend() will independently compute for a deadline_10h
    // send of this fixture recommendation — precomputed here from the same
    // pure functions runSend() itself calls, so this test proves the
    // trigger-scoped query, not a coincidence of wording.
    const tenHourMessage = applyWindowMarker(
      composeCurrentMessage({ reasonLines: [ROLL_HEADLINE], planB: null, solverStatus: { isOptimal: true, status: 'Optimal' } }),
      'deadline_10h',
    )

    // Fabricate the collision that used to swallow GW1's real 10h reminder:
    // a successful 24h send recorded with text byte-identical to what the
    // 10h send is about to produce.
    tables.notifications.push({ id: 1, gameweek_id: 9, outcome: 'sent', trigger: 'deadline_24h', message_text: tenHourMessage })

    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const firstOutcome = await runSend('deadline_10h', fakeSupabase as unknown as SupabaseClient, UNIT_TEST_TELEGRAM_ENV, new Date())

    expect(firstOutcome).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const sentDeadline10hRows = tables.notifications.filter((r) => r.trigger === 'deadline_10h' && r.outcome === 'sent')
    expect(sentDeadline10hRows).toHaveLength(1)
    expect(sentDeadline10hRows[0].message_text).toBe(tenHourMessage)

    // A second deadline_10h attempt now finds ITS OWN trigger's row already
    // sent with identical text — this one IS suppressed.
    const secondOutcome = await runSend('deadline_10h', fakeSupabase as unknown as SupabaseClient, UNIT_TEST_TELEGRAM_ENV, new Date())

    logSpy.mockRestore()
    fetchSpy.mockRestore()

    expect(secondOutcome).toBe('skipped')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no second Telegram call
    expect(tables.notifications.filter((r) => r.trigger === 'deadline_10h' && r.outcome === 'sent')).toHaveLength(1) // no second row
  })

  it('sanity check: the fabricated 24h/10h text collision above is real — the same recommendation composes byte-identical text for both windows before the marker is applied', () => {
    const base = composeCurrentMessage({ reasonLines: [ROLL_HEADLINE], planB: null, solverStatus: { isOptimal: true, status: 'Optimal' } })
    expect(applyWindowMarker(base, 'deadline_24h').endsWith(base)).toBe(true)
    expect(applyWindowMarker(base, 'deadline_10h').endsWith(base)).toBe(true)
  })
})

// ============================================================================
// buildPlanSnapshot — ticket #231, pure — no I/O. Player CODE throughout,
// never player_id (deltas.md D9).
// ============================================================================

describe('buildPlanSnapshot (ticket #231)', () => {
  const TRANSFER_ROW: RecommendationRowForSnapshot = {
    gameweek_id: 9,
    plan_index: 0,
    is_roll: false,
    transfer_in_player_id: 101,
    transfer_in_player_code: 5001,
    transfer_out_player_id: 102,
    transfer_out_player_code: 5002,
    captain_player_code: 5001,
    vice_captain_player_code: 5003,
    starting_xi: [
      { playerId: 101, playerCode: 5001 },
      { playerId: 103, playerCode: 5003 },
    ],
    bench_order: [{ playerId: 104, playerCode: 5004 }],
    hit_cost: 4,
    net_points: 55.5,
    confidence_band: 'marginal',
  }

  it('carries player codes and names for the transfer in/out, codes only for captain/vice-captain and the XI/bench, plus the model version', () => {
    const snapshot = buildPlanSnapshot(TRANSFER_ROW, { transferInName: 'Palmer', transferOutName: 'Saka' }, 'baseline-v1')
    const expected: PlanSnapshot = {
      gameweekId: 9,
      planIndex: 0,
      modelVersion: 'baseline-v1',
      isRoll: false,
      transferIn: { code: 5001, name: 'Palmer' },
      transferOut: { code: 5002, name: 'Saka' },
      captainPlayerCode: 5001,
      viceCaptainPlayerCode: 5003,
      startingXi: [5001, 5003],
      benchOrder: [5004],
      hitCost: 4,
      expectedPoints: 55.5,
      confidenceBand: 'marginal',
    }
    expect(snapshot).toEqual(expected)
  })

  it('a roll plan (no transfer) snapshots null transferIn/transferOut, never a fabricated player', () => {
    const rollRow: RecommendationRowForSnapshot = {
      ...TRANSFER_ROW,
      is_roll: true,
      transfer_in_player_id: null,
      transfer_in_player_code: null,
      transfer_out_player_id: null,
      transfer_out_player_code: null,
    }
    const snapshot = buildPlanSnapshot(rollRow, { transferInName: null, transferOutName: null }, 'baseline-v1')
    expect(snapshot.isRoll).toBe(true)
    expect(snapshot.transferIn).toBeNull()
    expect(snapshot.transferOut).toBeNull()
  })

  it('never fabricates a transfer name when the code is present but the name lookup came back empty', () => {
    const snapshot = buildPlanSnapshot(TRANSFER_ROW, { transferInName: null, transferOutName: null }, 'baseline-v1')
    expect(snapshot.transferIn).toBeNull()
    expect(snapshot.transferOut).toBeNull()
  })
})

// ============================================================================
// runSend + plan_snapshot — ticket #231's own named tests: written on a
// successful send, and written on a failed send too (a failed Telegram
// delivery is still a recommendation the model produced).
// ============================================================================

describe('runSend records plan_snapshot on the notifications row (ticket #231)', () => {
  const SNAPSHOT_HEADLINE = 'Transfer Saka out, Palmer in.'

  beforeEach(() => {
    resetTables({
      gameweeks: [{ id: 9, deadline_time: futureIsoDate(72) }],
      recommendations: [
        {
          gameweek_id: 9,
          plan_index: 0,
          solver_run_id: 1,
          is_roll: false,
          transfer_in_player_id: 101,
          transfer_in_player_code: 5001,
          transfer_out_player_id: 102,
          transfer_out_player_code: 5002,
          captain_player_code: 5001,
          vice_captain_player_code: 5003,
          starting_xi: [
            { playerId: 101, playerCode: 5001 },
            { playerId: 103, playerCode: 5003 },
          ],
          bench_order: [{ playerId: 104, playerCode: 5004 }],
          hit_cost: 4,
          net_points: 55.5,
          confidence_band: 'marginal',
        },
      ],
      recommendation_reasons: [{ gameweek_id: 9, plan_index: 0, order_index: 0, reason: SNAPSHOT_HEADLINE }],
      solver_runs: [{ id: 1, solver_status: 'Optimal' }],
      players: [
        { id: 101, web_name: 'Palmer' },
        { id: 102, web_name: 'Saka' },
      ],
    })
  })

  const EXPECTED_SNAPSHOT: PlanSnapshot = {
    gameweekId: 9,
    planIndex: 0,
    modelVersion: 'baseline-v1',
    isRoll: false,
    transferIn: { code: 5001, name: 'Palmer' },
    transferOut: { code: 5002, name: 'Saka' },
    captainPlayerCode: 5001,
    viceCaptainPlayerCode: 5003,
    startingXi: [5001, 5003],
    benchOrder: [5004],
    hitCost: 4,
    expectedPoints: 55.5,
    confidenceBand: 'marginal',
  }

  it('a successful send writes a non-null plan_snapshot built from the exact rows the message was composed from', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const outcome = await runSend('manual', fakeSupabase as unknown as SupabaseClient, UNIT_TEST_TELEGRAM_ENV, new Date())

    logSpy.mockRestore()
    fetchSpy.mockRestore()

    expect(outcome).toBe('sent')
    expect(tables.notifications).toHaveLength(1)
    expect(tables.notifications[0].outcome).toBe('sent')
    expect(tables.notifications[0].plan_snapshot).toEqual(EXPECTED_SNAPSHOT)
  })

  it('a failed Telegram send ALSO writes a non-null plan_snapshot — a failed delivery is still a recommendation the model produced', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await runSend('manual', fakeSupabase as unknown as SupabaseClient, UNIT_TEST_TELEGRAM_ENV, new Date())

    logSpy.mockRestore()
    errorSpy.mockRestore()
    fetchSpy.mockRestore()

    expect(outcome).toBe('failed')
    expect(tables.notifications).toHaveLength(1)
    expect(tables.notifications[0].outcome).toBe('failed')
    expect(tables.notifications[0].plan_snapshot).toEqual(EXPECTED_SNAPSHOT)
  }, 10_000)

  it('an infeasible/no-recommendation send (no plan referenced) writes a null plan_snapshot, never a guessed one', async () => {
    resetTables({
      gameweeks: [{ id: 9, deadline_time: futureIsoDate(72) }],
      solver_runs: [{ id: 1, gameweek_id: 9, solver_status: 'Infeasible' }],
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const outcome = await runSend('manual', fakeSupabase as unknown as SupabaseClient, UNIT_TEST_TELEGRAM_ENV, new Date())

    logSpy.mockRestore()
    fetchSpy.mockRestore()

    expect(outcome).toBe('sent')
    expect(tables.notifications[0].send_kind).toBe('infeasible')
    expect(tables.notifications[0].plan_snapshot).toBeNull()
  })
})
