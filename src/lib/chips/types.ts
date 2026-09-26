/**
 * Types for chip-state derivation (ticket #85, feature-list item 25). The
 * raw shape mirrors scripts/sync-squad.ts's `ChipUsage` exactly — squads.
 * chips_used is written verbatim from FPL's `entry/{id}/history/` "chips"
 * array — but this module keeps its own local copy rather than importing
 * across the scripts/src compilation boundary, the same "small local copy
 * of a domain type it merely reads" call src/lib/verdict/types.ts and
 * src/lib/reasoning/types.ts already document for this codebase.
 *
 * `PositionCode` is the one exception, imported from `src/lib/squad/
 * positions.ts` below — same precedent `src/lib/override/types.ts`'s own
 * header comment sets (that module reads squad/api.ts's fetchPlayers and
 * fetchExistingSquad too, for the identical reason: naming a player's
 * position a second, unrelated way here would be duplication with no
 * offsetting isolation benefit).
 */
import type { PositionCode } from '../squad/positions'

/** The four chip identifiers FPL's own API uses — see derive.ts's CHIP_DISPLAY_NAMES for the source and the mapping to display names. */
export type KnownChipId = 'wildcard' | 'freehit' | 'bboost' | '3xc'

/** One entry of `squads.chips_used`, exactly as scripts/sync-squad.ts's `parseChips` writes it. `name` is FPL's raw identifier — NOT necessarily one of `KnownChipId`; FPL has added and removed chips before (e.g. the since-removed Assistant Manager chip), so this field is a bare `string`, not the narrower union. */
export interface ChipUsageRecord {
  name: string
  event: number | null
  time: string | null
}

/** One `public.gameweeks` row, trimmed to what derive.ts needs — an instant, not a display string, so every comparison in derive.ts is instant-vs-instant and never timezone-sensitive (matching src/lib/deadlineCountdown.ts's own note on this). */
export interface GameweekDeadline {
  id: number
  deadlineMs: number
}

/**
 * One row read from `public.chip_advisories` for the current/next gameweek
 * — ticket #126 (item 27). See scripts/store-chip-advisory.ts for how it is
 * written: one row per chip played per solution, keyed to the normal
 * (chip-free) run it is compared against via `solverRunId` — already
 * resolved to "the latest run for this gameweek" by src/lib/chips/api.ts, so
 * this type carries no run id at all; there is nothing here to compare
 * across runs by mistake.
 */
export interface ChipAdvisoryRow {
  chipCode: string
  /** The horizon gameweek this chip would be played in — may differ from the target gameweek being solved for. */
  chipGameweekId: number
  /** chip-enabled objective minus chip-free objective, already computed by the database (a GENERATED column) — never recomputed here. */
  delta: number
  solutionIndex: number
}

/**
 * One chip decision within a collapsed chip-timing plan — ticket #141. Never
 * carries its own points figure: the delta belongs to the whole plan (see
 * ChipAdvisoryView below), not to an individual chip — there is no
 * measurement of either chip alone, so a per-decision number would be
 * invented, not read. See derive.ts's module header for the full because.
 */
export interface ChipAdvisoryDecision {
  chipCode: string
  /** e.g. "Triple Captain" — SOLVER_CHIP_DISPLAY_NAMES[chipCode] in derive.ts, or an explicit unknown-chip label. */
  displayName: string
  chipGameweekId: number
  gameweekLabel: string
}

/**
 * One DISTINCT chip-timing plan the solver's stored solutions propose —
 * ticket #141, collapsing ticket #126's flat one-row-per-(chip,solution)
 * storage into one entry per distinct set of chip decisions. States a
 * number and its limitation; never a "play this chip" instruction
 * (product-brief.md §6a — see CHIP_ADVISORY_HORIZON_NOTE in derive.ts).
 *
 * `decisions` is the whole set of chips this plan plays together, in
 * gameweek order. `deltaWhole` is the SINGLE points figure this whole set
 * was measured against (chip-enabled solve vs chip-free solve) — stated
 * once per plan, never once per chip. `solutionCount` /
 * `totalSolutionCount` say how many of the solver's stored solutions chose
 * exactly this plan, out of how many named a chip at all, so the reader
 * can see solver agreement without being shown the same plan more than
 * once — see derive.ts's deriveChipAdvisories for exactly how these are
 * computed.
 */
