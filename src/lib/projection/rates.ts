/**
 * Rate model — shrunk per-90 attacking/save rates from a player's own match
 * history plus a position prior. Two of these (xG, xA per 90) are the
 * "xG and xA rates" input named in product-brief.md §6d; a third
 * (saves per 90) reuses the identical method to feed the goalkeeper save-
 * points calculation in `expectedPoints.ts`, since `player_match_stats`
 * already carries a `saves` column and the shrinkage formula is generic.
 * Two more (CBI, recoveries per 90 — ticket #78) feed the bonus-points
 * projection in `bonus.ts` the same way, for the same reason: the shrinkage
 * formula is generic in the underlying count, not specific to attacking
 * stats.
 *
 * TWO-STAGE SHRINKAGE (ticket #113). `player_match_stats` now carries rows
 * from more than one season, and a player who has actually played this
 * season should not be judged purely on a position average while last
 * season's evidence sits unused. The fix is not a fixed percentage split —
 * "70% this season, 30% last" is wrong at both ends of a season, badly
 * calibrated after two gameweeks and again in April. It is instead the
 * SAME shrinkage formula applied twice, stated as its because: this
 * season, shrunk toward (last season, shrunk toward the position average).
 * `computeTwoStagePlayerRates` below does exactly that — two calls to
 * `computePlayerRates`, no new parameter, no numeric literal beyond the
 * existing `SHRINKAGE_K`. A player with zero current-season minutes
 * collapses to exactly the single-stage historical-vs-position-prior rate
 * (today's behaviour, unchanged); a player with no rows at either level
 * collapses to the position prior, exactly as today.
 *
 * `computePlayerRates` itself is untouched on purpose: `expectedPoints.ts`
 * calls it directly and is out of scope for this ticket, so its signature
 * cannot change. `scripts/project-points.ts` gets the two-stage effect by
 * feeding it a personal prior (the historical-stage-1 result) in place of
 * the position prior — see that file's own header for the wiring.
 *
 * Pure computation only: no I/O, no database, no fetch.
 *
 * The formula, stated once here rather than per-rate: shrink the observed
 * per-90 rate toward a position prior by `k` "phantom prior nineties":
 * `(total + k × prior) / (ninetiesPlayed + k)`. With zero minutes played
 * this reduces to exactly the prior; with a full season of minutes it
 * converges on the player's own observed rate. `k = 3` is pre-answered in
 * the ticket — smaller than defconRate.ts's k = 5 because these rates are
 * lower-variance counting stats (xG/xA/saves accumulate roughly linearly
 * per 90) than a binary per-match threshold hit.
 *
 * PRICE AS A WEAK PRIOR (ticket #119). Neither shrinkage stage above helps a
 * player with zero qualifying rows at BOTH levels (docs/projection-model-backlog.md
 * G2) — a summer signing from outside the Premier League, or a promoted
 * club's player who has not yet played a Premier League minute. With zero
 * minutes at every level, both stages collapse to exactly the position
 * prior, by construction of `shrunkRate` — there is nothing for shrinkage to
 * work with. `priceAdjustedPositionPrior` below gives that population one
 * weak signal that already exists in the database and is otherwise unused:
 * `players.now_cost` is FPL's own analysts pricing a player by expected
 * returns. One-sentence explanation (required by product-brief.md §6d): a
 * player we know nothing about is assumed to be as good as his price says,
 * relative to others in his position.
 *
 * It touches ONLY xgPer90 and xaPer90 — price signals attacking expectation,
 * not clearances or saves, which are functions of team shape and fixture
 * rather than transfer fee (see the ticket's Notes). It is applied to the
 * POSITION PRIOR itself, before that prior ever enters stage one above —
 * never inside `computePlayerRates`/`computeTwoStagePlayerRates`, and it
 * must never be applied to a player with any real minutes at either level.
 * The caller (`scripts/project-points.ts`) enforces that: see its
 * `effectiveRatePositionPrior`, which only substitutes the price-adjusted
 * prior in for a player whose two-stage coverage classifies as "neither".
 *
 * The scale is clamped to [PRICE_PRIOR_MIN_SCALE, PRICE_PRIOR_MAX_SCALE]
 * deliberately: the price signal is real but weak — right about ordering
 * more often than magnitude. An unclamped ratio would hand a £15m striker
 * several times the position prior on no evidence at all, manufacturing the
 * false confidence product-brief.md §8 forbids. This is a stated
 * under-correction, not a calibration — no backtest yet shows the clamped
 * scale is closer to reality than the flat prior it replaces (see
 * docs/projection-model-backlog.md G2).
 */

