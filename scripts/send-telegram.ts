// Send the recommendation to Telegram — ticket #55 (feature-list item 14,
// product-brief.md §2: "so that acknowledging it and deciding are the same
// act"). Reads the current gameweek's recommendation from Supabase, composes
// the message (src/lib/notification/), sends it via the Telegram Bot API,
// and records what was sent. Runs on demand (workflow_dispatch, see
// .github/workflows/send-notification.yml) and as a step in
// .github/workflows/solver-run.yml, right after "Generate recommendations."
//
// This script does NOT decide *when* to send — no 24h/10h trigger, no
// deadline arithmetic. That is item 15 (ticket #59): its own
// scripts/notification-schedule.ts decides the trigger and calls runSend()
// below directly, in-process, with whichever trigger it decided on. Every
// run of runSend() is a single, immediate attempt to send whatever the
// current state warrants (a fresh plan, a stale one clearly marked with its
// age, or a failure notice) — never a schedule.
//
// ============================================================================
// trigger — ticket #59. Which of 'manual' / 'deadline_24h' / 'deadline_10h'
// caused this send. Recorded verbatim on the notifications row (see that
// ticket's migration). Invoked directly (workflow_dispatch, or `npx tsx
// scripts/send-telegram.ts` by hand) it defaults to 'manual' — see main()'s
// own default parameter. scripts/notification-schedule.ts instead calls
// runSend() directly, in-process, with the trigger its own pure schedule.ts
// decided on, never 'manual'.
//
// ============================================================================
// Why main() is a thin wrapper around runSend(), not one function.
// ============================================================================
// main() calls process.exit(1) on failure — correct for this file's own
// entry point, wrong for a caller like scripts/notification-schedule.ts
// that needs to keep running afterwards to write ITS OWN job_runs row
// regardless of whether this send succeeded. runSend() is the same logic
// with every process.exit(1) replaced by `return 'failed'` (a three-way
// SendOutcome — see runSend's own header, ticket #90); main() is the
// process-exit-owning wrapper every direct invocation of this file already
// went through, unchanged in observable behaviour.
//
// ============================================================================
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID do not exist yet.
// ============================================================================
// Creating the bot and the chat is Tier 1 (owner-only — accounts and
// credentials, escalation.md). This script must work correctly with BOTH
// unset, exactly like scripts/sync-squad.ts's FPL_ENTRY_ID: if either is
// missing, log a message naming it, make NO network call of any kind —
// including to Supabase — and exit zero. See readTelegramEnv() below. The
// Telegram env check runs first, before Supabase is even touched, so an
// unset bot never causes a Supabase read/write of any kind either.
//
// ============================================================================
// How "which recommendation to send" is decided — see src/lib/notification/
// for the pure logic; this file only wires it to Supabase reads.
// ============================================================================
// 1. currentGameweekId: the next gameweek whose deadline has not yet passed
//    (or the last known gameweek, mirroring scripts/sync-squad.ts's own
//    "next unpassed deadline" rule — duplicated here on purpose, not
//    imported: it answers a different question in each file, see
//    determineCurrentGameweekId's own doc comment).
// 2. latestRecommendationGameweekId: the highest gameweek_id present in
//    `recommendations` (plan_index 0) — that table is upserted per
//    gameweek and old rows are never deleted (ticket #47's own migration
//    header), so "most recent gameweek_id present" is the right question,
//    not "does gameweek_id = currentGameweekId have a row."
// 3. src/lib/notification/availability.ts's classifyAvailability() turns
//    those two numbers into 'current' / 'stale' / 'none'.
// 4. 'none' gets one more check before falling back to a generic failure
//    notice: was the LATEST solve attempt for the current gameweek
//    specifically infeasible? product-brief.md §6c: infeasible is "the one
//    case with a specific, actionable message" — never a generic error.
//    (An infeasible solve never produces a `recommendations` row at all —
//    scripts/store-solver-output.ts throws before generate-recommendations.ts
//    ever runs — so this is the only way to detect it from this script.)
//
// ============================================================================
// Idempotency — the `notifications` log stops a re-run from double-sending.
// ============================================================================
// Before calling Telegram, this script checks whether an identical message
// (same gameweek_id, same message_text) was already recorded with
// outcome='sent'. If so, it logs and exits — no second Telegram call, no
// second notifications row. The notifications row for a real send is
// written AFTER the Telegram call resolves (success or failure) and BEFORE
// the run is allowed to conclude success — see main()'s own comments.
//
// ============================================================================
// Wiring
// ============================================================================
// Reads exactly SUPABASE_URL, SUPABASE_SECRET_KEY, TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID. No VITE_-prefixed variable. Every multi-row Supabase
// read goes through scripts/lib/paginate.ts's fetchAllPages +
// assertRowCountMatches; single primary-key row lookups (recommendations by
// (gameweek_id, plan_index), solver_runs by id) are plain queries, matching
// the precedent in decisions/ticket-47.md ("small/bounded reads are
// exempt").

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import {
  applyWindowMarker,
  classifyAvailability,
  composeCurrentMessage,
  composeInfeasibleMessage,
  composeNoRecommendationMessage,
  composeStaleMessage,
  isProvenOptimal,
  type NotificationTrigger,
  type SolverStatusInfo,
} from '../src/lib/notification/index.ts'

