/**
 * Defensive-contribution hit-rate estimator — the forward-looking sibling of
 * `src/lib/scoring/defensiveContribution.ts`. That module answers "did this
 * player reach their threshold in *this* match" as a pure function; this one
 * answers "how likely is this player to reach it in the *next* one," from
 * their own match history plus a position prior.
 *
 * Pure computation only, in the same shape as the scoring module: no I/O, no
 * database, no fetch. See `product-brief.md` §6d — this is one of five
 * inputs to the v1 projection model, and each input must be explainable in
 * one sentence. This one is: a shrunk empirical rate, `(hits + k×prior) /
 * (n + k)` with k = 5, so a player with little or no history degrades
 * gracefully toward the position's typical rate instead of swinging to 0 or
 * 1 on a handful of matches.
 *
 * TWO-STAGE SHRINKAGE (ticket #113). `estimateTwoStageDefconHitRate` below
 * applies the identical shrinkage twice rather than once: the player's own
 * current-season hit rate, shrunk toward his personal prior, which is
 * itself his historical hit rate shrunk toward the position prior. Same
 * `k = 5`, same formula, no new parameter — see `rates.ts`'s header for the
 * one-line rule this mirrors ("this season, shrunk toward (last season,
 * shrunk toward the position average)"). Composition of
 * `estimateDefconHitRate` with itself is the whole implementation; there is
 * nothing else to tune.
 *
 * The threshold check itself is never reimplemented here. `cbitCount` and
 * `cbirtCount` alone cannot tell you "hit" or "miss" without also knowing
 * the position-specific threshold value — and this module is not allowed to
 * hold that number, so it cannot compare a count against it directly.
 * `defensiveContributionPoints` from
 * `src/lib/scoring/` already wraps exactly that comparison (it calls
 * `cbitCount`/`cbirtCount` internally and returns 0 or the +2 cap), so "hit"
 * here is defined as `defensiveContributionPoints(...) > 0`. That delegates
 * the threshold check to the scoring module without this file ever knowing
 * what the threshold is — which is the property the definition of done asks
 * for. See decisions/ticket-28.md.
 */
import type { Position } from '../scoring/types.ts'
import { GOALKEEPER } from '../scoring/types.ts'
import { defensiveContributionPoints } from '../scoring/defensiveContribution.ts'
import type { DefensiveContributionMatch } from './types.ts'

/** A match only counts toward a rate if the player was on the pitch long enough to plausibly reach a per-match threshold. */
const QUALIFYING_MINUTES = 60

/** Shrinkage strength: how many "phantom prior matches" the prior is worth against observed data. Pre-answered in the ticket — do not change without a new decision. */
const SHRINKAGE_K = 5

/** Returned by `positionPriorHitRate` for an empty match set: maximum uncertainty, not zero — there is no observed evidence either way. */
const NEUTRAL_PRIOR = 0.5

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** Only matches with at least 60 minutes played qualify — a substitute cameo essentially cannot reach a per-match defensive-contribution threshold. */
export function isQualifyingMatch(match: Pick<DefensiveContributionMatch, 'minutesPlayed'>): boolean {
  return match.minutesPlayed >= QUALIFYING_MINUTES
}

/** Did the player reach their defensive-contribution threshold in this match? Delegates entirely to `defensiveContributionPoints`, which is itself built on `cbitCount`/`cbirtCount` — no threshold value lives in this file. */
function reachedThreshold(position: Position, match: DefensiveContributionMatch): boolean {
  return defensiveContributionPoints(position, match) > 0
}

/**
 * Position-level prior hit rate: the observed proportion of qualifying
 * matches, among the ones passed in, that reached the defensive-contribution
 * threshold for that position. Feed it a broad set of historical matches for
 * players in one position (e.g. every defender's matches from the current
 * season) to get that position's baseline rate — nothing here is
 * hardcoded.
 *
 * Goalkeepers do not earn defensive-contribution points at all (a separate
 * saves function applies instead, per product-brief.md §6d), so the
 * goalkeeper prior is always 0 regardless of what's passed in.
 *
 * An empty match set returns `NEUTRAL_PRIOR` (0.5) rather than dividing by
 * zero or erroring — with zero evidence, maximum uncertainty is the honest
 * answer, not a claim of "never happens."
 */
export function positionPriorHitRate(
  position: Position,
  matches: readonly DefensiveContributionMatch[],
): number {
  if (position === GOALKEEPER) return 0

  const qualifying = matches.filter(isQualifyingMatch)
  if (qualifying.length === 0) return NEUTRAL_PRIOR

  const hits = qualifying.filter((match) => reachedThreshold(position, match)).length
  return hits / qualifying.length
}

/**
 * A player's estimated per-match probability of reaching their
 * defensive-contribution threshold in their next match, from their own
 * qualifying match history plus a position prior.
 *
 * `(hits + k × positionPrior) / (qualifyingMatches + k)`, k = 5. With no
 * qualifying matches this reduces to exactly `positionPrior`; with many
 * qualifying matches it converges on the player's own observed rate.
 *
 * Goalkeepers always return 0 — defensive contribution does not apply to
 * them, regardless of the prior or any stats passed in.
 */
export function estimateDefconHitRate(
  position: Position,
  matches: readonly DefensiveContributionMatch[],
  positionPrior: number,
): number {
  if (position === GOALKEEPER) return 0

  const qualifying = matches.filter(isQualifyingMatch)
  const hits = qualifying.filter((match) => reachedThreshold(position, match)).length
  const n = qualifying.length

  const estimate = (hits + SHRINKAGE_K * positionPrior) / (n + SHRINKAGE_K)
  return clamp01(estimate)
}

/**
 * Two-stage shrinkage (ticket #113) for the defensive-contribution hit
 * rate — the defcon sibling of `rates.ts`'s `computeTwoStagePlayerRates`.
 *
 *   personalPrior = estimateDefconHitRate(position, historicalMatches, positionPrior)
 *   twoStageRate  = estimateDefconHitRate(position, currentSeasonMatches, personalPrior)
 *
 * Goalkeepers still always return 0 — `estimateDefconHitRate` already
 * short-circuits on `GOALKEEPER` at both stages, so this composes that
 * behaviour rather than repeating it. A player with no qualifying
 * current-season matches collapses to exactly `personalPrior` (today's
 * single-stage historical-vs-position-prior estimate); a player with no
 * qualifying matches at either level collapses to exactly `positionPrior`.
 */
export function estimateTwoStageDefconHitRate(
  position: Position,
  currentSeasonMatches: readonly DefensiveContributionMatch[],
  historicalMatches: readonly DefensiveContributionMatch[],
  positionPrior: number,
): number {
  const personalPrior = estimateDefconHitRate(position, historicalMatches, positionPrior)
  return estimateDefconHitRate(position, currentSeasonMatches, personalPrior)
}

/**
 * Expected defensive-contribution points for a player: probability × 2, the
 * per-match cap. Never exceeds 2 because the probability is clamped to
 * [0, 1] first.
 */
export function expectedDefensiveContributionPoints(probability: number): number {
  return clamp01(probability) * 2
}
