/**
 * Types for the verdict card (ticket #61, feature-list item 17). Deliberately
 * NOT imported from `src/lib/recommendation/` — that module is pure solver
 * logic owned by a different ticket running in this same batch (see the
 * ticket's Notes), and `src/components/pitchAvailability.ts`'s own header
 * comment already establishes the precedent this file follows: a feature
 * owns a small local copy of a domain type it merely reads, rather than
 * importing across an unrelated module boundary. `ConfidenceBand`'s three
 * values match `public.recommendations.confidence_band`'s CHECK constraint
 * (supabase/migrations/20260817090000_recommendations.sql) exactly.
 */

export type ConfidenceBand = 'clear' | 'marginal' | 'coin-flip'

/** One entry from the stored `recommendations.coverage` jsonb column. */
export interface CoverageEntry {
  role: string
  playerId: number
  hasHistory: boolean
}

/**
 * Everything `deriveVerdictView` needs for one recommendation — already
 * resolved by `src/lib/verdict/api.ts` (player names looked up, reasons
 * fetched in order_index order). Plan A only (`plan_index = 0`); this
 * ticket never reads Plan B/C.
 */
export interface VerdictRecommendationData {
  gameweekId: number
  gameweekName: string
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  viceCaptainPlayerId: number
  hitCost: number
  grossPointsRounded: number
  netPointsRounded: number
  confidenceBand: ConfidenceBand
  coverage: readonly CoverageEntry[]
  /** `recommendation_reasons.reason`, already ordered by order_index ascending. */
  reasons: readonly string[]
  /** Display name for every player id referenced above that could be resolved. */
  playerNames: ReadonlyMap<number, string>
}

/** Explicit hit-cost figures — only present when hit_cost > 0 (product-brief.md §6d). */
export interface VerdictHit {
  cost: number
  gross: number
  net: number
}

/** Fully-resolved display data for VerdictCard — the component does no further derivation. */
export interface VerdictView {
  isStale: boolean
  /** The stale recommendation's own gameweek name — null when not stale. */
  staleGameweekName: string | null
  /** How many gameweeks behind the current one — null when not stale or when the
   *  stored recommendation is somehow ahead of the current gameweek (defensive; should not happen). */
  staleGameweeksOld: number | null
  /** The decision — the largest text on the card, nothing precedes it. Sourced verbatim
   *  from recommendation_reasons order_index 0 (see api.ts and the recommendations
   *  migration's own comment: "item 14 (Telegram) uses the first line as the headline" —
   *  the same stored line is this card's headline, by the same established convention). */
  headline: string
  captainLine: string
  netPoints: number
  hit: VerdictHit | null
  confidenceWord: string
  /** Present only when confidenceBand is 'coin-flip' — states in words that the top options are too close to separate. */
  coinFlipNote: string | null
  /** Present only when at least one referenced player has no match history (recommendations.coverage). */
  coverageNote: string | null
}