const JOB_NAME = 'send-telegram'
const NOTIFICATIONS_MIGRATION = 'supabase/migrations/20260818090000_notifications.sql'
const RECOMMENDATIONS_MIGRATION = 'supabase/migrations/20260817090000_recommendations.sql'

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org'
const TELEGRAM_MAX_ATTEMPTS = 3
const TELEGRAM_BASE_DELAY_MS = 300

// ============================================================================
// Env
// ============================================================================

export interface TelegramEnv {
  botToken: string
  chatId: string
}

/**
 * Checked FIRST, before Supabase is touched at all — see this file's own
 * header. Mirrors scripts/sync-squad.ts's readEntryId() contract exactly:
 * unset means "log which variable is missing, make no request, exit zero,"
 * not an error.
 */
export function readTelegramEnv(): TelegramEnv | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const missing: string[] = []
  if (!botToken || botToken.trim() === '') missing.push('TELEGRAM_BOT_TOKEN')
  if (!chatId || chatId.trim() === '') missing.push('TELEGRAM_CHAT_ID')

  if (missing.length > 0) {
    console.log(
      `${JOB_NAME}: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. Nothing to send — making no request of ` +
        `any kind, including to Supabase (missing: ${missing.join(', ')}). Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID once the bot exists.`,
    )
    return null
  }
  return { botToken: botToken as string, chatId: chatId as string }
}

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

export class SendTelegramError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'SendTelegramError'
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

/**
 * Postgres's own unique_violation SQLSTATE (23505) — surfaced verbatim as
 * `error.code` by PostgREST/Supabase. This is what
 * idx_notifications_gameweek_trigger_sent_once (ticket #59's own migration)
 * produces when two runs race past the pre-send existingSent check above and
 * both attempt to INSERT the same (gameweek_id, trigger, outcome='sent')
 * row. runSend() treats this as the expected outcome of a race, not a
 * crash — this ticket's own DoD: "two workflow runs overlapping is a normal
 * race, not a failure." See that migration's own header for why the index,
 * not any application-level check, is the actual guarantee against a
 * double send.
 */
export function isUniqueViolation(error: PostgrestLikeError): boolean {
  return error.code === '23505'
}

// ============================================================================
// job_runs
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
// Pure-ish local helpers — no I/O.
// ============================================================================

export interface GameweekRow {
  id: number
  deadline_time: string
}

