/**
 * Pure derivation for the reasoning screen (ticket #79, feature-list item
 * 21; rebuilt for plain language by ticket #277). No I/O — takes an
 * already-resolved `ReasoningRecommendationData | null` (see api.ts) and
 * returns a fully-resolved `ReasoningView` the screen renders with no
 * further logic, same split as `src/lib/verdict/derive.ts` (pure + tested)
 * and `Pitch.tsx`'s pitchLayout.ts split.
 *
 * Ticket #277 — "the plan and the reasons in ten seconds, no jargon" —
 * rewrites this module's output shape around a hero line + one confidence
 * badge, per-player reason chips in plain football language, and a
 * one-line summary per alternative plan. Feature names, "pushes up/pulls
 * down", model names and raw decimals in a headline are never surfaced by
 * this module any more; raw per-player decimals are still permitted in the
 * player-card figure and the disclosed breakdown, per product-brief.md §8
 * ("raw numbers may appear on the reasoning screen, where the context
 * makes them honest") — never in the hero or headline figure, which stay
 * whole numbers.
 */
import { formatSyncTimestamp } from '../format.ts'
import type {
  AlternativePlanData,
  ConfidenceBand,
  CoverageEntry,
  PlayerProjectionData,
  PlayerProjectionDriver,
  ReasoningRecommendationData,
  StartingXIPick,
} from './types.ts'

function nameFor(id: number, names: ReadonlyMap<number, string>): string {
  return names.get(id) ?? 'Unknown player'
}

// ============================================================================
// Component-label formatting — DELIBERATELY generic. `player_projections
// .components.points` is written by scripts/project-points.ts with whatever
// keys the model computes (appearancePoints, goalPoints, ... today), and
// this function turns ANY camelCase `*Points` key into a sentence-case
// label — it does not enumerate the keys it expects, so an unrecognised key
// (a future model input) still renders with a readable label instead of
// being silently dropped. See derive.test.ts's "unknown component key" test.
// This is the per-player breakdown that ticket #277 now puts behind a
// closed-by-default "See the numbers" disclosure (build item 5).
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

/** Sum of every stored `components.points` value — the baseline model's own
 *  total for one gameweek, before `gbm-v1` is available for this player.
 *  Used only as a fallback for the player-card figure (see
 *  `playerHeadlinePoints`); `0` for an empty/missing breakdown reads as
 *  "no stored points", which the caller treats as `null`, never `0`. */
function sumPoints(points: Readonly<Record<string, number>>): number | null {
  const values = Object.values(points)
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0)
}

// ============================================================================
// Learned-model drivers (ticket #266) — `gbm-v1`'s per-player driver list.
// `describeDriver` remains the generic, exhaustive plain-word mapping for
// every one of `model/fpl_model/features.py`'s FEATURES names (used
// nowhere on screen since #277 — see `reasonChip` below for the small,
// deliberately narrow set of football-language chips this screen actually
// shows — but kept as the tested, generic fallback mapping this repo has
// relied on since #266, in case a future ticket needs a plain description
// of an arbitrary driver again).
// ============================================================================

/** `model/fpl_model/features.py`'s `_STAT_COLS` (plus the two derived
 *  minutes-based flags, `m60`/`app`) in plain words — shared by the `r{k}_`
 *  and `p90_{k}_` patterns below, since both roll the same underlying
 *  stats. Keys are exactly the Python column names; values are plain
 *  wording. */
const STAT_WORDS: Readonly<Record<string, string>> = {
  minutes: 'minutes',
  total_points: 'points',
  goals_scored: 'goals',
  assists: 'assists',
  expected_goals: 'expected goals',
  expected_assists: 'expected assists',
  bps: 'bonus points system',
  bonus: 'bonus',
  ict_index: 'ICT index',
  threat: 'threat',
  creativity: 'creativity',
  saves: 'saves',
  clean_sheets: 'clean sheets',
  goals_conceded: 'goals conceded',
  starts: 'starts',
  defensive_contribution: 'defensive contributions',
  expected_goals_conceded: 'expected goals conceded',
  m60: '60+ minute games',
  app: 'appearances',
}

