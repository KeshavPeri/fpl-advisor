/**
 * The combiner — one player, one fixture in, expected points and the
 * individual point components out. Wires together all five v1 projection
 * inputs from product-brief.md §6d:
 *   1. minutes probability      — `minutes.ts`
 *   2. xG and xA rates          — `rates.ts`
 *   3. fixture difficulty (elo) — `fixture.ts`
 *   4. clean-sheet probability  — derived here from (3)
 *   5. defensive-contribution hit rate — `defconRate.ts` (#28), not reimplemented
 *
 * Pure computation only: no I/O, no database, no fetch.
 *
 * The per-fixture point total is produced by `totalMatchPoints` from
 * `src/lib/scoring/` — every component this ticket does not model
 * (penalties, cards, own goals, bonus) is passed as 0. No hand-rolled sum.
 */
import type { Position } from '../scoring/types.ts'
import type { MatchPointComponents } from '../scoring/totalMatchPoints.ts'
import { totalMatchPoints } from '../scoring/totalMatchPoints.ts'
import { estimateDefconHitRate, expectedDefensiveContributionPoints } from './defconRate.ts'
import type { DefensiveContributionMatch } from './types.ts'
import { availabilityFactor, estimateMinutes } from './minutes.ts'
import { computePlayerRates, type PlayerRateHistory, type PlayerRates } from './rates.ts'
import { attackingMultiplier, expectedGoalsConceded, expectedScore, expectedScoreFromDifficulty } from './fixture.ts'
import {
  ASSIST_POINTS,
  GOALS_CONCEDED_DIVISOR,
  GOALS_CONCEDED_POINTS_PER_UNIT,
  SAVES_DIVISOR,
  SAVE_POINTS_PER_UNIT,
  cleanSheetPoints,
  expectedAppearancePoints,
  goalPoints,
  goalsConcededPointsApply,
  savePointsApply,
} from './pointValues.ts'

// ============================================================================
// Poisson expectation of a step function of a Poisson-distributed count.
// Goals conceded and saves both score in whole "units" (1 point lost per 2
// goals conceded, 1 point earned per 3 saves) — a step function of the
// count, not the count itself. The expectation of a step function is NOT
// the step function of the expectation (E[floor(X/n)] != floor(E[X]/n)), so
// this sums the true Poisson expectation over a truncated range instead of
// using a linear -lambda/2 (or /3) approximation. See ticket #33 Notes for
// why: summing k = 0..N is about six lines and is exactly right.
// ============================================================================

function poissonPmf(k: number, lambda: number): number {
  let factorial = 1
  for (let i = 2; i <= k; i++) factorial *= i
  return Math.exp(-lambda) * lambda ** k / factorial
}

/** Truncation point for the goals-conceded Poisson sum — 11 goals conceded in one match is effectively impossible; the tail beyond this is negligible. */
const GOALS_CONCEDED_SUM_LIMIT = 10
/** Truncation point for the saves Poisson sum — matches the ticket's stated k = 0..15. */
const SAVES_SUM_LIMIT = 15

/**
 * Expected goals-conceded points: the true Poisson expectation of
 * `GOALS_CONCEDED_POINTS_PER_UNIT × floor(GC / GOALS_CONCEDED_DIVISOR)`,
 * summed over `k = 0..10`. Zero for midfielders and forwards.
 */
export function expectedGoalsConcededPoints(lambdaConceded: number, position: Position): number {
  if (!goalsConcededPointsApply(position)) return 0

  let expectedUnits = 0
  for (let k = 0; k <= GOALS_CONCEDED_SUM_LIMIT; k++) {
    expectedUnits += poissonPmf(k, lambdaConceded) * Math.floor(k / GOALS_CONCEDED_DIVISOR)
  }
  return expectedUnits * GOALS_CONCEDED_POINTS_PER_UNIT
}

/**
 * Expected goalkeeper save points: the true Poisson expectation of
 * `SAVE_POINTS_PER_UNIT × floor(saves / SAVES_DIVISOR)`, summed over
 * `k = 0..15`. Zero for every outfield position.
 */
export function expectedSavePoints(expectedSaves: number, position: Position): number {
  if (!savePointsApply(position)) return 0

  let expectedUnits = 0
  for (let k = 0; k <= SAVES_SUM_LIMIT; k++) {
    expectedUnits += poissonPmf(k, expectedSaves) * Math.floor(k / SAVES_DIVISOR)
  }
  return expectedUnits * SAVE_POINTS_PER_UNIT
}

/**
 * Clean-sheet probability: the Poisson probability of conceding exactly
 * zero, `exp(-lambdaConceded)`.
 */