/**
 * The gameweek this notification run targets. Duplicated from, not shared
 * with, scripts/sync-squad.ts's own "next gameweek whose deadline has not
 * passed, else the last one" logic (and from
 * scripts/generate-recommendations.ts's DIFFERENTLY-DEFINED
 * deriveCurrentGameweekId, which means "the first week in the solver's own
 * output" — a different question with the same-sounding name). Named
 * distinctly here on purpose to avoid that exact confusion. `nowMs` is a
 * parameter, not `Date.now()` read internally, so this stays pure and
 * testable without faking the system clock.
 */
export function determineCurrentGameweekId(gwRows: readonly GameweekRow[], nowMs: number): number {
  const sorted = [...gwRows].sort((a, b) => a.id - b.id)
  const next = sorted.find((gw) => new Date(gw.deadline_time).getTime() > nowMs)
  const target = next ?? sorted[sorted.length - 1]
  return target.id
}

// ============================================================================
// Telegram Bot API — the only network call besides Supabase. Built from env
// vars at runtime; never a hardcoded token-shaped string anywhere in this
// file (verifiable by search — this ticket's own DoD).
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface TelegramAttemptResult {
  ok: boolean
  status: number | null
  errorText: string | null
}

async function attemptTelegramSend(fetchImpl: typeof fetch, botToken: string, chatId: string, text: string): Promise<TelegramAttemptResult> {
  try {
    const response = await fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Plain text, deliberately no parse_mode — a player name with an
      // underscore or asterisk would break Telegram's markdown parsing
      // (this ticket's own Notes).
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (response.ok) {
      return { ok: true, status: response.status, errorText: null }
    }
    let description: string | null = null
    try {
      const body = (await response.json()) as { description?: unknown }
      if (typeof body.description === 'string') description = body.description
    } catch {
      // Non-JSON error body — fall back to statusText below.
    }
    return { ok: false, status: response.status, errorText: description ?? response.statusText }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: null, errorText: message }
  }
}

export interface TelegramSendOutcome {
  ok: boolean
  status: number | null
  errorText: string | null
  attempts: number
}

/**
 * At most `maxAttempts` (default 3) attempts with backoff — "no retry
 * storm" (this ticket's own DoD). `fetchImpl` is injectable so tests never
 * make a real request to api.telegram.org (unreachable from this sandbox
 * anyway, and not something a unit test should depend on regardless).
 */
