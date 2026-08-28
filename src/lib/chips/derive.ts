/**
 * Chip state derivation — ticket #85 (feature-list item 25, "the unblocker
 * for the rest of wave 7"), extended by ticket #97 (item 26, "warn before an
 * unused chip expires") with the expiry urgency band below. Pure, matching
 * src/lib/notification/schedule.ts's own convention exactly: `supabase`,
 * `fetch` and `useEffect` appear nowhere in this file, and no clock is ever
 * read — `Date.now()` and an argument-less `new Date()` never appear here.
 * The current instant is always a parameter (`nowMs` below), so the same
 * (ChipSourceData, nowMs) pair always produces the same result and this
 * module is fully testable with no faked clock.
 *
 * This module decides WHICH chips are used/remaining/lost, HOW LONG the
 * active set has left, and (ticket #97) HOW URGENT that remaining time is —
 * it never recommends a chip to play. That's item 27, still out of scope
 * here (see the ticket's own Scope OUT).
 */

import { formatDeadlineInstant } from '../deadlineCountdown'
import type {
  ChipAdvisoryDecision,
  ChipAdvisoryRow,
  ChipAdvisoryView,
  ChipExpiryBand,
  ChipExpiryWarning,
  ChipSetTimeRemaining,
  ChipSlotView,
  ChipSourceData,
  DerivedChipState,
  FirstChipSetView,
  GameweekDeadline,
  KnownChipId,
  RemainingChipView,
  SecondChipSetView,
  SquadAdvisoryRow,
  SquadAdvisoryView,
  UsedChipView,
} from './types.ts'

/**
 * The gameweek that splits the season's eight chips into two sets of four:
 * the first set (Wildcard, Free Hit, Bench Boost, Triple Captain) must be
 * used by THIS gameweek's own deadline or it is lost for the season — no
 * carry-over. Verified 22 Aug 2026 against the Premier League's 2026/27
 * changes announcement (product-brief.md §6d) and cross-checked against a
 * live read of `bootstrap-static/`'s top-level "chips" array: each of the
 * four identifiers below appears twice — once with `stop_event: 19`, once
 * with `start_event: 20` — which is the API's own confirmation of exactly
 * this boundary. The actual deadline INSTANT is never taken from here; it is
 * always read from `public.gameweeks` (see api.ts) — this constant only says
 * which gameweek id to look up.
 */
export const FIRST_CHIP_SET_LAST_GAMEWEEK = 19

/**
 * FPL API chip identifier -> display name. One named constant, per the
 * ticket's DoD, with its source below rather than recalled from training:
 * live read of `https://fantasy.premierleague.com/api/bootstrap-static/`,
 * 22 Aug 2026, top-level "chips" array — id/name/start_event/stop_event for
 * all eight rows (the four identifiers below, each once per set). FPL's
 * `entry/{id}/history/` "chips" array — what scripts/sync-squad.ts stores
 * verbatim in `squads.chips_used` — uses these exact identifier strings in
 * its own "name" field.
 *
 * An identifier not listed here is NOT dropped. FPL has added and removed
 * chips before (the Assistant Manager chip existed in 2024/25 and was
 * removed for 2025/26) — deriveChipState below renders anything unrecognised
 * as an explicit unknown-chip entry, still present in `usedChips` and still
 * counted in its set's `usedCount`, per the ticket's own DoD.
 */
export const CHIP_DISPLAY_NAMES: Readonly<Record<KnownChipId, string>> = {
  wildcard: 'Wildcard',
  freehit: 'Free Hit',
  bboost: 'Bench Boost',
  '3xc': 'Triple Captain',
}

const KNOWN_CHIP_IDS = Object.keys(CHIP_DISPLAY_NAMES) as KnownChipId[]
const CHIPS_PER_SET = KNOWN_CHIP_IDS.length // 4 — one of each identifier above.

function isKnownChipId(id: string): id is KnownChipId {
  return Object.prototype.hasOwnProperty.call(CHIP_DISPLAY_NAMES, id)
}

/**
 * Which of the two sets a used chip belongs to, from the gameweek it was
 * used in. 'unknown' only when FPL reported no event number for the usage —
 * there is nothing safe to assume about which side of the deadline it fell
 * on, so it is excluded from both sets' counts (still present in the raw
 * `usedChips` list — see deriveChipState).
 */
function classifySet(gameweekId: number | null): 'first' | 'second' | 'unknown' {
  if (gameweekId === null) return 'unknown'
  return gameweekId <= FIRST_CHIP_SET_LAST_GAMEWEEK ? 'first' : 'second'
}

