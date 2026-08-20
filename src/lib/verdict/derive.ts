/**
 * Pure derivation for the verdict card (ticket #61, extended by #68). No
 * I/O — takes an already-resolved `VerdictRecommendationData` (see api.ts
 * for how that gets built) plus the current gameweek id, and returns a
 * fully-resolved `VerdictView` the component renders with no further logic.
 * Same shape as the pitch's own split (pitchLayout.ts pure + tested,
 * Pitch.tsx a dumb renderer) and the countdown's (deadlineCountdown.ts pure
 * + tested, DeadlineCountdown.tsx a dumb renderer).
 *
 * Every horizon-total points figure passed in is already a stored
 * `*_rounded` integer column (product-brief.md §8 / the recommendations
 * migration) — this file never calls Math.round or toFixed on THOSE. The
 * one figure this file does compute itself is `gameweekPoints` (ticket
 * #68), summed from raw per-player `solver_picks.expected_points` — see
 * `sumGameweekPoints` below — and rounded here, the same convention
 * scripts/generate-recommendations.ts uses for gross_points_rounded /
 * net_points_rounded (Math.round, never floor/ceil).
 */
import type { GameweekPick, VerdictRecommendationData, VerdictView } from './types.ts'

function nameFor(id: number, names: ReadonlyMap<number, string>): string {
  return names.get(id) ?? 'Unknown player'
}

/**
 * Ensures exactly one trailing full stop after a player's display name
 * (ticket #68) — `web_name` values that already end in "." (e.g.
 * "Bruno G.") must not gain a second one. This only ever inspects the END
 * of the string, so a name with an internal full stop is left untouched.
 */
function withFullStop(name: string): string {
  return name.endsWith('.') ? name : `${name}.`
}

/**
 * Sums a starting XI's THIS-gameweek projected points (ticket #68) —
 * `solver_picks.expected_points`, captain's contribution counted twice,
 * rounded to a whole number. Filters to `isLineup` defensively even though
 * api.ts's own query already filters `is_lineup = true` at the database
 * layer — this is the one place the arithmetic actually lives, so it is the
 * one place that must not silently trust an unfiltered input (see this
 * file's bench-exclusion test). Returns null when there is nothing to sum
 * (no rows at all, or no lineup rows survive the filter) — the caller
 * renders that as an explicit "unavailable" figure, never 0/NaN.
 */
function sumGameweekPoints(picks: readonly GameweekPick[] | null): number | null {
  if (!picks) return null
  const lineup = picks.filter((pick) => pick.isLineup)
  if (lineup.length === 0) return null
  const total = lineup.reduce(
    (sum, pick) => sum + pick.expectedPoints * (pick.isCaptain ? 2 : 1),
    0
  )
  return Math.round(total)
}

export function deriveVerdictView(
  data: VerdictRecommendationData,
  currentGameweekId: number
): VerdictView {
  const isStale = data.gameweekId !== currentGameweekId
  const gwDiff = currentGameweekId - data.gameweekId

  const headline =
    data.reasons[0] ?? (data.isRoll ? 'Roll your transfer.' : 'A transfer is recommended.')

  const captainLine = `Captain ${withFullStop(
    nameFor(data.captainPlayerId, data.playerNames)
  )} Vice-captain ${withFullStop(nameFor(data.viceCaptainPlayerId, data.playerNames))}`

  const gameweekPoints = sumGameweekPoints(data.gameweekPicks)
  // Always the recommendation's OWN gameweek name, not the current one — a
  // stale recommendation's figure describes ITS gameweek (ticket #68 DoD:
  // "a stale recommendation renders as stale, figure derived from its OWN
  // gameweek's picks, not the current gameweek").
  const gameweekPointsLabel = `${data.gameweekName} projected points`

  const hit =
    data.hitCost > 0
      ? { cost: data.hitCost, gross: data.grossPointsRounded, net: data.netPointsRounded }
      : null
  // Hits are a one-off cost weighed against horizon-wide gain, never
  // against a single gameweek — this label is what keeps the hit block
  // coherent now that gameweekPoints, not the horizon total, is primary
  // (ticket #68 DoD).
  const hitBasisLabel = hit ? 'Across the full transfer plan' : null

  // The literal band value IS the word to show — product-brief.md §8 names
  // the three words exactly ("clear / marginal / coin-flip"), matching
  // `recommendations.confidence_band`'s own stored values one-for-one, so
  // there's no separate display-label mapping to keep in sync.
  const confidenceWord = data.confidenceBand
  const coinFlipNote =
    data.confidenceBand === 'coin-flip' ? 'The top options are too close to separate.' : null

  const missingHistoryIds = Array.from(
    new Set(data.coverage.filter((entry) => !entry.hasHistory).map((entry) => entry.playerId))
  )
  const coverageNote =
    missingHistoryIds.length > 0
      ? `${missingHistoryIds.map((id) => nameFor(id, data.playerNames)).join(' and ')} ${
          missingHistoryIds.length === 1 ? 'has' : 'have'
        } no Premier League history yet — this rests on an early-season estimate.`
      : null

  return {
    isStale,
    staleGameweekName: isStale ? data.gameweekName : null,
    staleGameweeksOld: isStale && gwDiff > 0 ? gwDiff : null,
    headline,
    captainLine,
    gameweekPoints,
    gameweekPointsLabel,
    hit,
    hitBasisLabel,
    confidenceWord,
    coinFlipNote,
    coverageNote,
  }
}
