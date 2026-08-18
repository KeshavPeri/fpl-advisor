// Decide whether NOW is one of the two instants the notification must fire —
// ticket #59 (feature-list item 15, "the last piece of the value loop").
// Runs hourly (see .github/workflows/send-notification.yml's schedule
// trigger). Every run either fires exactly one send (deadline_24h or
// deadline_10h, for the current gameweek) or exits zero having done
// nothing — never both, never a schedule-independent send (that is
// scripts/send-telegram.ts's own workflow_dispatch path, entirely
// untouched by this file).
//
// ============================================================================
// What this file does NOT do.
// ============================================================================
// It does not compose messages (src/lib/notification/message.ts, item 14,
// this ticket's own Scope OUT), does not decide which recommendation is
// current/stale/missing (src/lib/notification/availability.ts, also item
// 14), and does not talk to the Telegram API directly. All of that already
// exists in scripts/send-telegram.ts's runSend() — this file's own job is
// only the WHEN question (src/lib/notification/schedule.ts's pure
// decideNotificationTrigger()), wired to two Supabase reads: the target
// gameweek's deadline, and which scheduled triggers have already been sent
// for it. Once a trigger is decided, this file calls runSend() directly, in
// the same process — see scripts/send-telegram.ts's own header for why that
// function has no process.exit() in it: this file needs to keep running
// afterwards, regardless of what runSend() returns, to write its OWN
// job_runs row (job_name = 'notification-schedule') recording the
// scheduling decision itself, separate from runSend()'s own
// job_name = 'send-telegram' row recording the send attempt.
//
// ============================================================================
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset — same contract as item 14.
// ============================================================================
// Checked FIRST, before Supabase is touched at all, via the exact same
// readTelegramEnv() scripts/send-telegram.ts already exports: if either is
// missing, log which one, make NO network call of any kind — including to
// Supabase — and exit zero. There is nothing to schedule around if there is
// nowhere to send.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads exactly SUPABASE_URL, SUPABASE_SECRET_KEY, TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID — no new environment variable. Every multi-row Supabase
// read goes through scripts/lib/paginate.ts's fetchAllPages +
// assertRowCountMatches, matching every job since ticket #43.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { determineCurrentGameweekId, readTelegramEnv, runSend, type GameweekRow, type TelegramEnv } from './send-telegram.ts'
import { decideNotificationTrigger, type ScheduledTrigger } from '../src/lib/notification/index.ts'

const JOB_NAME = 'notification-schedule'
const TRIGGER_MIGRATION = 'supabase/migrations/20260819090000_notification_trigger.sql'

const SCHEDULED_TRIGGERS: readonly ScheduledTrigger[] = ['deadline_24h', 'deadline_10h']

