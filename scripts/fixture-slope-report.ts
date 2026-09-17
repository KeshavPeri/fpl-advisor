// Fixture slope report — ticket #244.
//
// ============================================================================
// WHAT THIS IS AND WHY IT EXISTS.
// ============================================================================
// Ticket #182/#184 damped `attackingMultiplier` from slope 2 to slope 1
// against a real measurement (docs/model-review-2026-09-02.md §1b, n=698
// resolvable 2025-2026 Premier League team-matches). Its own comment on
// `ATTACKING_MULTIPLIER_OFFSET` (src/lib/projection/fixture.ts) says the
// mirror side — `defensiveMultiplier` / `expectedGoalsConceded` — is
// "explicitly UNTOUCHED by this measurement" and must not be damped "without
// its own separate measurement and ticket" (docs/projection-model-backlog.md
// G12). This script is that measurement: actual team goals CONCEDED,
// bucketed by point-in-time `expectedScore`, over the SAME population, SAME
// buckets and SAME method #184 used for goals SCORED — plus a reproduction of
// the goals-SCORED table itself, from the same run, so both slopes are
// measured by one method on one population (the ticket's own falsification
// gate #2: if the reproduced scored table does not match #184's published
// bucket means within 0.05 goals, the harness is wrong and nothing else here
// can be trusted).
//
// ============================================================================
// DATA SOURCE — NO SUPABASE, DELIBERATELY.
// ============================================================================
// Every other report script in scripts/ (calibration-report.ts,
// team-strength-diagnostic.ts, bonus-validation-report.ts, ...) reads live
// data from Supabase. This one does not, and that is not an oversight: a
// Builder session in this pipeline has no Supabase credentials (see
// src/lib/projection/teamStrength.ts's own SCALE comment: "This job has no
// Supabase access at all and never will (confirmed)"), and the ticket's own
// falsification gate requires this report's ACTUAL, MEASURED numbers to be
// pasted into the PR body — a script this session cannot run would produce
// nothing to paste. `player_match_stats` for 2025-2026 is reconstructed
// directly from FPL-Core-Insights' own public per-gameweek CSVs instead — the
// exact same source and method SCALE's own calibration comment describes as
// "no Supabase needed for this side — confirmed reachable", and the same
// source #184's own measurement (docs/model-review-2026-09-02.md) used. This
// script needs no environment variable and makes no database write; it is
// pure HTTPS GET plus the pure functions below.
//
// ============================================================================
// REUSE, NOT REIMPLEMENTATION.
// ============================================================================
// `buildTeamMatchRecords`, `computeTeamStrengthAsOf`,
// `computeFixtureExpectedScore` and `SCALE` are imported UNMODIFIED from
// src/lib/projection/teamStrength.ts, per the ticket text. Opponent
// resolution and competition parsing reuse `buildClubCodeBySlug`,
// `buildTeamCodeMap` and `toMatchStatRow`, exported from
// scripts/ingest-core-insights.ts for exactly this kind of reconstruction
// (the same three functions the SCALE calibration's own "throwaway script"
// reused, per its comment) — nothing about slug parsing or opponent
// resolution is re-derived here. `PREMIER_LEAGUE_COMPETITION` is imported
// from scripts/lib/competition.ts, the one place that token is defined.
//
// `TEAM_STRENGTH_SHRINKAGE_K = 0` ON THIS PATH — ticket text, verbatim
// reasoning. `SCALE` (src/lib/projection/teamStrength.ts) was calibrated
// against a full-season, UNSHRUNK population (its own comment: "This
// construction's own delta... population stdDev 0.9564" — computed with no
// shrinkage, because the live shrinkage constant TEAM_STRENGTH_SHRINKAGE_K
// was added later, by ticket #242, for a DIFFERENT purpose: taming early
// -season, few-match noise on live, in-season data, where "few matches" is
// the normal case for most of the season. Every row this script measures is
// END-OF-SEASON, full-season-length evidence (a team's `matches` count when
// evaluated as of gameweek 30 is on the order of 29, not 2-3) — shrinking a
// season-length rate toward the mean would pull `expectedScore` narrower than
// the regime #184's own attacking figures (and this script's reproduction of
// them) were measured against, moving the x-axis under the y-axis. Passing
// `shrinkageK = 0` explicitly (rather than relying on the function's own
// default of `TEAM_STRENGTH_SHRINKAGE_K = 5`) reproduces the pre-#242,
// full-season-appropriate figure exactly — see teamStrength.ts's own
// `computeFixtureExpectedScore` doc comment, "shrinkageK = 0 reproduces the
// pre-#242 unshrunk figure exactly".
//
// NO HOME-ADVANTAGE TERM EITHER, for the same "match the regime #184 was
// measured against" reason. #184's own reconstruction (fixture.ts's
// ATTACKING_MULTIPLIER_OFFSET comment; docs/model-review-2026-09-02.md §1b)
// predates ticket #229's `HOME_EXPECTED_SCORE_BONUS` / `homeAdjustment`
// parameter and used none — `computeFixtureExpectedScore`'s `homeAdjustment`
// parameter is left at its own default (0) here, deliberately, so the
// goals-SCORED reproduction (falsification gate #2) is comparing like with
// like.
//
// ============================================================================
// SCOPE — READ-ONLY, NOT SCHEDULED.
// ============================================================================
// This script makes no database write of any kind (no job_runs row — there
// is no Supabase connection to write one to). It is not added to
// .github/workflows/ and not added to scripts/preflight-check.ts's tracked
// -job list — both explicitly out of scope per the ticket's own "Out of
// scope" section (preflight-check.ts is listed as owned by ticket #238, this
// same batch).