/**
 * The gameweek "now" sits in: the lowest gameweek id whose deadline hasn't
 * passed yet, or the highest id if every deadline has passed — the same
 * "target gameweek" rule src/lib/squad/api.ts's fetchTargetGameweek applies,
 * reimplemented here as a pure function of (gameweeks, nowMs) rather than of
 * the system clock, so it stays inside this file's no-I/O contract. Null
 * when `gameweeks` is empty (nothing ingested yet).
 */
function resolveCurrentGameweekId(gameweeks: readonly GameweekDeadline[], nowMs: number): number | null {
  if (gameweeks.length === 0) return null
  const next = gameweeks.find((gw) => gw.deadlineMs > nowMs)
  return (next ?? gameweeks[gameweeks.length - 1]).id
}

/** The known chips NOT in `usedKnownIds`, in the constant's own display order. */
function remainingList(usedKnownIds: ReadonlySet<KnownChipId>): RemainingChipView[] {
  return KNOWN_CHIP_IDS.filter((id) => !usedKnownIds.has(id)).map((id) => ({
    id,
    displayName: CHIP_DISPLAY_NAMES[id],
  }))
}

/**
 * All four known chip types resolved to exactly one status each — the
 * checklist the screen actually renders, so a used chip carries its own
 * gameweek rather than just a struck-through name (this ticket's own DoD).
 * `usedGameweekLabels` holds an entry only for chips used IN THIS SET.
 * `canBeLost` is false for the second set, which has no known expiry within
 * this ticket's scope — an unused second-set chip is always 'remaining'.
 */
function buildSlots(
  usedGameweekLabels: ReadonlyMap<KnownChipId, string>,
  expired: boolean,
  canBeLost: boolean
): ChipSlotView[] {
  return KNOWN_CHIP_IDS.map((id) => {
    const gameweekLabel = usedGameweekLabels.get(id) ?? null
    if (gameweekLabel !== null) {
      return { id, displayName: CHIP_DISPLAY_NAMES[id], status: 'used' as const, gameweekLabel }
    }
    const status = canBeLost && expired ? ('lost' as const) : ('remaining' as const)
    return { id, displayName: CHIP_DISPLAY_NAMES[id], status, gameweekLabel: null }
  })
}

/**
 * The escalation table, pre-answered by the ticket — do not invent other
 * thresholds. Boundaries: strictly more than 8 is 'none'; 5 through 8
 * inclusive is 'noted'; 3 through 4 inclusive is 'pressing'; 2 or fewer is
 * 'final'. Only ever called with a non-negative `gameweeksRemaining` (the
 * caller already excludes the expired case), but the fall-through to
 * 'final' below is also the correct answer if it were ever called at 0 or
 * negative — the tightest band, never a crash.
 */
/**
 * Ticket #126 (item 27). Solver chip-code -> display name — DELIBERATELY a
 * separate constant from CHIP_DISPLAY_NAMES above: that map is keyed by
 * FPL's OWN chip identifiers ('wildcard', 'bboost', '3xc', ...), read from
 * squads.chips_used; this one is keyed by the SOLVER's own two-letter codes
 * ('TC', 'BB'), read from scripts/lib/solver-output.ts's parse of
 * dev/solver.py's stdout — two different vocabularies for the same four
 * chips, never conflated. Only TC/BB have ever been observed (see that
 * module's own header) — item 28 (Wildcard/Free Hit) is out of scope here.
 */
export const SOLVER_CHIP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  TC: 'Triple Captain',
  BB: 'Bench Boost',
}

/**
 * The fixed sentence design-reference.md's DoD requires: "a plain sentence
 * stating that the solver sees only five gameweeks and therefore always
 * favours playing a chip early." One constant, never composed per-row —
 * see ChipsScreen.tsx, which renders it once beneath the advisory list, not
 * once per chip.
 */
export const CHIP_ADVISORY_HORIZON_NOTE =
  'The solver only sees five gameweeks ahead, so it always favours playing a chip now rather than saving it for a later one it cannot see.'