/** Every feature name that is NOT a `r{k}_`/`p90_{k}_` rolling stat — a
 *  fixed set (context, market and odds features, per
 *  model/fpl_model/features.py's `_CONTEXT`/`_MARKET` plus the four odds
 *  names #133 adds), so a plain lookup is enough; no pattern needed. */
const NAMED_FEATURES: Readonly<Record<string, string>> = {
  own_pct_rank: 'popular with managers',
  transfers_rank: 'being transferred in',
  value: 'price',
  was_home: 'playing at home',
  nfix: 'number of fixtures',
  sd_minutes: 'minutes this season',
  sd_apps: 'appearances this season',
  rows_hist: 'games of history',
  pos_i: 'playing position',
  lambda_for: 'expected team goals this fixture',
  lambda_against: 'expected goals against',
  p_win: 'chance of winning',
  p_cs: 'clean-sheet chance',
}

const ROLLING_FEATURE = /^r(\d+)_(.+)$/
const P90_FEATURE = /^p90_(\d+)_(.+)$/
const TEAM_FEATURE = /^t_(gf|ga)_(\d+)$/
const OPPONENT_TEAM_FEATURE = /^ot_(gf|ga)_(\d+)$/

/** Turns one `gbm-v1` driver's generated feature name into plain words, or
 *  `null` when the name is not recognised. Exported for `derive.test.ts`'s
 *  exhaustive `FEATURES` coverage. Not used to render anything on this
 *  screen any more (see this file's own header) — `reasonChip` is what the
 *  screen actually shows. */
export function describeDriver(feature: string): string | null {
  const named = NAMED_FEATURES[feature]
  if (named) return named

  const rolling = feature.match(ROLLING_FEATURE)
  if (rolling) {
    const stat = STAT_WORDS[rolling[2]]
    if (stat) {
      const k = rolling[1]
      return k === '1' ? `${stat} last game` : `${stat} over the last ${k} games`
    }
  }

  const p90 = feature.match(P90_FEATURE)
  if (p90) {
    const stat = STAT_WORDS[p90[2]]
    if (stat) return `${stat} per 90 minutes, last ${p90[1]} games`
  }

  const team = feature.match(TEAM_FEATURE)
  if (team) {
    const [, stat, k] = team
    return `team goals ${stat === 'gf' ? 'scored' : 'conceded'}, last ${k}`
  }

  const opponentTeam = feature.match(OPPONENT_TEAM_FEATURE)
  if (opponentTeam) {
    const [, stat, k] = opponentTeam
    return `opponent goals ${stat === 'gf' ? 'scored' : 'conceded'}, last ${k}`
  }

  return null
}

// ============================================================================
// reasonChip (ticket #277, build item 3) — the actual per-player chips this
// screen shows. Deliberately a SMALL, hand-picked set of driver features,
// each turned into one short, plain, football-language phrase built from
// the driver's own VALUE against a fixed threshold — never from the
// feature's name and never generic ("pushes up"/"pulls down" is banned on
// this screen). A feature this function doesn't recognise, or whose value
// doesn't clear its threshold, returns `null` and is dropped by the caller
// (see `topReasonChips`) — "no chip is better than a vague one" is the
// ticket's own instruction.
//
// Thresholds are this ticket's own Tier 3 calls, reported to the
// orchestrator's decisions log rather than sourced from the brief (the
// brief is silent on exact cut-offs for "high"/"low"):
//   - own_pct_rank / transfers_rank are within-gameweek PERCENTILE ranks in
//     [0, 1] (model/fpl_model/features.py, `.rank(pct=True)`) — 0.7/0.3 read
//     as "clearly in the top/bottom third of the player pool".
//   - value is players.now_cost, tenths of a million — 80 is £8.0m, the
//     conventional FPL line for a "premium" outfield price.
//   - lambda_for (expected goals for the player's own team this fixture)
//     and p_cs (clean-sheet probability) are both modelled rates with no
//     stored percentile; 1.8 and 0.35 are plain reads of "a genuinely
//     strong fixture" against typical Premier League ranges.
//   - the goal-scoring thresholds (r5_goals_scored, r5_expected_goals,
//     p90_*_expected_goals) are picked the same way — a rate that reads as
//     "this player scores/creates chances often", not a statistical cutoff.
// ============================================================================