import { parse } from 'csv-parse/sync'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildClubCodeBySlug, buildTeamCodeMap, toMatchStatRow, type MatchStatRow } from './ingest-core-insights.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import {
  buildTeamMatchRecords,
  computeFixtureExpectedScore,
  computeTeamStrengthAsOf,
  SCALE,
  type MatchStatsForTeamStrength,
  type TeamMatchRecord,
} from '../src/lib/projection/teamStrength.ts'
import { LEAGUE_BASELINE_GOALS_PER_TEAM } from '../src/lib/projection/fixture.ts'

const JOB_NAME = 'fixture-slope-report'
const DEFAULT_REPORT_PATH = './out/fixture-slope-report.md'

// The one season this ticket measures — #184's own population, never a
// parameter. "Every resolvable 2025-2026 Premier League team-match" (ticket
// text, verbatim).
const SEASON = '2025-2026'
const SOURCE_BASE_URL = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data'
// A Premier League season is 38 gameweeks. A 2025-2026 gameweek missing from
// the source (a 404) is recorded and skipped, never silently treated as "the
// season is over" -- unlike scripts/ingest-core-insights.ts's own walk
// (which targets the CURRENT, still-in-progress season and correctly stops
// at the first 404), this is a completed past season and every gameweek is
// expected to be present.
const MAX_GAMEWEEKS = 38

// The unshrunk, no-home-adjustment path this whole measurement runs on — see
// the file header's "REUSE, NOT REIMPLEMENTATION" section for the "because".
const SHRINKAGE_K_FOR_THIS_PATH = 0

// #184's own published bucket boundaries (fixture.ts's own
// ATTACKING_MULTIPLIER_OFFSET comment table; docs/model-review-2026-09-02.md
// §1b) -- reused verbatim so the two measurements are directly comparable.
// A bucket is [lower, upper) except the last, which is [0.65, 1.01] (closed
// at both ends -- expectedScore never legitimately exceeds 1, and the ".01"
// in the published label is headroom, not a real boundary crossed by any
// value this construction can produce).
export const BUCKET_UPPER_BOUNDS = [0.35, 0.45, 0.55, 0.65] as const
export const BUCKET_LABELS = ['0.00–0.35', '0.35–0.45', '0.45–0.55', '0.55–0.65', '0.65–1.01'] as const

/**
 * Which of the 5 buckets (0-indexed, matching BUCKET_LABELS) an expectedScore
 * falls into. Boundaries are lower-inclusive / upper-exclusive except the
 * last bucket, which has no upper bound to exclude (any value >= 0.65,
 * including a value at or above 1.0, lands here -- the clamp in
 * computeFixtureExpectedScore already keeps real output inside [0.05, 0.95],
 * this function does not need to re-enforce that).
 *
 * Named tests: a value exactly ON each of the three interior boundaries
 * (0.35, 0.45, 0.55, 0.65) resolves to the UPPER bucket, matching the
 * published table's own "0.00-0.35" / "0.35-0.45" reading (0.35 belongs to
 * the second bucket, not the first); a value just below each boundary stays
 * in the lower bucket; the two extremes (0 and 1) land in bucket 0 and
 * bucket 4 respectively.
 */
export function bucketIndexForExpectedScore(expectedScoreValue: number): number {
  for (let i = 0; i < BUCKET_UPPER_BOUNDS.length; i++) {
    if (expectedScoreValue < BUCKET_UPPER_BOUNDS[i]) return i
  }
  return BUCKET_UPPER_BOUNDS.length
}

// ============================================================================
// One measured team-match-perspective row -- one team's own expectedScore,
// as of that match's own gameweek, plus what it actually scored and conceded
// in that match. Two rows per resolvable match (one per side), exactly the
// "n=698 team-matches" shape #184's own table counts in.
// ============================================================================

export interface MeasuredRow {
  matchId: string
  gameweek: number
  teamCode: number
  expectedScoreValue: number
  actualGoalsScored: number
  actualGoalsConceded: number
}

/**
 * Builds one MeasuredRow per resolvable (team, match) TeamMatchRecord --
 * `records` itself IS the population ("every resolvable 2025-2026 Premier
 * League team-match", ticket text): a record with insufficient prior history
 * on either side is NOT dropped from the population, it gets the neutral
 * expectedScore = 0.5 fallback exactly as computeFixtureExpectedScore's own
 * MIN_TEAM_PRIOR_MATCHES gate produces for a live fixture -- dropping it here
 * instead would silently shrink the measured population below #184's own
 * n=698 and violate the falsification gate's population-size requirement.
 *
 * The opponent for each record is found by matchId (never by team pairing --
 * see teamStrength.ts's own buildTeamMatchRecordsFromFixtures doc for why
 * matchId, not team pairing, is what distinguishes two fixtures between the
 * same two clubs). A record whose match has no resolvable opponent record
 * (should not happen -- buildTeamMatchRecords only emits a record when BOTH
 * sides resolved -- but never assumed) is skipped and counted separately by
 * the caller, never silently included with a guessed opponent.
 */
