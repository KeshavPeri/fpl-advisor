/**
 * Pure derivation for the verdict card (ticket #61). No I/O — takes an
 * already-resolved `VerdictRecommendationData` (see api.ts for how that gets
 * built) plus the current gameweek id, and returns a fully-resolved
 * `VerdictView` the component renders with no further logic. Same shape as
 * the pitch's own split (pitchLayout.ts pure + tested, Pitch.tsx a dumb
 * renderer) and the countdown's (deadlineCountdown.ts pure + tested,
 * DeadlineCountdown.tsx a dumb renderer).
 *
 * Every points figure passed in is already a stored `*_rounded` integer
 * column (product-brief.md §8 / the recommendations migration) — this file
 * never calls Math.round or toFixed on a points value, only assembles
 * already-whole numbers, so no decimal can appear in its output.
 */
import type { VerdictRecommendationData, VerdictView } from './types.ts'

function nameFor(id: number, names: ReadonlyMap<number, string>): string {
  return names.get(id) ?? 'Unknown player'
}

export function deriveVerdictView(
  data: VerdictRecommendationData,
  currentGameweekId: number
): VerdictView {
  const isStale = data.gameweekId !== currentGameweekId
  const gwDiff = currentGameweekId - data.gameweekId

  const headline =
    data.reasons[0] ?? (data.isRoll ? 'Roll your transfer.' : 'A transfer is recommended.')

  const captainLine = `Captain ${nameFor(data.captainPlayerId, data.playerNames)}. Vice-captain ${nameFor(
    data.viceCaptainPlayerId,
    data.playerNames
  )}.`

  const hit =
    data.hitCost > 0
      ? { cost: data.hitCost, gross: data.grossPointsRounded, net: data.netPointsRounded }
      : null

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
    netPoints: data.netPointsRounded,
    hit,
    confidenceWord,
    coinFlipNote,
    coverageNote,
  }
}
