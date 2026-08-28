import { supabase } from '../supabase'
import type { ChipAdvisoryRow, ChipSourceData, ChipUsageRecord, GameweekDeadline } from './types.ts'

/**
 * Same wrapping as src/lib/squad/api.ts's raise() / src/lib/verdict/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

interface GameweekRow {
  id: number
  deadline_time: string
  is_next: boolean
}

interface SquadsChipsRow {
  chips_used: unknown
}

/** One row of `public.chip_advisories`, as selected below — see scripts/store-chip-advisory.ts for how it is written. */
interface ChipAdvisoryDbRow {
  chip_code: string
  chip_gameweek_id: number
  delta: number
  solution_index: number
  solver_run_id: number
}

/**
 * `squads.chips_used` is stored as jsonb — defensively parsed rather than
 * trusted as already matching `ChipUsageRecord[]`, the same posture
 * scripts/sync-squad.ts's own `parseChips` takes on the API response this
 * column was written from. A malformed entry is dropped rather than thrown
 * on: this is read-only display of already-stored state, and one bad entry
 * must not blank the whole screen.
 */
function parseChipsUsed(raw: unknown): ChipUsageRecord[] {
  if (!Array.isArray(raw)) return []
  const result: ChipUsageRecord[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = record.name
    if (typeof name !== 'string' || name.trim() === '') continue
    const eventRaw = record.event
    const event = typeof eventRaw === 'number' && Number.isFinite(eventRaw) ? eventRaw : null
    const timeRaw = record.time
    const time = typeof timeRaw === 'string' ? timeRaw : null
    result.push({ name, event, time })
  }
  return result
}

/**
 * Reads everything `deriveChipState` (./derive.ts) needs. Read-only — no
 * write path exists in this ticket (Scope OUT: "No writes of any kind").
 *
 * Both queries below are bounded by construction, matching the convention
 * src/lib/verdict/api.ts and src/lib/reasoning/api.ts establish (an explicit
 * filter/limit on every query rather than trusting an unbounded scan, so
 * none of them can approach PostgREST's silent 1,000-row cap): `gameweeks`
 * holds one row per FPL gameweek (38 a season) and the `squads` read below is
 * `.limit(1)`. Neither can grow into pagination territory regardless of how
 * many seasons this app runs across — there is nothing here for a `.range()`
 * loop to do, the same conclusion reasoning/api.ts's own header reaches for
 * its bounded reads.
 */
export async function fetchChipSourceData(): Promise<ChipSourceData> {
  const { data: gwRows, error: gwError } = await supabase
    .from('gameweeks')
    .select('id, deadline_time, is_next')
    .order('id', { ascending: true })
    .returns<GameweekRow[]>()
  if (gwError) raise(gwError)

  const gameweeks: GameweekDeadline[] = (gwRows ?? []).map((row) => ({
    id: row.id,
    deadlineMs: new Date(row.deadline_time).getTime(),
  }))
  const nextGameweek = (gwRows ?? []).find((row) => row.is_next) ?? null

  // The most recently synced squads row — "most recently" meaning the
  // highest gameweek_id row that actually exists, never an assumption that
  // a row exists for the current/next gameweek: a gameweek's row is written
  // only once that gameweek's api_sync run has happened
  // (scripts/sync-squad.ts), so the latest one written is the latest one
  // that CAN exist. Filtered to source = 'api_sync' because that is the
  // only writer that ever populates chips_used with real data — the manual
  // squad-entry screen (source = 'manual') never touches the column and
  // leaves it at its schema default ('[]'), so ordering across every source
  // could return an empty chips_used for a LATER gameweek's manual save even
  // though an EARLIER api_sync row already recorded a real chip. No rows at
  // all (nothing synced yet) resolves to an empty array below, matching
  // "no chips used" rather than an error.
  const { data: squadRows, error: squadError } = await supabase
    .from('squads')
    .select('chips_used')
    .eq('source', 'api_sync')
    .order('gameweek_id', { ascending: false })
    .limit(1)
    .returns<SquadsChipsRow[]>()
  if (squadError) raise(squadError)

  const chipsUsed = parseChipsUsed((squadRows ?? [])[0]?.chips_used)

  // --------------------------------------------------------------------
  // Chip advisory (ticket #126, item 27) — every stored row for the
  // current/next gameweek, newest solver_run_id first, then filtered down
  // to just that newest run's own rows below. `chip_advisories` is
  // append-only (a re-run of the same gameweek adds new rows rather than
  // overwriting — see that migration's header), so without this filter an
  // older night's advisory would linger alongside tonight's. Bounded by an
  // explicit `.limit()`, matching this file's own convention above: at
  // most a handful of chips are ever played per solve (two, in the one
  // real example observed), across at most a few solutions, so this can
  // never approach PostgREST's 1,000-row cap.
  // --------------------------------------------------------------------
  let chipAdvisories: ChipAdvisoryRow[] = []
  if (nextGameweek !== null) {
    const { data: advisoryRows, error: advisoryError } = await supabase
      .from('chip_advisories')
      .select('chip_code, chip_gameweek_id, delta, solution_index, solver_run_id')
      .eq('gameweek_id', nextGameweek.id)
      .order('solver_run_id', { ascending: false })
      .order('solution_index', { ascending: true })
      .limit(50)
      .returns<ChipAdvisoryDbRow[]>()
    if (advisoryError) raise(advisoryError)

    const latestSolverRunId = (advisoryRows ?? [])[0]?.solver_run_id ?? null
    chipAdvisories = (advisoryRows ?? [])
      .filter((row) => row.solver_run_id === latestSolverRunId)
      .map((row) => ({
        chipCode: row.chip_code,
        chipGameweekId: row.chip_gameweek_id,
        delta: row.delta,
        solutionIndex: row.solution_index,
      }))
  }

  return { chipsUsed, gameweeks, chipAdvisories }
}
