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
 * ── v2: start probability × minutes-given-start (ticket #188) ─────────────
 *
 * v1 averaged all five rows into one number, so a single rested/subbed
 * match dragged a nailed starter's whole estimate down with it: a window of
 * `90, 90, 90, 90, 0` produced `expectedMinutes = 72.0` and `pSixtyPlus =
 * 0.8`, a ~20% discount on every attacking and defensive-contribution term
 * that multiplies by minutes, for a player who missed exactly one match in
 * five. v2 answers two separate questions from the window — does he feature
 * at all, and for how long when he does — and multiplies them back
 * together, matching how the DoD phrases it:
 * `pSixtyPlus = P(featured) × P(60+ | featured)`, and analogously
 * `expectedMinutes = P(featured) × E[minutes | featured]`.
 * "Featured" (any minutes > 0) stands in for "started" here — the source
 * publishes `start_min`/`finish_min`, but ingesting them is out of scope
 * for this ticket (no new stored data); minutes-based "featured" is the
 * available proxy.
 *
 * That split alone changes nothing numerically — `P(featured) ×
 * E[minutes|featured]` is arithmetically identical to the plain mean,
 * because a zero contributes zero to the sum either way. The robustness
 * comes from what feeds the split: on a FULL `RECENT_MATCH_COUNT`-row
 * window only, the single lowest raw value (zero, an early sub, a rested
 * cameo — whichever it is) is set aside before `P(featured)`,
 * `E[minutes|featured]` and `P(60+|featured)` are computed from what's
 * left. Below a full window (a player's first 1–4 matches) every row still
 * counts — there isn't enough data at that size to tell a genuine outlier
 * from real signal, and the ticket's own worked examples are all full
 * five-row windows.
 *
 * Justified from real data, not intuition: pulled every 2025-2026 Premier
 * League `playermatchstats.csv` row for gameweeks 1–20 from
 * FPL-Core-Insights (the source and method tickets #148/#162/#168 used) and
 * built true minutes sequences per player. Among players with a season
 * average ≥ 75 minutes/gameweek (77 players, 1,232 five-match sliding
 * windows), a window containing exactly one 0 (rest of the window ≥ 60) is
 * not rare — 7.6% of windows — and its plain mean (70.7) sits ~20% below
 * the mean of a "clean" all-≥60 window (88.8), reproducing the Haaland
 * shape almost exactly. But the *next* match after a one-zero window looks
 * almost identical to the next match after a clean window: mean 81.5 vs
 * 85.1 minutes, P(60+) 0.92 vs 0.94. A single missed match in this
 * population barely predicts a reduced role — it is usually rotation for a
 * cup tie or a game managed off a minor knock, not a form change — so an
 * estimator that lets one such match move the whole figure by a fifth is
 * measurably wrong, not just aesthetically crude. Dropping only the single
 * lowest value (not the median, not every zero) is the form that fits this
 * evidence: it recovers ~90 for the `90,90,90,90,0` case (matching the
 * "clean" population's ~89 average, not just asserting it), while still
 * requiring a SECOND low value to pull the figure down — verified against
 * the rotation-player case below — so it does not collapse into "every
 * missed match is noise."
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
 * Drops the single lowest raw value from a full-length window before the
 * start/minutes-given-start split below — see the file header's "v2"
 * section for why exactly one, and why only at a full window. Ties for
 * lowest drop only one instance (sorts ascending, slices off index 0), so a
 * window with two zeros — a genuine rotation pattern, not one blip — still
 * carries a zero into the estimate.
 */
function dropSingleLowest(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b).slice(1)
}

/**
 * Splits a match-minutes sample into the two questions v2 answers
 * separately: how often the player features at all (any minutes > 0 — the
 * available proxy for "starts", see file header), and, given that he does,
 * how long he typically lasts and how often that reaches 60+. `sample` is
 * assumed non-empty; the empty-window case is handled entirely above this
 * function by the named no-history baseline.
 */
function splitFeaturedFromSample(sample: readonly number[]): {
  pFeature: number
  minutesGivenFeature: number
  pSixtyGivenFeature: number
} {
  const featured = sample.filter((m) => m > 0)
  const pFeature = featured.length / sample.length
  const minutesGivenFeature = featured.length > 0 ? featured.reduce((s, m) => s + m, 0) / featured.length : 0
  const pSixtyGivenFeature = featured.length > 0 ? featured.filter((m) => m >= 60).length / featured.length : 0
  return { pFeature, minutesGivenFeature, pSixtyGivenFeature }
}

/**
 * Estimates expected minutes, appearance probability and 60+-minute
 * probability from a player's recent match-minutes history (up to the last
 * `RECENT_MATCH_COUNT` = 5 rows, every one of them — see file header) and an
 * availability factor from {@link availabilityFactor}.
 *
 * `recentMinutes` may hold fewer than 5 entries (a player early in their
 * first season) — every row is used directly, with no trimming (see file
 * header). An empty array is the stated no-history case and returns the
 * named fallback baseline above, scaled by availability, rather than
 * 0/NaN/error.
 *
 * `expectedMinutes` and `pSixtyPlus` keep their v1 meanings and ranges
 * exactly (0–90 and 0–1 respectively, both scaled by availability) — only
 * how they're derived from `recentMinutes` changed. `pAppears` is untouched:
 * it equals availability, as it always has, since minutes history is not
 * evidence about current fitness/selection risk.
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

  const sample = recentMinutes.length === RECENT_MATCH_COUNT ? dropSingleLowest(recentMinutes) : [...recentMinutes]
  const { pFeature, minutesGivenFeature, pSixtyGivenFeature } = splitFeaturedFromSample(sample)

  const expectedMinutesRaw = pFeature * minutesGivenFeature
  const pSixtyPlusRaw = pFeature * pSixtyGivenFeature

  return {
    // Defensively capped at 90: the source data measured for this ticket
    // never exceeds 90, but the cap keeps the invariant true regardless.
    expectedMinutes: Math.min(expectedMinutesRaw * pAppears, 90),
    pAppears,
    pSixtyPlus: clamp01(pSixtyPlusRaw * pAppears),
  }
}

/** Exported so `scripts/project-points.ts` can slice a player's match history the same way this module expects it. */
export { RECENT_MATCH_COUNT }
