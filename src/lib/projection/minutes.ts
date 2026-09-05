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
 *
 * ── ticket #213: shrink the window toward the season figure ────────────────
 *
 * #207's revert fixed the WITHIN-window question (don't drop or reweight
 * individual matches) but left a separate, longer-horizon question open:
 * `docs/model-review-2026-09-02.md` §1f measured that at the five-gameweek
 * target, a plain season-minutes-per-match baseline beats this whole model
 * for midfielders and forwards — the five-match window is too reactive for
 * that horizon, exactly as a naive baseline with no window at all should
 * NOT be able to beat a model with strictly more information. The fix is not
 * a new idea: `rates.ts` already solves the identical shape of problem for
 * xG/xA/saves/CBI/recoveries with its "phantom prior nineties" shrinkage
 * formula (`shrunkRate`, exported from that file for exactly this reuse —
 * see its own header) and `docs/projection-model-backlog.md` G6 already
 * measured that formula as principled and zero-new-parameter. This ticket
 * applies the SAME formula, with the SAME `SHRINKAGE_K`, to minutes:
 *
 *   shrunkMean = shrunkRate(sum(recentMinutes), recentMinutes.length, seasonMinutesPerMatch)
 *
 * `seasonMinutesPerMatch` is optional on the caller's `PlayerProjectionInput`
 * (see expectedPoints.ts) because not every producer can always supply a
 * season figure (a player with zero current-season Premier League matches,
 * G2/G6's "neither"/"historicalOnly" populations). When it is omitted, the
 * prior fed to `shrunkRate` is the window's OWN mean — which collapses the
 * formula back to exactly that mean, `total / n`, by the same algebraic
 * identity `computePlayerRates`'s zero-minutes case already relies on
 * (shrinking a value toward itself changes nothing) — so an unsupplied
 * season figure reproduces today's plain-mean behaviour to the last decimal,
 * never a silently different number. See PlayerProjectionInput's own comment
 * for how each producer either supplies the figure or is counted as a
 * fallback.
 *
 * Two collapse properties follow directly from `shrunkRate`'s own shape and
 * are pinned by name in this file's tests: a full window whose season figure
 * happens to equal that window's own mean (no season evidence beyond the
 * window itself — the common case early in a season) reproduces today's
 * plain mean exactly; an EMPTY window collapses to exactly the season figure
 * (`shrunkRate(0, 0, seasonMinutesPerMatch) === seasonMinutesPerMatch`,
 * since the phantom-prior term is the only one left standing at zero
 * observed weight) — a strictly better answer than the old flat
 * `NO_HISTORY_BASELINE_MINUTES` guess for any player who has a season figure
 * but, for whatever reason, no stored recent-minutes window. `pSixtyPlus` is
 * completely untouched by this ticket — the backlog's diagnosis and this
 * ticket's own scope are both about the MEAN minutes figure specifically,
 * not the 60-minute rate, and touching it would be exactly the "no other
 * change to the minutes model" this ticket's scope forbids.
 */

import { shrunkRate } from './rates.ts'

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
 * first season) — the mean is simply taken over however many are given. An
 * empty array is the stated no-history case; see below for what it returns
 * with and without a season figure.
 *
 * `seasonMinutesPerMatch` (ticket #213, optional) is this player's season
 * minutes per match — see this file's own "ticket #213" header section for
 * the full "because" and the shrinkage formula reused from `rates.ts`.
 * Omitted (`undefined`), the window's own mean stands in as the shrinkage
 * prior, which reproduces this function's pre-#213 plain-mean behaviour to
 * the last decimal — see the header for why that is exact, not approximate.
 *
 * Deliberately still no outlier handling WITHIN the window (unchanged from
 * #207) — a window of `90, 90, 90, 90, 0` with no season figure supplied
 * still gives `expectedMinutes = 72.0` and `pSixtyPlus = 0.8` exactly as
 * before; #213 changes how far that 72 gets pulled back toward a season
 * figure when one is available, not how the window itself is read.
 * `pSixtyPlus` is completely unaffected by `seasonMinutesPerMatch` — see the
 * header's last paragraph for why that is deliberately out of scope.
 */
export function estimateMinutes(
  recentMinutes: readonly number[],
  availability: number,
  seasonMinutesPerMatch?: number,
): MinutesEstimate {
  const pAppears = clamp01(availability)

  if (recentMinutes.length === 0) {
    // shrunkRate(0, 0, prior) === prior exactly (the phantom-prior term is
    // the only one left standing at zero observed weight) — this IS the
    // season figure when one is supplied, and the named no-history baseline
    // when it is not, by construction rather than a second branch.
    const baselineMinutes = shrunkRate(0, 0, seasonMinutesPerMatch ?? NO_HISTORY_BASELINE_MINUTES)
    return {
      expectedMinutes: baselineMinutes * pAppears,
      pAppears,
      pSixtyPlus: NO_HISTORY_BASELINE_SIXTY_PLUS_RATE * pAppears,
    }
  }

  const totalMinutes = recentMinutes.reduce((sum, m) => sum + m, 0)
  const windowMean = totalMinutes / recentMinutes.length
  // Ticket #213: shrink the window's mean toward the season figure, weighted
  // by how many of the window's matches are real observed evidence (up to
  // RECENT_MATCH_COUNT) against SHRINKAGE_K phantom "season" matches — same
  // formula, same constant as rates.ts. No season figure supplied ->
  // shrink the window toward ITS OWN mean, which by shrunkRate's own algebra
  // reproduces windowMean exactly (see this file's header).
  const shrunkMean = shrunkRate(totalMinutes, recentMinutes.length, seasonMinutesPerMatch ?? windowMean)
  const sixtyPlusRate = recentMinutes.filter((m) => m >= 60).length / recentMinutes.length

  return {
    expectedMinutes: shrunkMean * pAppears,
    pAppears,
    pSixtyPlus: sixtyPlusRate * pAppears,
  }
}

/** Exported so `scripts/project-points.ts` can slice a player's match history the same way this module expects it. */
export { RECENT_MATCH_COUNT }
