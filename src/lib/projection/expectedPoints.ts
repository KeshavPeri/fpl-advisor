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
import {
  attackingMultiplier,
  defensiveMultiplier,
  expectedGoalsConceded,
  expectedScore,
  expectedScoreFromDifficulty,
} from './fixture.ts'
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
// Assist conversion — ticket #148.
//
// MECHANISM (verified, not assumed). `expectedAssists = xaPer90 x
// minutesFraction x attackMultiplier` measures the QUALITY of chances a
// player creates (xA), not whether the recipient actually scored. FPL's
// assist rule credits some events xA does not model at all -- a penalty won
// (and converted by someone else), an own goal forced, and (in some
// seasons) a second assist. Goals are calibrated near-perfectly on two
// independent instruments that use this SAME attackMultiplier and minutes
// model (backtest: -0.006 signed error; calibration report: 1.02x-1.03x
// proj/actual) -- which rules out both as the cause and localises the gap
// to this xA-to-assist conversion step specifically. No other component in
// this file is touched by this section.
//
// MEASUREMENT (28 Aug 2026, ticket #148): actual assists / sum(xA), by
// position, computed directly from FPL-Core-Insights' published per-gameweek
// player-match CSVs -- the same source scripts/ingest-core-insights.ts reads
// into player_match_stats -- for season 2025-2026, Premier League matches
// only (competition = 'prem' after stripping the season prefix, the same
// rule scripts/lib/competition.ts's PREMIER_LEAGUE_COMPETITION applies to
// player_match_stats.match_id). Position resolved via that season's own
// players.csv (player_id -> position), fetched from the same source, since
// FPL element ids are not stable across a season boundary (see the
// player_match_stats migration's own header) and this repo does not hold a
// locally queryable 2025-2026 players table to join against.
//
//   Position   | actual assists | sum(xA)    | ratio (actual/xA) | sample
//   Goalkeeper |             5  |   2.170866 |  2.303228          | n=1026 player-matches, 56 players (THIN -- 5 events total; see clamp below)
//   Defender   |           237  | 182.908110 |  1.295733          | n=4450 player-matches, 189 players
//   Midfielder |           593  | 444.415323 |  1.334337          | n=5763 player-matches, 254 players
//   Forward    |           107  |  50.556239 |  2.116455          | n=1515 player-matches, 66 players
//
// This is a per-position table, not one flat factor, because the gap is not
// flat: forwards measure at roughly double defenders/midfielders here, and
// the ticket's two other, independently-built instruments (a point-in-time
// backtest and a separately-computed calibration report, built from
// different data on a different basis) corroborate the same direction and
// roughly the same relative size (defender 0.74x, midfielder 0.78x, forward
// 0.43x proj/actual -- inverting to roughly 1.35x/1.28x/2.33x actual/proj,
// in the same range as the ratios measured directly above). A single factor
// fitted across all four would over-correct defenders/midfielders and
// under-correct forwards -- exactly the comparison a captaincy decision
// turns on. Had the four positions instead measured close together, a
// single flat factor would have been the right, simpler call; they did not.
// ============================================================================

/**
 * Clamp range for the assist conversion factors below. A calibration
 * constant derived from one season on one data source is a reasonable
 * correction and a poor law -- a future re-measurement on a thinner sample
 * (an early-season slice, or a position with few events, exactly like the
 * goalkeeper row above) must not be able to swing `expectedAssists` by an
 * arbitrary amount. The clamp is applied at the point of use (see
 * `assistConversionFactor` below), not baked into the constants themselves,
 * so it protects a future edit to those constants too, not only today's
 * values.
 *
 * MIN = 1.0: the mechanism this factor corrects for (missing credit for
 * penalties won, own goals forced, and second assists) only ever ADDS
 * assists beyond what xA predicts -- a strictly upward correction. A
 * measured factor below 1.0 would claim the opposite (xA overcounts
 * assists), contradicting both the documented mechanism and the goals
 * comparison above (goals need no downward correction either -- effectively
 * 1.0x on both instruments). Below 1.0 is treated as measurement noise, not
 * a real effect, and floored at 1.0.
 *
 * MAX = 2.5: comfortably above the largest well-supported measured ratio
 * above (forward, 2.12x, n=107 assists) without permitting an unbounded
 * multiplier from a thin future sample -- the goalkeeper row above (2.30x
 * from just 5 assists league-wide) is exactly the kind of thin sample this
 * bound exists to contain; it happens to land under 2.5 this season, but a
 * different season's small handful of goalkeeper assists easily might not.
 */