export function buildMeasuredRows(records: readonly TeamMatchRecord[]): { rows: MeasuredRow[]; skippedNoOpponentRecord: number } {
  const recordsByMatchId = new Map<string, TeamMatchRecord[]>()
  for (const record of records) {
    const existing = recordsByMatchId.get(record.matchId)
    if (existing) existing.push(record)
    else recordsByMatchId.set(record.matchId, [record])
  }

  const rows: MeasuredRow[] = []
  let skippedNoOpponentRecord = 0

  for (const record of records) {
    const sameMatch = recordsByMatchId.get(record.matchId) ?? []
    const opponentRecord = sameMatch.find((r) => r.teamCode !== record.teamCode)
    if (opponentRecord === undefined) {
      skippedNoOpponentRecord++
      continue
    }
    const ownStrength = computeTeamStrengthAsOf(records, record.teamCode, record.gameweek)
    const opponentStrength = computeTeamStrengthAsOf(records, opponentRecord.teamCode, record.gameweek)
    const expectedScoreValue = computeFixtureExpectedScore(ownStrength, opponentStrength, SCALE, 0, SHRINKAGE_K_FOR_THIS_PATH)
    rows.push({
      matchId: record.matchId,
      gameweek: record.gameweek,
      teamCode: record.teamCode,
      expectedScoreValue,
      actualGoalsScored: record.goalsScored,
      actualGoalsConceded: record.goalsConceded,
    })
  }

  return { rows, skippedNoOpponentRecord }
}

// ============================================================================
// Bucketing and the two slope figures -- endpoint and weighted least squares,
// matching #184's own presentation exactly (fixture.ts's
// ATTACKING_MULTIPLIER_OFFSET comment: "the review states '≈1.43',
// reproduced here as the extreme-bucket endpoint slope... a whole-table
// weighted least-squares fit over the five bucket means, by comparison,
// gives ≈1.50").
// ============================================================================

export interface BucketStats {
  label: string
  n: number
  meanExpectedScore: number
  meanActualGoalsScored: number
  meanActualGoalsConceded: number
}

/** n=0 buckets are possible only in a synthetic/test population -- guarded against dividing by zero, never NaN. */
function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function bucketRows(rows: readonly MeasuredRow[]): BucketStats[] {
  const buckets: MeasuredRow[][] = BUCKET_LABELS.map(() => [])
  for (const row of rows) {
    buckets[bucketIndexForExpectedScore(row.expectedScoreValue)].push(row)
  }
  return buckets.map((bucketRowsForLabel, i) => ({
    label: BUCKET_LABELS[i],
    n: bucketRowsForLabel.length,
    meanExpectedScore: meanOf(bucketRowsForLabel.map((r) => r.expectedScoreValue)),
    meanActualGoalsScored: meanOf(bucketRowsForLabel.map((r) => r.actualGoalsScored)),
    meanActualGoalsConceded: meanOf(bucketRowsForLabel.map((r) => r.actualGoalsConceded)),
  }))
}

/** The extreme-bucket endpoint slope: (high bucket mean y - low bucket mean y) / (high bucket mean x - low bucket mean x), over the FIRST and LAST bucket only, matching #184's own headline figure. Buckets with n=0 at either extreme make this undefined (NaN) -- callers must check bucket n before trusting this on unmeasured/synthetic data with empty extreme buckets. */
export function endpointSlope(buckets: readonly BucketStats[], y: (b: BucketStats) => number): number {
  const low = buckets[0]
  const high = buckets[buckets.length - 1]
  return (y(high) - y(low)) / (high.meanExpectedScore - low.meanExpectedScore)
}

/**
 * Weighted least-squares linear fit y = intercept + slope * x over the five
 * bucket means, weighted by each bucket's own n -- matching #184's own
 * "whole-table weighted least-squares fit over the five bucket means"
 * (fixture.ts's ATTACKING_MULTIPLIER_OFFSET comment). Standard weighted
 * normal-equations form:
 *   slope = (W * Wxy - Wx * Wy) / (W * Wxx - Wx^2)
 *   intercept = (Wy - slope * Wx) / W
 * where W = sum(w), Wx = sum(w*x), Wy = sum(w*y), Wxy = sum(w*x*y),
 * Wxx = sum(w*x*x). A bucket with n=0 contributes weight 0 and drops out
 * entirely, rather than pulling the fit toward a meaningless x=0,y=0 point.
 */
export function weightedLinearFit(points: readonly { x: number; y: number; weight: number }[]): { slope: number; intercept: number } {
  let sumW = 0
  let sumWX = 0
  let sumWY = 0
  let sumWXX = 0
  let sumWXY = 0
  for (const p of points) {
    sumW += p.weight
    sumWX += p.weight * p.x
    sumWY += p.weight * p.y
    sumWXX += p.weight * p.x * p.x
    sumWXY += p.weight * p.x * p.y
  }
  const denominator = sumW * sumWXX - sumWX * sumWX
  const slope = denominator === 0 ? 0 : (sumW * sumWXY - sumWX * sumWY) / denominator
  const intercept = sumW === 0 ? 0 : (sumWY - slope * sumWX) / sumW
  return { slope, intercept }
}

function weightedFitFor(buckets: readonly BucketStats[], y: (b: BucketStats) => number): { slope: number; intercept: number } {
  return weightedLinearFit(buckets.map((b) => ({ x: b.meanExpectedScore, y: y(b), weight: b.n })))
}

// ============================================================================
// The decision -- ticket text, verbatim: "materially flatter than -2.9"
// means outside +/-15% of it.
// ============================================================================