/** Shrinkage strength: "phantom prior nineties" the prior is worth against observed data. Pre-answered in the ticket. */
export const SHRINKAGE_K = 3

/** Weak-prior price-scaling clamp bounds (ticket #119) — see the header note above for why these are a deliberate under-correction rather than a fitted calibration. */
export const PRICE_PRIOR_MIN_SCALE = 0.6
export const PRICE_PRIOR_MAX_SCALE = 1.8

export interface PlayerRates {
  xgPer90: number
  xaPer90: number
  savesPer90: number
  /** CBI = clearances + blocks + interceptions — NOT tackles, same definition as `src/lib/scoring/bps.ts`. Ticket #78, feeds the bonus-points projection. */
  cbiPer90: number
  /** Ball recoveries per 90. Ticket #78, feeds the bonus-points projection. */
  recoveriesPer90: number
}

/** A player's own match-history totals, aggregated across every match row available (not just the last five — see minutes.ts for that separate, smaller window). */
export interface PlayerRateHistory {
  minutesPlayed: number
  totalXg: number
  totalXa: number
  totalSaves: number
  /** Sum of clearances + blocks + interceptions across every match — ticket #78. */
  totalCbi: number
  /** Sum of recoveries across every match — ticket #78. */
  totalRecoveries: number
}

function shrunkRate(total: number, ninetiesPlayed: number, prior: number): number {
  return (total + SHRINKAGE_K * prior) / (ninetiesPlayed + SHRINKAGE_K)
}

/**
 * Shrunk per-90 rates for one player, from their own history totals and a
 * position prior (see {@link positionPriorRates}). A player with zero
 * minutes played returns the position prior exactly, by construction of the
 * formula above — no special-cased branch needed.
 */
export function computePlayerRates(history: PlayerRateHistory, positionPrior: PlayerRates): PlayerRates {
  const ninetiesPlayed = history.minutesPlayed / 90
  return {
    xgPer90: shrunkRate(history.totalXg, ninetiesPlayed, positionPrior.xgPer90),
    xaPer90: shrunkRate(history.totalXa, ninetiesPlayed, positionPrior.xaPer90),
    savesPer90: shrunkRate(history.totalSaves, ninetiesPlayed, positionPrior.savesPer90),
    cbiPer90: shrunkRate(history.totalCbi, ninetiesPlayed, positionPrior.cbiPer90),
    recoveriesPer90: shrunkRate(history.totalRecoveries, ninetiesPlayed, positionPrior.recoveriesPer90),
  }
}

/**
 * Two-stage shrinkage (ticket #113): the player's own current-season rate,
 * shrunk toward his personal prior — which is itself his historical rate,
 * shrunk toward the position prior. Both stages reuse
 * {@link computePlayerRates} unmodified (same `SHRINKAGE_K`, same formula),
 * so this function contains no numeric literal of its own and no extra
 * blending knob — the composition IS the two-stage rule, stated once here:
 *
 *   personalPrior = computePlayerRates(historical, positionPrior)
 *   twoStageRate  = computePlayerRates(currentSeason, personalPrior)
 *
 * A player with zero current-season minutes: `computePlayerRates` with
 * zero minutes returns its prior argument exactly, so this collapses to
 * `personalPrior` — i.e. today's single-stage historical-vs-position-prior
 * rate, unchanged to the last decimal. A player with no rows at either
 * level: both stages collapse in turn, leaving exactly `positionPrior`.
 * A player with many current-season nineties: stage two's own shrinkage
 * denominator grows past `SHRINKAGE_K`, so `personalPrior` (and therefore
 * the historical season) contributes negligibly, converging on the
 * player's own current-season rate — the same convergence behaviour
 * `computePlayerRates` already has, just applied to the current-season
 * observed side instead of the full history.
 */