const MINUTES_LAST_GAME_THRESHOLD = 80
const RANK_HIGH = 0.7
const RANK_LOW = 0.3
const PREMIUM_PRICE_THRESHOLD = 80
const LAMBDA_FOR_HIGH = 1.8
const CLEAN_SHEET_CHANCE_HIGH = 0.35

const GOAL_STAT_THRESHOLDS: Readonly<Record<string, number>> = {
  goals_scored: 3,
  expected_goals: 2.5,
}
const ROLLING5_GOAL_STAT = /^r5_(goals_scored|expected_goals)$/
const P90_EXPECTED_GOALS_THRESHOLD = 0.5
const P90_EXPECTED_GOALS = /^p90_(\d+)_expected_goals$/

function goalStatChip(feature: string, value: number): string | null {
  const rolling = feature.match(ROLLING5_GOAL_STAT)
  if (rolling) {
    const threshold = GOAL_STAT_THRESHOLDS[rolling[1]]
    return value >= threshold ? 'Scoring regularly' : null
  }
  if (P90_EXPECTED_GOALS.test(feature)) {
    return value >= P90_EXPECTED_GOALS_THRESHOLD ? 'Scoring regularly' : null
  }
  return null
}

/** One `gbm-v1` driver's value turned into a short, plain football-language
 *  chip, or `null` when this driver has nothing worth saying (an
 *  unrecognised feature, or a recognised one whose value doesn't clear its
 *  threshold). Exported for `derive.test.ts`'s per-example coverage. */
export function reasonChip(driver: PlayerProjectionDriver): string | null {
  const { feature, value } = driver
  if (value === null) return null

  switch (feature) {
    case 'r1_minutes':
      return value >= MINUTES_LAST_GAME_THRESHOLD ? 'Played 90 mins last game' : null
    case 'transfers_rank':
      if (value >= RANK_HIGH) return 'Managers are buying him'
      if (value <= RANK_LOW) return 'Managers are selling him'
      return null
    case 'own_pct_rank':
      return value >= RANK_HIGH ? 'Owned by most managers' : null
    case 'value':
      return value >= PREMIUM_PRICE_THRESHOLD ? 'Premium, nailed starter' : null
    case 'lambda_for':
      return value >= LAMBDA_FOR_HIGH ? 'Team expected to score' : null
    case 'p_cs':
      return value >= CLEAN_SHEET_CHANCE_HIGH ? 'Good clean-sheet chance' : null
    default:
      return goalStatChip(feature, value)
  }
}

const MAX_CHIPS = 3

/** Up to `MAX_CHIPS` chips for one player's `gbm-v1` drivers — every driver
 *  is turned into a chip (or dropped, via `reasonChip`), the survivors are
 *  ranked by the driver's own `|contribution|` (the model's own sense of
 *  what mattered most for this player), and only the top three are kept.
 *  `[]` for a player with no `gbm-v1` drivers at all (only a baseline-v1
 *  row, or no row), which is a normal, common state, not a shortfall. */
export function topReasonChips(drivers: readonly PlayerProjectionDriver[]): string[] {
  return drivers
    .map((driver) => ({ text: reasonChip(driver), contribution: driver.contribution }))
    .filter((entry): entry is { text: string; contribution: number } => entry.text !== null)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, MAX_CHIPS)
    .map((entry) => entry.text)
}