export const MODEL_IMPLIED_CONCEDED_SLOPE = -LEAGUE_BASELINE_GOALS_PER_TEAM * 2 // -2.9 at the current LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45
export const MATERIALITY_BAND_FRACTION = 0.15

/**
 * True when `measuredSlope` (expected to be negative -- goals conceded fall
 * as expectedScore rises) is OUTSIDE +/-15% of MODEL_IMPLIED_CONCEDED_SLOPE
 * -- ticket text: "materially flatter than -2.9 -- outside +/-15% of it".
 * Compared on magnitude (both slopes are negative by construction; "flatter"
 * means smaller magnitude), so this reads as a plain percentage-of-magnitude
 * band, not a signed-value band that could be fooled by a sign flip.
 */
export function isMateriallyFlatterThanModel(measuredSlope: number): boolean {
  const modelMagnitude = Math.abs(MODEL_IMPLIED_CONCEDED_SLOPE)
  const measuredMagnitude = Math.abs(measuredSlope)
  const lowerBound = modelMagnitude * (1 - MATERIALITY_BAND_FRACTION)
  const upperBound = modelMagnitude * (1 + MATERIALITY_BAND_FRACTION)
  return measuredMagnitude < lowerBound || measuredMagnitude > upperBound
}

// ============================================================================
// Falsification gate.
// ============================================================================

export const MIN_MEASURED_TEAM_MATCHES = 600
// #184's own published goals-SCORED bucket means (fixture.ts's
// ATTACKING_MULTIPLIER_OFFSET comment table) -- gate 2 compares this report's
// own reproduction against these five numbers, in bucket order.
export const PUBLISHED_SCORED_BUCKET_MEANS = [1.04, 1.23, 1.35, 1.61, 1.75] as const
export const SCORED_REPRODUCTION_TOLERANCE = 0.05

export interface FalsificationGateResult {
  populationGate: { passed: boolean; n: number; min: number }
  reproductionGate: { passed: boolean; deltas: number[]; tolerance: number }
}

export function checkFalsificationGate(totalN: number, scoredBuckets: readonly BucketStats[]): FalsificationGateResult {
  const populationGate = { passed: totalN >= MIN_MEASURED_TEAM_MATCHES, n: totalN, min: MIN_MEASURED_TEAM_MATCHES }
  const deltas = scoredBuckets.map((b, i) => b.meanActualGoalsScored - PUBLISHED_SCORED_BUCKET_MEANS[i])
  const reproductionGate = {
    // + 1e-9 is a floating-point-representation guard only (e.g. 1.04 + 0.05
    // = 1.0900000000000001 in IEEE 754 double, so a delta of "exactly" 0.05
    // can read back as 0.050000000000000044) -- negligible next to the
    // 0.05 tolerance itself, never enough to let a real failure through.
    passed: deltas.every((d) => Math.abs(d) <= SCORED_REPRODUCTION_TOLERANCE + 1e-9),
    deltas,
    tolerance: SCORED_REPRODUCTION_TOLERANCE,
  }
  return { populationGate, reproductionGate }
}

// ============================================================================
// Falsification gate 3 (REPLACED after the Builder's first report -- the
// original spec needed a live Supabase read of scripts/calibration-report.ts
// before/after, which a Builder session cannot do at all (no credentials)
// and should not attempt even with them, per
// LEARNINGS-second-build-wave.md §20: only write gates the Builder can
// actually evaluate. This is Keshav's replacement: a gate computable
// entirely from the SAME rows already measured above, no Supabase, no
// re-running project-points -- does the DAMPED clean-sheet-probability curve
// (`pCleanSheet = exp(-lambda)`, `lambda = leagueBaselineGoals *
// defensiveMultiplier(es)`) actually track the real, observed clean-sheet
// rate better than the pre-#244 curve did, or does the linear slope fit on
// goals conceded (which the endpoint/weighted fit above confirms) come at
// the cost of a WORSE clean-sheet probability -- the exact non-linearity
// risk `pCleanSheet = exp(-lambda)` being non-linear in lambda raises, and
// that this backlog's own G12 entry flagged before this measurement existed.
//
// POOLING, NOT A TWO-LEVEL MEAN-OF-MEANS. Every rate below (actual, old
// predicted, new predicted) is a single pooled mean over the bucket's own
// MeasuredRow's -- exactly how BucketStats above already pools
// meanActualGoalsScored/Conceded per bucket, never an average of per-match
// rates re-averaged a second time.
// ============================================================================

/** The pre-#244 formula's implied Poisson rate, lambda = leagueBaselineGoals x 2 x (1 - es) -- exactly what expectedGoalsConceded computed before this ticket (see fixture.test.ts's own "pre-#244" hand-computed values). */
export function cleanSheetLambdaOld(leagueBaselineGoals: number, expectedScoreValue: number): number {
  return leagueBaselineGoals * 2 * (1 - expectedScoreValue)
}

/** This ticket's damped formula's implied Poisson rate, lambda = leagueBaselineGoals x (1.5 - es) -- exactly DEFENSIVE_MULTIPLIER_OFFSET's own shape (src/lib/projection/fixture.ts), reproduced here as a plain number rather than importing defensiveMultiplier, so this gate reads as an independent check against the SAME formula, not a call into the code being checked. */
export function cleanSheetLambdaNew(leagueBaselineGoals: number, expectedScoreValue: number): number {
  return leagueBaselineGoals * (1.5 - expectedScoreValue)
}

