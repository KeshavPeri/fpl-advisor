/**
 * Pure derivation for the reasoning screen (ticket #79, feature-list item
 * 21). No I/O — takes an already-resolved `ReasoningRecommendationData | null`
 * (see api.ts) and returns a fully-resolved `ReasoningView` the screen
 * renders with no further logic, same split as `src/lib/verdict/derive.ts`
 * (pure + tested) and `Pitch.tsx`'s pitchLayout.ts split.
 *
 * design-reference.md's Linear reference names THIS screen as the one place
 * in the app where information density is correct — every stored reason
 * line, the full component breakdown, coverage and the model version all
 * render here, none of it hidden behind a summary. product-brief.md §8
 * still governs: decimals are permitted ONLY here (never on the verdict
 * card or anywhere else), and every projected-points value must carry
 * context — a bare number next to nothing is exactly what this rule bans.
 */
import { formatSyncTimestamp } from '../format.ts'
import type {
  ConfidenceBand,
  PlayerProjectionData,
  ReasoningRecommendationData,
  StartingXIPick,
} from './types.ts'

function nameFor(id: number, names: ReadonlyMap<number, string>): string {
  return names.get(id) ?? 'Unknown player'
}

// ============================================================================
// Component-label formatting — DELIBERATELY generic. `player_projections
// .components.points` is written by scripts/project-points.ts with whatever
// keys the model computes (appearancePoints, goalPoints, ... today; #78 adds
// nothing new here, a real bonus number just starts flowing through the same
// key). This function turns ANY camelCase `*Points` key into a sentence-case
// label — it does not enumerate the keys it expects, so an unrecognised key
// (a future model input) still renders with a readable label instead of
// being silently dropped. See derive.test.ts's "unknown component key" test.
// ============================================================================

const TRAILING_POINTS = /Points$/

