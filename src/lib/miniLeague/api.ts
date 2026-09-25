import { supabase } from '../supabase'
import type { MiniLeagueStandingRow } from './types.ts'

/**
 * Same wrapping as src/lib/accuracy/api.ts's raise() / src/lib/squad/api.ts's own copy —
 * supabase-js resolves `{ data: null, error }` on a Postgrest-level failure rather than
 * rejecting, so every caller re-throws as a real Error here. See src/lib/format.ts's
 * toErrorMessage for the full "because".
 */
function raise(error: { message: string }): never {
  throw new Error(error.message, { cause: error })
}

/**
 * config/mini-league.json's leagueId (848654, not a secret — see that file). Duplicated here
 * rather than statically imported: config/ sits outside tsconfig.app.json's "include": ["src"]
 * root, and importing across that boundary would need a tsconfig change this ticket's file
 * scope does not list (CLAUDE.md's "a ticket whose scope constraint lists exact files must list
 * the build config too"). A single non-secret integer constant is a small, low-risk duplication
 * — nothing like the scoring/projection logic CLAUDE.md's sharing rule exists to protect against
 * drifting. Tier 3 — see decisions/ticket-271.md.
 */
const LEAGUE_ID = 848654

interface DbMiniLeagueStandingRow {
  league_id: number
  gameweek_id: number
  entry_id: number
  entry_name: string | null
  player_name: string | null
  rank: number | null
  last_rank: number | null
  total: number | null
  event_total: number | null
  fetched_at: string
}

/**
 * Reads every `mini_league_standings` row for the latest ingested gameweek of this app's one
 * configured league. Two reads: first the max gameweek_id for this league (cheap — an ordered,
 * limit-1 select), then every row for that (league_id, gameweek_id) pair. No pagination needed:
 * a classic league has ~20 managers, far under PostgREST's 1,000-row db-max-rows ceiling (see
 * src/lib/accuracy/api.ts's own header for the incident that ceiling caused elsewhere in this
 * repo when a read genuinely needed to page).
 *
 * Returns an empty array when nothing has been ingested yet — deriveMiniLeagueView
 * (./derive.ts) turns that into the card's honest empty state, never a spinner or a zero.
 */
export async function fetchLatestMiniLeagueStandings(): Promise<MiniLeagueStandingRow[]> {
  const { data: latestRows, error: latestError } = await supabase
    .from('mini_league_standings')
    .select('gameweek_id')
    .eq('league_id', LEAGUE_ID)
    .order('gameweek_id', { ascending: false })
    .limit(1)
    .returns<{ gameweek_id: number }[]>()

  if (latestError) raise(latestError)

  const latestGameweekId = latestRows?.[0]?.gameweek_id ?? null
  if (latestGameweekId === null) return []

  const { data, error } = await supabase
    .from('mini_league_standings')
    .select(
      'league_id, gameweek_id, entry_id, entry_name, player_name, rank, last_rank, total, event_total, fetched_at'
    )
    .eq('league_id', LEAGUE_ID)
    .eq('gameweek_id', latestGameweekId)
    .order('rank', { ascending: true })
    .returns<DbMiniLeagueStandingRow[]>()

  if (error) raise(error)

  return (data ?? []).map((row) => ({
    leagueId: row.league_id,
    gameweekId: row.gameweek_id,
    entryId: row.entry_id,
    entryName: row.entry_name,
    playerName: row.player_name,
    rank: row.rank,
    lastRank: row.last_rank,
    total: row.total,
    eventTotal: row.event_total,
    fetchedAt: row.fetched_at,
  }))
}