export function cleanSheetProbability(lambdaConceded: number): number {
  return Math.exp(-lambdaConceded)
}

// ============================================================================
// Player + fixture inputs
// ============================================================================

export interface PlayerProjectionInput {
  position: Position
  status: string
  chanceOfPlayingNextRound: number | null
  /** Last five match rows' minutes played, all of them, most-recent-first or any order — see minutes.ts. Empty array is the stated no-history case. */
  recentMinutes: readonly number[]
  /** Aggregated totals across the player's own full available match history. */
  rateHistory: PlayerRateHistory
  /** This player's position prior, from `positionPriorRates` over that position's league-wide match history. */
  ratePositionPrior: PlayerRates
  /** This player's own qualifying match history for the defcon estimator (ticket #28) — the full available history, not just the last five. */
  defconMatches: readonly DefensiveContributionMatch[]
  /** This player's position prior hit rate, from `positionPriorHitRate`. */
  defconPositionPrior: number
}

export interface FixtureContext {
  fixtureId: number
  isHome: boolean
  /** Null when ClubElo has no rating for this team — see fixture.ts's documented FDR fallback. */
  teamElo: number | null
  /** The opponent's elo in this fixture. Null triggers the same FDR fallback as a null teamElo. */
  opponentElo: number | null
  /** FPL's own 1-5 FDR for this team in this fixture (team_h_difficulty or team_a_difficulty, whichever applies), used only when either elo above is null. */
  fplDifficulty: number
  /** Resolved league-wide average goals per team per match — see fixture.ts's LEAGUE_BASELINE_GOALS_PER_TEAM and scripts/project-points.ts's runtime computation. */
  leagueBaselineGoals: number
}

export interface FixtureProjectionComponents {
  appearancePoints: number
  goalPoints: number
  assistPoints: number
  cleanSheetPoints: number
  goalsConcededPoints: number
  savePoints: number
  defensiveContributionPoints: number
  bonusPoints: number
}

/**
 * Expected event counts for one player-fixture, surfaced so a second pass
 * (bonus allocation — ticket #78, `bonus.ts`) can consume them without
 * recomputing anything. `projectPlayerFixture` already computes every one
 * of these internally to build `components` above; this field just stops
 * them being thrown away. Bonus needs every player projected for the SAME
 * fixture at once, which is a different shape of input than a single
 * player-fixture projection has, so bonus itself is never computed here —
 * see `components.bonusPoints` staying `0` below.
 */
export interface FixtureExpectedEvents {
  expectedGoals: number
  expectedAssists: number
  expectedSaves: number
  /** Clearances + blocks + interceptions expected this fixture — NOT tackles, same definition as `src/lib/scoring/bps.ts`. */
  expectedCbi: number
  expectedRecoveries: number
  pCleanSheet: number
  pAppears: number
  pSixtyPlus: number
}

export interface FixtureModelInputs {
  fixtureId: number
  pAppears: number
  pSixtyPlus: number
  xgPer90: number
  xaPer90: number
  savesPer90: number
  defconHitRate: number
  expectedScore: number
  expectedGoalsConceded: number
  pCleanSheet: number
  /** True when this fixture's expectedScore came from the FPL-FDR fallback in fixture.ts because a team's elo was null. Counted in job_runs.details by the job. */
  eloFallbackUsed: boolean
}

export interface FixtureProjection {
  fixtureId: number
  expectedPoints: number
  expectedMinutes: number
  components: FixtureProjectionComponents
  modelInputs: FixtureModelInputs
  expectedEvents: FixtureExpectedEvents
}

/**
 * Projects one player's expected points for one fixture. Every component
 * this ticket does not model (penalties, cards, own goals, bonus) is passed
 * to `totalMatchPoints` as 0 — see product-brief.md §6d and this ticket's
 * "explicitly out of scope" list.
 */
