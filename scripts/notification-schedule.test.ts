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