/**
 * Mean of `exp(-lambdaFn(leagueBaselineGoals, row.expectedScoreValue))` over
 * `rows`, pooled directly (one number per row, then a single mean) -- the
 * named "exp(-lambda) bucket-mean helper" per the gate spec. n=0 returns 0,
 * never NaN, matching meanOf's own guard.
 */
export function meanPredictedCleanSheetRate(
  rows: readonly MeasuredRow[],
  leagueBaselineGoals: number,
  lambdaFn: (leagueBaselineGoals: number, expectedScoreValue: number) => number,
): number {
  return meanOf(rows.map((r) => Math.exp(-lambdaFn(leagueBaselineGoals, r.expectedScoreValue))))
}

/** Share of `rows` whose actualGoalsConceded is exactly 0 -- the observed clean-sheet rate, pooled directly over the bucket's own rows. n=0 returns 0, never NaN. */
export function actualCleanSheetRate(rows: readonly MeasuredRow[]): number {
  if (rows.length === 0) return 0
  const cleanSheets = rows.filter((r) => r.actualGoalsConceded === 0).length
  return cleanSheets / rows.length
}

export interface CleanSheetBucketStats {
  label: string
  n: number
  actualCleanSheetRate: number
  oldPredictedCleanSheetRate: number
  newPredictedCleanSheetRate: number
}

/** Groups `rows` into the SAME 5 buckets bucketRows uses (bucketIndexForExpectedScore, unmodified), and computes the three pooled clean-sheet rates per bucket. */
export function bucketCleanSheetStats(rows: readonly MeasuredRow[], leagueBaselineGoals: number): CleanSheetBucketStats[] {
  const buckets: MeasuredRow[][] = BUCKET_LABELS.map(() => [])
  for (const row of rows) {
    buckets[bucketIndexForExpectedScore(row.expectedScoreValue)].push(row)
  }
  return buckets.map((bucketRowsForLabel, i) => ({
    label: BUCKET_LABELS[i],
    n: bucketRowsForLabel.length,
    actualCleanSheetRate: actualCleanSheetRate(bucketRowsForLabel),
    oldPredictedCleanSheetRate: meanPredictedCleanSheetRate(bucketRowsForLabel, leagueBaselineGoals, cleanSheetLambdaOld),
    newPredictedCleanSheetRate: meanPredictedCleanSheetRate(bucketRowsForLabel, leagueBaselineGoals, cleanSheetLambdaNew),
  }))
}

/** Unweighted mean of the 5 per-bucket |predicted - actual| values -- 5 buckets = 5 rows being compared, the same shape as the endpoint/weighted-slope comparison elsewhere in this file. Never weighted by bucket n: an under-populated bucket's probability error counts exactly as much as a well-populated one's, matching the ticket text ("unweighted mean of the 5 per-bucket... values"). */
export function meanAbsoluteError(buckets: readonly CleanSheetBucketStats[], predicted: (b: CleanSheetBucketStats) => number): number {
  return meanOf(buckets.map((b) => Math.abs(predicted(b) - b.actualCleanSheetRate)))
}

export interface CleanSheetGateResult {
  buckets: CleanSheetBucketStats[]
  oldMae: number
  newMae: number
  /** true when NEW's MAE is strictly lower than OLD's -- ticket text: "STOP AND REPORT if NEW's MAE is higher than or equal to OLD's". Equality is a STOP, not a PASS -- a damping that does not measurably improve the clean-sheet probability has not earned replacing the old formula. */
  passed: boolean
}

export function checkCleanSheetGate(rows: readonly MeasuredRow[], leagueBaselineGoals: number): CleanSheetGateResult {
  const buckets = bucketCleanSheetStats(rows, leagueBaselineGoals)
  const oldMae = meanAbsoluteError(buckets, (b) => b.oldPredictedCleanSheetRate)
  const newMae = meanAbsoluteError(buckets, (b) => b.newPredictedCleanSheetRate)
  return { buckets, oldMae, newMae, passed: newMae < oldMae }
}

// ============================================================================
// Fetching and CSV parsing -- FPL-Core-Insights, no Supabase. See file header.
// ============================================================================

class FixtureSlopeReportError extends Error {}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FixtureSlopeReportError(`could not reach ${url}: ${message}`)
  }
  const text = await response.text()
  return { status: response.status, text }
}

function parseCsv(text: string, url: string): Array<Record<string, string>> {
  try {
    return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FixtureSlopeReportError(`${url} exists but does not parse as CSV: ${message}`)
  }
}

function seasonRootUrl(season: string, file: string): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/${file}`
}

function gameweekUrl(season: string, gameweek: number): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/By%20Gameweek/GW${gameweek}/playermatchstats.csv`
}

interface FetchedPopulation {
  matchStatsRows: MatchStatsForTeamStrength[]
  gameweeksFetched: number[]
  gameweeksMissing: number[]
  totalCsvRowsRead: number
  nonPremRowsExcluded: number
}

