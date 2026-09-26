import { fetchExistingSquad, fetchPlayers } from '../squad/api'
import { supabase } from '../supabase'
import type { ChipAdvisoryRow, ChipPlayerOption, ChipRebuildPickRow, ChipSourceData, ChipUsageRecord, GameweekDeadline, SquadAdvisoryRow } from './types.ts'

/**
 * The solver's own two-letter codes for the chip-TIMING advisory (ticket
 * #126) — TC/BB only, matching src/lib/chips/derive.ts's own
 * SOLVER_CHIP_DISPLAY_NAMES. Named here, not re-derived from that map,
 * because api.ts has no reason to import derive.ts's display-name
 * vocabulary just to get a filter list — this module already keeps its own
 * local copies of raw shapes it reads (see ChipAdvisoryDbRow below).
 */
const CHIP_TIMING_CODES = ['TC', 'BB'] as const
/** The solver's own two-letter codes for the squad-REBUILD advisory (ticket #134) — WC/FH only. Never overlaps CHIP_TIMING_CODES above. */
const SQUAD_REBUILD_CODES = ['WC', 'FH'] as const

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

/** One row of `public.chip_advisories` where chip_code is 'WC'/'FH', as selected below — see scripts/store-squad-advisory.ts for how it is written. `id` is chip_advisories' own append-only identity primary key, read here (not solver_run_id) since squad-rebuild rows are dispatched irregularly, not nightly — see the query's own comment. */
interface SquadAdvisoryDbRow {
  id: number
  chip_code: string
  delta: number
}

/** One row of `public.chip_rebuild_picks`, as selected below — ticket #284. See scripts/store-squad-advisory.ts for how it is written. */
interface ChipRebuildPickDbRow {
  chip_advisory_id: number
  player_id: number
  player_code: number | null
  position: string
  is_starting: boolean
  bench_order: number | null
  is_captain: boolean
  is_vice_captain: boolean
  expected_points: number
}