export function projectPlayerFixture(player: PlayerProjectionInput, fixture: FixtureContext): FixtureProjection {
  const availability = availabilityFactor(player.status, player.chanceOfPlayingNextRound)
  const minutesEstimate = estimateMinutes(player.recentMinutes, availability)
  // Fraction of a full 90 minutes this player is expected to be exposed to
  // this fixture's attacking/defensive events. Reuses expectedMinutes
  // (already scaled by availability and recent involvement) rather than
  // introducing a second, separate exposure figure.
  const minutesFraction = minutesEstimate.expectedMinutes / 90

  const playerRates = computePlayerRates(player.rateHistory, player.ratePositionPrior)
  const defconHitRate = estimateDefconHitRate(player.position, player.defconMatches, player.defconPositionPrior)

  const eloFallbackUsed = fixture.teamElo === null || fixture.opponentElo === null
  const expectedScoreValue = eloFallbackUsed
    ? expectedScoreFromDifficulty(fixture.fplDifficulty)
    : expectedScore(fixture.teamElo as number, fixture.opponentElo as number, fixture.isHome)

  const attackMultiplier = attackingMultiplier(expectedScoreValue)
  const teamLambdaConceded = expectedGoalsConceded(fixture.leagueBaselineGoals, expectedScoreValue)

  const expectedGoals = playerRates.xgPer90 * minutesFraction * attackMultiplier
  const expectedAssists = playerRates.xaPer90 * minutesFraction * attackMultiplier
  const expectedSaves = playerRates.savesPer90 * minutesFraction
  // CBI and recoveries are defensive-action counts, not attacking output --
  // scaled by minutes exposure only, same as expectedSaves above, with no
  // fixture attacking multiplier applied (matching defconRate.ts, which
  // also does not fixture-adjust its hit-rate estimate). Ticket #78.
  const expectedCbi = playerRates.cbiPer90 * minutesFraction
  const expectedRecoveries = playerRates.recoveriesPer90 * minutesFraction

  const pCleanSheet = cleanSheetProbability(teamLambdaConceded)
  // Goals-conceded exposure scales continuously with minutes played, unlike
  // the clean-sheet points below — the real FPL rule gates clean sheets on
  // reaching 60 minutes but does not gate the goals-conceded penalty the
  // same way (it accrues from goals conceded while actually on the pitch).
  const playerLambdaConceded = teamLambdaConceded * minutesFraction

  const components: FixtureProjectionComponents = {
    appearancePoints: expectedAppearancePoints(minutesEstimate.pAppears, minutesEstimate.pSixtyPlus),
    goalPoints: expectedGoals * goalPoints(player.position),
    assistPoints: expectedAssists * ASSIST_POINTS,
    cleanSheetPoints: pCleanSheet * minutesEstimate.pSixtyPlus * cleanSheetPoints(player.position),
    goalsConcededPoints: expectedGoalsConcededPoints(playerLambdaConceded, player.position),
    savePoints: expectedSavePoints(expectedSaves, player.position),
    defensiveContributionPoints: expectedDefensiveContributionPoints(defconHitRate) * minutesEstimate.pSixtyPlus,
    bonusPoints: 0,
  }

  const fullComponents: MatchPointComponents = {
    ...components,
    penaltySavePoints: 0,
    penaltyMissPoints: 0,
    yellowCardPoints: 0,
    redCardPoints: 0,
    ownGoalPoints: 0,
  }

  return {
    fixtureId: fixture.fixtureId,
    expectedPoints: totalMatchPoints(fullComponents),
    expectedMinutes: minutesEstimate.expectedMinutes,
    components,
    modelInputs: {
      fixtureId: fixture.fixtureId,
      pAppears: minutesEstimate.pAppears,
      pSixtyPlus: minutesEstimate.pSixtyPlus,
      xgPer90: playerRates.xgPer90,
      xaPer90: playerRates.xaPer90,
      savesPer90: playerRates.savesPer90,
      defconHitRate,
      expectedScore: expectedScoreValue,
      expectedGoalsConceded: teamLambdaConceded,
      pCleanSheet,
      eloFallbackUsed,
    },
    expectedEvents: {
      expectedGoals,
      expectedAssists,
      expectedSaves,
      expectedCbi,
      expectedRecoveries,
      pCleanSheet,
      pAppears: minutesEstimate.pAppears,
      pSixtyPlus: minutesEstimate.pSixtyPlus,
    },
  }
}

// ============================================================================
// Gameweek total — sums a player's fixture projections. A player whose team
// has two fixtures in one gameweek is the sum of both (expected points AND
// expected minutes); a player with no fixture is 0/0, never an error.
// ============================================================================

export interface GameweekProjection {
  expectedPoints: number
  expectedMinutes: number
  fixtures: FixtureProjection[]
}

export function projectPlayerGameweek(
  player: PlayerProjectionInput,
  fixtures: readonly FixtureContext[],
): GameweekProjection {
  const fixtureProjections = fixtures.map((fixture) => projectPlayerFixture(player, fixture))
  return {
    expectedPoints: fixtureProjections.reduce((sum, f) => sum + f.expectedPoints, 0),
    expectedMinutes: fixtureProjections.reduce((sum, f) => sum + f.expectedMinutes, 0),
    fixtures: fixtureProjections,
  }
}
