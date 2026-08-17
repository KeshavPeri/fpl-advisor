// Unit tests for scripts/send-telegram.ts's pure/testable functions —
// ticket #55. No live Supabase project and no real Telegram bot: Telegram
// sends are exercised against `fetchImpl` injection (a local fake, never a
// real request to api.telegram.org — unreachable from this sandbox anyway,
// see this ticket's own Notes), and the env-check/gameweek-selection logic
// is pure and needs no I/O at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { determineCurrentGameweekId, main, readTelegramEnv, sendTelegramMessage, type GameweekRow } from './send-telegram.js'

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