/** Fetches teams.csv, players.csv and every gameweek's playermatchstats.csv for SEASON, and reduces them to the (matchId, teamCode, opponentTeamCode, teamGoalsConceded) shape buildTeamMatchRecords needs. Every step reuses ingest-core-insights.ts's own exported functions unmodified -- see file header. */
async function fetchPopulation(): Promise<FetchedPopulation> {
  const teamsCsv = await fetchText(seasonRootUrl(SEASON, 'teams.csv'))
  if (teamsCsv.status !== 200) {
    throw new FixtureSlopeReportError(`teams.csv fetch failed for season ${SEASON}: HTTP ${teamsCsv.status}`)
  }
  const playersCsv = await fetchText(seasonRootUrl(SEASON, 'players.csv'))
  if (playersCsv.status !== 200) {
    throw new FixtureSlopeReportError(`players.csv fetch failed for season ${SEASON}: HTTP ${playersCsv.status}`)
  }

  const teamRecords = parseCsv(teamsCsv.text, 'teams.csv')
  const playerRecords = parseCsv(playersCsv.text, 'players.csv')
  const { codeBySlug } = buildClubCodeBySlug(teamRecords)
  const teamCodeByPlayerId = buildTeamCodeMap(playerRecords)

  const matchStatsRows: MatchStatsForTeamStrength[] = []
  const gameweeksFetched: number[] = []
  const gameweeksMissing: number[] = []
  let totalCsvRowsRead = 0
  let nonPremRowsExcluded = 0

  for (let gw = 1; gw <= MAX_GAMEWEEKS; gw++) {
    const url = gameweekUrl(SEASON, gw)
    const fetched = await fetchText(url)
    if (fetched.status === 404) {
      gameweeksMissing.push(gw)
      continue
    }
    if (fetched.status !== 200) {
      throw new FixtureSlopeReportError(`GW${gw} playermatchstats.csv fetch failed: HTTP ${fetched.status}`)
    }
    const rawRecords = parseCsv(fetched.text, url)
    if (rawRecords.length === 0) {
      gameweeksMissing.push(gw)
      continue
    }
    gameweeksFetched.push(gw)
    totalCsvRowsRead += rawRecords.length

    for (const record of rawRecords) {
      // playerCodeByPlayerId (4th positional arg) is required by
      // toMatchStatRow's signature but its output field (player_code) is
      // never read below -- an empty map is correct, not a shortcut: this
      // report needs team identity and goals conceded only.
      const row: MatchStatRow | null = toMatchStatRow(record, SEASON, gw, new Map(), new Map(), teamCodeByPlayerId, codeBySlug)
      if (row === null) continue
      if (row.competition !== PREMIER_LEAGUE_COMPETITION) {
        nonPremRowsExcluded++
        continue
      }
      matchStatsRows.push({
        matchId: row.match_id,
        gameweek: row.gameweek,
        teamCode: row.team_code,
        opponentTeamCode: row.opponent_team_code,
        teamGoalsConceded: row.team_goals_conceded,
      })
    }
  }

  return { matchStatsRows, gameweeksFetched, gameweeksMissing, totalCsvRowsRead, nonPremRowsExcluded }
}

// ============================================================================
// Report markdown.
// ============================================================================

function fmt3(n: number): string {
  return n.toFixed(3)
}
function fmt2(n: number): string {
  return n.toFixed(2)
}

function bucketTableMarkdown(buckets: readonly BucketStats[], modelForBucket: (b: BucketStats) => number, modelColumnLabel: string, actualColumn: 'scored' | 'conceded'): string {
  const header = `| es bucket | n | mean es | actual goals ${actualColumn} | ${modelColumnLabel} |\n|---|---|---|---|---|`
  const rows = buckets.map((b) => {
    const actual = actualColumn === 'scored' ? b.meanActualGoalsScored : b.meanActualGoalsConceded
    return `| ${b.label} | ${b.n} | ${fmt3(b.meanExpectedScore)} | ${fmt2(actual)} | ${fmt2(modelForBucket(b))} |`
  })
  return [header, ...rows].join('\n')
}

interface ReportData {
  generatedAt: Date
  population: FetchedPopulation
  scoredBuckets: BucketStats[]
  concededBuckets: BucketStats[]
  scoredEndpointSlope: number
  scoredWeightedFit: { slope: number; intercept: number }
  concededEndpointSlope: number
  concededWeightedFit: { slope: number; intercept: number }
  gate: FalsificationGateResult
  cleanSheetGate: CleanSheetGateResult
  materiallyFlatter: boolean
  skippedNoOpponentRecord: number
}

function fmt4(n: number): string {
  return n.toFixed(4)
}

