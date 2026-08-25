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

/** The raw `recommended` sub-object (ticket #107), snake_cased and
 *  read exactly as stored — `jsonb` enforces no shape, so every field is
 *  optional here even though src/lib/override/api.ts's `registerOverride`
 *  always writes all seven; see ./types.ts's `RecommendedSnapshot` for why
 *  a missing key must render as "not recorded", not error or fabricate. */
interface DbRecommendedSnapshot {
  is_roll?: boolean
  transfer_in_player_id?: number | null
  transfer_out_player_id?: number | null
  captain_player_id?: number
  vice_captain_player_id?: number
  hit_cost?: number
  solver_run_id?: number | null
}

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
    // Absent (undefined) for a commit and for every override registered
    // before #107 — normalized to `null` below, never left `undefined`, so
    // ./types.ts's DecisionSnapshot has exactly one "absent" value to check
    // for (see that type's own comment).
    recommended?: DbRecommendedSnapshot | null
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
      decisionRows.flatMap((row) => {
        const recommended = row.snapshot.recommended
        return [
          row.snapshot.transfer_in_player_id,
          row.snapshot.transfer_out_player_id,
          row.snapshot.captain_player_id,
          row.snapshot.vice_captain_player_id,
          // Ticket #107: the recommended side (when present) references its
          // own player ids, independent of the decided side's — both must
          // resolve to a name for the comparison to render correctly.
          recommended?.transfer_in_player_id,
          recommended?.transfer_out_player_id,
          recommended?.captain_player_id,
          recommended?.vice_captain_player_id,
        ].filter((id): id is number => id !== null && id !== undefined)
      })
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
      // Ticket #107. `?? null` normalizes an absent key (undefined) to the
      // same `null` used for "no recommended side at all" — never left as
      // `undefined` (see DbDecisionRow's own comment and
      // ./types.ts's DecisionSnapshot). A recommended object that IS
      // present but missing one of ITS OWN seven keys is passed through
      // as-is: derive.ts's comparison renders that specific field as "not
      // recorded" (DoD), which is a different case from no object at all.
      recommended: row.snapshot.recommended
        ? {
            isRoll: row.snapshot.recommended.is_roll,
            transferInPlayerId: row.snapshot.recommended.transfer_in_player_id,
            transferOutPlayerId: row.snapshot.recommended.transfer_out_player_id,
            captainPlayerId: row.snapshot.recommended.captain_player_id,
            viceCaptainPlayerId: row.snapshot.recommended.vice_captain_player_id,
            hitCost: row.snapshot.recommended.hit_cost,
            solverRunId: row.snapshot.recommended.solver_run_id,
          }
        : null,
    },
  }))

  const gameweeks: DecisionGameweek[] = gameweekRows.map((gw) => ({
    id: gw.id,
    name: gw.name,
    deadlineTime: gw.deadline_time,
  }))

  return { decisions, gameweeks, playerNames }
}