export const ASSIST_CONVERSION_MIN = 1.0
export const ASSIST_CONVERSION_MAX = 2.5

/** Measured actual/xA ratio, goalkeepers, rounded to two decimals. Raw measurement: 5 / 2.170866 = 2.303228 (n=1026 player-matches, 56 players) -- see the section header above. Thin sample; the clamp above is this constant's real protection. */
export const ASSIST_CONVERSION_GOALKEEPER = 2.3
/** Measured actual/xA ratio, defenders, rounded to two decimals. Raw measurement: 237 / 182.908110 = 1.295733 (n=4450 player-matches, 189 players) -- see the section header above. */
export const ASSIST_CONVERSION_DEFENDER = 1.3
/** Measured actual/xA ratio, midfielders, rounded to two decimals. Raw measurement: 593 / 444.415323 = 1.334337 (n=5763 player-matches, 254 players) -- see the section header above. */
export const ASSIST_CONVERSION_MIDFIELDER = 1.33
/** Measured actual/xA ratio, forwards, rounded to two decimals. Raw measurement: 107 / 50.556239 = 2.116455 (n=1515 player-matches, 66 players) -- see the section header above. */
export const ASSIST_CONVERSION_FORWARD = 2.12

/** Clamps a raw assist conversion factor into [ASSIST_CONVERSION_MIN, ASSIST_CONVERSION_MAX]. See the clamp comment above for why this exists and why the bounds sit where they do. */
export function clampAssistConversionFactor(factor: number): number {
  return Math.min(ASSIST_CONVERSION_MAX, Math.max(ASSIST_CONVERSION_MIN, factor))
}

/**
 * This position's assist conversion factor, clamped. A `switch` with one
 * explicit, named case per position -- goalkeeper gets its own named case
 * and its own measured constant, exactly like every outfield position,
 * rather than silently inheriting a shared fallback. The only `default:` is
 * `assertNeverPosition` below, which every valid `Position` value is
 * guaranteed by the four cases above never to reach -- it exists so an
 * invalid position code fails loudly instead of one of the four real cases
 * quietly acting as an unlabelled default for it.
 *
 * Cased on the plain position codes (1 GK, 2 DEF, 3 MID, 4 FWD) rather than
 * the imported GOALKEEPER/DEFENDER/... constants: those are typed as the
 * widened `Position` union in scoring/types.ts, not as literal types (see
 * pointValues.ts's own comment on the same point), so TypeScript cannot
 * narrow `position` down to `never` after them the way it can after the
 * literals.
 */
export function assistConversionFactor(position: Position): number {
  switch (position) {
    case 1: // goalkeeper
      return clampAssistConversionFactor(ASSIST_CONVERSION_GOALKEEPER)
    case 2: // defender
      return clampAssistConversionFactor(ASSIST_CONVERSION_DEFENDER)
    case 3: // midfielder
      return clampAssistConversionFactor(ASSIST_CONVERSION_MIDFIELDER)
    case 4: // forward
      return clampAssistConversionFactor(ASSIST_CONVERSION_FORWARD)
    default:
      return assertNeverPosition(position)
  }
}

/** Unreachable at runtime for a valid `Position` -- exists only so TypeScript can verify a position switch is exhaustive without a `default:` case that would silently swallow an unrecognised position code. Shared by `assistConversionFactor` and `goalConversionFactor` below -- both switches are exhaustive over the same four-case `Position` union, so one unreachable-guard suffices for both. */
function assertNeverPosition(position: never): never {
  throw new Error(`unhandled position code ${String(position)}`)
}

