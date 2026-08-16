/**
 * Confidence band — ticket #47. product-brief.md §8: projected points are
 * never shown as decimals in the recommendation UI; a coarse band —
 * clear / marginal / coin-flip — stands in for the raw numbers, plus the
 * reason in words.
 *
 * Thresholds are Tier 3 (design-reference.md / product-brief.md §8's
 * "decided here" formatting rule), decided in this ticket's own Notes and
 * EXPLICITLY PROVISIONAL: product-brief.md §9 open question 2 says the real
 * numbers should come from the backtest (item 32), not from taste. Logged
 * as uncalibrated in decisions/ticket-47.md.
 */

export type ConfidenceBand = 'clear' | 'marginal' | 'coin-flip'

/** Score gap (points, across the full solve horizon) at or above which Plan A is a clear pick over Plan B. */
export const CONFIDENCE_CLEAR_THRESHOLD = 2.0
/** Score gap at or above which the edge is marginal rather than a coin-flip. Below this, the two plans are "routinely under one point apart... well inside the model's own error" (product-brief.md §8). */
export const CONFIDENCE_MARGINAL_THRESHOLD = 0.5

/**
 * Derives the base confidence band from the (unsigned) score gap between
 * Plan A and Plan B, summed across the whole solve horizon — not just the
 * current gameweek, and not the raw per-gameweek xP.
 */
export function deriveConfidenceBand(scoreGap: number): ConfidenceBand {
  const gap = Math.abs(scoreGap)
  if (gap >= CONFIDENCE_CLEAR_THRESHOLD) return 'clear'
  if (gap >= CONFIDENCE_MARGINAL_THRESHOLD) return 'marginal'
  return 'coin-flip'
}

/** Ascending order of confidence — index 0 is the least confident band. */
const BAND_ORDER: readonly ConfidenceBand[] = ['coin-flip', 'marginal', 'clear']

/**
 * The data-coverage rule (product-brief.md §8) is a FLOOR, never a ceiling:
 * a recommendation resting on a player with little or no match history
 * drops one confidence band. This function can only move a band down the
 * `BAND_ORDER` list (or leave it unchanged); it can never raise one to
 * `clear`, whatever `hasCoverageGap` says.
 */
export function applyCoverageFloor(band: ConfidenceBand, hasCoverageGap: boolean): ConfidenceBand {
  if (!hasCoverageGap) return band
  const index = BAND_ORDER.indexOf(band)
  return BAND_ORDER[Math.max(0, index - 1)]
}
