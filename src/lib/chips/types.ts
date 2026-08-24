/**
 * Types for chip-state derivation (ticket #85, feature-list item 25). The
 * raw shape mirrors scripts/sync-squad.ts's `ChipUsage` exactly — squads.
 * chips_used is written verbatim from FPL's `entry/{id}/history/` "chips"
 * array — but this module keeps its own local copy rather than importing
 * across the scripts/src compilation boundary, the same "small local copy
 * of a domain type it merely reads" call src/lib/verdict/types.ts and
 * src/lib/reasoning/types.ts already document for this codebase.
 */

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

/** Everything deriveChipState needs, already read by src/lib/chips/api.ts. */
export interface ChipSourceData {
  /** The most recently synced squads row's cumulative chips_used array — see api.ts for what "most recently synced" means and why. Empty array (never null) when nothing has been synced yet. */
  chipsUsed: readonly ChipUsageRecord[]
  /** Every known gameweek's id + deadline instant, ascending by id. Used to resolve both the Gameweek 19 deadline (never hardcoded — read from here) and how many gameweeks remain in the active set. Empty when the gameweeks table hasn't been ingested yet. */
  gameweeks: readonly GameweekDeadline[]
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
}