// ============================================================================
// Goal conversion -- ticket #162 (reproduces #148's measurement exactly for
// defenders: 137/180.862900 = 0.757480, matching #148's own comment above).
//
// MECHANISM. `expectedGoals = xgPer90 x minutesFraction x attackMultiplier`
// measures the QUALITY/QUANTITY of chances a player gets (xG), not whether
// they actually convert them. Real conversion differs from the population
// average xG models are trained on, and it differs BY POSITION: a
// defender's xG is dominated by set-piece headers and scrambles in crowded
// boxes -- exactly the chance types a population-average finisher (which is
// what an xG model implicitly assumes) converts worse than a striker
// running onto an open chance. Midfielders and forwards convert close to
// 1:1 with their xG; defenders measurably do not. This is the calibration
// report's largest single position-specific error (30 Aug 2026: defender
// goals projected 1.38x actual pts/90), and it is specific to defenders --
// midfielders and forwards both measure within ~2% of 1.0x on the same
// report.
//
// MEASUREMENT (30 Aug 2026, ticket #162): actual goals / sum(xG), by
// position, computed directly from FPL-Core-Insights' published per-gameweek
// player-match CSVs -- the same source and method as #148's assist
// measurement above (season 2025-2026, Premier League matches only,
// position resolved via that season's own players.csv).
//
//   Position   | actual goals | sum(xG)    | ratio (actual/xG) | sample
//   Goalkeeper |            0 |   0.160000 |  undefined        | n=1026 player-matches, 56 players (0 goals -- not a measurement, see below)
//   Defender   |          137 | 180.862900 |  0.757480          | n=4450 player-matches, 189 players
//   Midfielder |          533 | 542.257100 |  0.982929          | n=5763 player-matches, 254 players
//   Forward    |          335 | 343.627900 |  0.974892          | n=1515 player-matches, 66 players
//
// Goalkeepers scored zero goals league-wide on 0.16 sum(xG) -- 0/0.16 is not
// a measurable ratio (any value divided by a near-zero denominator is noise,
// and zero goals from any number of chances says nothing about a
// hypothetical goalkeeper conversion rate). GOAL_CONVERSION_GOALKEEPER below
// is 1.0 explicitly labelled NO-INFORMATION, not measured -- it applies no
// correction at all, rather than pretending 0/0.16 is a real signal.
//
// This is a per-position table, not one flat factor, because the gap is not
// flat: defenders under-convert by ~24%, while midfielders/forwards sit
// within ~2% of 1.0 -- correcting all three by the same amount would
// under-correct defenders and introduce a needless wobble into
// midfielder/forward projections that the data does not support. Had the
// three (four, with goalkeeper's no-information case) measured close
// together, a single flat factor would have been the right, simpler call;
// they did not.
// ============================================================================

/**
 * Clamp range for the goal conversion factors below. A calibration constant
 * derived from one season on one data source is a reasonable correction and
 * a poor law -- a future re-measurement on a thinner sample must not be
 * able to swing `expectedGoals` by an arbitrary amount. The clamp is
 * applied at the point of use (see `goalConversionFactor` below), not baked
 * into the constants themselves, so it protects a future edit to those
 * constants too, not only today's values.
 *
 * MIN = 0.5 and MAX = 1.5 are a judgement call, not a derived bound -- unlike
 * the assist conversion clamp above (whose MIN = 1.0 follows directly from a
 * one-directional mechanism), goal conversion can plausibly run either side
 * of 1.0: a position dominated by low-quality chances (defenders, per the
 * mechanism above) can under-convert, and a position of clinical finishers
 * could genuinely out-convert its xG (the upper bound is NOT fixed at 1.0 --
 * that would assume away a real possibility the data does not rule out).
 * 0.5 sits comfortably below the lowest measured ratio (defender, 0.757)
 * without permitting a thin future sample to collapse a position's goal
 * output near zero; 1.5 sits comfortably above every measured ratio
 * (including the goalkeeper no-information case of 1.0) without permitting
 * an unbounded multiplier from a thin future sample -- the same shape of
 * protection #148's MAX = 2.5 gives the assist factor, scaled to this
 * factor's much narrower measured range.
 */
export const GOAL_CONVERSION_MIN = 0.5
export const GOAL_CONVERSION_MAX = 1.5

/** Goalkeepers scored 0 goals on 0.16 sum(xG) league-wide -- 0/0.16 is not a measurable ratio (see the section header above). NO-INFORMATION, not measured: applies no correction. */
export const GOAL_CONVERSION_GOALKEEPER = 1.0
/** Measured actual/xG ratio, defenders, rounded to two decimals. Raw measurement: 137 / 180.862900 = 0.757480 (n=4450 player-matches, 189 players) -- see the section header above. */
export const GOAL_CONVERSION_DEFENDER = 0.76
/** Measured actual/xG ratio, midfielders, rounded to two decimals. Raw measurement: 533 / 542.257100 = 0.982929 (n=5763 player-matches, 254 players) -- see the section header above. */
export const GOAL_CONVERSION_MIDFIELDER = 0.98
/** Measured actual/xG ratio, forwards, rounded to two decimals. Raw measurement: 335 / 343.627900 = 0.974892 (n=1515 player-matches, 66 players) -- see the section header above. */
export const GOAL_CONVERSION_FORWARD = 0.97

/** Clamps a raw goal conversion factor into [GOAL_CONVERSION_MIN, GOAL_CONVERSION_MAX]. See the clamp comment above for why this exists and why the bounds sit where they do. */
export function clampGoalConversionFactor(factor: number): number {
  return Math.min(GOAL_CONVERSION_MAX, Math.max(GOAL_CONVERSION_MIN, factor))
}