export interface ChipAdvisoryView {
  decisions: readonly ChipAdvisoryDecision[]
  /** Math.round(delta) — design-reference.md forbids decimal points on a projected-points figure; see derive.ts. */
  deltaWhole: number
  solutionCount: number
  totalSolutionCount: number
}

/**
 * One row read from `public.chip_advisories` where chip_code is 'WC' or
 * 'FH' — ticket #134 (item 28). Same table and same shape as
 * ChipAdvisoryRow above, but a full-squad-rebuild question ("is a wildcard
 * worth it right now?") rather than a chip-timing one, and resolved
 * separately from ChipAdvisoryRow in api.ts so a squad-rebuild-probe run
 * can never be mistaken for the nightly chip-timing advisory (or vice
 * versa) — see scripts/store-squad-advisory.ts for how this is written.
 */
export interface SquadAdvisoryRow {
  /** Ticket #284. `chip_advisories`' own append-only bigint identity primary key. api.ts passes through EVERY matching WC/FH row (not just the latest) so derive.ts's deriveSquadAdvisories can pick the latest one per chip code itself (highest `id` wins) — a pure, unit-testable reduction, rather than one buried in a database query. Never rendered. */
  id: number
  chipCode: 'WC' | 'FH'
  /** chip-enabled objective minus chip-free objective, already computed by the database (a GENERATED column) — never recomputed here. Can be large; see SQUAD_ADVISORY_HORIZON_NOTE in derive.ts for why a large number is not itself an instruction. */
  delta: number
  /** Ticket #284. `chip_advisories.gameweek_id` for this row — the target gameweek the whole rebuild was solved for (never a chip's own later horizon gameweek; a preseason rebuild has none — see scripts/store-squad-advisory.ts's own buildSquadAdvisoryRow comment). Needed for the Free Hit "for Gameweek N only" label. */
  gameweekId: number
  /** Ticket #284. The fifteen players this rebuild picked, from `public.chip_rebuild_picks`. Empty when nothing is stored for this advisory yet — a row written before ticket #284, or chip_rebuild_picks' own migration not yet applied when it was written (see scripts/store-squad-advisory.ts's own header) — the Chips screen renders no "See the squad" disclosure in that case, never a broken/empty one. */
  picks: readonly ChipRebuildPickRow[]
}

/**
 * One row of `public.chip_rebuild_picks` — ticket #284. See
 * scripts/store-squad-advisory.ts for how it is written: one row per player
 * in the rebuild solve's own results CSV, for solution_index 0 and the
 * first rebuild gameweek only.
 */
export interface ChipRebuildPickRow {
  playerId: number
  playerCode: number | null
  /** Verbatim from the results CSV's own "pos" column, e.g. "GKP" — see the migration's own column comment. The squad-rebuild disclosure groups by `elementType` (resolved via the wider player pool, ChipPlayerOption below) instead, so this app's position vocabulary stays the one place (src/lib/squad/positions.ts) — this field is read only as a fallback label for a player id the current player pool no longer recognises (see buildSquadRebuildView in derive.ts). */
  position: string
  isStarting: boolean
  benchOrder: number | null
  isCaptain: boolean
  isViceCaptain: boolean
  expectedPoints: number
}

/**
 * One player, trimmed to what the squad-rebuild disclosure needs to show a
 * name and group by position — ticket #284. Read directly from
 * `src/lib/squad/api.ts`'s `fetchPlayers`, the same source
 * `src/lib/override/types.ts`'s `OverridePlayerOption` already trims for the
 * identical reason (that type carries price/team/availability fields this
 * disclosure never shows either).
 */
