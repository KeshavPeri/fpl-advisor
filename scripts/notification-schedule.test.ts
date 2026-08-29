// Unit tests for scripts/notification-schedule.ts — ticket #59. The window
// rule itself is proven exhaustively, with no clock and no I/O, in
// src/lib/notification/schedule.test.ts; this file covers what is specific
// to THIS script: the env-unset contract (mirroring ticket #55's own
// scripts/send-telegram.test.ts, which this file deliberately does not
// duplicate wholesale — see below), and the unique-violation-is-not-a-crash
// behaviour this ticket adds to scripts/send-telegram.ts's runSend(), which
// this file tests directly since scripts/send-telegram.test.ts is out of
// this ticket's scope to change.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// runSend is mocked (real gameweeks/notifications reads still exercised
// against the fake Postgrest layer below) so these tests can drive main()
// through all three SendOutcome values without a live Supabase project or a
// real Telegram bot — ticket #90's own DoD: "scripts/notification-
// schedule.ts writes status: 'skipped' ... and only uses the word 'fired'
// when a Telegram call actually succeeded." Every other export of
// send-telegram.ts passes through unmocked via importOriginal.
// ============================================================================
const runSendMock = vi.fn()
vi.mock('./send-telegram.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./send-telegram.js')>()
  return { ...actual, runSend: (...args: unknown[]) => runSendMock(...args) }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => fakeSupabase) }))

import { isUniqueViolation } from './send-telegram.js'
import { main } from './notification-schedule.js'

const ORIGINAL_ENV = { ...process.env }

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
}

// ============================================================================
// A minimal fake Postgrest layer — just enough of supabase-js's chainable
// surface (select/eq/in/order/range/limit/maybeSingle, insert, and being
// awaitable) for main()'s own two reads (gameweeks, notifications) and its
// one insert (job_runs). Filtering happens INSIDE this fake "server" layer,
// matching the convention in src/lib/verdict/api.test.ts's own fakeFrom.
// ============================================================================

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let tables: Tables = { gameweeks: [], notifications: [], job_runs: [] }

function resetTables(overrides: Partial<Tables> = {}): void {
  tables = { gameweeks: [], notifications: [], job_runs: [], ...overrides }
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

/** An ISO timestamp `hoursFromNow` hours ahead of the real clock — main() reads `Date.now()` internally (not injectable), so tests place the fixture deadline relative to it rather than faking the clock. */
function futureIsoDate(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()
}

// ============================================================================
// isUniqueViolation — the DoD's own named test: "A unique-violation on
// insert is caught and reported as 'already sent', not as a crash." This is
// the pure classification runSend() uses to make that call; the full
// insert-then-catch path around it is exercised live (this ticket's own
// Notes: "cannot prove the unique index behaves under a real race" without
// a real database), matching this repo's existing convention of unit-testing
// the pure decision and proving the live wiring by deploying it.
// ============================================================================

describe('isUniqueViolation', () => {
  it('is true for Postgres SQLSTATE 23505 (unique_violation) — what idx_notifications_gameweek_trigger_sent_once produces on a race', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "idx_notifications_gameweek_trigger_sent_once"' })).toBe(true)
  })

  it('is false for an unrelated Postgres error code', () => {
    expect(isUniqueViolation({ code: '23503', message: 'insert or update on table violates foreign key constraint' })).toBe(false)
  })

  it('is false when the error carries no code at all', () => {
    expect(isUniqueViolation({ message: 'network error' })).toBe(false)
  })
})

// ============================================================================
// main() with Telegram env unset — same contract item 14 established
// (scripts/send-telegram.ts's own tests prove this for that file; this
// proves this ticket's own scheduled entry point honours it too, per this
// ticket's own DoD: "the scheduled path logs the missing variable, makes no
// network request and exits zero").
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

  it('logs which variable is missing', async () => {
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main()).resolves.toBeUndefined()
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('TELEGRAM_BOT_TOKEN')
    logSpy.mockRestore()
  })
})

// ============================================================================
// main() — SendOutcome reporting (ticket #90's own DoD). runSend() is
// mocked to each of its three possible outcomes in turn; these tests assert
// what THIS file does with that outcome — the job_runs row it writes for
// its OWN job_name ('notification-schedule'), and whether it exits non-zero
// — not runSend()'s own internals (covered by scripts/send-telegram.test.ts).
//
// All three tests place the fixture gameweek's deadline 15 hours out (inside
// the 24h window, outside the 10h one) with no notifications rows yet, so
// src/lib/notification/schedule.ts's own decideNotificationTrigger() (real,
// unmocked) always selects deadline_24h and reaches the "fire" branch this
// ticket changed — the window-selection logic itself is untouched by this
// ticket and is proven elsewhere (src/lib/notification/schedule.test.ts).
// ============================================================================

describe('main() — SendOutcome reporting (ticket #90)', () => {
  beforeEach(() => {
    resetEnv()
    process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token'
    process.env.TELEGRAM_CHAT_ID = 'unit-test-chat'
    process.env.SUPABASE_URL = 'https://unit-test.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'unit-test-secret'
    resetTables({ gameweeks: [{ id: 9, deadline_time: futureIsoDate(15) }] })
    runSendMock.mockReset()
  })
  afterEach(resetEnv)

  it('a "sent" outcome is reported with the word "fired" and job_runs status: "success"', async () => {
    runSendMock.mockResolvedValue('sent')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main()
    logSpy.mockRestore()

    expect(tables.job_runs).toHaveLength(1)
    const ownRow = tables.job_runs[0]
    expect(ownRow.status).toBe('success')
    expect(String(ownRow.message)).toContain('fired')
    expect(String(ownRow.message)).not.toContain('skipped')
  })

  it('a "skipped" outcome is reported with the word "skipped" and job_runs status: "skipped" — never "fired"', async () => {
    runSendMock.mockResolvedValue('skipped')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main()
    logSpy.mockRestore()

    expect(tables.job_runs).toHaveLength(1)
    const ownRow = tables.job_runs[0]
    expect(ownRow.status).toBe('skipped')
    expect(String(ownRow.message)).toContain('skipped')
    expect(String(ownRow.message)).not.toContain('fired')
  })

  it('a "failed" outcome is reported with job_runs status: "failure", never the word "fired", and exits non-zero', async () => {
    runSendMock.mockResolvedValue('failed')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    await main()
    logSpy.mockRestore()
    errorSpy.mockRestore()

    expect(tables.job_runs).toHaveLength(1)
    const ownRow = tables.job_runs[0]
    expect(ownRow.status).toBe('failure')
    expect(String(ownRow.message)).not.toContain('fired')
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
