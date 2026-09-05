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
 *
 * ── ticket #207: reverted to this, the pre-#191 form ───────────────────────
 *
 * Ticket #191 briefly replaced the plain windowed mean below with a
 * start-probability x minutes-given-start split that dropped the single
 * lowest value from a full five-match window (see `git show e652df7` for
 * that version). #191's own definition of done pre-registered its revert
 * condition — "if any position moves away from 1.00 [on the appearance-ratio
 * calibration check], revert rather than tune" — and three of four positions
 * did, the day it shipped, and stayed that way five days later. Ticket #201
 * then ran both models side by side in the honest backtest harness: the
 * pre-#191 plain mean (this file) beat the shipped v2 model on the season
 * aggregate and on midfield/defence at both the one- and five-gameweek
 * horizons; v2 won only at goalkeeper (both horizons) and forward (five
 * gameweeks only). Full figures: `docs/projection-model-backlog.md`.
 *
 * #191's reasoning was sound and its motivating data was real — averaging
 * `90, 90, 90, 90, 0` down to 72 minutes genuinely does understate a nailed
 * starter who missed one match to rotation. It was measured properly the
 * moment a working backtest existed, and it lost. This file is the reverted,
 * measured-worse idea; do not re-introduce the split without new evidence
 * the backlog entry doesn't already cover.
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
 *
 * Deliberately a plain mean over the whole window, with no outlier handling
 * — see the file header's "ticket #207" section for why: a window of
 * `90, 90, 90, 90, 0` gives `expectedMinutes = 72.0` and `pSixtyPlus = 0.8`,
 * a real ~20% discount for a player who missed exactly one match in five.
 * That was #191's motivating case for dropping the single lowest value
 * instead; the measured backtest said the plain mean below still ranks
 * players better overall, so the discount stays.
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
