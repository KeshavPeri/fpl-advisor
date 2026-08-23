import { supabase } from '../supabase'
import type { PredictionLogRow } from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() / src/lib/verdict/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

interface DbPredictionLogRow {
  gameweek_id: number
  model_version: string
  projected_points: number
  projected_minutes: number
  captured_at: string
  actual_points: number | null
  actual_minutes: number | null
  settled_at: string | null
  error: number | null
}

/**
 * PostgREST's own db-max-rows ceiling on this project — 1000, silent, no
 * error, no partial-result marker (see scripts/lib/paginate.ts's own header
 * for the incident this caused elsewhere in this repo: emit-projections-csv.ts
 * read player_projections unbounded and got exactly 1,000 of 2,935 rows,
 * zero-filling the rest as if they didn't exist). Unlike
 * src/lib/verdict/api.ts's or src/lib/reasoning/api.ts's own reads — each
 * bounded by a small, fixed filter (one recommendation's few dozen rows) so
 * neither needs to page — this read has no such bound:
 * `prediction_log` grows ~600 rows/GW and the settled subset alone passes
 * 1,000 within two gameweeks (ticket's own DoD). So this function pages
 * explicitly with `.range()`, requesting pages of PAGE_SIZE until one comes
 * back shorter than PAGE_SIZE (including empty) — the one signal that
 * cannot be produced by a server-side cap silently truncating a full page —
 * the same termination rule scripts/lib/paginate.ts's fetchAllPages uses.
 * Not imported from there: scripts/ and src/ are separate compilation
 * environments and CLAUDE.md's sharing rule runs one way (scripts/ may
 * import src/lib/, never the reverse) — this loop is small and
 * self-contained enough that it isn't worth being the ticket that crosses
 * that boundary backwards.
 */
const PAGE_SIZE = 1000

/**
 * Reads every SETTLED `prediction_log` row (`settled_at IS NOT NULL`) —
 * across every gameweek and every model_version. deriveAccuracyView
 * (./derive.ts) is the one place that decides which model_version is
 * "current" and does every bit of arithmetic; this function's only job is
 * handing it a complete set of rows to work from.
 *
 * Filtered to settled rows at the database level, not fetched-all-then-
 * filtered-in-memory: unsettled rows carry no actual_* data this card could
 * ever use (the migration's own column comments — a row with settled_at IS
 * NULL "has not been measured yet"), and excluding them here halves the
 * volume this function has to page through once a gameweek's pre-deadline
 * snapshot rows have accumulated but before settlement has run for it.
 * deriveAccuracyView still narrows on `settledAt`/`actualPoints`/
 * `actualMinutes` itself as a second, pure-layer guard — see that file's own
 * header for why the same rule is enforced twice.
 *
 * Returns an empty array when nothing has settled yet — deriveAccuracyView
 * turns that into the card's honest empty state, never a spinner or a zero.
 */
export async function fetchPredictionLog(): Promise<PredictionLogRow[]> {
  const rows: PredictionLogRow[] = []
  let from = 0

  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('prediction_log')
      .select(
        'gameweek_id, model_version, projected_points, projected_minutes, captured_at, ' +
          'actual_points, actual_minutes, settled_at, error'
      )
      .not('settled_at', 'is', null)
      .order('gameweek_id', { ascending: true })
      .range(from, to)
      .returns<DbPredictionLogRow[]>()

    if (error) raise(error)

    const page = data ?? []
    for (const row of page) {
      rows.push({
        gameweekId: row.gameweek_id,
        modelVersion: row.model_version,
        projectedPoints: row.projected_points,
        projectedMinutes: row.projected_minutes,
        capturedAt: row.captured_at,
        actualPoints: row.actual_points,
        actualMinutes: row.actual_minutes,
        settledAt: row.settled_at,
        storedError: row.error,
      })
    }

    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}
