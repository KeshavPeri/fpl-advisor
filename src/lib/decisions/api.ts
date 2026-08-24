import { supabase } from '../supabase'
import type { DecisionGameweek, DecisionHistorySource, DecisionSourceRow } from './types.ts'

/**
 * Same wrapping as src/lib/verdict/api.ts's raise() / src/lib/commit/api.ts's
 * own copy — supabase-js resolves `{ data: null, error }` on a Postgrest-
 * level failure rather than rejecting, so every caller re-throws as a real
 * Error here. See src/lib/format.ts's toErrorMessage for the full "because".
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

/**
 * PostgREST's own db-max-rows ceiling on this project — 1000, silent, no
 * error, no partial-result marker — see src/lib/accuracy/api.ts's own header
 * for the incident that established this convention
 * (scripts/emit-projections-csv.ts read an unbounded table and silently got
 * 1,000 of 2,935 rows). `recommendation_decisions` is small today (at most a
 * couple of rows per gameweek) but grows for as long as this app runs, and
 * DoD: "Every Supabase read paginates" — so this loop exists regardless of
 * the current row count, matching src/lib/accuracy/api.ts's own
 * fetchPredictionLog: request pages of PAGE_SIZE until one comes back
 * shorter than PAGE_SIZE (including empty), the one signal a server-side cap
 * cannot fake.
 */
const PAGE_SIZE = 1000

interface DbDecisionRow {
  gameweek_id: number
  plan_index: number
  kind: 'commit' | 'override'
  decided_at: string
  snapshot: {
    is_roll: boolean
    transfer_in_player_id: number | null
    transfer_out_player_id: number | null
    captain_player_id: number
    vice_captain_player_id: number
    hit_cost: number | null
    solver_run_id: number | null
  }
}

/** Every `recommendation_decisions` row that exists, both kinds, every
 *  gameweek — deriveDecisionHistoryView (./derive.ts) does the newest-first
 *  ordering and every bit of arithmetic; this function's only job is to hand
 *  it a complete set. No `.eq('kind', …)` filter: this ticket reads both
 *  `commit` and `override` rows in the one query, per the same-key-names
 *  precedent src/lib/override/api.ts's `fetchOverrideDecisions` already
 *  establishes for reading across both kinds at once. */
async function fetchAllDecisionRows(): Promise<DbDecisionRow[]> {
  const rows: DbDecisionRow[] = []
  let from = 0

  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('recommendation_decisions')
      .select('gameweek_id, plan_index, kind, decided_at, snapshot')
      .order('decided_at', { ascending: true })
      .range(from, to)
      .returns<DbDecisionRow[]>()

    if (error) raise(error)

    const page = data ?? []
    rows.push(...page)

    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

interface DbGameweekRow {
  id: number
  name: string
  deadline_time: string
}

/** Every gameweek this season (and any future one already loaded) — used
 *  both to resolve a decision's gameweek name and to count how many
 *  gameweeks have elapsed (derive.ts's own headline arithmetic). Paginated
 *  for the same reason fetchAllDecisionRows is: small today, but the rule is
 *  about the class of bug, not the current row count (see that function's
 *  own comment). */
async function fetchAllGameweeks(): Promise<DbGameweekRow[]> {
  const rows: DbGameweekRow[] = []
  let from = 0

  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('gameweeks')
      .select('id, name, deadline_time')
      .order('id', { ascending: true })
      .range(from, to)
      .returns<DbGameweekRow[]>()

    if (error) raise(error)

    const page = data ?? []
    rows.push(...page)

    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

interface PlayerNameRow {
  id: number
  web_name: string
}

/**
 * Reads everything deriveDecisionHistoryView needs in one call: every
 * decision row, every gameweek (for names and the elapsed-gameweeks count),
 * and player names for every id any snapshot references. Player names are
 * resolved here, not left to the caller, so derive.ts stays pure and so an
 * unresolvable id (players are re-keyed between seasons — see
 * DecisionHistorySource's own comment) can be handled once, in one place.
 *
 * The `players` lookup itself is bounded by `.in('id', ids)` to exactly the
 * ids this batch of decisions references — the same shape
 * src/lib/verdict/api.ts's own playerNames lookup uses — so it cannot
 * approach the 1,000-row cap regardless of table size; there is nothing here
 * for a pagination loop to do.
 */
export async function fetchDecisionHistorySource(): Promise<DecisionHistorySource> {
  const [decisionRows, gameweekRows] = await Promise.all([
    fetchAllDecisionRows(),
    fetchAllGameweeks(),
  ])

  const gameweekNames = new Map<number, string>(gameweekRows.map((gw) => [gw.id, gw.name]))

  const playerIds = Array.from(
    new Set(
      decisionRows.flatMap((row) =>
        [
          row.snapshot.transfer_in_player_id,
          row.snapshot.transfer_out_player_id,
          row.snapshot.captain_player_id,
          row.snapshot.vice_captain_player_id,
        ].filter((id): id is number => id !== null)
      )
    )
  )

  const playerNames = new Map<number, string>()
  if (playerIds.length > 0) {
    const { data: playerRows, error: playerError } = await supabase
      .from('players')
      .select('id, web_name')
      .in('id', playerIds)
      .returns<PlayerNameRow[]>()

    if (playerError) raise(playerError)
    for (const row of playerRows ?? []) {
      playerNames.set(row.id, row.web_name)
    }
  }

  const decisions: DecisionSourceRow[] = decisionRows.map((row) => ({
    gameweekId: row.gameweek_id,
    gameweekName: gameweekNames.get(row.gameweek_id) ?? `Gameweek ${String(row.gameweek_id)}`,
    planIndex: row.plan_index,
    kind: row.kind,
    decidedAt: row.decided_at,
    snapshot: {
      isRoll: row.snapshot.is_roll,
      transferInPlayerId: row.snapshot.transfer_in_player_id,
      transferOutPlayerId: row.snapshot.transfer_out_player_id,
      captainPlayerId: row.snapshot.captain_player_id,
      viceCaptainPlayerId: row.snapshot.vice_captain_player_id,
      hitCost: row.snapshot.hit_cost,
      solverRunId: row.snapshot.solver_run_id,
    },
  }))

  const gameweeks: DecisionGameweek[] = gameweekRows.map((gw) => ({
    id: gw.id,
    name: gw.name,
    deadlineTime: gw.deadline_time,
  }))

  return { decisions, gameweeks, playerNames }
}