/**
 * This position's goal conversion factor, clamped. A `switch` with one
 * explicit, named case per position -- goalkeeper gets its own named case
 * and its own (no-information) constant, exactly like every outfield
 * position, rather than silently inheriting a shared fallback. The only
 * `default:` is `assertNeverPosition` above, which every valid `Position`
 * value is guaranteed by the four cases below never to reach -- it exists
 * so an invalid position code fails loudly instead of one of the four real
 * cases quietly acting as an unlabelled default for it.
 *
 * Cased on the plain position codes (1 GK, 2 DEF, 3 MID, 4 FWD), same
 * reasoning as `assistConversionFactor` above (see its own comment on the
 * point) -- the imported GOALKEEPER/DEFENDER/... constants are typed as the
 * widened `Position` union, not literal types, so TypeScript cannot narrow
 * `position` to `never` after them.
 */
export function goalConversionFactor(position: Position): number {
  switch (position) {
    case 1: // goalkeeper
      return clampGoalConversionFactor(GOAL_CONVERSION_GOALKEEPER)
    case 2: // defender
      return clampGoalConversionFactor(GOAL_CONVERSION_DEFENDER)
    case 3: // midfielder
      return clampGoalConversionFactor(GOAL_CONVERSION_MIDFIELDER)
    case 4: // forward
      return clampGoalConversionFactor(GOAL_CONVERSION_FORWARD)
    default:
      return assertNeverPosition(position)
  }
}

