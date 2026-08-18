import { supabase } from '../supabase'
import type { PositionCode } from './positions'
import type { SelectablePlayer, TargetGameweek } from './types'

/**
 * supabase-js does not reject with an `Error` on a Postgrest-level failure —
 * it resolves `{ data: null, error }`, where `error` is a plain
 * `{ message, details, hint, code }` object. Wrapping it in a real `Error`
 * here (rather than `throw error` at each call site) means every caller's
 * `catch` block gets normal `Error` behaviour — `instanceof Error`,
 * `.stack`, `.message` — instead of having to know about supabase-js's
 * shape. `cause` keeps the original object around for anyone who does want
 * `.details`/`.hint`/`.code`. See src/lib/format.ts's toErrorMessage, which
 * also handles the case, for the incident this fixes (QA, ticket #13
 * revision round 1: an un-wrapped error object rendered as "[object
 * Object]" in the UI).
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

interface GameweekRow {
  id: number
  name: string
  deadline_time: string
}

/**
 * The gameweek this screen edits: the lowest `gameweeks.id` whose deadline
 * hasn't passed yet, or the highest id if every deadline has passed
 * (product-brief.md / ticket #13 notes, pre-answered — do not re-litigate).
 * Returns null if `gameweeks` is empty (the #11 ingest job hasn't run yet).
 */
export async function fetchTargetGameweek(): Promise<TargetGameweek | null> {
  const { data, error } = await supabase
    .from('gameweeks')
    .select('id, name, deadline_time')
    .order('id', { ascending: true })
    .returns<GameweekRow[]>()

  if (error) raise(error)
  if (!data || data.length === 0) return null

  const now = Date.now()
  const next = data.find((gw) => new Date(gw.deadline_time).getTime() > now)
  const target = next ?? data[data.length - 1]

  return { id: target.id, name: target.name, deadlineTime: target.deadline_time }
}

interface PlayerRow {
  id: number
  code: number
  web_name: string
  team_id: number
  element_type: PositionCode
  now_cost: number
  status: string
  chance_of_playing_next_round: number | null
  teams: { short_name: string } | { short_name: string }[] | null
}

/**
 * The selectable player pool, from the #11-filled `players` table.
 *
 * `status` and `chance_of_playing_next_round` were added by ticket #61 —
 * fetchPlayers is the only existing read that supplies player name/position/
 * price to the home screen's pitch (see HomeScreen.tsx), and it was the one
 * read missing these two columns, which is why every shirt rendered with no
 * availability ring until now. See pitchAvailability.ts's deriveAvailability
 * for the rules these two fields feed.
 */
export async function fetchPlayers(): Promise<SelectablePlayer[]> {
  const { data, error } = await supabase
    .from('players')
    .select(
      'id, code, web_name, team_id, element_type, now_cost, status, chance_of_playing_next_round, teams(short_name)'
    )
    .order('web_name', { ascending: true })
    .returns<PlayerRow[]>()

  if (error) raise(error)

  return (data ?? []).map((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    return {
      id: row.id,
      code: row.code,
      webName: row.web_name,
      teamId: row.team_id,
      teamShortName: team?.short_name ?? '',
      elementType: row.element_type,
      nowCost: row.now_cost,
      status: row.status,
      chanceOfPlayingNextRound: row.chance_of_playing_next_round,
    }
  })
}

export interface ExistingSquad {
  bank: number
  squadValue: number
  freeTransfers: number
  picks: Array<{
    squadPosition: number
    playerId: number
    isStarting: boolean
    benchOrder: number | null
    isCaptain: boolean
    isViceCaptain: boolean
  }>
}

/** The saved squad for a gameweek, or null if nothing has been saved yet. */
export async function fetchExistingSquad(gameweekId: number): Promise<ExistingSquad | null> {
  const { data: squadRow, error: squadError } = await supabase
    .from('squads')
    .select('bank, squad_value, free_transfers')
    .eq('gameweek_id', gameweekId)
    .maybeSingle()

  if (squadError) raise(squadError)
  if (!squadRow) return null

  const { data: pickRows, error: picksError } = await supabase
    .from('squad_picks')
    .select('squad_position, player_id, is_starting, bench_order, is_captain, is_vice_captain')
    .eq('gameweek_id', gameweekId)
    .order('squad_position', { ascending: true })

  if (picksError) raise(picksError)

  return {
    bank: squadRow.bank,
    squadValue: squadRow.squad_value,
    freeTransfers: squadRow.free_transfers,
    picks: (pickRows ?? []).map((row) => ({
      squadPosition: row.squad_position,
      playerId: row.player_id,
      isStarting: row.is_starting,
      benchOrder: row.bench_order,
      isCaptain: row.is_captain,
      isViceCaptain: row.is_vice_captain,
    })),
  }
}

export interface SavePickInput {
  squadPosition: number
  playerId: number
  playerCode: number
  isStarting: boolean
  benchOrder: number | null
  isCaptain: boolean
  isViceCaptain: boolean
}

export interface SaveSquadInput {
  bank: number
  squadValue: number
  freeTransfers: number
  picks: SavePickInput[]
}

/**
 * Persists a full squad for a gameweek: upserts the `squads` row, then
 * replaces all fifteen `squad_picks` rows (delete + insert — this screen's
 * only writer, so a full replace is simpler and safer than diffing fifteen
 * rows in place; see the migration file for why DELETE is granted).
 * source is always 'manual' here — this is the manual-entry screen.
 */
export async function saveSquad(gameweekId: number, input: SaveSquadInput): Promise<void> {
  const { error: upsertError } = await supabase.from('squads').upsert({
    gameweek_id: gameweekId,
    bank: input.bank,
    squad_value: input.squadValue,
    free_transfers: input.freeTransfers,
    source: 'manual',
    updated_at: new Date().toISOString(),
  })
  if (upsertError) raise(upsertError)

  const { error: deleteError } = await supabase
    .from('squad_picks')
    .delete()
    .eq('gameweek_id', gameweekId)
  if (deleteError) raise(deleteError)

  const rows = input.picks.map((pick) => ({
    gameweek_id: gameweekId,
    squad_position: pick.squadPosition,
    player_id: pick.playerId,
    player_code: pick.playerCode,
    is_starting: pick.isStarting,
    bench_order: pick.benchOrder,
    is_captain: pick.isCaptain,
    is_vice_captain: pick.isViceCaptain,
  }))

  const { error: insertError } = await supabase.from('squad_picks').insert(rows)
  if (insertError) raise(insertError)
}
