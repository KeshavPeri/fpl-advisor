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

/**
 * One entry in `MiniLeagueView.rows` (ticket #276) — either a real standings row, or a divider
 * marking a skipped rank range between the top-3 block and the "you ± 1" block below it. A
 * discriminated union rather than `MiniLeagueStandingRow | null` so a caller can never mistake a
 * divider for a row with missing data — the two are rendered completely differently
 * (MiniLeagueCard.tsx).
 */
export type MiniLeagueRowEntry = { kind: 'row'; row: MiniLeagueStandingRow } | { kind: 'divider' }

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
  /** leader.total - you.total. 0 exactly when `you` is the leader. Null when `you` is null or
   *  either total is unavailable. */
  gapToLeader: number | null
  /** above.total - you.total. Null when there is no row above (you're the leader), when `you`
   *  is null, or when either total is unavailable. */
  gapToAbove: number | null
  /** Ticket #276 — you.total - (rank 2's) total, only ever populated when `isLeading` is true;
   *  null otherwise, including when there's no rank-2 row to compare against. The gap bar's own
   *  "Leading by N" figure when you're 1st (gapToAbove is null in that case, by construction —
   *  there's no row above the leader). */
  leadOverSecond: number | null
  /** you.lastRank - you.rank — positive means rank improved (moved up) since the previous
   *  gameweek, negative means it fell. Null when `you` is null or lastRank is unavailable (e.g.
   *  the league's first-ever recorded gameweek). */
  movement: number | null
  /** Ticket #276 — true exactly when `you` is rank 1 (gapToLeader === 0). Drives the card's one
   *  "premium moment" (a crown glyph) — false, never true, when `you` is null. */
  isLeading: boolean
  /** Ticket #276 — top 3 by rank, plus `you` and the rows immediately above/below `you` when
   *  `you` falls outside the top 3 (a rank already in the top 3 adds nothing new — deduplicated
   *  by entryId). A `{kind:'divider'}` entry marks every place this list's own rank sequence
   *  skips at least one rank, so MiniLeagueCard can render "···" there rather than implying a
   *  contiguous table. When `you` is null (entryNotInLeague), this is the top 3 rows instead, so
   *  the card still shows something meaningful. */
  rows: readonly MiniLeagueRowEntry[]
}