// ============================================================================
// Ticket #168, 31 Aug 2026 -- DIAGNOSED, NO FIX SHIPPED BELOW THIS LINE.
//
// Forward assists were the last component outside +/-10% on either
// instrument (calibration report, 31 Aug 2026: actual 0.40 pts/90, projected
// 0.27 pts/90, 0.67x) after #148 already applied the directly-measured
// ASSIST_CONVERSION_FORWARD = 2.12 correction above. This ticket's job was to
// choose between two candidate mechanisms upstream of that conversion by
// MEASURING, not arguing (docs/projection-model-backlog.md G7/G8's "do not
// act from argument alone" precedent) -- and it is recorded here, rather
// than only in decisions/ticket-168.md, because the next ticket to touch
// this file needs the finding, not just the outcome.
//
// METHOD. Fetched FPL-Core-Insights' player-match CSVs directly over plain
// HTTPS (both ingested seasons, Premier League matches only via the same
// match_id-prefix filter scripts/lib/competition.ts uses) and reconstructed,
// independently, exactly what scripts/project-points.ts computes: the
// forward position prior (positionPriorRates over every match row of a
// CURRENTLY-ROSTERED forward, both seasons combined -- the same
// player_match_stats.player_code = players.code join project-points.ts
// uses), and the two-stage shrunk rate for the highest-minutes current-season
// forwards. This reproduced the calibration report's own population sizes
// exactly (73 distinct forward codes on the current 2026/27 roster; 46 of
// them found with real 2025/26 minutes, against the report's stated 48) --
// strong independent confirmation the reconstruction matches the live join.
//
// FINDING 1 -- "population mismatch, not fully corrected by
// appearance-weighting" (the ticket's second candidate) is RULED OUT, not
// merely unmeasured. Forwards with under 5 nineties of combined history
// across both seasons carry only 4.3% of the position prior's
// minutes-weighted total (29 of 677 nineties), and their own xA/90 (0.052)
// is only 11% below the established (>=5 nineties) group's (0.059) --
// nowhere near enough dilution to produce a 33-point gap. More decisively:
// ticket #155 (calibration-report.ts) already applies the IDENTICAL
// pSixtyPlus appearance-weighted formula to every projected component, goals
// included, over this SAME 73-forward population. If population dilution
// were the driver, goals would show a comparable bias. They do not (0.97x,
// clean, ticket #162).
//
// FINDING 2 -- "the position prior is dragging forwards down" (the ticket's
// first candidate) has only weak, and the wrong-shaped, support as
// originally framed. The position prior (xaPer90 = 0.0586) sits close to the
// MEDIAN of the established-forward per-player distribution (~p54, n=35,
// median 0.0538), not far below it, and the highest-minutes 15 forwards' own
// combined-history xA/90 (0.053, minutes-weighted) sits slightly BELOW the
// prior, not above it -- shrinkage pulls their rate UP toward the prior on
// this evidence, the opposite of what "recommended players sit far above a
// low prior" predicts. The same top-15 group's xG/90 (0.463) sits almost
// exactly AT the prior (0.455, ratio 1.02) -- consistent with goals
// projecting correctly and unhelpful for explaining why assists do not.
//
// FINDING 3 -- a real, measured, ASYMMETRIC effect exists that has exactly
// the right shape to explain the goals/assists divergence, but its cause
// sits in a file this ticket's scope does not permit touching.
// scripts/project-points.ts's codeToPlayer join drops every historical row
// for a player no longer on the current roster (relegation, transfer out,
// retirement) before it ever reaches positionPriorRates. Measured directly:
// the 44 forwards that join drops had a HIGHER historical xA/90 (0.073) than
// the 51 who remain (0.055) -- but a LOWER xG/90 (0.277 vs 0.459). The
// Premier League's survivorship selects for forwards who score; it does not
// select for forwards who create -- and #148's ASSIST_CONVERSION_FORWARD /
// #162's GOAL_CONVERSION_FORWARD were both measured against the FULL,
// un-survivorship-filtered 2025/26 forward population, not the
// currently-rostered subset positionPriorRates actually runs on today. This
// is a real, directional finding, but fixing it means changing WHICH rows
// feed the position prior (scripts/project-points.ts, out of this ticket's
// scope) -- and correcting for it here, at the rate or conversion level,
// would be architecturally indistinguishable from a second, undocumented
// assist conversion factor, which this ticket's scope explicitly forbids.
//
// CONCLUSION. No change below this line. On direct measurement, the
// shrinkage/position-prior code in THIS file and rates.ts is reasonably
// calibrated for forwards, on both xG and xA -- it is not the primary driver
// of the measured gap, and a correction fitted here on top of a mechanism
// this diagnostic could not confirm at the required magnitude would be
// exactly the "second blind correction... fitting noise" #148 already
// warned against. Finding 3 is the strongest lead for a follow-up ticket
// scoped to touch scripts/project-points.ts instead. Full workings, sample
// sizes, and the population-validation check against the live report's own
// 73/48 counts: decisions/ticket-168.md.
// ============================================================================

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
  /** xaPer90 x minutesFraction x attackMultiplier x this position's assistConversionFactor -- ticket #148. The same value assistPoints is derived from; surfaced here (alongside the existing per-fixture inputs) as well as on expectedEvents so the reasoning screen and any future calibration work can see the adjusted figure, not only the resulting points. */
  expectedAssists: number
  /** xgPer90 x minutesFraction x attackMultiplier x this position's goalConversionFactor -- ticket #162. The same value goalPoints is derived from; surfaced here (alongside expectedAssists above) as well as on expectedEvents so the reasoning screen and any future calibration work can see the adjusted figure, not only the resulting points. */
  expectedGoals: number
  expectedScore: number
  expectedGoalsConceded: number
  /** The defensive multiplier applied to savesPer90 for this fixture -- see fixture.ts's defensiveMultiplier. Ticket #109. */
  savesMultiplier: number
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
  const savesMultiplier = defensiveMultiplier(expectedScoreValue)
  const teamLambdaConceded = expectedGoalsConceded(fixture.leagueBaselineGoals, expectedScoreValue)

  // Ticket #162: xG measures chance quality/quantity, not conversion -- see
  // this file's "Goal conversion" section above for the mechanism, the
  // measurement and why it is per-position rather than one flat factor.
  // Nothing upstream of this line (xgPer90, minutesFraction,
  // attackMultiplier) is touched by that ticket.
  const expectedGoals =
    playerRates.xgPer90 * minutesFraction * attackMultiplier * goalConversionFactor(player.position)
  // Ticket #148: xA measures chance quality, not conversion -- see this
  // file's "Assist conversion" section above for the mechanism, the
  // measurement and why it is per-position rather than one flat factor.
  // Nothing upstream of this line (xaPer90, minutesFraction,
  // attackMultiplier) is touched by that ticket.
  const expectedAssists =
    playerRates.xaPer90 * minutesFraction * attackMultiplier * assistConversionFactor(player.position)
  // Saves scale with the same fixture pressure that raises goals conceded --
  // a keeper facing a team twice as likely to score faces roughly twice the
  // shot volume. See fixture.ts's defensiveMultiplier and
  // docs/projection-model-backlog.md G1 for the caveat this does not resolve.
  const expectedSaves = playerRates.savesPer90 * minutesFraction * savesMultiplier
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
      expectedAssists,
      expectedGoals,
      expectedScore: expectedScoreValue,
      expectedGoalsConceded: teamLambdaConceded,
      savesMultiplier,
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