// ============================================================================
// Coverage — product-brief.md §8's data-coverage rule: "a recommendation
// resting on a player with little match history must say so, in words."
// Ticket #277 (G4) deletes the positive-case filler ("X — built on real
// Premier League match history.") everywhere on this screen — this module
// now returns a coverage note ONLY when there is a gap to disclose, the
// same "only speak up for the gap" rule src/lib/verdict/derive.ts's
// coverageNote already follows. A player with real history gets `null`,
// not a sentence that says nothing.
// ============================================================================

function coverageGapNote(name: string, hasHistory: boolean): string | null {
  if (hasHistory) return null
  return `${name} has little Premier League history yet — this rests on an early estimate, not a season of form.`
}

// ============================================================================
// Confidence — product-brief.md §8's three-band rule (clear / marginal /
// coin-flip, never raw decimals in the primary view) surfaced as one plain
// badge label per ticket #277's own wording, so "coin-flip" (repeated
// 2-3x per card before this ticket, per docs/ui-audit-2026-09-25.md G5)
// never appears in the rendered UI at all.
// ============================================================================

export function confidenceBadgeLabel(band: ConfidenceBand): string {
  if (band === 'coin-flip') return 'Close call'
  if (band === 'marginal') return 'Leaning'
  return 'Clear'
}

// ============================================================================
// Captain confidence band — thresholds unchanged since #79 ("because":
// product-brief.md §8 says gaps routinely under one point are inside the
// model's own error). Compares the captain's raw projected points (never
// doubled) against the next-highest STARTER in the same starting XI — not
// the next-highest in the full squad.
// ============================================================================

export type CaptainConfidenceBand = ConfidenceBand

/** gap < 0.5 -> coin-flip; 0.5 to 1.5 inclusive -> marginal; > 1.5 -> clear. */
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
    return `The captaincy is too close to call — ${captainName} and ${nextBestName} are almost level.`
  }
  if (band === 'marginal') {
    return `${captainName} is a marginal pick for captain over ${nextBestName}.`
  }
  return `${captainName} is a clear pick for captain over ${nextBestName}.`
}

// ============================================================================
// Hero (ticket #277, build item 1) — the plan in one line, plus one
// confidence badge and at most one short plain sentence. Replaces the old
// summary card (a heading that repeated the first bullet, per
// docs/ui-audit-2026-09-25.md R1) entirely.
// ============================================================================

interface HeroSource {
  isRoll: boolean
  transferInPlayerId: number | null
  transferOutPlayerId: number | null
  captainPlayerId: number
  playerNames: ReadonlyMap<number, string>
}

/** "Rogers in · Wirtz out · Captain Haaland", or "Roll your transfer ·
 *  Captain Haaland" for a roll plan. Exported for `derive.test.ts`. */
export function heroLine(data: HeroSource): string {
  const captainName = nameFor(data.captainPlayerId, data.playerNames)
  if (data.isRoll) {
    return `Roll your transfer · Captain ${captainName}`
  }
  if (data.transferInPlayerId !== null && data.transferOutPlayerId !== null) {
    const inName = nameFor(data.transferInPlayerId, data.playerNames)
    const outName = nameFor(data.transferOutPlayerId, data.playerNames)
    return `${inName} in · ${outName} out · Captain ${captainName}`
  }
  // Defensive — a non-roll plan should always carry both ids; this branch
  // exists only so the hero never renders a dangling or half-built string.
  return `Captain ${captainName}`
}

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
  coverage: readonly CoverageEntry[],
  role: string,
  playerId: number
): boolean {
  // Default true (no coverage gap) when nothing was stored for this
  // role/player — coverage rows only exist for players actually checked at
  // generation time. A missing entry is not evidence of a gap; only an
  // explicit `hasHistory: false` row is.
  const entry = coverage.find((c) => c.role === role && c.playerId === playerId)
  return entry?.hasHistory ?? true
}

/** The first named player (in ROLE_ORDER) with a stored coverage gap, or
 *  `null` when every named player has real history. Feeds the hero
 *  sentence — product-brief.md §8 requires this screen to state a coverage
 *  gap in words, and the hero is where a 10-second read finds it. */