function generateReportMarkdown(data: ReportData): string {
  const totalN = data.scoredBuckets.reduce((sum, b) => sum + b.n, 0)
  const lines: string[] = []
  lines.push(`# Fixture slope report — ${data.generatedAt.toISOString()}`)
  lines.push('')
  lines.push(`Ticket #244. Season ${SEASON}. Data source: FPL-Core-Insights public CSVs (no Supabase). Gameweeks fetched: ${data.population.gameweeksFetched.length} (${data.population.gameweeksFetched.join(', ')}); missing: ${data.population.gameweeksMissing.length > 0 ? data.population.gameweeksMissing.join(', ') : 'none'}.`)
  lines.push(`Total playermatchstats.csv rows read: ${data.population.totalCsvRowsRead}. Non-Premier-League rows excluded: ${data.population.nonPremRowsExcluded}. Team-match records with no resolvable opponent record (skipped): ${data.skippedNoOpponentRecord}.`)
  lines.push(`\`TEAM_STRENGTH_SHRINKAGE_K = 0\` on this path (season-length evidence — see this script's own file header). No home-advantage term (matches the regime #184's own measurement was made against).`)
  lines.push('')

  lines.push('## Falsification gate')
  lines.push('')
  lines.push(`1. **Population size**: n = ${data.gate.populationGate.n} resolvable team-matches (minimum ${data.gate.populationGate.min}). **${data.gate.populationGate.passed ? 'PASS' : 'FAIL'}**.`)
  lines.push(
    `2. **Goals-SCORED reproduction of #184's published table** (tolerance ±${data.gate.reproductionGate.tolerance} goals per bucket). Deltas (this report − #184 published): ${data.gate.reproductionGate.deltas.map((d) => d.toFixed(3)).join(', ')}. **${data.gate.reproductionGate.passed ? 'PASS' : 'FAIL — STOP, the harness does not reproduce the published measurement'}**.`,
  )
  lines.push('')
  lines.push(
    `Note: this report's total n (${totalN}) is larger than #184's own published n=698. The difference is the four extreme buckets' n matching #184's published counts EXACTLY (123/138/…/138/123) while the middle bucket (0.45–0.55) carries 60 more rows here. Those 60 are early-season (GW1–3) team-match perspectives where one side had fewer than MIN_TEAM_PRIOR_MATCHES (3) resolvable prior matches — computeFixtureExpectedScore's own built-in neutral fallback (expectedScore = 0.5, reused UNMODIFIED per the ticket text) puts them in the middle bucket rather than excluding them from the population. #184's own reconstruction appears to have excluded them instead. Kept in, not excluded, here: the ticket's own falsification gate checks bucket MEANS against #184's published table, not bucket n, and the means reproduce to within 0.002 regardless (gate 2 above) — excluding them would depart from "reuse computeFixtureExpectedScore ... unmodified" for no falsification-gate benefit.`,
  )
  lines.push('')

  lines.push('## Goals SCORED — reproduction of #184\'s table')
  lines.push('')
  lines.push('Model column reproduces #184\'s own published table exactly (`leagueBaselineGoals × 2 × es` — the PRE-#182 formula #184\'s own table compared against, not the current, already-damped `attackingMultiplier`):')
  lines.push('')
  lines.push(bucketTableMarkdown(data.scoredBuckets, (b) => LEAGUE_BASELINE_GOALS_PER_TEAM * 2 * b.meanExpectedScore, 'model (1.45×2×es)', 'scored'))
  lines.push('')
  lines.push(`Endpoint slope: ${fmt3(data.scoredEndpointSlope)}. Weighted least-squares slope: ${fmt3(data.scoredWeightedFit.slope)} (intercept ${fmt3(data.scoredWeightedFit.intercept)}). #184's own published figures: ≈1.43 (endpoint), ≈1.50 (weighted).`)
  lines.push('')

  lines.push('## Goals CONCEDED — the new measurement')
  lines.push('')
  // Deliberately NOT calling fixture.ts's own expectedGoalsConceded() here.
  // On a branch where this ticket's own fixture.ts change has already
  // landed (true for every run after the first commit on this branch),
  // that function returns the NEW, damped prediction -- which would make
  // this "what the model being evaluated predicted" column silently track
  // itself rather than the PRE-#244 baseline the whole report exists to
  // compare against. cleanSheetLambdaOld's own literal reproduction of
  // `leagueBaselineGoals * 2 * (1 - es)` below is the same pattern, for the
  // same reason -- see its own comment.
  lines.push('Model column is the PRE-#244 baseline formula (`leagueBaselineGoals × 2 × (1 − es)`) -- reproduced literally here, never called from fixture.ts, so this table is stable regardless of whether the damped formula has already landed on this branch:')
  lines.push('')
  lines.push(bucketTableMarkdown(data.concededBuckets, (b) => cleanSheetLambdaOld(LEAGUE_BASELINE_GOALS_PER_TEAM, b.meanExpectedScore), 'model (1.45×2×(1−es))', 'conceded'))
  lines.push('')
  lines.push(`Endpoint slope: ${fmt3(data.concededEndpointSlope)}. Weighted least-squares slope: ${fmt3(data.concededWeightedFit.slope)} (intercept ${fmt3(data.concededWeightedFit.intercept)}).`)
  lines.push(`Model-implied slope: ${MODEL_IMPLIED_CONCEDED_SLOPE} (= −leagueBaselineGoals × 2). Materiality band: ±${MATERIALITY_BAND_FRACTION * 100}% = [${(MODEL_IMPLIED_CONCEDED_SLOPE * (1 + MATERIALITY_BAND_FRACTION)).toFixed(3)}, ${(MODEL_IMPLIED_CONCEDED_SLOPE * (1 - MATERIALITY_BAND_FRACTION)).toFixed(3)}].`)
  lines.push('')

  lines.push('## Slope verdict')
  lines.push('')
  lines.push(
    data.materiallyFlatter
      ? `The measured conceded slope (endpoint ${fmt3(data.concededEndpointSlope)}) is **materially flatter** than the model-implied ${MODEL_IMPLIED_CONCEDED_SLOPE} — outside the ±15% band. \`fixture.ts\` is damped to match (see the PR diff and \`DEFENSIVE_MULTIPLIER_OFFSET\`'s own doc comment for the fitted value and full derivation).`
      : `The measured conceded slope (endpoint ${fmt3(data.concededEndpointSlope)}) is **within ±15%** of the model-implied ${MODEL_IMPLIED_CONCEDED_SLOPE}. No change to \`fixture.ts\` — the asymmetry between attack and defence is real, not a modelling error.`,
  )
  lines.push(`Total n across both tables (from the same run): ${totalN}.`)
  lines.push('')

  lines.push('## Clean-sheet probability check (gate 3)')
  lines.push('')
  lines.push(
    'Replaces the original gate 3 (a live Supabase calibration-report.ts before/after, which a Builder session cannot run — see `LEARNINGS-second-build-wave.md` §20). Computed entirely from the SAME measured rows above: per bucket, the ACTUAL observed clean-sheet rate against the OLD formula\'s implied `exp(-lambda_old)` and this ticket\'s NEW damped formula\'s `exp(-lambda_new)` — both pooled directly over the bucket\'s own team-matches, never a mean-of-means.',
  )
  lines.push('')
  lines.push('| es bucket | n | ACTUAL CS rate | OLD predicted (exp(−λ), λ=b×2×(1−es)) | NEW predicted (exp(−λ), λ=b×(1.5−es)) |')
  lines.push('|---|---|---|---|---|')
  for (const b of data.cleanSheetGate.buckets) {
    lines.push(`| ${b.label} | ${b.n} | ${fmt4(b.actualCleanSheetRate)} | ${fmt4(b.oldPredictedCleanSheetRate)} | ${fmt4(b.newPredictedCleanSheetRate)} |`)
  }
  lines.push('')
  lines.push(`Mean absolute error vs ACTUAL, unweighted mean of the 5 per-bucket \`|predicted - actual|\` values: OLD = ${fmt4(data.cleanSheetGate.oldMae)}, NEW = ${fmt4(data.cleanSheetGate.newMae)}.`)
  lines.push('')
  lines.push(
    data.cleanSheetGate.passed
      ? `**PASS** — NEW's MAE (${fmt4(data.cleanSheetGate.newMae)}) is lower than OLD's (${fmt4(data.cleanSheetGate.oldMae)}). The damped formula tracks the real clean-sheet rate better than the pre-#244 formula did; the non-linearity risk \`pCleanSheet = exp(-lambda)\` raised did not materialize.`
      : `**STOP** — NEW's MAE (${fmt4(data.cleanSheetGate.newMae)}) is NOT lower than OLD's (${fmt4(data.cleanSheetGate.oldMae)}). The linear slope fit on goals conceded improved that figure while making the clean-sheet probability worse — the damping should NOT ship as-is.`,
  )

  return lines.join('\n')
}