export async function sendTelegramMessage(params: {
  botToken: string
  chatId: string
  text: string
  fetchImpl?: typeof fetch
  maxAttempts?: number
  baseDelayMs?: number
}): Promise<TelegramSendOutcome> {
  const fetchImpl = params.fetchImpl ?? fetch
  const maxAttempts = params.maxAttempts ?? TELEGRAM_MAX_ATTEMPTS
  const baseDelayMs = params.baseDelayMs ?? TELEGRAM_BASE_DELAY_MS

  let last: TelegramAttemptResult = { ok: false, status: null, errorText: 'no attempt made' }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await attemptTelegramSend(fetchImpl, params.botToken, params.chatId, params.text)
    if (last.ok) return { ...last, attempts: attempt }
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.error(`${JOB_NAME}: Telegram send attempt ${attempt}/${maxAttempts} failed (${last.errorText ?? 'unknown error'}), retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  return { ...last, attempts: maxAttempts }
}

// ============================================================================
// runSend — the actual work, with no process.exit() anywhere in it. See this
// file's header ("Why main() is a thin wrapper") for why: a caller other
// than this file's own direct invocation (scripts/notification-schedule.ts)
// needs to keep running after this returns, to write its own job_runs row
// regardless of the outcome here.
//
// Returns a three-way SendOutcome, not a boolean (ticket #90): a benign
// "already sent" skip (a race lost to another run, or an identical message
// already sent for this trigger) is still not a failure of THIS run, but it
// is also not a send — collapsing the two into one boolean is exactly what
// let scripts/notification-schedule.ts report a skipped send as "fired" for
// ten straight hours before GW1's deadline (see this ticket's own Notes).
// 'sent': a Telegram call was actually made and succeeded. 'skipped': no
// Telegram call was made at all (idempotency short-circuit, either path).
// 'failed': everything that used to call process.exit(1) — gameweeks table
// empty, the Telegram call itself failed, or an uncaught error. Every
// caller of this function is updated for the new return type.
// ============================================================================

export type SendOutcome = 'sent' | 'skipped' | 'failed'

export async function runSend(trigger: NotificationTrigger, supabase: SupabaseClient, telegramEnv: TelegramEnv, startedAt: Date): Promise<SendOutcome> {
  try {
    // ------------------------------------------------------------------
    // 1. Current gameweek.
    // ------------------------------------------------------------------
    const {
      rows: gwRows,
      error: gwError,
      pages: gwPages,
    } = await fetchAllPages<GameweekRow>((from, to) => supabase.from('gameweeks').select('id, deadline_time').order('id', { ascending: true }).range(from, to).returns<GameweekRow[]>())
    if (gwError) {
      throw new SendTelegramError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const { count: gwExpected, error: gwCountError } = await supabase.from('gameweeks').select('*', { count: 'exact', head: true })
    if (gwCountError) throw new SendTelegramError(`gameweeks count check failed: ${gwCountError.message}`, 'gameweeks')
    assertRowCountMatches('gameweeks', gwRows.length, gwExpected ?? 0)

    if (gwRows.length === 0) {
      const message = `${JOB_NAME}: the "gameweeks" table is empty — nothing to determine a current gameweek from. Run scripts/ingest-fpl.ts first.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
      return 'failed'
    }
    const currentGameweekId = determineCurrentGameweekId(gwRows, Date.now())

    // ------------------------------------------------------------------
    // 2. The most recent gameweek `recommendations` (plan_index 0) holds
    //    any plan for — never deleted, so "highest gameweek_id present" is
    //    the right question (see this file's own header).
    // ------------------------------------------------------------------
    const {
      rows: recGwRows,
      error: recGwError,
      pages: recGwPages,
    } = await fetchAllPages<{ gameweek_id: number }>((from, to) =>
      supabase
        .from('recommendations')
        .select('gameweek_id')
        .eq('plan_index', 0)
        .order('gameweek_id', { ascending: true })
        .order('plan_index', { ascending: true })
        .range(from, to)
        .returns<{ gameweek_id: number }[]>(),
    )
    if (recGwError) {
      if (isMissingTable(recGwError, 'recommendations')) {
        throw new SendTelegramError(`the "recommendations" table does not exist. Apply ${RECOMMENDATIONS_MIGRATION} first.`, 'recommendations')
      }
      throw new SendTelegramError(`recommendations lookup failed: ${recGwError.message}`, 'recommendations')
    }
    const { count: recGwExpected, error: recGwCountError } = await supabase.from('recommendations').select('*', { count: 'exact', head: true }).eq('plan_index', 0)
    if (recGwCountError) throw new SendTelegramError(`recommendations count check failed: ${recGwCountError.message}`, 'recommendations')
    assertRowCountMatches('recommendations (gameweek listing)', recGwRows.length, recGwExpected ?? 0)

    const latestRecommendationGameweekId = recGwRows.length > 0 ? Math.max(...recGwRows.map((r) => r.gameweek_id)) : null
    const availability = classifyAvailability({ currentGameweekId, latestRecommendationGameweekId })

    let sendKind: 'current' | 'stale' | 'infeasible' | 'no_recommendation'
    let messageText: string
    let recommendationGameweekId: number | null = null
    let planIndexSent: number | null = null

    if (availability.kind === 'none') {
      // ------------------------------------------------------------------
      // No recommendation has ever been stored. Check whether the LATEST
      // solve attempt for the current gameweek was specifically infeasible
      // — product-brief.md §6c's one case with a specific, actionable
      // message, never a generic error. Single primary-key-adjacent lookup
      // (most recent row for one gameweek_id), not paginated — matches
      // decisions/ticket-47.md's precedent for small/bounded reads.
      // ------------------------------------------------------------------
      const { data: solverRunRow, error: solverRunError } = await supabase
        .from('solver_runs')
        .select('id, solver_status')
        .eq('gameweek_id', currentGameweekId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: number; solver_status: string }>()
      if (solverRunError) throw new SendTelegramError(`solver_runs lookup failed: ${solverRunError.message}`, 'solver_runs')

      if (solverRunRow && /infeasible/i.test(solverRunRow.solver_status)) {
        sendKind = 'infeasible'
        messageText = composeInfeasibleMessage(currentGameweekId)
      } else {
        sendKind = 'no_recommendation'
        messageText = composeNoRecommendationMessage(currentGameweekId)
      }
    } else {
      const targetGw = availability.kind === 'current' ? currentGameweekId : availability.recommendationGameweekId
      recommendationGameweekId = targetGw
      planIndexSent = 0

      const { data: recRow, error: recRowError } = await supabase
        .from('recommendations')
        .select('solver_run_id')
        .eq('gameweek_id', targetGw)
        .eq('plan_index', 0)
        .maybeSingle<{ solver_run_id: number | null }>()
      if (recRowError) throw new SendTelegramError(`recommendations row lookup failed: ${recRowError.message}`, 'recommendations')
      if (!recRow) {
        throw new SendTelegramError(
          `recommendations row for gameweek ${targetGw}, plan_index 0 was not found, but its gameweek_id was just read from the ` +
            'same table moments earlier — it changed under us. Re-run.',
          'recommendations',
        )
      }

      const { rows: reasonRows, error: reasonError } = await fetchAllPages<{ plan_index: number; order_index: number; reason: string }>((from, to) =>
        supabase
          .from('recommendation_reasons')
          .select('plan_index, order_index, reason')
          .eq('gameweek_id', targetGw)
          .in('plan_index', [0, 1])
          .order('plan_index', { ascending: true })
          .order('order_index', { ascending: true })
          .range(from, to)
          .returns<{ plan_index: number; order_index: number; reason: string }[]>(),
      )
      if (reasonError) throw new SendTelegramError(`recommendation_reasons lookup failed: ${reasonError.message}`, 'recommendation_reasons')
      const { count: reasonExpected, error: reasonCountError } = await supabase
        .from('recommendation_reasons')
        .select('*', { count: 'exact', head: true })
        .eq('gameweek_id', targetGw)
        .in('plan_index', [0, 1])
      if (reasonCountError) throw new SendTelegramError(`recommendation_reasons count check failed: ${reasonCountError.message}`, 'recommendation_reasons')
      assertRowCountMatches('recommendation_reasons', reasonRows.length, reasonExpected ?? 0)

      const planAReasons = reasonRows
        .filter((r) => r.plan_index === 0)
        .sort((a, b) => a.order_index - b.order_index)
        .map((r) => r.reason)
      const planB = reasonRows.find((r) => r.plan_index === 1 && r.order_index === 0)?.reason ?? null

      if (planAReasons.length === 0) {
        throw new SendTelegramError(
          `recommendation_reasons has no rows for gameweek ${targetGw}, plan_index 0 — the recommendation exists but its ` +
            'reasoning was never stored. Re-run scripts/generate-recommendations.ts before sending.',
          'recommendation_reasons',
        )
      }

      let solverStatus: SolverStatusInfo = { isOptimal: false, status: null }
      if (recRow.solver_run_id !== null) {
        const { data: solverRunRow, error: solverRunError } = await supabase
          .from('solver_runs')
          .select('solver_status')
          .eq('id', recRow.solver_run_id)
          .maybeSingle<{ solver_status: string }>()
        if (solverRunError) throw new SendTelegramError(`solver_runs lookup failed: ${solverRunError.message}`, 'solver_runs')
        if (solverRunRow) {
          solverStatus = { isOptimal: isProvenOptimal(solverRunRow.solver_status), status: solverRunRow.solver_status }
        }
      }

      if (availability.kind === 'current') {
        sendKind = 'current'
        messageText = composeCurrentMessage({ reasonLines: planAReasons, planB, solverStatus })
      } else {
        sendKind = 'stale'
        messageText = composeStaleMessage({
          reasonLines: planAReasons,
          recommendationGameweekId: availability.recommendationGameweekId,
          currentGameweekId: availability.currentGameweekId,
          planB,
          solverStatus,
        })
      }
    }

    // ticket #90: a short leading line naming the window (24h/10h), so two
    // notifications for the same unchanged recommendation a day apart read
    // as distinguishable, not as a repeat — see src/lib/notification/
    // message.ts's own header for why this alone is not the duplicate-send
    // fix (the trigger-scoped query just below is).
    messageText = applyWindowMarker(messageText, trigger)

    // ------------------------------------------------------------------
    // Idempotency: an identical message already sent successfully for this
    // gameweek AND THIS TRIGGER is not sent again. Scoped to `trigger` as
    // well as gameweek_id/outcome/message_text (ticket #90) — the 24h and
    // 10h messages for an unchanged recommendation used to be byte-
    // identical (no window marker existed yet), so this query suppressed
    // the 10h send as a "duplicate" of the 24h one and the more urgent of
    // the two reminders silently never went out. A different trigger is a
    // different notification, never a duplicate of another window's send —
    // matching the partial unique index in
    // supabase/migrations/20260819090000_notification_trigger.sql, which
    // already keyed its own guarantee on (gameweek_id, trigger). This query
    // was the one place that disagreed with it. Bounded single-row lookup,
    // not paginated.
    // ------------------------------------------------------------------
    const { data: existingSent, error: existingSentError } = await supabase
      .from('notifications')
      .select('id')
      .eq('gameweek_id', currentGameweekId)
      .eq('outcome', 'sent')
      .eq('trigger', trigger)
      .eq('message_text', messageText)
      .limit(1)
      .maybeSingle<{ id: number }>()
    if (existingSentError) {
      if (isMissingTable(existingSentError, 'notifications')) {
        throw new SendTelegramError(`the "notifications" table does not exist. Apply ${NOTIFICATIONS_MIGRATION} first.`, 'notifications')
      }
      throw new SendTelegramError(`notifications lookup failed: ${existingSentError.message}`, 'notifications')
    }
    if (existingSent) {
      const message = `${JOB_NAME}: an identical "${trigger}" message was already sent for gameweek ${currentGameweekId} (notifications.id=${existingSent.id}) — skipping to avoid a duplicate send.`
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { currentGameweekId, sendKind, trigger, gwPages, recGwPages }, startedAt })
      return 'skipped'
    }

    // ------------------------------------------------------------------
    // Send. Write the notifications row for BOTH outcomes before deciding
    // this run's own success — see this file's header.
    // ------------------------------------------------------------------
    const sendOutcome = await sendTelegramMessage({ botToken: telegramEnv.botToken, chatId: telegramEnv.chatId, text: messageText })

    const { error: notifInsertError } = await supabase.from('notifications').insert({
      gameweek_id: currentGameweekId,
      recommendation_gameweek_id: recommendationGameweekId,
      plan_index: planIndexSent,
      outcome: sendOutcome.ok ? 'sent' : 'failed',
      send_kind: sendKind,
      message_text: messageText,
      http_status: sendOutcome.status,
      telegram_error: sendOutcome.errorText,
      trigger,
    })
    if (notifInsertError) {
      if (isMissingTable(notifInsertError, 'notifications')) {
        throw new SendTelegramError(`the "notifications" table does not exist. Apply ${NOTIFICATIONS_MIGRATION} first.`, 'notifications')
      }
      if (isUniqueViolation(notifInsertError)) {
        // ticket #59: idx_notifications_gameweek_trigger_sent_once rejected
        // this INSERT because another run already recorded a successful
        // "${trigger}" send for this gameweek — the pre-send existingSent
        // check above raced and lost. That is the expected outcome of an
        // overlapping run, not a failure of this one (this ticket's own
        // DoD); the Telegram message this run just sent is an unfortunate
        // but accepted duplicate, not something this insert can undo.
        const message = `${JOB_NAME}: a "${trigger}" notification for gameweek ${currentGameweekId} was already recorded as sent by another run (unique-index race) — not treating this as a failure.`
        console.log(message)
        await recordJobRun(supabase, { status: 'skipped', message, details: { currentGameweekId, sendKind, trigger }, startedAt })
        return 'skipped'
      }
      throw new SendTelegramError(`failed to record notifications row: ${notifInsertError.message}`, 'notifications')
    }

    if (!sendOutcome.ok) {
      const message =
        `${JOB_NAME}: Telegram send failed after ${sendOutcome.attempts} attempt(s) — status ${sendOutcome.status ?? '(network error)'}: ` +
        `${sendOutcome.errorText ?? 'unknown error'}`
      console.error(message)
      await recordJobRun(supabase, {
        status: 'failure',
        message,
        details: { currentGameweekId, sendKind, trigger, httpStatus: sendOutcome.status, telegramError: sendOutcome.errorText, attempts: sendOutcome.attempts },
        startedAt,
      })
      return 'failed'
    }

    const message =
      `${JOB_NAME}: sent a "${sendKind}" notification for gameweek ${currentGameweekId} (trigger: ${trigger})` +
      (recommendationGameweekId !== null && recommendationGameweekId !== currentGameweekId ? ` (recommendation from gameweek ${recommendationGameweekId})` : '') +
      '.'
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: { currentGameweekId, sendKind, trigger, recommendationGameweekId, httpStatus: sendOutcome.status, attempts: sendOutcome.attempts },
      startedAt,
    })
    return 'sent'
  } catch (err) {
    const message =
      err instanceof SendTelegramError ? err.message : err instanceof Error ? `unexpected failure: ${err.message}` : `unexpected failure: ${String(err)}`
    console.error(`${JOB_NAME}: failed: ${message}`)
    try {
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    return 'failed'
  }
}