function firstCoverageGap(data: ReasoningRecommendationData): string | null {
  for (const entry of ROLE_ORDER) {
    const playerId = entry.idOf(data)
    if (playerId === null) continue
    if (!findCoverage(data.coverage, entry.role, playerId)) {
      return nameFor(playerId, data.playerNames)
    }
  }
  return null
}

/** At most one short, plain sentence under the hero badge: a data-coverage
 *  disclosure takes priority (product-brief.md §8 — this is the one
 *  binding requirement), then a plain-language note for a coin-flip plan
 *  naming the alternative. `null` for a clear or marginal plan with full
 *  data coverage — the badge alone says enough. */
function heroSentence(data: ReasoningRecommendationData): string | null {
  const gapName = firstCoverageGap(data)
  if (gapName !== null) {
    return `${gapName} has little match history, so this rests on an early estimate.`
  }

  if (data.confidenceBand === 'coin-flip') {
    const firstAlternative = data.alternatives[0]
    if (firstAlternative) {
      const altText = firstAlternative.isRoll
        ? 'rolling the transfer instead'
        : `${nameFor(firstAlternative.transferInPlayerId as number, data.playerNames)} instead of ${nameFor(
            data.transferInPlayerId as number,
            data.playerNames
          )}`
      return `${altText.charAt(0).toUpperCase()}${altText.slice(1)} would be almost as good.`
    }
  }

  return null
}

// ============================================================================
// Headline figure (ticket #277, build item 2) — replaces the bare, no-
// context "Projected across 5 gameweeks 362" (docs/ui-audit-2026-09-25.md
// R2) with the starting XI's own total for the SINGLE gameweek this
// recommendation targets (captain's contribution doubled, matching how FPL
// itself scores captaincy), which the screen already reads for the captain
// confidence gap above. A same-gameweek "vs roll" comparison is
// deliberately NOT shown: the only stored alternative figures
// (`recommendations.net_points_rounded`) are horizon totals, not
// single-gameweek ones, and mixing the two would manufacture a comparison
// this data cannot actually support — see the ticket's own "if the
// comparison isn't available, show only the gameweek figure."
// ============================================================================

function gameweekPoints(startingXI: readonly StartingXIPick[] | null): number | null {
  if (!startingXI || startingXI.length === 0) return null
  const total = startingXI.reduce((sum, pick) => sum + pick.expectedPoints * (pick.isCaptain ? 2 : 1), 0)
  return Math.round(total)
}

/** "Expected this gameweek" under the figure, or a plain unavailable
 *  caption when there's no starting XI to sum — never a bare number with
 *  nothing to say what it is (docs/ui-audit-2026-09-25.md R2). */
function headlineCaption(points: number | null): string {
  return points !== null ? 'Expected this gameweek' : 'No figure available for this gameweek'
}

// ============================================================================
// Per-player figure and breakdown — "5.6 pts next gameweek" (build item 3).
// Prefers the `gbm-v1` prediction when one resolved for this player (the
// model actually deciding the pick); falls back to the sum of the
// baseline-v1 components otherwise. Raw decimals are permitted here per
// product-brief.md §8's own carve-out for this screen.
// ============================================================================

function playerHeadlinePoints(projection: PlayerProjectionData | null): number | null {
  if (!projection) return null
  if (projection.learned) return projection.learned.expectedPoints
  return sumPoints(projection.points)
}

// ============================================================================
// Other options (ticket #277, build item 6; was "Alternatives considered",
// ticket #102) — collapsed to one line per plan: "Schade instead of Rogers
// · same points". The full detail (confidence, hit, per-player coverage)
// sits behind a disclosure the screen renders closed by default; this
// module only supplies the data, not the open/closed state (native
// <details>, same pattern as DecisionHistoryScreen.tsx).
// ============================================================================

interface PlanDecisionShape {
  isRoll: boolean
  transferInPlayerId: number | null
  captainPlayerId: number
}

/** The horizon points gap between an alternative and Plan A — net points
 *  (post-hit), computed purely from the already-stored net_points_rounded
 *  on each plan's own recommendations row. Positive means the alternative
 *  projects HIGHER than Plan A over the horizon. Exported for
 *  derive.test.ts. */
