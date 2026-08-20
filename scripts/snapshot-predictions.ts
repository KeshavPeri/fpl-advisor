// Snapshot the current gameweek's projections into prediction_log — ticket #73.
//
// product-brief.md §2: "every projection stored, scored against actuals after gameweek
// lockdown, and shown as a rolling figure in-app." This job is the "every projection stored"
// half. It copies player_projections rows for the CURRENT gameweek (gameweeks.is_next — the
// same "current gameweek" convention scripts/project-points.ts and
// scripts/emit-projections-csv.ts already use) at MODEL_VERSION into public.prediction_log,
// stamping captured_at. scripts/settle-predictions.ts is the other half — it fills in
// actual_points/actual_minutes/error/settled_at after lockdown, and never before.
//
// ============================================================================
// The freeze rule — the reason this job exists in this exact shape.
// ============================================================================
// Re-running this job before the current gameweek's deadline OVERWRITES the snapshot
// (latest-before-deadline wins — a later run naturally reflects a later, presumably better,
// projection run). Re-running it AFTER the deadline does NOT overwrite anything: it logs why and
// exits zero, touching no row. A prediction log rewritable after the outcome is knowable is not a
// prediction log — see this ticket's own Notes. decideSnapshotAction() below is the single place
// that freeze/capture decision is made, and it is pure and directly unit-tested.
//
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other
// scripts/*.ts job. No VITE_-prefixed variable. No network request other than to Supabase — this
// job reads player_projections, it makes no external HTTP call of its own (unlike
// scripts/settle-predictions.ts, which does).
//
// Every multi-row Supabase read goes through scripts/lib/paginate.ts's fetchAllPages +
// assertRowCountMatches (ticket #43's convention) — player_projections for one gameweek can be
// ~600 rows, close enough to the 1,000-row db-max-rows ceiling to require it.
//
// Upsert only, never delete: this file issues no Supabase row-removal call anywhere.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'

const JOB_NAME = 'snapshot-predictions'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'
const PREDICTION_LOG_MIGRATION = 'supabase/migrations/20260821090000_prediction_log.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated, not imported; see that file's header and scripts/emit-projections-csv.ts's identical precedent for why every scripts/*.ts job is a standalone entry point. */
export const MODEL_VERSION = 'baseline-v1'

/** Rows written per upsert call — same batch size as project-points.ts, well under any PostgREST/Supabase request-size limit for a full ~600-player gameweek. */
const UPSERT_BATCH_SIZE = 500

// ============================================================================
// Env — identical contract to every other scripts/*.ts job.
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
      `${JOB_NAME}: required environment variables are not set. ` +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

class SnapshotError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'SnapshotError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

// Same PGRST205 / 42P01 recognition as every other job in scripts/.
function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
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
// The freeze/capture decision — PURE, no I/O, no Date.now()/argument-less new Date() anywhere.
// This is the single place the "before deadline: overwrite; after deadline: freeze" rule lives.
// ============================================================================

export type SnapshotDecision =
  | { outcome: 'captured' }
  | { outcome: 'skipped-after-deadline'; message: string }
  | { outcome: 'skipped-no-projections'; message: string }

export interface DecideSnapshotActionInput {
  gameweekId: number
  deadlineIso: string
  /** Current instant in epoch milliseconds. Always a parameter — never read from the system clock in this function. */
  nowMs: number
  /** How many player_projections rows exist for this gameweek at MODEL_VERSION. */
  projectionRowCount: number
}

/**
 * Deadline is checked BEFORE row count: the freeze rule is this ticket's single most important
 * line (see file header), so a gameweek past its deadline is reported as frozen even in the
 * (unlikely) edge case where its player_projections rows have since disappeared — "no
 * projections" is never allowed to mask a freeze that should have applied.
 */
export function decideSnapshotAction(input: DecideSnapshotActionInput): SnapshotDecision {
  const deadlineMs = new Date(input.deadlineIso).getTime()

  if (input.nowMs >= deadlineMs) {
    return {
      outcome: 'skipped-after-deadline',
      message:
        `gameweek ${input.gameweekId}'s deadline (${input.deadlineIso}) has passed — the snapshot is frozen and will not ` +
        'be overwritten. This is expected: the deadline-day run and every run after it should see this message.',
    }
  }

  if (input.projectionRowCount === 0) {
    return {
      outcome: 'skipped-no-projections',
      message:
        `gameweek ${input.gameweekId} has zero player_projections rows at model_version='${MODEL_VERSION}' — ` +
        'nothing to snapshot yet. Run scripts/project-points.ts first.',
    }
  }

  return { outcome: 'captured' }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
  deadline_time: string
}

interface ProjectionRow {
  gameweek_id: number
  player_id: number
  player_code: number | null
  expected_points: number
  expected_minutes: number
  components: unknown
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. The current gameweek: gameweeks.is_next, same convention every
    //    other job in this repo uses for "current gameweek".
    //
    //    A season has 38 gameweeks, well under the 1,000-row db-max-rows
    //    ceiling, but paginated and count-verified anyway — this ticket's
    //    own DoD asks for every Supabase read to go through
    //    scripts/lib/paginate.ts, matching scripts/notification-schedule.ts's
    //    identical treatment of this same table.
    // --------------------------------------------------------------------
    const {
      rows: gwRows,
      error: gwError,
      pages: gwPagesFetched,
    } = await fetchAllPages<GameweekRow>((from, to) =>
      supabase
        .from('gameweeks')
        .select('id, is_next, deadline_time')
        .order('id', { ascending: true })
        .range(from, to)
        .returns<GameweekRow[]>(),
    )
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new SnapshotError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new SnapshotError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const { count: gwRowsExpectedByCount, error: gwCountError } = await supabase
      .from('gameweeks')
      .select('*', { count: 'exact', head: true })
    if (gwCountError) {
      throw new SnapshotError(`gameweeks count check failed: ${gwCountError.message}`, 'gameweeks')
    }
    assertRowCountMatches('gameweeks', gwRows.length, gwRowsExpectedByCount ?? 0)