export interface ChipPlayerOption {
  id: number
  webName: string
  elementType: PositionCode
}

/** One player named in a squad-rebuild disclosure's position group, bench list, or In/Out comparison — ticket #284. */
export interface SquadRebuildPlayerView {
  playerId: number
  name: string
  isCaptain: boolean
}

/** One position's starting-XI block within a squad-rebuild disclosure — ticket #284. */
export interface SquadRebuildPositionGroupView {
  /** e.g. "Goalkeepers" — `${POSITION_LABEL[position]}s`, same pluralisation SquadEntryScreen.tsx already uses. Falls back to the raw CSV `position` string for a player id the current player pool doesn't recognise (see ChipRebuildPickRow.position and buildSquadRebuildView in derive.ts) — such a group is never silently dropped. */
  label: string
  starters: readonly SquadRebuildPlayerView[]
}

/**
 * The rebuild squad's "In / Out vs your team" comparison against the
 * currently-saved squad (`src/lib/squad/api.ts`'s `fetchExistingSquad`) —
 * ticket #284. `known` is false only when nothing has ever been saved for
 * this gameweek at all — distinct from an empty `playersIn`/`playersOut`
 * pair, which means the saved squad and the rebuild squad are IDENTICAL
 * (zero changes), a real, informative answer in its own right.
 */
export type SquadRebuildComparisonView =
  | { known: false }
  | { known: true; playersIn: readonly SquadRebuildPlayerRefView[]; playersOut: readonly SquadRebuildPlayerRefView[] }

/** A bare player reference (id + name) for an In/Out line — ticket #284. No captain/points fields: those belong to the squad the player is IN, not to a one-line "who left" mention. */
export interface SquadRebuildPlayerRefView {
  playerId: number
  name: string
}

/** The fully-resolved "See the squad" disclosure for one stored squad-rebuild advisory — ticket #284. Null on `SquadAdvisoryView.squad` when nothing is stored yet (see SquadAdvisoryRow.picks). */
export interface SquadRebuildSquadView {
  positionGroups: readonly SquadRebuildPositionGroupView[]
  /** Ordered by bench_order (1-4) — bench sits separately from the position groups, matching design-reference.md's "bench sits visually separated below the pitch" convention. */
  bench: readonly SquadRebuildPlayerView[]
  captainName: string | null
  /** This ONE gameweek's projected points, captain's contribution doubled — from the rebuild solve's own results CSV, the SAME target gameweek chip_rebuild_picks was filtered to (never chip_advisories.delta, which is a five-gameweek horizon figure). Null only if the starting XI isn't exactly eleven players — should never happen given scripts/store-squad-advisory.ts's own DoD guard, but this file never trusts an unfiltered input either (same discipline src/lib/verdict/derive.ts's sumGameweekPoints uses). */
  gameweekPointsWhole: number | null
  comparison: SquadRebuildComparisonView
}

/**
 * One squad-rebuild advisory resolved for display — ticket #134, extended by
 * #284. States a point gap and its five-gameweek limitation; never a "play
 * this chip" instruction (product-brief.md §6a — see
 * SQUAD_ADVISORY_HORIZON_NOTE in derive.ts). design-reference.md: never
 * coloured as a warning — a large delta is information, not an alarm.
 */
export interface SquadAdvisoryView {
  chipCode: 'WC' | 'FH'
  /** "Wildcard" or "Free Hit" — SQUAD_ADVISORY_DISPLAY_NAMES[chipCode] in derive.ts. */
  displayName: string
  /** Math.round(delta) — design-reference.md forbids decimal points on a projected-points figure; see derive.ts. */
  deltaWhole: number
  /** Ticket #284. The gameweek this rebuild squad was solved for. */
  gameweekId: number
  /** Ticket #284. "Gameweek N" — used in the Free Hit "for Gameweek N only" label. */
  gameweekLabel: string
  /** Ticket #284. Null when SquadAdvisoryRow.picks was empty — the Chips screen renders no "See the squad" disclosure for this advisory in that case. */
  squad: SquadRebuildSquadView | null
}