export function planPointsGap(planANet: number, alternativeNet: number): number {
  return alternativeNet - planANet
}

/** "same points" / "1 pt less" / "2 pts more" — the ticket's own exact
 *  examples for 0 and a negative gap. Exported for derive.test.ts. */
export function otherOptionGapText(gap: number): string {
  if (gap === 0) return 'same points'
  const magnitude = Math.abs(gap)
  const unit = magnitude === 1 ? 'pt' : 'pts'
  return gap > 0 ? `${magnitude} ${unit} more` : `${magnitude} ${unit} less`
}

/** "Schade instead of Rogers", "Saliba as captain instead of Salah", or
 *  both joined with "and" — no verbs ("transfers in"/"captains"), so it
 *  reads as a compact noun phrase rather than a repeat of the full
 *  sentence Plan A's own hero line already gave. */
function otherOptionNounFragment(
  planA: PlanDecisionShape,
  alternative: PlanDecisionShape,
  names: ReadonlyMap<number, string>
): string {
  const parts: string[] = []

  if (planA.isRoll && !alternative.isRoll) {
    parts.push(`${nameFor(alternative.transferInPlayerId as number, names)} instead of rolling`)
  } else if (!planA.isRoll && alternative.isRoll) {
    parts.push('Roll the transfer instead')
  } else if (
    !planA.isRoll &&
    !alternative.isRoll &&
    planA.transferInPlayerId !== alternative.transferInPlayerId
  ) {
    parts.push(
      `${nameFor(alternative.transferInPlayerId as number, names)} instead of ${nameFor(
        planA.transferInPlayerId as number,
        names
      )}`
    )
  }

  if (planA.captainPlayerId !== alternative.captainPlayerId) {
    parts.push(
      `${nameFor(alternative.captainPlayerId, names)} as captain instead of ${nameFor(planA.captainPlayerId, names)}`
    )
  }

  if (parts.length === 0) return 'Same transfer and captain'
  const sentence = parts.join(' and ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** "Schade instead of Rogers · same points" — one line, ready to render.
 *  Exported for derive.test.ts. */
export function otherOptionLine(
  planA: PlanDecisionShape & { netPointsRounded: number },
  alternative: PlanDecisionShape & { netPointsRounded: number },
  names: ReadonlyMap<number, string>
): string {
  const gap = planPointsGap(planA.netPointsRounded, alternative.netPointsRounded)
  return `${otherOptionNounFragment(planA, alternative, names)} · ${otherOptionGapText(gap)}`
}

export interface ReasoningAlternativePlayerView {
  role: string
  name: string
  coverageNote: string | null
}

export interface ReasoningHitView {
  cost: number
  gross: number
  net: number
}

export interface ReasoningOtherOptionView {
  /** 'Plan B' for plan_index 1, 'Plan C' for plan_index 2. */
  label: string
  /** "Schade instead of Rogers · same points" — the collapsed, always-
   *  visible line. */
  summaryLine: string
  confidenceLabel: string
  hit: ReasoningHitView | null
  /** Behind the per-plan disclosure — transfer in/out and captain, with a
   *  coverage note only for a player with a data gap (never the "built on
   *  real match history" filler). */
  players: readonly ReasoningAlternativePlayerView[]
}

const PLAN_LABELS: Readonly<Record<number, string>> = { 1: 'Plan B', 2: 'Plan C' }

function alternativePlayerCoverage(
  role: string,
  storageRole: string,
  playerId: number,
  coverage: readonly CoverageEntry[],
  names: ReadonlyMap<number, string>
): ReasoningAlternativePlayerView {
  const name = nameFor(playerId, names)
  const hasHistory = findCoverage(coverage, storageRole, playerId)
  return { role, name, coverageNote: coverageGapNote(name, hasHistory) }
}

function deriveOtherOptionView(
  planA: ReasoningRecommendationData,
  alternative: AlternativePlanData
): ReasoningOtherOptionView {
  const players: ReasoningAlternativePlayerView[] = []
  if (!alternative.isRoll && alternative.transferInPlayerId !== null) {
    players.push(
      alternativePlayerCoverage(
        'Transfer in',
        'transferIn',
        alternative.transferInPlayerId,
        alternative.coverage,
        planA.playerNames
      )
    )
  }
  if (!alternative.isRoll && alternative.transferOutPlayerId !== null) {
    players.push(
      alternativePlayerCoverage(
        'Transfer out',
        'transferOut',
        alternative.transferOutPlayerId,
        alternative.coverage,
        planA.playerNames
      )
    )
  }
  players.push(
    alternativePlayerCoverage('Captain', 'captain', alternative.captainPlayerId, alternative.coverage, planA.playerNames)
  )

  return {
    label: PLAN_LABELS[alternative.planIndex] ?? `Plan ${alternative.planIndex + 1}`,
    summaryLine: otherOptionLine(planA, alternative, planA.playerNames),
    confidenceLabel: confidenceBadgeLabel(alternative.confidenceBand),
    hit:
      alternative.hitCost > 0
        ? { cost: alternative.hitCost, gross: alternative.grossPointsRounded, net: alternative.netPointsRounded }
        : null,
    players,
  }
}

/** design-reference.md's writing rules: an empty state is an invitation or
 *  a confident answer, never an apology. Collapsing to one distinct plan
 *  IS the confident case ("the week where the recommendation is 'roll your
 *  transfer' is not an empty state"). */
const NO_OTHER_OPTIONS_NOTE = 'This is a confident call — no distinct alternative plan was found for this gameweek.'

// ============================================================================
// View types
// ============================================================================

export interface ReasoningPlayerView {
  role: string
  name: string
  /** This player's own figure for the SINGLE gameweek this recommendation
   *  targets — `gbm-v1`'s prediction when one resolved, else the sum of
   *  the baseline-v1 components. `null` when nothing resolved at all. Raw
   *  decimal, per product-brief.md §8's carve-out for this screen; the
   *  screen renders it through the `.num` (tabular mono) class, never the
   *  surrounding "pts next gameweek" text (G3 — mono is for figures only,
   *  never for a whole sentence). */
  points: number | null
  hasProjection: boolean
  /** Up to 3 plain-language reason chips (see `reasonChip`). `[]` for a
   *  player with no `gbm-v1` row yet — a normal state, not a shortfall. */
  chips: readonly string[]
  /** Only set when this player has a stored data-coverage gap
   *  (product-brief.md §8) — `null` otherwise, never the deleted "built on
   *  real match history" filler line (ticket #277, G4). */
  coverageNote: string | null
  /** Behind this player's own "See the numbers" disclosure. */
  components: readonly ReasoningComponentRow[]
}

export type ReasoningViewStatus = 'empty' | 'ready'

export interface ReasoningView {
  status: ReasoningViewStatus
  /** Set only when status is 'empty' — a specific sentence naming what's
   *  missing and what to do, never a generic error or an indefinite
   *  spinner. */
  emptyMessage: string | null
  gameweekName: string | null
  /** "Rogers in · Wirtz out · Captain Haaland" — the whole plan in one
   *  line. */
  heroLine: string | null
  confidenceBand: ConfidenceBand | null
  /** "Clear" / "Leaning" / "Close call" — see `confidenceBadgeLabel`. */
  confidenceLabel: string | null
  /** At most one short, plain sentence under the hero badge — a
   *  data-coverage disclosure takes priority; `null` when there's nothing
   *  that needs saying beyond the badge. */
  heroSentence: string | null
  /** The single-gameweek total for the starting XI this recommendation
   *  targets (captain's points doubled), rounded to a whole number — `null`
   *  when there's no starting XI to sum. Render large, with
   *  `headlineCaption` as the small label under it (design-reference.md's
   *  Revolut reference: one large tabular number, a small quiet label). */
  headlineValue: number | null
  headlineCaption: string
  hit: ReasoningHitView | null
  captainBand: CaptainConfidenceBand | null
  /** "Captain confidence: Close call" — reuses `confidenceBadgeLabel` so
   *  the raw band word never repeats verbatim (docs/ui-audit-2026-09-25.md
   *  G5). `null` when there is no starting XI to compare against. */
  captainLabel: string | null
  captainNote: string | null
  players: readonly ReasoningPlayerView[]
  /** Every OTHER stored plan for this gameweek, collapsed to one line each
   *  — `[]` when Plan A is the only distinct plan left standing; see
   *  `otherOptionsEmptyNote` for that case's wording. */
  otherOptions: readonly ReasoningOtherOptionView[]
  otherOptionsEmptyNote: string | null
  /** "Updated Fri 25 Sep, 11:41" — the recommendation's OWN solve time
   *  (`recommendations.updated_at` for Plan A), never a projection row's
   *  `computed_at` (ticket #277's footer bug fix) and never a model name. */
  updatedAtLabel: string | null
}

const EMPTY_MESSAGE =
  'No recommendation to explain yet — run scripts/generate-recommendations.ts to produce this ' +
  "gameweek's plan, then reload this page."

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
      heroLine: null,
      confidenceBand: null,
      confidenceLabel: null,
      heroSentence: null,
      headlineValue: null,
      headlineCaption: headlineCaption(null),
      hit: null,
      captainBand: null,
      captainLabel: null,
      captainNote: null,
      players: [],
      otherOptions: [],
      otherOptionsEmptyNote: null,
      updatedAtLabel: null,
    }
  }

  const players: ReasoningPlayerView[] = ROLE_ORDER.filter((entry) => entry.idOf(data) !== null).map(
    (entry) => {
      const playerId = entry.idOf(data) as number
      const name = nameFor(playerId, data.playerNames)
      const hasHistory = findCoverage(data.coverage, entry.role, playerId)
      const projection = projectionFor(data.projections, playerId)
      return {
        role: entry.label,
        name,
        points: playerHeadlinePoints(projection),
        components: projection ? pointsToRows(projection.points) : [],
        hasProjection: projection !== null,
        chips: projection?.learned ? topReasonChips(projection.learned.drivers) : [],
        coverageNote: coverageGapNote(name, hasHistory),
      }
    }
  )

  const hit =
    data.hitCost > 0
      ? { cost: data.hitCost, gross: data.grossPointsRounded, net: data.netPointsRounded }
      : null

  let captainBand: CaptainConfidenceBand | null = null
  let captainLabel: string | null = null
  let captainNoteText: string | null = null
  if (data.startingXI) {
    const found = findCaptainGap(data.startingXI)
    if (found) {
      captainBand = deriveCaptainConfidenceBand(found.gap)
      captainLabel = `Captain confidence: ${confidenceBadgeLabel(captainBand)}`
      const captainName = nameFor(found.captainId, data.playerNames)
      const nextBestName = nameFor(found.nextBestId, data.playerNames)
      captainNoteText = captainNote(captainBand, captainName, nextBestName)
    }
  }

  const otherOptions = data.alternatives.map((alternative) => deriveOtherOptionView(data, alternative))

  return {
    status: 'ready',
    emptyMessage: null,
    gameweekName: data.gameweekName,
    heroLine: heroLine(data),
    confidenceBand: data.confidenceBand,
    confidenceLabel: confidenceBadgeLabel(data.confidenceBand),
    heroSentence: heroSentence(data),
    headlineValue: gameweekPoints(data.startingXI),
    headlineCaption: headlineCaption(gameweekPoints(data.startingXI)),
    hit,
    captainBand,
    captainLabel,
    captainNote: captainNoteText,
    players,
    otherOptions,
    otherOptionsEmptyNote: otherOptions.length === 0 ? NO_OTHER_OPTIONS_NOTE : null,
    updatedAtLabel: formatSyncTimestamp(data.updatedAt),
  }
}