/**
 * Ticket #141. Collapses `rows` — one row per (chip played, solution) from
 * the solver's stored solutions, already filtered by api.ts to the latest
 * solver run — into one entry per DISTINCT plan those solutions propose,
 * fixing the two display defects the ticket exists for:
 *
 * 1. **Six rows where there should be two.** When every solution names the
 *    same chip(s) in the same gameweek(s), that is one decision shown three
 *    times over, not three decisions. Grouping by solution first, then by
 *    each solution's own *set* of (chipCode, chipGameweekId) pairs, means
 *    identical solutions collapse to a single plan; solutions that
 *    genuinely disagree produce genuinely distinct plans.
 * 2. **The delta belongs to the pair, not each chip.** `chip_advisories`
 *    replicates one solution's objective delta onto every chip row within
 *    that solution (see ChipAdvisoryRow's own doc comment) — so this reads
 *    that shared value ONCE per distinct plan (from its first solution)
 *    and attaches it to the plan as a whole via ChipAdvisoryView.deltaWhole,
 *    never to an individual ChipAdvisoryDecision. There is no measurement
 *    of either chip alone; printing one against each would invent two
 *    numbers from one.
 *
 * `solutionCount` / `totalSolutionCount` are computed against the number of
 * DISTINCT solutionIndex values actually present in `rows` — the only count
 * this data can honestly give (a solution that played no chip at all leaves
 * no row here to count). When only one plan results, every solution that
 * named a chip agreed, so `solutionCount === totalSolutionCount` always
 * holds for it; the count only becomes informative once solutions disagree,
 * which is exactly when the screen renders it (see ChipsScreen.tsx).
 *
 * Decisions within a plan are sorted by gameweek, then chip code, so
 * grouping is independent of whatever order the database returned rows in.
 */
function deriveChipAdvisories(rows: readonly ChipAdvisoryRow[]): ChipAdvisoryView[] {
  if (rows.length === 0) return []

  const bySolution = new Map<number, ChipAdvisoryRow[]>()
  for (const row of rows) {
    const existing = bySolution.get(row.solutionIndex)
    if (existing) existing.push(row)
    else bySolution.set(row.solutionIndex, [row])
  }
  const totalSolutionCount = bySolution.size

  interface PlanAccumulator {
    decisions: readonly ChipAdvisoryRow[]
    delta: number
    solutionCount: number
  }
  const plans = new Map<string, PlanAccumulator>()

  for (const solutionRows of bySolution.values()) {
    const sortedDecisions = [...solutionRows].sort((a, b) =>
      a.chipGameweekId !== b.chipGameweekId
        ? a.chipGameweekId - b.chipGameweekId
        : a.chipCode.localeCompare(b.chipCode)
    )
    const key = sortedDecisions.map((row) => `${row.chipCode}@${row.chipGameweekId}`).join('|')
    const existingPlan = plans.get(key)
    if (existingPlan) {
      existingPlan.solutionCount += 1
    } else {
      plans.set(key, { decisions: sortedDecisions, delta: sortedDecisions[0].delta, solutionCount: 1 })
    }
  }

  return Array.from(plans.values()).map((plan) => {
    const decisions: ChipAdvisoryDecision[] = plan.decisions.map((row) => ({
      chipCode: row.chipCode,
      displayName: SOLVER_CHIP_DISPLAY_NAMES[row.chipCode] ?? `Unknown chip (${row.chipCode})`,
      chipGameweekId: row.chipGameweekId,
      gameweekLabel: `Gameweek ${row.chipGameweekId}`,
    }))
    return {
      decisions,
      deltaWhole: Math.round(plan.delta),
      solutionCount: plan.solutionCount,
      totalSolutionCount,
    }
  })
}

/**
 * Ticket #134 (item 28). Squad-rebuild chip code -> display name —
 * DELIBERATELY a separate constant from both CHIP_DISPLAY_NAMES (FPL's own
 * chip identifiers) and SOLVER_CHIP_DISPLAY_NAMES (the solver's TC/BB
 * timing-advisory codes) above: WC/FH here are the solver's own two-letter
 * codes too, read from scripts/lib/solver-output.ts's parse of the
 * squad-rebuild-probe's stdout, but they never appear in
 * SOLVER_CHIP_DISPLAY_NAMES — that map's own test asserts it "maps exactly
 * the two chip codes ever observed" (TC/BB) and must keep doing so; WC/FH
 * are a different question (a full-squad rebuild, not a chip PLAYED within
 * the current squad) with their own display path below.
 */
export const SQUAD_ADVISORY_DISPLAY_NAMES: Readonly<Record<'WC' | 'FH', string>> = {
  WC: 'Wildcard',
  FH: 'Free Hit',
}