/** Everything deriveChipState needs, already read by src/lib/chips/api.ts. */
export interface ChipSourceData {
  /** The most recently synced squads row's cumulative chips_used array — see api.ts for what "most recently synced" means and why. Empty array (never null) when nothing has been synced yet. */
  chipsUsed: readonly ChipUsageRecord[]
  /** Every known gameweek's id + deadline instant, ascending by id. Used to resolve both the Gameweek 19 deadline (never hardcoded — read from here) and how many gameweeks remain in the active set. Empty when the gameweeks table hasn't been ingested yet. */
  gameweeks: readonly GameweekDeadline[]
  /** The current/next gameweek's chip advisory rows (TC/BB only — see api.ts), from the LATEST solver run only. Empty when no chip was played in the latest solve, or none has run yet. */
  chipAdvisories: readonly ChipAdvisoryRow[]
  /** The current/next gameweek's squad-rebuild advisory rows (WC/FH only — see api.ts), the latest stored row per chip code. Empty when squad-rebuild-probe.yml has never been dispatched for this gameweek. */
  squadAdvisories: readonly SquadAdvisoryRow[]
  /** Ticket #284. The wider player pool (`src/lib/squad/api.ts`'s `fetchPlayers`) — read only when `squadAdvisories` is non-empty, since nothing else on this screen needs a name/position lookup. Empty otherwise. */
  players: readonly ChipPlayerOption[]
  /** Ticket #284. The fifteen player ids in the currently-saved squad for the current/next gameweek (`src/lib/squad/api.ts`'s `fetchExistingSquad`) — what each rebuild squad's "In / Out vs your team" is compared against. Null when nothing has been saved for that gameweek yet (fetchExistingSquad returned null), distinct from an empty set — see SquadRebuildComparisonView's own `known` flag. Also null when `squadAdvisories` is empty (nothing to compare). */
  existingSquadPlayerIds: ReadonlySet<number> | null
}

/** One chip already used, resolved for display. */
export interface UsedChipView {
  /** The raw FPL identifier, e.g. 'wildcard' — always present, even when unrecognised. */
  id: string
  /** A human display name — CHIP_DISPLAY_NAMES[id] when known, an explicit "Unknown chip (…)" label otherwise. Never dropped. */
  displayName: string
  /** False when `id` is not one of the four known identifiers. */
  isKnown: boolean
  /** The gameweek this chip was used in, or null if FPL reported no event for it. */
  gameweekId: number | null
  gameweekLabel: string
  /** Which of the two four-chip sets this usage belongs to. 'unknown' only when `gameweekId` is null — there is nothing safe to assume about which side of the Gameweek 19 deadline an unstated event fell on. */
  set: 'first' | 'second' | 'unknown'
}

/** One chip not yet used, resolved for display. */
export interface RemainingChipView {
  id: KnownChipId
  displayName: string
}

/** How long the currently-active set has left. Present only while that set is both active and its expiry is known. */
export interface ChipSetTimeRemaining {
  /** Gameweeks left up to and including the Gameweek 19 deadline, clamped at zero. Null only when the current gameweek can't be resolved (the gameweeks table holds no row at or after "now"). */
  gameweeksRemaining: number | null
  /** The deadline itself, formatted per product-brief.md §8 — Asia/Singapore, weekday-first date, 24-hour time. */
  calendarLabel: string
}

/** One of the four known chip types' status within a single set — the unit the screen renders as one checklist row, so a used chip shows its own gameweek rather than just a struck-through name. */
export interface ChipSlotView {
  id: KnownChipId
  displayName: string
  status: 'used' | 'remaining' | 'lost'
  /** Present only when `status === 'used'`. */
  gameweekLabel: string | null
}

