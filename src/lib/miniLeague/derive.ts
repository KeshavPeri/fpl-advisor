/**
 * Pure derivation for the mini-league standings card (ticket #271). No I/O — takes every row
 * api.ts read for the latest ingested gameweek and returns a fully-resolved `MiniLeagueView` the
 * component renders with no further logic, matching src/lib/accuracy/derive.ts's own pure/impure
 * split.
 *
 * DISPLAY ONLY. This module (and everything else under src/lib/miniLeague/) must never be
 * imported by src/lib/scoring/, src/lib/projection/, or anything that feeds the solver or a
 * recommendation — product-brief.md §1's hard line. There is nothing here for that code to want
 * anyway (no points model, no objective function), but the boundary is stated so it stays that
 * way on purpose, not by accident.
 */
import type { MiniLeagueStandingRow, MiniLeagueView } from './types.ts'

export const EMPTY_STATE_MESSAGE = 'Standings appear after the first gameweek is ingested.'

/** How many rows to show when Keshav's own entry can't be matched (entryNotInLeague) — just
 *  enough for the card to read as a real leaderboard rather than a single bare row. Tier 3 —
 *  see decisions/ticket-271.md. */
const FALLBACK_ROW_COUNT = 3

function byRankAscending(a: MiniLeagueStandingRow, b: MiniLeagueStandingRow): number {
  const rankA = a.rank ?? Number.POSITIVE_INFINITY
  const rankB = b.rank ?? Number.POSITIVE_INFINITY
  return rankA - rankB
}

/** Collapses a list that may repeat the same manager (e.g. `above` and `leader` are the same row
 *  when `you` is 2nd) into one row per entryId, in rank order. */
function dedupeByEntryId(rows: readonly (MiniLeagueStandingRow | null)[]): MiniLeagueStandingRow[] {
  const seen = new Set<number>()
  const result: MiniLeagueStandingRow[] = []
  for (const row of rows) {
    if (!row || seen.has(row.entryId)) continue
    seen.add(row.entryId)
    result.push(row)
  }
  return result.sort(byRankAscending)
}

/**
 * `fplEntryId` is VITE_FPL_ENTRY_ID as read by src/lib/squad/env.ts's getFplEntryId() — a string
 * or null. Standings rows carry entryId as a number, so this parses defensively rather than
 * assuming the env var is always a clean integer string.
 */
function parseEntryId(fplEntryId: string | null): number | null {
  if (fplEntryId === null) return null
  const trimmed = fplEntryId.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

export function deriveMiniLeagueView(
  rows: readonly MiniLeagueStandingRow[],
  fplEntryId: string | null
): MiniLeagueView {
  if (rows.length === 0) {
    return {
      hasData: false,
      emptyStateMessage: EMPTY_STATE_MESSAGE,
      gameweekId: null,
      leagueSize: 0,
      you: null,
      entryNotInLeague: false,
      leader: null,
      above: null,
      below: null,
      gapToLeader: null,
      gapToAbove: null,
      movement: null,
      rows: [],
    }
  }

  const sorted = [...rows].sort(byRankAscending)
  const leader = sorted[0]
  const gameweekId = sorted[0].gameweekId
  const leagueSize = sorted.length

  const entryIdNum = parseEntryId(fplEntryId)
  const youIndex = entryIdNum === null ? -1 : sorted.findIndex((row) => row.entryId === entryIdNum)

  if (youIndex === -1) {
    return {
      hasData: true,
      emptyStateMessage: null,
      gameweekId,
      leagueSize,
      you: null,
      entryNotInLeague: true,
      leader,
      above: null,
      below: null,
      gapToLeader: null,
      gapToAbove: null,
      movement: null,
      rows: dedupeByEntryId(sorted.slice(0, FALLBACK_ROW_COUNT)),
    }
  }

  const you = sorted[youIndex]
  const above = youIndex > 0 ? sorted[youIndex - 1] : null
  const below = youIndex < sorted.length - 1 ? sorted[youIndex + 1] : null

  const gapToLeader =
    you.total !== null && leader.total !== null ? leader.total - you.total : null
  const gapToAbove =
    above && you.total !== null && above.total !== null ? above.total - you.total : null
  const movement = you.lastRank !== null && you.rank !== null ? you.lastRank - you.rank : null

  return {
    hasData: true,
    emptyStateMessage: null,
    gameweekId,
    leagueSize,
    you,
    entryNotInLeague: false,
    leader,
    above,
    below,
    gapToLeader,
    gapToAbove,
    movement,
    rows: dedupeByEntryId([leader, above, you, below]),
  }
}