/**
 * The fixed sentence design-reference.md's DoD requires: "a sentence
 * stating that it is a five-gameweek view and that a wildcard's real value
 * depends on fixtures the model cannot see." One constant, never composed
 * per-row — see ChipsScreen.tsx, which renders it once beneath the
 * squad-advisory list, matching CHIP_ADVISORY_HORIZON_NOTE's own pattern.
 * Deliberately mentions both chips generically (never singles out only
 * "wildcard") since squadAdvisories can hold a Free Hit row, a Wildcard
 * row, or both — see the ticket's own Notes: "report both as one-gameweek
 * rebuild gaps and say so."
 */
export const SQUAD_ADVISORY_HORIZON_NOTE =
  "This is a five-gameweek view — a wildcard or free hit's real value depends on fixtures the model cannot see."

/**
 * Resolves each stored squad-rebuild advisory row for display. `delta` is
 * already a database-computed figure (chip_advisories' own GENERATED
 * column, same one CHIP/TC/BB advisories share) — this only rounds it to a
 * whole number, per design-reference.md's "no decimal projected-points
 * values" rule, and attaches a display name. Every SquadAdvisoryRow's
 * `chipCode` is already narrowed to 'WC' | 'FH' by api.ts's own query (see
 * that file), so there is no "unknown chip" fallback to render here — unlike
 * deriveChipAdvisories above, which reads a bare `string` chip_code that can
 * genuinely be anything.
 */
function deriveSquadAdvisories(rows: readonly SquadAdvisoryRow[]): SquadAdvisoryView[] {
  return rows.map((row) => ({
    chipCode: row.chipCode,
    displayName: SQUAD_ADVISORY_DISPLAY_NAMES[row.chipCode],
    deltaWhole: Math.round(row.delta),
  }))
}

function bandForGameweeksRemaining(gameweeksRemaining: number): ChipExpiryBand {
  if (gameweeksRemaining > 8) return 'none'
  if (gameweeksRemaining >= 5) return 'noted'
  if (gameweeksRemaining >= 3) return 'pressing'
  return 'final'
}

/**
 * The ticket's own adjustment: "when 2+ chips in the active set are unused,
 * the band moves up one level — because two chips can't both be played in
 * the last gameweek." One step only, and 'final' has nowhere further to go.
 * Never applied to 'none' — more than 8 gameweeks out is still nothing to
 * warn about regardless of how many chips remain (the table's own "Nothing"
 * row), so escalation only nudges an already-active band, never creates one.
 */
const CHIP_COUNT_ESCALATION: Readonly<Record<ChipExpiryBand, ChipExpiryBand>> = {
  none: 'none',
  noted: 'pressing',
  pressing: 'final',
  final: 'final',
}

/**
 * The urgency band for the FIRST set only — ticket #97's own scope: "Band is
 * 'none' when: no unused chips in the active set, OR the active set is the
 * second one (doesn't expire before season end)." Once `firstSet.expired`,
 * the second set is the active one (see `secondSet.isAvailable` above) and
 * this always returns 'none' — the first set's own loss already happened
 * and is reported via `lostCount`/`slots`, not re-litigated as a warning.
 * `gameweeksRemaining` and `chipsAtRisk` are present on the return value
 * only for the three non-'none' bands, by construction (a discriminated
 * union in types.ts), so a caller can never read a stale/undefined number.
 */
function deriveExpiryWarning(firstSet: FirstChipSetView): ChipExpiryWarning {
  const chipsAtRisk = firstSet.expired ? [] : firstSet.remaining
  const gameweeksRemaining = firstSet.timeRemaining?.gameweeksRemaining ?? null

  // No unused chips left to lose, or the countdown itself can't be resolved
  // (deadline unknown, or the current gameweek can't be placed) — nothing
  // safe to warn about either way.
  if (chipsAtRisk.length === 0 || gameweeksRemaining === null) {
    return { band: 'none' }
  }

  let band = bandForGameweeksRemaining(gameweeksRemaining)
  if (chipsAtRisk.length >= 2) {
    band = CHIP_COUNT_ESCALATION[band]
  }

  if (band === 'none') return { band: 'none' }
  return { band, gameweeksRemaining, chipsAtRisk }
}

