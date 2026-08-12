/**
 * Shared types for the projection module.
 *
 * Position codes and per-match defensive-action counts are not redefined
 * here — see `DEFCONRATE` notes in `defconRate.ts` for why. This file adds
 * only the one thing the scoring module doesn't need: minutes played, which
 * `defconRate.ts` uses to decide whether a match qualifies at all.
 */
import type { DefensiveActionStats } from '../scoring/types.ts'

/**
 * A single player-match, as far as the defensive-contribution rate estimator
 * needs it: the same raw action counts `src/lib/scoring/` scores, plus
 * minutes played so the estimator can apply the 60-minute qualifying rule.
 */
export interface DefensiveContributionMatch extends DefensiveActionStats {
  minutesPlayed: number
}