// ============================================================================
// main — the direct-invocation entry point (workflow_dispatch, or `npx tsx
// scripts/send-telegram.ts` by hand). Owns process.exit(1) on failure, and
// defaults trigger to 'manual' when invoked directly, since nothing sets it
// otherwise — see this file's header. scripts/notification-schedule.ts
// never goes through this function at all: it imports and calls runSend()
// directly, in-process, with the trigger its own schedule.ts decided on
// (never 'manual'), specifically so it can keep running afterwards and
// write its own job_runs row regardless of what runSend() returns.
// ============================================================================

export async function main(trigger: NotificationTrigger = 'manual'): Promise<void> {
  const startedAt = new Date()

  const telegramEnv = readTelegramEnv()
  if (!telegramEnv) {
    // No network call of any kind — including to Supabase. Matches
    // scripts/sync-squad.ts's unset-FPL_ENTRY_ID contract exactly.
    return
  }

  const supabaseEnv = readSupabaseEnv()
  if (!supabaseEnv) {
    process.exit(1)
    return
  }
  const supabase = createClient(supabaseEnv.url, supabaseEnv.secretKey)

  const outcome = await runSend(trigger, supabase, telegramEnv, startedAt)
  if (outcome === 'failed') {
    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: this file also exports
// its pure/testable functions (scripts/send-telegram.test.ts) so they are
// unit-testable without a live Supabase project or a real Telegram bot.
// Importing the module for that must not trigger a real run — only running
// it directly (`npx tsx scripts/send-telegram.ts`) should.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