export function deriveChipState(data: ChipSourceData, nowMs: number): DerivedChipState {
  const usedChips: UsedChipView[] = data.chipsUsed.map((entry) => {
    const name = entry.name
    const gameweekLabel = entry.event !== null ? `Gameweek ${entry.event}` : 'gameweek unknown'
    const set = classifySet(entry.event)
    // Narrowing on `name` directly (rather than a separately-computed
    // boolean) is what lets TS accept the CHIP_DISPLAY_NAMES lookup below
    // without a cast — CHIP_DISPLAY_NAMES is keyed by KnownChipId, not by
    // the raw `string` every chips_used entry actually carries.
    if (isKnownChipId(name)) {
      return {
        id: name,
        displayName: CHIP_DISPLAY_NAMES[name],
        isKnown: true,
        gameweekId: entry.event,
        gameweekLabel,
        set,
      }
    }
    return {
      id: name,
      displayName: `Unknown chip (${name})`,
      isKnown: false,
      gameweekId: entry.event,
      gameweekLabel,
      set,
    }
  })

  const firstSetUsedKnownIds = new Set<KnownChipId>()
  const secondSetUsedKnownIds = new Set<KnownChipId>()
  const firstSetGameweekLabels = new Map<KnownChipId, string>()
  const secondSetGameweekLabels = new Map<KnownChipId, string>()
  let firstSetUsedCount = 0
  let secondSetUsedCount = 0

  for (const chip of usedChips) {
    if (chip.set === 'first') {
      firstSetUsedCount += 1
      if (chip.isKnown) {
        firstSetUsedKnownIds.add(chip.id as KnownChipId)
        firstSetGameweekLabels.set(chip.id as KnownChipId, chip.gameweekLabel)
      }
    } else if (chip.set === 'second') {
      secondSetUsedCount += 1
      if (chip.isKnown) {
        secondSetUsedKnownIds.add(chip.id as KnownChipId)
        secondSetGameweekLabels.set(chip.id as KnownChipId, chip.gameweekLabel)
      }
    }
    // 'unknown' (no event recorded): already present in `usedChips` above —
    // that satisfies "still counted, never dropped" — but it can't be
    // attributed to either set's usedCount/remaining without guessing.
  }

  const gameweek19 = data.gameweeks.find((gw) => gw.id === FIRST_CHIP_SET_LAST_GAMEWEEK) ?? null
  const deadlineKnown = gameweek19 !== null
  const expired = gameweek19 !== null && nowMs >= gameweek19.deadlineMs

  let timeRemaining: ChipSetTimeRemaining | null = null
  if (gameweek19 !== null && !expired) {
    const currentGameweekId = resolveCurrentGameweekId(data.gameweeks, nowMs)
    const gameweeksRemaining =
      currentGameweekId === null
        ? null
        : Math.max(FIRST_CHIP_SET_LAST_GAMEWEEK - currentGameweekId + 1, 0)
    timeRemaining = {
      gameweeksRemaining,
      calendarLabel: formatDeadlineInstant(new Date(gameweek19.deadlineMs).toISOString()),
    }
  }

  const firstSet: FirstChipSetView = {
    usedCount: firstSetUsedCount,
    totalCount: CHIPS_PER_SET,
    // Once expired there is nothing left to use — an empty list, not a
    // (now-meaningless) list of what could no longer be played anyway.
    remaining: expired ? [] : remainingList(firstSetUsedKnownIds),
    lostCount: expired ? Math.max(CHIPS_PER_SET - firstSetUsedCount, 0) : 0,
    slots: buildSlots(firstSetGameweekLabels, expired, true),
    expired,
    deadlineKnown,
    timeRemaining,
  }

  const secondSet: SecondChipSetView = {
    usedCount: secondSetUsedCount,
    totalCount: CHIPS_PER_SET,
    remaining: remainingList(secondSetUsedKnownIds),
    // No known expiry for the second set within this ticket's scope — see
    // the ticket notes; nothing here ever marks a second-set chip lost.
    lostCount: 0,
    slots: buildSlots(secondSetGameweekLabels, false, false),
    isAvailable: expired,
  }

  const chipAdvisories = deriveChipAdvisories(data.chipAdvisories)
  const squadAdvisories = deriveSquadAdvisories(data.squadAdvisories)

  return {
    hasUsedAnyChip: usedChips.length > 0,
    usedChips,
    firstSet,
    secondSet,
    expiryWarning: deriveExpiryWarning(firstSet),
    chipAdvisories,
    chipAdvisoryNote: chipAdvisories.length > 0 ? CHIP_ADVISORY_HORIZON_NOTE : null,
    squadAdvisories,
    squadAdvisoryNote: squadAdvisories.length > 0 ? SQUAD_ADVISORY_HORIZON_NOTE : null,
  }
}