export function formatComponentLabel(key: string): string {
  const trimmed = key.replace(TRAILING_POINTS, '')
  const spaced = trimmed.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  const label = spaced.length > 0 ? spaced : 'points'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export interface ReasoningComponentRow {
  key: string
  label: string
  value: number
}

/** Every entry in a player's `components.points` object, as display rows —
 *  iterates the object's OWN keys (ticket DoD), never a fixed list. Sorted
 *  by nothing but insertion order (`Object.entries`), matching the order
 *  scripts/project-points.ts writes them in — stable and not something this
 *  file re-decides. */
function pointsToRows(points: Readonly<Record<string, number>>): ReasoningComponentRow[] {
  return Object.entries(points).map(([key, value]) => ({
    key,
    label: formatComponentLabel(key),
    value,
  }))
}

// ============================================================================
// Coverage — product-brief.md §8. Every player shown here gets a coverage
// sentence, not just the ones with a gap (design-reference.md/§8: silence on
// a marquee summer signing must not read as a verdict) — this is the one
// place that differs from VerdictCard's coverageNote, which only speaks up
// for the missing-history case.
// ============================================================================

function coverageSentence(name: string, hasHistory: boolean): string {
  return hasHistory
    ? `${name} — built on real Premier League match history.`
    : `${name} — no Premier League history yet; this rests on a position-based estimate, not a season of form.`
}

// ============================================================================
// Captain confidence band — ticket #79's own thresholds, pre-decided in the
// ticket's Notes ("because": product-brief.md §8 says gaps routinely under
// one point are inside the model's own error). Compares the captain's raw
// projected points (never doubled) against the next-highest STARTER in the
// same starting XI — not the next-highest in the full squad.
// ============================================================================

export type CaptainConfidenceBand = ConfidenceBand

/** gap < 0.5 -> coin-flip; 0.5 to 1.5 inclusive -> marginal; > 1.5 -> clear.
 *  Exported so both this file's callers and its own unit tests can name the
 *  thresholds without repeating magic numbers (ticket DoD: boundary values
 *  0.5 and 1.5 exactly are unit-tested). */
export function deriveCaptainConfidenceBand(gap: number): CaptainConfidenceBand {
  const absoluteGap = Math.abs(gap)
  if (absoluteGap > 1.5) return 'clear'
  if (absoluteGap >= 0.5) return 'marginal'
  return 'coin-flip'
}

interface CaptainGap {
  gap: number
  captainId: number
  nextBestId: number
}

/** Finds the captain among the starting XI and the highest-projected
 *  non-captain starter, and returns the (unsigned) gap between them. Null
 *  when there's nothing to compare — no starting XI, no flagged captain, or
 *  a starting XI of exactly one player (defensive; should not happen for a
 *  real eleven). */
function findCaptainGap(startingXI: readonly StartingXIPick[]): CaptainGap | null {
  const captain = startingXI.find((pick) => pick.isCaptain)
  if (!captain) return null

  const others = startingXI.filter((pick) => pick.playerId !== captain.playerId)
  if (others.length === 0) return null

  const nextBest = others.reduce((best, pick) => (pick.expectedPoints > best.expectedPoints ? pick : best), others[0])

  return {
    gap: Math.abs(captain.expectedPoints - nextBest.expectedPoints),
    captainId: captain.playerId,
    nextBestId: nextBest.playerId,
  }
}

function captainNote(band: CaptainConfidenceBand, captainName: string, nextBestName: string): string {
  if (band === 'coin-flip') {
    return `The captaincy is too close to call — ${captainName} and ${nextBestName} cannot be separated on this projection.`
  }
  if (band === 'marginal') {
    return `${captainName} is a marginal pick for captain over ${nextBestName}.`
  }
  return `${captainName} is a clear pick for captain over ${nextBestName}.`
}

// ============================================================================
// View types
// ============================================================================

export interface ReasoningPlayerView {
  role: string
  name: string
  coverageNote: string
  components: readonly ReasoningComponentRow[]
  /** False when no player_projections row could be resolved for this player
   *  at all — the component list is then empty and the screen must say so,
   *  never render a silently-empty table. */
  hasProjection: boolean
}

export interface ReasoningHitView {
  cost: number
  gross: number
  net: number
}

export type ReasoningViewStatus = 'empty' | 'ready'

export interface ReasoningView {
  status: ReasoningViewStatus
  /** Set only when status is 'empty' — a specific sentence naming what's
   *  missing and what to do (design-reference.md's writing rules), never a
   *  generic error or an indefinite spinner. */
  emptyMessage: string | null
  gameweekName: string | null
  headline: string | null
  reasons: readonly string[]
  horizonLabel: string
  horizonGross: number | null
  horizonNet: number | null
  hit: ReasoningHitView | null
  confidenceWord: ConfidenceBand | null
  players: readonly ReasoningPlayerView[]
  captainBand: CaptainConfidenceBand | null
  captainNote: string | null
  modelVersion: string | null
  computedAtLabel: string | null
}

const EMPTY_MESSAGE =
  'No recommendation to explain yet — run scripts/generate-recommendations.ts to produce this ' +
  "gameweek's plan, then reload this page."

/** Fixed role display order — transfer-in, transfer-out, captain,
 *  vice-captain — matching the order the ticket's own scope list names
 *  them in. A roll plan has no transfer-in/out, so those two are simply
 *  skipped rather than shown as a gap. */
const ROLE_ORDER: ReadonlyArray<{
  role: 'transferIn' | 'transferOut' | 'captain' | 'viceCaptain'
  label: string
  idOf: (data: ReasoningRecommendationData) => number | null
}> = [
  { role: 'transferIn', label: 'Transfer in', idOf: (d) => d.transferInPlayerId },
  { role: 'transferOut', label: 'Transfer out', idOf: (d) => d.transferOutPlayerId },
  { role: 'captain', label: 'Captain', idOf: (d) => d.captainPlayerId },
  { role: 'viceCaptain', label: 'Vice-captain', idOf: (d) => d.viceCaptainPlayerId },
]

function findCoverage(
  coverage: ReasoningRecommendationData['coverage'],
  role: string,
  playerId: number
): boolean {
  // Default true (no coverage gap) when nothing was stored for this
  // role/player — coverage rows only exist for players actually checked at
  // generation time (recommendation_reasons/coverage precedent, see
  // src/lib/recommendation/coverage.ts). A missing entry is not evidence of
  // a gap; only an explicit `hasHistory: false` row is.
  const entry = coverage.find((c) => c.role === role && c.playerId === playerId)
  return entry?.hasHistory ?? true
}

function projectionFor(
  projections: ReadonlyMap<number, PlayerProjectionData>,
  playerId: number
): PlayerProjectionData | null {
  return projections.get(playerId) ?? null
}

export function deriveReasoningView(data: ReasoningRecommendationData | null): ReasoningView {
  if (!data) {
    return {
      status: 'empty',
      emptyMessage: EMPTY_MESSAGE,
      gameweekName: null,
      headline: null,
      reasons: [],
      horizonLabel: 'Horizon unavailable',
      horizonGross: null,
      horizonNet: null,
      hit: null,
      confidenceWord: null,
      players: [],
      captainBand: null,
      captainNote: null,
      modelVersion: null,
      computedAtLabel: null,
    }
  }

  const headline =
    data.reasons[0] ?? (data.isRoll ? 'Roll your transfer.' : 'A transfer is recommended.')

  const players: ReasoningPlayerView[] = ROLE_ORDER.filter((entry) => entry.idOf(data) !== null).map(
    (entry) => {
      const playerId = entry.idOf(data) as number
      const name = nameFor(playerId, data.playerNames)
      const hasHistory = findCoverage(data.coverage, entry.role, playerId)
      const projection = projectionFor(data.projections, playerId)
      return {
        role: entry.label,
        name,
        coverageNote: coverageSentence(name, hasHistory),
        components: projection ? pointsToRows(projection.points) : [],
        hasProjection: projection !== null,
      }
    }
  )

  const hit =
    data.hitCost > 0
      ? { cost: data.hitCost, gross: data.grossPointsRounded, net: data.netPointsRounded }
      : null

  const horizonLabel =
    data.horizon !== null
      ? `Projected across ${data.horizon} gameweek${data.horizon === 1 ? '' : 's'}`
      : 'Horizon unavailable'

  // Model version / computed-at: taken from whichever named player's
  // projection resolved first, in ROLE_ORDER — every row written for one
  // gameweek by one job run shares the same model_version and computed_at
  // (scripts/project-points.ts writes both from one MODEL_VERSION constant
  // and one `new Date()` per run), so any resolved player's row is
  // representative. Null when no projection resolved for anyone.
  const firstProjection = ROLE_ORDER.map((entry) => entry.idOf(data))
    .filter((id): id is number => id !== null)
    .map((id) => projectionFor(data.projections, id))
    .find((p): p is PlayerProjectionData => p !== null)

  const modelVersion = firstProjection?.modelVersion ?? null
  const computedAtLabel = firstProjection ? formatSyncTimestamp(firstProjection.computedAt) : null

  let captainBand: CaptainConfidenceBand | null = null
  let captainNoteText: string | null = null
  if (data.startingXI) {
    const found = findCaptainGap(data.startingXI)
    if (found) {
      captainBand = deriveCaptainConfidenceBand(found.gap)
      const captainName = nameFor(found.captainId, data.playerNames)
      const nextBestName = nameFor(found.nextBestId, data.playerNames)
      captainNoteText = captainNote(captainBand, captainName, nextBestName)
    }
  }

  return {
    status: 'ready',
    emptyMessage: null,
    gameweekName: data.gameweekName,
    headline,
    reasons: data.reasons,
    horizonLabel,
    // The horizon TOTAL (recommendations.gross_points_rounded/
    // net_points_rounded) is a separate stored figure from the horizon
    // COUNT (solver_runs.horizon) used only for horizonLabel above — one
    // being unresolvable must not blank the other. A missing horizon count
    // means the label reads "Horizon unavailable" while the total itself
    // still renders; see derive.test.ts.
    horizonGross: data.grossPointsRounded,
    horizonNet: data.netPointsRounded,
    hit,
    confidenceWord: data.confidenceBand,
    players,
    captainBand,
    captainNote: captainNoteText,
    modelVersion,
    computedAtLabel,
  }
}