/** Shared shape for either four-chip set's state. */
export interface ChipSetView {
  usedCount: number
  totalCount: number
  /** The known chips in this set not yet used — only ever includes chips this code recognises, since an unrecognised identifier can't safely be attributed to one of the four named slots (see derive.ts). */
  remaining: readonly RemainingChipView[]
  /** Chips from this set that were never used and can no longer be. Always zero unless the set has closed. */
  lostCount: number
  /** All four known chip types for this set, each resolved to exactly one status — what the screen actually renders as a checklist. */
  slots: readonly ChipSlotView[]
}

export interface FirstChipSetView extends ChipSetView {
  expired: boolean
  /** Whether Gameweek 19's own deadline could be resolved from `gameweeks` at all — false before that gameweek has been ingested. */
  deadlineKnown: boolean
  /** Present only while the set is active (`!expired`) and `deadlineKnown` is true. */
  timeRemaining: ChipSetTimeRemaining | null
}

export interface SecondChipSetView extends ChipSetView {
  /** True once the first set has expired; false while the first set is still the active one — the screen's "not yet available" state. */
  isAvailable: boolean
}

/**
 * Ticket #97 (item 26). How urgent it is that the first set's unused chips
 * get played before Gameweek 19's deadline. Gameweeks remaining is the unit
 * — never days, never a live countdown (design-reference.md: the per-hour
 * clock is the deadline countdown's job, not this one's). A discriminated
 * union rather than nullable fields: 'none' carries nothing else, so a
 * caller can never read a `gameweeksRemaining` or `chipsAtRisk` that is
 * stale, zero-length, or meaningless for the band it's paired with.
 */
export type ChipExpiryBand = 'none' | 'noted' | 'pressing' | 'final'

export type ChipExpiryWarning =
  | { band: 'none' }
  | {
      band: 'noted' | 'pressing' | 'final'
      /** Gameweeks left up to and including the Gameweek 19 deadline. Always present and non-negative when `band` is not 'none'. */
      gameweeksRemaining: number
      /** The unused first-set chips this warning is about, in the constant's own display order. Always non-empty when `band` is not 'none'. */
      chipsAtRisk: readonly RemainingChipView[]
    }

/** Fully-resolved chip state for the /chips screen — no further derivation happens in the component. */
export interface DerivedChipState {
  /** False only when `chipsUsed` was empty — drives the screen's "no chips used" message, never an error or a blank screen. */
  hasUsedAnyChip: boolean
  usedChips: readonly UsedChipView[]
  firstSet: FirstChipSetView
  secondSet: SecondChipSetView
  /** Ticket #97: how urgent it is to play the first set's unused chips before they're lost. Always 'none' once the first set has expired or has nothing left unused, or while the second set is active — see deriveExpiryWarning's own comment in derive.ts. */
  expiryWarning: ChipExpiryWarning
  /** Ticket #126/#141: the latest chip-enabled solve's advisory, collapsed to one entry per distinct chip-timing plan its stored solutions propose. Empty when no chip was played in any of them. */
  chipAdvisories: readonly ChipAdvisoryView[]
  /** CHIP_ADVISORY_HORIZON_NOTE when `chipAdvisories` is non-empty, null otherwise — present on the derived view itself so it is directly assertable without rendering the screen. */
  chipAdvisoryNote: string | null
  /** Ticket #134: the latest squad-rebuild-probe run(s), one entry per chip code (WC and/or FH) that has ever been probed for the current gameweek. Empty when squad-rebuild-probe.yml has never been dispatched for it. */
  squadAdvisories: readonly SquadAdvisoryView[]
  /** SQUAD_ADVISORY_HORIZON_NOTE when `squadAdvisories` is non-empty, null otherwise — same "assertable without rendering" reasoning as chipAdvisoryNote above. */
  squadAdvisoryNote: string | null
}