// ============================================================================
// main()
// ============================================================================

async function main(): Promise<void> {
  const reportPath = process.env.FIXTURE_SLOPE_REPORT_PATH ?? DEFAULT_REPORT_PATH
  console.log(`${JOB_NAME}: fetching ${SEASON} data from FPL-Core-Insights…`)
  const population = await fetchPopulation()
  console.log(`${JOB_NAME}: ${population.matchStatsRows.length} Premier League match-stat rows read across ${population.gameweeksFetched.length} gameweeks.`)

  const records = buildTeamMatchRecords(population.matchStatsRows)
  console.log(`${JOB_NAME}: ${records.length} resolvable team-match records built.`)

  const { rows, skippedNoOpponentRecord } = buildMeasuredRows(records)

  // One bucketing pass -- each BucketStats row already carries both the mean
  // actual goals SCORED and the mean actual goals CONCEDED for that bucket
  // (both measured from the SAME rows, the same run -- ticket text: "Two
  // slopes measured by one method on one population"). The scored and
  // conceded "tables" in the report are two different READS of this one
  // array, never two separate computations.
  const buckets = bucketRows(rows)

  const scoredEndpointSlope = endpointSlope(buckets, (b) => b.meanActualGoalsScored)
  const scoredWeightedFit = weightedFitFor(buckets, (b) => b.meanActualGoalsScored)
  const concededEndpointSlope = endpointSlope(buckets, (b) => b.meanActualGoalsConceded)
  const concededWeightedFit = weightedFitFor(buckets, (b) => b.meanActualGoalsConceded)

  const totalN = rows.length
  const gate = checkFalsificationGate(totalN, buckets)
  const materiallyFlatter = isMateriallyFlatterThanModel(concededEndpointSlope)
  const cleanSheetGate = checkCleanSheetGate(rows, LEAGUE_BASELINE_GOALS_PER_TEAM)

  const reportData: ReportData = {
    generatedAt: new Date(),
    population,
    scoredBuckets: buckets,
    concededBuckets: buckets,
    scoredEndpointSlope,
    scoredWeightedFit,
    concededEndpointSlope,
    concededWeightedFit,
    gate,
    cleanSheetGate,
    materiallyFlatter,
    skippedNoOpponentRecord,
  }
  const reportMarkdown = generateReportMarkdown(reportData)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, reportMarkdown, 'utf8')

  console.log(reportMarkdown)
  console.log('')
  console.log(`${JOB_NAME}: report written to ${reportPath}.`)

  if (!gate.populationGate.passed || !gate.reproductionGate.passed) {
    console.error(`${JOB_NAME}: falsification gate FAILED. See report above.`)
    process.exit(1)
  }
  if (!cleanSheetGate.passed) {
    console.error(
      `${JOB_NAME}: clean-sheet gate 3 FAILED -- NEW MAE (${cleanSheetGate.newMae.toFixed(4)}) is not lower than OLD MAE (${cleanSheetGate.oldMae.toFixed(4)}). The damping should NOT ship as-is. See report above.`,
    )
    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g.
// from a test) never triggers a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