/**
 * Same shape scripts/store-squad-advisory.ts's own isMissingTable uses —
 * ticket #284. `chip_rebuild_picks` is a NEW table in this same ticket, and
 * Vercel auto-deploys `main` the moment this PR merges while applying its
 * migration to the live Supabase project is a separate, owner-only,
 * post-merge step (supabase/README.md) — so this screen must tolerate the
 * table not existing yet for however long that gap lasts, rather than
 * turning the whole Chips screen into an error page over a table that
 * merely hasn't been migrated in yet. `chip_advisories` itself predates this
 * ticket and is never treated this way — only the query below, which is new.
 */
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
  // Chip advisory (ticket #126, item 27) — every stored TC/BB row for the
  // current/next gameweek, newest solver_run_id first, then filtered down
  // to just that newest run's own rows below. `chip_advisories` is
  // append-only (a re-run of the same gameweek adds new rows rather than
  // overwriting — see that migration's header), so without this filter an
  // older night's advisory would linger alongside tonight's. Bounded by an
  // explicit `.limit()`, matching this file's own convention above: at
  // most a handful of chips are ever played per solve (two, in the one
  // real example observed), across at most a few solutions, so this can
  // never approach PostgREST's 1,000-row cap.
  //
  // `.in('chip_code', CHIP_TIMING_CODES)` (ticket #134) — this table now
  // also carries squad-rebuild rows (chip_code 'WC'/'FH', a DIFFERENT
  // question, see the squad-advisory read below), written from a
  // completely separate, manually-dispatched workflow with its OWN
  // solver_run_id anchor. Without this filter, a squad-rebuild-probe run
  // dispatched after tonight's nightly chip-enabled solve could have a
  // NEWER solver_run_id than any TC/BB row, and `latestSolverRunId` below
  // would silently resolve to a run that has no TC/BB rows at all —
  // emptying this list even though a real chip-timing advisory exists.
  // --------------------------------------------------------------------
  let chipAdvisories: ChipAdvisoryRow[] = []
  const squadAdvisories: SquadAdvisoryRow[] = []
  let players: ChipPlayerOption[] = []
  let existingSquadPlayerIds: ReadonlySet<number> | null = null
  if (nextGameweek !== null) {
    const { data: advisoryRows, error: advisoryError } = await supabase
      .from('chip_advisories')
      .select('chip_code, chip_gameweek_id, delta, solution_index, solver_run_id')
      .eq('gameweek_id', nextGameweek.id)
      .in('chip_code', CHIP_TIMING_CODES)
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

    // ------------------------------------------------------------------
    // Squad-rebuild advisory (ticket #134, item 28; nightly since #284) —
    // the WC/FH rows the query above deliberately excludes. Every matching
    // row is passed through (never pre-deduped here) — ticket #284 moved
    // "keep only the latest row per chip code" into derive.ts's own
    // latestSquadAdvisoryPerChip, so that reduction is a pure, unit-tested
    // function rather than logic buried in this query. Bounded by the same
    // `.limit(50)` discipline this file's own header comment establishes.
    // ------------------------------------------------------------------
    const { data: squadRebuildRows, error: squadRebuildError } = await supabase
      .from('chip_advisories')
      .select('id, chip_code, delta')
      .eq('gameweek_id', nextGameweek.id)
      .in('chip_code', SQUAD_REBUILD_CODES)
      .order('id', { ascending: false })
      .limit(50)
      .returns<SquadAdvisoryDbRow[]>()
    if (squadRebuildError) raise(squadRebuildError)

    // ------------------------------------------------------------------
    // Ticket #284 — the fifteen stored picks behind EVERY one of those rows
    // (not just the latest per chip — see above), if any. `chip_rebuild_
    // picks` may not exist on the live database yet (see isMissingTable's
    // own comment above) — that failure is swallowed, never thrown, leaving
    // every SquadAdvisoryRow.picks empty (derive.ts then renders no "See
    // the squad" disclosure) rather than failing the whole screen over a
    // table that merely hasn't been migrated in yet. Bounded: at most 15
    // rows per advisory, at most 50 advisories (the query above's own
    // limit), so `.limit(750)` can never approach PostgREST's 1,000-row cap.
    // ------------------------------------------------------------------
    const advisoryIds = (squadRebuildRows ?? []).map((row) => row.id)
    const pickRowsByAdvisoryId = new Map<number, ChipRebuildPickDbRow[]>()
    if (advisoryIds.length > 0) {
      const { data: pickRows, error: pickError } = await supabase
        .from('chip_rebuild_picks')
        .select('chip_advisory_id, player_id, player_code, position, is_starting, bench_order, is_captain, is_vice_captain, expected_points')
        .in('chip_advisory_id', advisoryIds)
        .limit(750)
        .returns<ChipRebuildPickDbRow[]>()
      if (pickError && !isMissingTable(pickError, 'chip_rebuild_picks')) raise(pickError)
      for (const row of pickRows ?? []) {
        const list = pickRowsByAdvisoryId.get(row.chip_advisory_id)
        if (list) list.push(row)
        else pickRowsByAdvisoryId.set(row.chip_advisory_id, [row])
      }
    }

    for (const row of squadRebuildRows ?? []) {
      const picks: ChipRebuildPickRow[] = (pickRowsByAdvisoryId.get(row.id) ?? []).map((p) => ({
        playerId: p.player_id,
        playerCode: p.player_code,
        position: p.position,
        isStarting: p.is_starting,
        benchOrder: p.bench_order,
        isCaptain: p.is_captain,
        isViceCaptain: p.is_vice_captain,
        expectedPoints: p.expected_points,
      }))
      squadAdvisories.push({ id: row.id, chipCode: row.chip_code as 'WC' | 'FH', delta: row.delta, gameweekId: nextGameweek.id, picks })
    }

    // ------------------------------------------------------------------
    // Ticket #284 — the wider player pool and the currently-saved squad,
    // read only when there is at least one squad-rebuild row to show a
    // "See the squad" disclosure for; nothing else on this screen needs
    // either. `fetchPlayers`/`fetchExistingSquad` are src/lib/squad/api.ts's
    // own reads, reused rather than duplicated (this ticket's own scope).
    // ------------------------------------------------------------------
    if (squadAdvisories.length > 0) {
      const [playerRows, existingSquad] = await Promise.all([fetchPlayers(), fetchExistingSquad(nextGameweek.id)])
      players = playerRows.map((p) => ({ id: p.id, webName: p.webName, elementType: p.elementType }))
      existingSquadPlayerIds = existingSquad ? new Set(existingSquad.picks.map((p) => p.playerId)) : null
    }
  }

  return { chipsUsed, gameweeks, chipAdvisories, squadAdvisories, players, existingSquadPlayerIds }
}
