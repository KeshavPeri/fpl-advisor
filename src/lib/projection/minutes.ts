/**
 * Minutes model — expected minutes, probability of appearing at all, and
 * probability of reaching 60 minutes, from a player's recent match minutes
 * plus an availability factor. One of the five v1 projection inputs
 * (product-brief.md §6d) — explainable in one sentence: recent minutes,
 * scaled down by how likely the player is to be fit and picked at all.
 *
 * Pure computation only: no I/O, no database, no fetch, matching
 * `defconRate.ts`'s shape.
 *
 * Deliberately does NOT apply the 60-minute qualifying filter that
 * `defconRate.ts` uses for its own rate estimate — that filter exists there
 * to decide whether a match is long enough to plausibly reach a per-match
 * defensive-action threshold, which is a different question from "how many
 * minutes do we expect this player to play". Every one of the last five
 * match rows counts here, cameos included.
 */

/** How many of the player's most recent match rows feed the estimate. */
const RECENT_MATCH_COUNT = 5

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

// ============================================================================
// Availability
// ============================================================================

/**
 * Returned when neither `players.status` nor
 * `players.chance_of_playing_next_round` gives a definite answer — an
 * unrecognised status with no published chance figure. Maximum uncertainty,
 * not an assertion either way, matching `defconRate.ts`'s NEUTRAL_PRIOR
 * convention.
 */
export const NEUTRAL_AVAILABILITY = 0.5

const UNAVAILABLE_STATUSES = new Set(['i', 's', 'u'])

/**
 * Availability factor in [0, 1], derived from `players.status` and
 * `players.chance_of_playing_next_round`:
 *  - a non-null chance always wins: `chance / 100`.
 *  - status `'a'` with a null chance: fully available, `1.0`.
 *  - status `'i' | 's' | 'u'` with a null chance: unavailable, `0.0`.
 *  - anything else with a null chance (e.g. `'d'` without a published
 *    chance, or a status the API adds later): `NEUTRAL_AVAILABILITY`.
 */
export function availabilityFactor(status: string, chanceOfPlayingNextRound: number | null): number {
  if (chanceOfPlayingNextRound !== null && chanceOfPlayingNextRound !== undefined) {
    return clamp01(chanceOfPlayingNextRound / 100)
  }
  if (status === 'a') return 1.0
  if (UNAVAILABLE_STATUSES.has(status)) return 0.0
  return NEUTRAL_AVAILABILITY
}

// ============================================================================
// Minutes estimate
// ============================================================================

export interface MinutesEstimate {
  /** Expected minutes played, averaged over recent history and scaled by availability. */
  expectedMinutes: number
  /** Probability the player appears at all (any minutes > 0). Equal to availability. */
  pAppears: number
  /** Probability the player reaches 60 minutes. */
  pSixtyPlus: number
}

/**
 * Assumed involvement for a player with zero history rows (a promoted-club
 * signing or new arrival, normal for GW1 — not an error). A fringe-squad
 * baseline: half a match's worth of minutes on average, and a
 * correspondingly lower-than-even chance of reaching 60. Named and stated
 * rather than silently defaulting to zero, NaN, or throwing. Still scaled
 * by availability like any other player's estimate.
 */
export const NO_HISTORY_BASELINE_MINUTES = 45
export const NO_HISTORY_BASELINE_SIXTY_PLUS_RATE = 0.25

/**
 * Estimates expected minutes, appearance probability and 60+-minute
 * probability from a player's recent match-minutes history (up to the last
 * `RECENT_MATCH_COUNT` = 5 rows, every one of them — see file header) and an
 * availability factor from {@link availabilityFactor}.
 *
 * `recentMinutes` may hold fewer than 5 entries (a player early in their
 * first season) — the average is simply taken over however many are given.
 * An empty array is the stated no-history case and returns the named
 * fallback baseline above, scaled by availability, rather than 0/NaN/error.
 */
export function estimateMinutes(recentMinutes: readonly number[], availability: number): MinutesEstimate {
  const pAppears = clamp01(availability)

  if (recentMinutes.length === 0) {
    return {
      expectedMinutes: NO_HISTORY_BASELINE_MINUTES * pAppears,
      pAppears,
      pSixtyPlus: NO_HISTORY_BASELINE_SIXTY_PLUS_RATE * pAppears,
    }
  }

  const averageMinutes = recentMinutes.reduce((sum, m) => sum + m, 0) / recentMinutes.length
  const sixtyPlusRate = recentMinutes.filter((m) => m >= 60).length / recentMinutes.length

  return {
    expectedMinutes: averageMinutes * pAppears,
    pAppears,
    pSixtyPlus: sixtyPlusRate * pAppears,
  }
}

/** Exported so `scripts/project-points.ts` can slice a player's match history the same way this module expects it. */
export { RECENT_MATCH_COUNT }
