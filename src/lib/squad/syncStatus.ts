import { supabase } from '../supabase'

const JOB_NAME = 'sync-squad'

function raise(error: { message: string }): never {
  // Same wrapping as src/lib/squad/api.ts's raise() — see that file's
  // comment for why a plain PostgREST error object needs this.
  throw new Error(error.message, { cause: error })
}

export interface SquadDiff {
  addedPlayerIds: number[]
  removedPlayerIds: number[]
  startingChangedPlayerIds: number[]
  captainChanged: boolean
  viceCaptainChanged: boolean
}

export type SyncReason =
  | 'no_deadline_passed'
  | 'picks_not_published'
  | 'diff_detected'
  | 'established'
  | 'confirmed'

interface JobRunRow {
  status: string
  message: string
  details: Record<string, unknown> | null
  finished_at: string | null
}

export interface SquadSyncStatus {
  /** The most recent scripts/sync-squad.ts run for THIS gameweek, if any has run. */
  lastRunForGameweek: {
    status: string
    message: string
    finishedAt: string | null
    reason: SyncReason | null
    diff: SquadDiff | null
  } | null
  /**
   * The most recent successful sync-squad run's finished_at, across every
   * gameweek — this is a whole-app health signal (product-brief.md §6a: the
   * app must show when it last successfully talked to the API), not scoped
   * to one gameweek.
   */
  lastSuccessfulSyncAt: string | null
  /**
   * True only when the single most recent sync-squad run of any kind
   * outright failed. A 'skipped' run (no deadline yet, picks not published)
   * is a normal state, not staleness — see scripts/sync-squad.ts's own
   * distinction between 'failure' and 'skipped'.
   */
  isStale: boolean
}

/**
 * Reads scripts/sync-squad.ts's own job_runs rows back out for display —
 * ticket #14's "visible last-successful-sync timestamp" and "the difference
 * is … surfaced" DoD items. Deliberately reuses job_runs rather than adding
 * squads columns for this: every fact needed (status, message, per-gameweek
 * reason, diff) is already written there by the sync job, and job_runs is
 * already readable by `anon` (see the #10 migration's SELECT policy).
 */
export async function fetchSquadSyncStatus(gameweekId: number): Promise<SquadSyncStatus> {
  const { data, error } = await supabase
    .from('job_runs')
    .select('status, message, details, finished_at')
    .eq('job_name', JOB_NAME)
    .order('started_at', { ascending: false })
    .limit(20)
    .returns<JobRunRow[]>()

  if (error) raise(error)

  const rows = data ?? []
  const mostRecent = rows[0] ?? null
  const mostRecentForGameweek = rows.find((r) => r.details?.gameweekId === gameweekId) ?? null
  const lastSuccess = rows.find((r) => r.status === 'success')

  return {
    lastRunForGameweek: mostRecentForGameweek
      ? {
          status: mostRecentForGameweek.status,
          message: mostRecentForGameweek.message,
          finishedAt: mostRecentForGameweek.finished_at,
          reason: (mostRecentForGameweek.details?.reason as SyncReason | undefined) ?? null,
          diff: (mostRecentForGameweek.details?.diff as SquadDiff | undefined) ?? null,
        }
      : null,
    lastSuccessfulSyncAt: lastSuccess?.finished_at ?? null,
    isStale: mostRecent !== null && mostRecent.status === 'failure',
  }
}
