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
 * One starting-XI `solver_picks` row for the recommendation's own
 * `gameweek_id` + `solution_index` + solver run (ticket #68, run-filtered
 * by #72) — used only to derive THIS gameweek's projected points, which is
 * a different figure from `netPointsRounded`/`grossPointsRounded` below
 * (those are totals across the whole multi-gameweek solve horizon).
 * `isLineup` is carried through even though api.ts's own query already
 * filters to `is_lineup = true` at the database layer, so `deriveVerdictView`
 * can defend the same rule — AND the eleven-player guard (ticket #72) — in
 * the one place its arithmetic actually lives rather than trusting the
 * caller silently (see derive.ts's bench-exclusion and lineup-size tests).
 */
export interface GameweekPick {
  expectedPoints: number
  isCaptain: boolean
  isLineup: boolean
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
  /**
   * Starting-XI `solver_picks` rows for this recommendation's own
   * `gameweek_id` + `solution_index` + solver run (ticket #68, run-filtered
   * by #72) — see api.ts. Null when the rows could not be found at all (the
   * read failed, no run could be resolved, or no rows exist for this
   * gameweek+solution+run): `deriveVerdictView` must fall back to an
   * explicit "unavailable" figure rather than 0/NaN/blank. Even when
   * non-null, `deriveVerdictView` treats it as unavailable unless exactly
   * eleven rows survive its own `isLineup` filter (ticket #72's guard) —
   * see derive.ts.
   */
  gameweekPicks: readonly GameweekPick[] | null
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
  /**
   * This gameweek's projected points (ticket #68) — sum of starting-XI
   * `solver_picks.expected_points` for the recommendation's own
   * `gameweekId` + solution + solver run (ticket #72), captain's
   * contribution counted twice, rounded to a whole number. Null when
   * `data.gameweekPicks` held no lineup rows, or held anything other than
   * exactly eleven of them (ticket #72's guard) — the component must render
   * an explicit "unavailable" message, never 0/NaN/blank. This, not a
   * horizon total, is the card's primary figure — see api.ts and derive.ts
   * for the full "because".
   */
  gameweekPoints: number | null
  /**
   * States the figure's period unambiguously, using the recommendation's
   * own gameweek name — never "current gameweek", since a stale
   * recommendation's figure is for ITS gameweek, not the one showing
   * elsewhere on screen.
   */
  gameweekPointsLabel: string
  hit: VerdictHit | null
  /**
   * Present only when `hit` is non-null. States explicitly that the hit's
   * gross/net figures are a multi-gameweek total, never the single
   * gameweek figure above — a hit is a one-off cost weighed against
   * horizon-wide gain (product-brief.md §6d), so pairing it with
   * `gameweekPoints` without saying so would be incoherent (ticket #68).
   */
  hitBasisLabel: string | null
  confidenceWord: string
  /** Present only when confidenceBand is 'coin-flip' — states in words that the top options are too close to separate. */
  coinFlipNote: string | null
  /** Present only when at least one referenced player has no match history (recommendations.coverage). */
  coverageNote: string | null
}