// ============================================================================
// Env — readSupabaseEnv is deliberately duplicated, not imported, matching
// every other scripts/*.ts job's own small env-reading helper (CLAUDE.md's
// own note: reasonable for a four-line helper like this one).
// ============================================================================

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')

  if (missing.length > 0) {
    console.error(
      `${JOB_NAME}: required environment variables are not set. Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ` +
        `(missing: ${missing.join(', ')}).`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

export class NotificationScheduleError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'NotificationScheduleError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// job_runs — this run's OWN row, distinct from runSend()'s job_name =
// 'send-telegram' row (see this file's header).
// ============================================================================

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: JsonRecord
  startedAt: Date
}

async function recordJobRun(supabase: SupabaseClient, input: JobRunInput): Promise<void> {
  const finishedAt = new Date()
  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: input.status,
    message: input.message,
    details: input.details,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })
  if (error) {
    if (isMissingTable(error, 'job_runs')) {
      console.error(`${JOB_NAME}: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Main
// ============================================================================

export async function main(): Promise<void> {
  const startedAt = new Date()

  const telegramEnv: TelegramEnv | null = readTelegramEnv()
  if (!telegramEnv) {
    // No network call of any kind — including to Supabase. Same contract
    // item 14 established (scripts/send-telegram.ts's own header) — there
    // is nothing to schedule around if there is nowhere to send, so this
    // run writes no job_runs row either.
    return
  }

  const supabaseEnv = readSupabaseEnv()
  if (!supabaseEnv) {
    process.exit(1)
    return
  }
  const supabase = createClient(supabaseEnv.url, supabaseEnv.secretKey)

  try {
    // ------------------------------------------------------------------
    // 1. The target gameweek and its deadline — the SAME "next gameweek
    //    whose deadline has not yet passed, else the last known one" rule
    //    scripts/send-telegram.ts itself uses, imported directly (not
    //    duplicated) so the two scripts can never disagree about which
    //    gameweek is being scheduled for.
    // ------------------------------------------------------------------
    const {
      rows: gwRows,
      error: gwError,
    } = await fetchAllPages<GameweekRow>((from, to) => supabase.from('gameweeks').select('id, deadline_time').order('id', { ascending: true }).range(from, to).returns<GameweekRow[]>())
    if (gwError) {
      throw new NotificationScheduleError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const { count: gwExpected, error: gwCountError } = await supabase.from('gameweeks').select('*', { count: 'exact', head: true })
    if (gwCountError) throw new NotificationScheduleError(`gameweeks count check failed: ${gwCountError.message}`, 'gameweeks')
    assertRowCountMatches('gameweeks', gwRows.length, gwExpected ?? 0)

    if (gwRows.length === 0) {
      const message = `${JOB_NAME}: the "gameweeks" table is empty — nothing to schedule against. Run scripts/ingest-fpl.ts first.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
      process.exit(1)
      return
    }

    const nowMs = Date.now()
    const targetGameweekId = determineCurrentGameweekId(gwRows, nowMs)
    const targetGw = gwRows.find((gw) => gw.id === targetGameweekId)
    if (!targetGw) {
      // Cannot happen: determineCurrentGameweekId only ever returns an id
      // it read from gwRows itself. Guarded anyway rather than asserted
      // away with a non-null assertion — see this ticket's own convention
      // of never trusting an invariant silently.
      throw new NotificationScheduleError(
        `internal error: determineCurrentGameweekId returned gameweek ${targetGameweekId}, which is not among the fetched gameweeks rows.`,
        'gameweeks',
      )
    }
    const deadlineMs = new Date(targetGw.deadline_time).getTime()

    // ------------------------------------------------------------------
    // 2. Which SCHEDULED triggers already have a successful send for this
    //    gameweek. 'manual' sends are excluded from the query itself — a
    //    manual send never occupies either window's slot (this ticket's
    //    own schedule.ts: sentTriggers is scoped to ScheduledTrigger).
    // ------------------------------------------------------------------
    const { rows: sentRows, error: sentError } = await fetchAllPages<{ trigger: string }>((from, to) =>
      supabase
        .from('notifications')
        .select('trigger')
        .eq('gameweek_id', targetGameweekId)
        .eq('outcome', 'sent')
        .in('trigger', SCHEDULED_TRIGGERS)
        .range(from, to)
        .returns<{ trigger: string }[]>(),
    )
    if (sentError) {
      if (isMissingTable(sentError, 'notifications')) {
        throw new NotificationScheduleError(`the "notifications" table has no "trigger" column yet. Apply ${TRIGGER_MIGRATION} first.`, 'notifications')
      }
      throw new NotificationScheduleError(`notifications lookup failed: ${sentError.message}`, 'notifications')
    }
    const { count: sentExpected, error: sentCountError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('gameweek_id', targetGameweekId)
      .eq('outcome', 'sent')
      .in('trigger', SCHEDULED_TRIGGERS)
    if (sentCountError) throw new NotificationScheduleError(`notifications count check failed: ${sentCountError.message}`, 'notifications')
    assertRowCountMatches('notifications (already-sent scheduled triggers)', sentRows.length, sentExpected ?? 0)

    const sentTriggers = new Set(sentRows.map((r) => r.trigger as ScheduledTrigger))

    // ------------------------------------------------------------------
    // 3. Decide. Pure — src/lib/notification/schedule.ts.
    // ------------------------------------------------------------------
    const decision = decideNotificationTrigger({ deadlineMs, nowMs, sentTriggers })
    const sentTriggersList = [...sentTriggers]

    if (decision.trigger === null) {
      const message = `${JOB_NAME}: gameweek ${targetGameweekId}, ${decision.hoursRemaining.toFixed(2)}h remaining — ${decision.reason}`
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: { targetGameweekId, hoursRemaining: decision.hoursRemaining, sentTriggers: sentTriggersList, decision: null },
        startedAt,
      })
      return
    }

    // ------------------------------------------------------------------
    // 4. Fire. runSend() writes its own job_runs row (job_name =
    //    'send-telegram') and, per product-brief.md §6c/§6d, sends the
    //    failure notice rather than staying silent if there is no usable
    //    recommendation right now — that behaviour is entirely runSend()'s
    //    own, unchanged by this ticket. This run's OWN job_runs row below
    //    always gets written regardless of what runSend() returns, because
    //    runSend() never calls process.exit() (see scripts/send-telegram.ts's
    //    own header) — that is the entire reason this file calls runSend()
    //    directly instead of scripts/send-telegram.ts's main().
    // ------------------------------------------------------------------
    console.log(`${JOB_NAME}: gameweek ${targetGameweekId}, ${decision.hoursRemaining.toFixed(2)}h remaining — firing ${decision.trigger}.`)
    const sendOk = await runSend(decision.trigger, supabase, telegramEnv, new Date())

    const message = `${JOB_NAME}: ${sendOk ? 'fired' : 'attempted'} ${decision.trigger} for gameweek ${targetGameweekId} (${decision.hoursRemaining.toFixed(2)}h remaining).`
    console.log(message)
    await recordJobRun(supabase, {
      status: sendOk ? 'success' : 'failure',
      message,
      details: { targetGameweekId, hoursRemaining: decision.hoursRemaining, sentTriggers: sentTriggersList, decision: decision.trigger },
      startedAt,
    })
    if (!sendOk) {
      process.exit(1)
    }
  } catch (err) {
    const message =
      err instanceof NotificationScheduleError ? err.message : err instanceof Error ? `unexpected failure: ${err.message}` : `unexpected failure: ${String(err)}`
    console.error(`${JOB_NAME}: failed: ${message}`)
    try {
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module
// (e.g. from a test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
