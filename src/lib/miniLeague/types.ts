/**
 * Types for the mini-league standings card (ticket #271, feature-list item 33). product-brief.md
 * §1: mini-league standings "may be *displayed*. They must never enter the optimiser's
 * objective." §5 pre-approves storing them for display only. This module (and everything under
 * src/lib/miniLeague/) is read only by MiniLeagueCard — nothing in src/lib/scoring/,
 * src/lib/projection/ or the solver input ever imports from here.
 *
 * Same house pattern as src/lib/accuracy/, src/lib/verdict/, src/lib/reasoning/: api.ts does I/O
 * and resolves raw rows into the camelCased type below, derive.ts is pure and does every bit of
 * arithmetic and wording, the component renders derive.ts's output with no further logic of its
 * own.
 */

/**
 * One `mini_league_standings` row, camelCased 1:1 from the migration's columns
 * (supabase/migrations/20260925090000_mini_league_standings.sql). `entryName`/`playerName`/
 * `rank`/`lastRank`/`total`/`eventTotal` stay nullable here, matching the underlying columns —
 * the API can in principle omit any of these, and this ticket did not have live access to verify
 * otherwise (see the migration's own header).
 */
export interface MiniLeagueStandingRow {
  leagueId: number
  gameweekId: number
  entryId: number
  entryName: string | null
  playerName: string | null
  rank: number | null
  lastRank: number | null
  total: number | null
  eventTotal: number | null
  fetchedAt: string
}

/** Fully-resolved display data for MiniLeagueCard — the component does no further derivation. */
export interface MiniLeagueView {
  hasData: boolean
  /** Present only when hasData is false — states what the card is waiting for, never a spinner
   *  or a blank panel. */
  emptyStateMessage: string | null
  /** The gameweek these standings were captured for. Null only alongside hasData: false. */
  gameweekId: number | null
  /** Number of managers in the league at this gameweek — the "of N" in "rank X of N". 0 only
   *  alongside hasData: false. */
  leagueSize: number
  /** Keshav's own row, matched by VITE_FPL_ENTRY_ID. Null when hasData is false, OR when his
   *  entry could not be matched against this league's rows (see entryNotInLeague). */
  you: MiniLeagueStandingRow | null
  /** True when standings exist for this league/gameweek but Keshav's own entry id (from
   *  VITE_FPL_ENTRY_ID) is unset or does not appear among them — a genuinely different state
   *  from "no data at all" (hasData: false), never collapsed into it. */
  entryNotInLeague: boolean
  /** Rank 1 in this gameweek's standings. Null only alongside hasData: false. */
  leader: MiniLeagueStandingRow | null
  /** The row immediately above `you` by rank. Null when `you` is the leader, or when `you` is
   *  null. */
  above: MiniLeagueStandingRow | null
  /** The row immediately below `you` by rank. Null when `you` is last, or when `you` is null. */
  below: MiniLeagueStandingRow | null
  /** leader.total - you.total. 0 exactly when `you` is the leader. Null when `you` is null or
   *  either total is unavailable. */
  gapToLeader: number | null
  /** above.total - you.total. Null when there is no row above (you're the leader), when `you`
   *  is null, or when either total is unavailable. */
  gapToAbove: number | null
  /** you.lastRank - you.rank — positive means rank improved (moved up) since the previous
   *  gameweek, negative means it fell. Null when `you` is null or lastRank is unavailable (e.g.
   *  the league's first-ever recorded gameweek). */
  movement: number | null
  /** The compact table MiniLeagueCard renders: leader, above, you (highlighted), below, in rank
   *  order, deduplicated by entryId (adjacent positions collapse into one row — e.g. `above` and
   *  `leader` are the same manager when `you` is 2nd). When `you` is null (entryNotInLeague),
   *  this is the top few rows by rank instead, so the card still shows something meaningful. */
  rows: readonly MiniLeagueStandingRow[]
}
