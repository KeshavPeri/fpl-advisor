/**
 * Pure derivation for the mini-league standings card (ticket #271, redesigned by ticket #276). No
 * I/O — takes every row api.ts read for the latest ingested gameweek and returns a fully-resolved
 * `MiniLeagueView` the component renders with no further logic, matching src/lib/accuracy/derive.ts's
 * own pure/impure split.
 *
 * DISPLAY ONLY. This module (and everything else under src/lib/miniLeague/) must never be
 * imported by src/lib/scoring/, src/lib/projection/, or anything that feeds the solver or a
 * recommendation — product-brief.md §1's hard line. There is nothing here for that code to want
 * anyway (no points model, no objective function), but the boundary is stated so it stays that
 * way on purpose, not by accident.
 *
 * Ticket #276 ("Round 2 → Mini-league" in docs/ui-audit-2026-09-25.md): "make it satisfying yet
 * premium." The table used to be a fixed leader/above/you/below shape; it's now "top 3, plus you
 * ± 1 if you're outside them, with a divider for skipped ranks" — see `MiniLeagueRowEntry` in
 * types.ts and `deriveMiniLeagueView` below.
 */
import type { MiniLeagueRowEntry, MiniLeagueStandingRow, MiniLeagueView } from './types.ts'

export const EMPTY_STATE_MESSAGE = 'Standings appear after the first gameweek is ingested.'

/** How many rows sit at the top of the table, always — both the entryNotInLeague fallback and
 *  the ordinary "top 3, plus you ± 1" shape (ticket #276's own wording). */
const TOP_ROW_COUNT = 3

function byRankAscending(a: MiniLeagueStandingRow, b: MiniLeagueStandingRow): number {
  const rankA = a.rank ?? Number.POSITIVE_INFINITY
  const rankB = b.rank ?? Number.POSITIVE_INFINITY
  return rankA - rankB
}

/** Collapses a list that may repeat the same manager (e.g. the "you ± 1" neighbourhood overlaps
 *  the top-3 block when `you` sits just outside it) into one row per entryId, in rank order. */
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
 * Inserts a `{kind:'divider'}` entry wherever two consecutive rows' own `rank` values are not
 * adjacent (ticket #276: "a divider for skipped ranks") — e.g. top 3 then a gap before "you ± 1"
 * once you're outside the top 3. A null `rank` on either side never triggers a divider: standings
 * rows carry `rank` nullable (the migration's own column), and there's nothing reliable to
 * compare in that case, so this stays silent rather than guessing.
 */
function withDividers(rows: readonly MiniLeagueStandingRow[]): MiniLeagueRowEntry[] {
  const entries: MiniLeagueRowEntry[] = []
  rows.forEach((row, index) => {
    const previous = rows[index - 1]
    if (previous && previous.rank !== null && row.rank !== null && row.rank - previous.rank > 1) {
      entries.push({ kind: 'divider' })
    }
    entries.push({ kind: 'row', row })
  })
  return entries
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
      gapToLeader: null,
      gapToAbove: null,
      leadOverSecond: null,
      movement: null,
      isLeading: false,
      rows: [],
    }
  }

  const sorted = [...rows].sort(byRankAscending)
  const leader = sorted[0]
  const second = sorted.length > 1 ? sorted[1] : null
  const gameweekId = sorted[0].gameweekId
  const leagueSize = sorted.length
  const top3 = sorted.slice(0, TOP_ROW_COUNT)

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
      gapToLeader: null,
      gapToAbove: null,
      leadOverSecond: null,
      movement: null,
      isLeading: false,
      rows: withDividers(top3),
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
  const isLeading = gapToLeader === 0
  const leadOverSecond =
    isLeading && second && you.total !== null && second.total !== null
      ? you.total - second.total
      : null

  // Ticket #276: "top 3, plus you ± 1 if you're outside them." Already inside the top 3
  // (youIndex < TOP_ROW_COUNT) means top3 alone already contains you — the neighbourhood adds
  // nothing new, so it's left empty rather than dragging in ranks 4/5 for someone in 2nd.
  const neighbourhood =
    youIndex < TOP_ROW_COUNT
      ? []
      : [above, you, below].filter((row): row is MiniLeagueStandingRow => row !== null)

  return {
    hasData: true,
    emptyStateMessage: null,
    gameweekId,
    leagueSize,
    you,
    entryNotInLeague: false,
    leader,
    above,
    gapToLeader,
    gapToAbove,
    leadOverSecond,
    movement,
    isLeading,
    rows: withDividers(dedupeByEntryId([...top3, ...neighbourhood])),
  }
}