    if (gwRows.length === 0) {
      throw new SnapshotError('the gameweeks table is empty. Run scripts/ingest-fpl.ts before snapshotting predictions.', 'gameweeks')
    }

    const currentGw = gwRows.find((gw) => gw.is_next)
    if (!currentGw) {
      throw new SnapshotError(
        'no gameweek has is_next = true. Run scripts/ingest-fpl.ts to refresh gameweeks, or the season has ended.',
        'gameweeks',
      )
    }

    // --------------------------------------------------------------------
    // 2. player_projections for the current gameweek at MODEL_VERSION.
    //    Paginated and count-verified (~600 rows, close to the 1,000-row
    //    db-max-rows ceiling) — see scripts/lib/paginate.ts.
    // --------------------------------------------------------------------
    const {
      rows: projectionRows,
      error: projectionsError,
      pages: projectionPagesFetched,
    } = await fetchAllPages<ProjectionRow>((from, to) =>
      supabase
        .from('player_projections')
        .select('gameweek_id, player_id, player_code, expected_points, expected_minutes, components')
        .eq('gameweek_id', currentGw.id)
        .eq('model_version', MODEL_VERSION)
        .range(from, to)
        .returns<ProjectionRow[]>(),
    )
    if (projectionsError) {
      if (isMissingTable(projectionsError, 'player_projections')) {
        throw new SnapshotError(
          `the "player_projections" table does not exist. Apply ${PLAYER_PROJECTIONS_MIGRATION} first.`,
          'player_projections',
        )
      }
      throw new SnapshotError(`player_projections lookup failed: ${projectionsError.message}`, 'player_projections')
    }

    const { count: projectionRowsExpectedByCount, error: projectionsCountError } = await supabase
      .from('player_projections')
      .select('*', { count: 'exact', head: true })
      .eq('gameweek_id', currentGw.id)
      .eq('model_version', MODEL_VERSION)
    if (projectionsCountError) {
      throw new SnapshotError(`player_projections count check failed: ${projectionsCountError.message}`, 'player_projections')
    }
    assertRowCountMatches('player_projections', projectionRows.length, projectionRowsExpectedByCount ?? 0)

    // --------------------------------------------------------------------
    // 3. Decide. Pure — see decideSnapshotAction() above.
    // --------------------------------------------------------------------
    const nowMs = Date.now()
    const decision = decideSnapshotAction({
      gameweekId: currentGw.id,
      deadlineIso: currentGw.deadline_time,
      nowMs,
      projectionRowCount: projectionRows.length,
    })

    if (decision.outcome !== 'captured') {
      console.log(`${JOB_NAME}: ${decision.message}`)
      await recordJobRun(supabase, {
        status: 'skipped',
        message: `${JOB_NAME}: ${decision.message}`,
        details: {
          gameweekId: currentGw.id,
          outcome: decision.outcome,
          projectionRowsFetched: projectionRows.length,
          projectionRowsExpectedByCount: projectionRowsExpectedByCount ?? 0,
          projectionPagesFetched,
          gwRowsFetched: gwRows.length,
          gwRowsExpectedByCount: gwRowsExpectedByCount ?? 0,
          gwPagesFetched,
        },
        startedAt,
      })
      return
    }

    // --------------------------------------------------------------------
    // 4. Capture: upsert into prediction_log, batched, stamping captured_at
    //    once per row for this run. Overwrites any prior snapshot for this
    //    (gameweek_id, player_id, model_version) — latest-before-deadline
    //    wins, per the freeze rule.
    // --------------------------------------------------------------------
    const capturedAtIso = new Date(nowMs).toISOString()
    const rowsToUpsert: JsonRecord[] = projectionRows.map((row) => ({
      gameweek_id: row.gameweek_id,
      player_id: row.player_id,
      model_version: MODEL_VERSION,
      player_code: row.player_code,
      projected_points: row.expected_points,
      projected_minutes: row.expected_minutes,
      components: row.components,
      captured_at: capturedAtIso,
    }))

    for (let i = 0; i < rowsToUpsert.length; i += UPSERT_BATCH_SIZE) {
      const batch = rowsToUpsert.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await supabase
        .from('prediction_log')
        .upsert(batch, { onConflict: 'gameweek_id,player_id,model_version' })
      if (error) {
        if (isMissingTable(error, 'prediction_log')) {
          throw new SnapshotError(`the "prediction_log" table does not exist. Apply ${PREDICTION_LOG_MIGRATION} first.`, 'prediction_log')
        }
        throw new SnapshotError(`upsert into "prediction_log" failed: ${error.message}`, 'prediction_log')
      }
    }

    const details: JsonRecord = {
      gameweekId: currentGw.id,
      outcome: decision.outcome,
      rowsWritten: rowsToUpsert.length,
      capturedAt: capturedAtIso,
      projectionRowsFetched: projectionRows.length,
      projectionRowsExpectedByCount: projectionRowsExpectedByCount ?? 0,
      projectionPagesFetched,
      gwRowsFetched: gwRows.length,
      gwRowsExpectedByCount: gwRowsExpectedByCount ?? 0,
      gwPagesFetched,
    }
    const message = `${JOB_NAME}: snapshotted ${rowsToUpsert.length} row(s) for gameweek ${currentGw.id} (model_version='${MODEL_VERSION}').`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof SnapshotError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

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

// Guarded, matching every other scripts/*.ts job: importing this module (e.g. from a test file)
// must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