export function computeTwoStagePlayerRates(
  currentSeason: PlayerRateHistory,
  historical: PlayerRateHistory,
  positionPrior: PlayerRates,
): PlayerRates {
  const personalPrior = computePlayerRates(historical, positionPrior)
  return computePlayerRates(currentSeason, personalPrior)
}

/** One match's worth of the raw stats {@link positionPriorRates} aggregates over. */
export interface RateHistoryMatch {
  minutesPlayed: number
  xg: number
  xa: number
  saves: number
  /** Clearances + blocks + interceptions for this match — NOT tackles. Ticket #78. */
  cbi: number
  /** Recoveries for this match. Ticket #78. */
  recoveries: number
}

/**
 * Position-level prior per-90 rates: the observed totals across every match
 * passed in, divided by total nineties played. Feed it every match row for
 * every player in one position (e.g. every midfielder's matches from the
 * current season) to get that position's baseline — nothing here is
 * hardcoded, per the DoD.
 *
 * An empty match set (or a set with zero total minutes) returns all-zero
 * rates rather than dividing by zero — there is no data to compute a
 * baseline from, and 0 is at least honest about that, unlike a fabricated
 * literal.
 */
export function positionPriorRates(matches: readonly RateHistoryMatch[]): PlayerRates {
  const totalMinutes = matches.reduce((sum, m) => sum + m.minutesPlayed, 0)
  const ninetiesPlayed = totalMinutes / 90
  if (ninetiesPlayed === 0) {
    return { xgPer90: 0, xaPer90: 0, savesPer90: 0, cbiPer90: 0, recoveriesPer90: 0 }
  }

  const totalXg = matches.reduce((sum, m) => sum + m.xg, 0)
  const totalXa = matches.reduce((sum, m) => sum + m.xa, 0)
  const totalSaves = matches.reduce((sum, m) => sum + m.saves, 0)
  const totalCbi = matches.reduce((sum, m) => sum + m.cbi, 0)
  const totalRecoveries = matches.reduce((sum, m) => sum + m.recoveries, 0)

  return {
    xgPer90: totalXg / ninetiesPlayed,
    xaPer90: totalXa / ninetiesPlayed,
    savesPer90: totalSaves / ninetiesPlayed,
    cbiPer90: totalCbi / ninetiesPlayed,
    recoveriesPer90: totalRecoveries / ninetiesPlayed,
  }
}

/**
 * The clamped price-relative-to-position-median scale factor (ticket #119):
 * `nowCost / positionMedianCost`, clamped to
 * `[PRICE_PRIOR_MIN_SCALE, PRICE_PRIOR_MAX_SCALE]`. A non-positive median —
 * an empty position, or a genuine data problem — returns exactly 1 (no
 * adjustment) rather than dividing by zero or by a negative number.
 */
export function priceAdjustmentScale(nowCost: number, positionMedianCost: number): number {
  if (positionMedianCost <= 0) return 1
  const rawScale = nowCost / positionMedianCost
  return Math.min(PRICE_PRIOR_MAX_SCALE, Math.max(PRICE_PRIOR_MIN_SCALE, rawScale))
}

/**
 * Adjusts a position prior's xG/xA rates by a player's price relative to the
 * median price for his position (ticket #119) — see this file's header for
 * the full "because" and why it is xG/xA only. `savesPer90`, `cbiPer90` and
 * `recoveriesPer90` pass through completely unchanged; price says nothing
 * about them. Only meant to be called for a player with zero minutes at
 * every level — see `scripts/project-points.ts`'s `effectiveRatePositionPrior`
 * for where that condition is enforced.
 */
export function priceAdjustedPositionPrior(
  positionPrior: PlayerRates,
  nowCost: number,
  positionMedianCost: number,
): PlayerRates {
  const scale = priceAdjustmentScale(nowCost, positionMedianCost)
  return {
    ...positionPrior,
    xgPer90: positionPrior.xgPer90 * scale,
    xaPer90: positionPrior.xaPer90 * scale,
  }
}
