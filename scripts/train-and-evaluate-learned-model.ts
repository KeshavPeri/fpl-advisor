// Learned model, second slice — ticket #208 (R6, feature-list items 30/31
// reshaped). Trains a small model on ticket #203's `training_features`
// substrate (18,023 rows for 2025-2026) and reads it against the
// pre-registered gate from docs/model-review-2026-09-02.md's question 4 and
// docs/projection-model-backlog.md's G15 entry.
//
// ============================================================================
// SHIPS NOTHING USER-VISIBLE.
// ============================================================================
// No projection is written, no player_projections row gains a new
// model_version, no CSV changes, no recommendation moves. This is a
// measurement job — it reads training_features and player_match_stats,
// fits a model, evaluates it, and reports a table plus a pass/fail verdict.
// Its only Supabase write is one job_runs row.
//
// ============================================================================
// THE GATE — pre-registered, restated here so a reader never has to
// cross-reference docs/projection-model-backlog.md's G15 entry to know why
// these four numbers.
// ============================================================================
// Measured on the five-gameweek ranking target, over the same measured
// population and exclusions scripts/run-backtest.ts already uses, per
// position:
//   Midfielder | must beat 0.464 — the naive "prior minutes per match" baseline (report 10, FIXED, never recomputed from this run)
//   Forward    | must beat 0.476 — same baseline, FIXED
//   Goalkeeper | must beat the INCUMBENT's own figure, computed fresh in this same run
//   Defender   | must beat the INCUMBENT's own figure, computed fresh in this same run
// The MID/FWD gate is the naive baseline, not the hand-built baseline-v1
// model, because report 10 already showed the naive baseline beating
// baseline-v1 at those two positions — that gate would pass a model with no
// real skill. GK/DEF use the incumbent because report 10 showed baseline-v1
// beating the naive baseline there; a learned model has to clear the bar
// that already exists, not a weaker one.
//
// ============================================================================
// THE INCUMBENT IS COMPUTED LIVE, NEVER QUOTED FROM A PAST REPORT.
// ============================================================================
// A sibling ticket (#207) reverts src/lib/projection/minutes.ts on its own
// branch in this same batch — that changes every incumbent number once
// merged. This job never assumes a merge order: it imports
// src/lib/projection/ dynamically (via scripts/run-backtest.ts's own
// projectRow) and computes the incumbent's baseline-v1 figures fresh, every
// run, from whatever those modules contain on the branch/commit actually
// checked out. The report and job_runs details both record the checked-out
// git commit SHA (see `readGitCommitSha` below) precisely so a reader can
// tell, after the fact, whether a given run's incumbent numbers reflect
// #207's revert or not — never guessed, always checkable.
//
// ============================================================================
// REUSE, NEVER REIMPLEMENT (this ticket's own DoD, grep-checkable).
// ============================================================================
// This file defines NO Spearman correlation, NO rank function, and NO
// five-gameweek window classifier of its own. Every ranking figure below is
// produced by summarizeGenericBaselineSpearman / summarizeBaselines /
// summarizeFiveGameweekBaselines / computeGenericConstantBaselineSpearman,
// all imported from scripts/run-backtest.ts, never edited by this ticket.
// The five-gameweek population is built by literally calling that file's own
// classifyFiveGameweekRow for every candidate window — this job supplies a
// SECOND model's predictions (the learned model's) for the exact same
// windows that function already proved are safe to measure; it does not
// re-derive which windows those are.
//
// ============================================================================
// THE MODEL — small, inspectable, no new dependency.
// ============================================================================
// Gradient-boosted regression trees over FEATURE_NAMES (15 columns), hand
// written below (buildRegressionTree / fitGradientBoostingModel) rather than
// pulled from an ML package: this ticket's own scope constraint is "one new
// script ... under scripts/. Nothing else" (no package.json edit), and the
// ticket text itself asks for "gradient boosting on ~15 columns, not a
// neural network" — small enough that a from-scratch implementation is both
// safer (no new npm dependency, no Tier 2 "framework choice" to justify) and
// more inspectable than importing one. See DEFAULT_GBM_HYPERPARAMETERS for
// the exact numbers and the "because" for each.
//
// ============================================================================
// THE SPLIT — gameweek-block, not row-random, and it is the thing under
// test.
// ============================================================================
// TRAIN_EVAL_GAMEWEEK_CUTOFF partitions every row by its OWN gameweek_id: a
// row belongs to the training fold iff gameweekId <= cutoff. This is a
// temporal split, not a random one, because the DoD requires proving no
// gameweek the model is SCORED on ever contributed to FITTING it — a random
// row-level split could not make that claim, since a five-gameweek window's
// legs would then span both folds unpredictably. See splitByGameweekCutoff's
// own tests, and the "no lookahead into the evaluation set" describe block
// in this file's test file — the single most important test this ticket
// adds.
//
// ============================================================================
// NO TUNING AGAINST THE GATE.
// ============================================================================
// The hyperparameters, the split cutoff and the feature list are all fixed
// BEFORE this file's own main() ever reads a row of real data — they are
// module-level constants, not env-configurable, so there is no dial to turn
// after seeing a disappointing number. Fit once on the training fold,
// evaluate once on the held-out fold, report whatever comes out. If the gate
// fails, this job says so plainly (see buildReportMarkdown's gate section)
// and does not retry with different numbers.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads SUPABASE_URL and SUPABASE_SECRET_KEY. Season is LEARNED_MODEL_SEASON,
// trimmed, falling back to DEFAULT_SEASON — its own env var name, matching
// every sibling job's "not shared" convention (CLAUDE.md). Writes to no
// table but job_runs (one row). Writes one report file to
// LEARNED_MODEL_REPORT_PATH (default ./out/learned-model-report.md). NOT
// wired into any workflow — run by hand, like scripts/build-training-features.ts
// and the first Backtest runs before their own workflow existed.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fetchAllPages, assertRowCountMatches } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { Position } from '../src/lib/scoring/types.ts'
import { GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD } from '../src/lib/scoring/types.ts'
import type { TrainingFeatureRow } from './build-training-features.ts'
import {
  type FeatureHistoryRow,
  type PositionPrior,
  type TeamMatchRecord,
  type ActualSourceRow,
  type MeasuredRow,
  type ExclusionReason,
  type FiveGameweekRow,
  type GenericRankingRow,
  type BaselineSummary,
  resolveRowPosition,
  computePositionPriors,
  fallbackPositionPrior,
  buildTeamMatchRecords,
  buildClubFixtureSchedule,
  lookupClubFixtureSchedule,
  computeTeamStrengthAsOf,
  resolveFixtureTeams,
  computeFixtureExpectedScore,
  SCALE,
  classifyRow,
  toActualMatchStatsInput,
  buildMeasuredRow,
  computeBaselineMinutesPerMatch,
  computeBaselineXgXaPerMatch,
  projectRow,
  sumComponentTotals,
  pickProjectedComponents,
  emptyExclusionCounts,
  incrementExclusion,
  assertReconciles,
  buildFeatureHistoryIndex,
  computeLastGameweekInData,
  buildFiveGameweekWindow,
  classifyFiveGameweekRow,
  emptyFiveGameweekExclusionCounts,
  incrementFiveGameweekExclusion,
  assertFiveGameweekReconciles,
  summarizeGenericBaselineSpearman,
  computeGenericConstantBaselineSpearman,
  summarizeBaselines,
  summarizeFiveGameweekBaselines,
} from './run-backtest.ts'

const JOB_NAME = 'train-and-evaluate-learned-model'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const TRAINING_FEATURES_MIGRATION = 'supabase/migrations/20260904090000_training_features.sql'

/** This job's own default — its own env var name (LEARNED_MODEL_SEASON), never shared with FEATURE_HISTORY_SEASON/BACKTEST_SEASON/TRAINING_FEATURES_SEASON (CLAUDE.md convention). */
export const DEFAULT_SEASON = '2025-2026'

const DEFAULT_REPORT_PATH = './out/learned-model-report.md'

/**
 * The train/eval split — a GAMEWEEK cutoff, not a row-random split (see file
 * header, "THE SPLIT"). A row with gameweekId <= this value is training
 * data; every other row is held out. 28 of the season's 38 gameweeks
 * (~74%) for training, leaving gameweeks 29-38 (10 gameweeks) for
 * evaluation — enough single-gameweek eval rows to comfortably clear
 * MIN_BUCKET_SAMPLE_SIZE (50) per position, and enough five-gameweek window
 * starts (29..34, since a window starting later than 34 would reach past
 * gameweek 38) to read a five-gameweek figure at all. Fixed before this file
 * ever reads a row of real data — see file header, "NO TUNING AGAINST THE
 * GATE".
 */
export const TRAIN_EVAL_GAMEWEEK_CUTOFF = 28

/**
 * The two FIXED gate thresholds (docs/projection-model-backlog.md G15,
 * docs/model-review-2026-09-02.md question 4) — report 10's own naive
 * "prior minutes per match" baseline at the five-gameweek horizon, full
 * season. These do NOT get recomputed from this run's own (necessarily
 * smaller, held-out-only) population — the ticket's gate table states them
 * as fixed numbers to beat, not "beat whatever this run's naive baseline
 * happens to read on a 10-gameweek slice". See buildGateResults.
 */
export const GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN = 0.464
export const GATE_FORWARD_NAIVE_BASELINE_SPEARMAN = 0.476

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  [GOALKEEPER]: 'Goalkeeper',
  [DEFENDER]: 'Defender',
  [MIDFIELDER]: 'Midfielder',
  [FORWARD]: 'Forward',
}

/**
 * Mirrors scripts/run-backtest.ts's own module-private `positionPriorKey`
 * exactly (same `${gameweekId}:${position}` format) — that function is not
 * exported, and `computePositionPriors`'s returned Map is keyed by it, so
 * this file needs its own copy to look values back out. A one-line string
 * template, not a metric or a rank function; duplicating it is the CLAUDE.md
 * "reasonable for a four-line helper" case, not the "second copy of a moving
 * rule" case that file's own header warns against.
 */
function positionPriorKey(gameweekId: number, position: Position): string {
  return `${gameweekId}:${position}`
}

// ============================================================================
// Env, matching every scripts/*.ts job's own convention exactly.
// ============================================================================

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')
  if (missing.length > 0) {
    console.error(`${JOB_NAME}: required environment variables are not set (missing: ${missing.join(', ')}). Making no network call.`)
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

function readSeason(): string {
  return (process.env.LEARNED_MODEL_SEASON ?? '').trim() || DEFAULT_SEASON
}

function readReportPath(): string {
  return (process.env.LEARNED_MODEL_REPORT_PATH ?? '').trim() || DEFAULT_REPORT_PATH
}

/**
 * The checked-out git commit SHA, so a reader of the report can tell whether
 * this run's incumbent numbers reflect ticket #207's minutes.ts revert
 * without having to re-derive it (see file header, "THE INCUMBENT IS
 * COMPUTED LIVE"). Returns 'unknown' rather than throwing if git is
 * unavailable — this is a diagnostic label, never something the job's
 * correctness depends on.
 */
function readGitCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

class LearnedModelError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'LearnedModelError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure'
  message: string
  details: JsonRecord | null
  startedAt: Date
}

async function recordJobRun(supabase: SupabaseClient, input: JobRunInput): Promise<void> {
  const finishedAt = new Date()
  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: input.status,
    message: input.message,
    details: input.details,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })
  if (error) {
    if (isMissingTable(error, 'job_runs')) {
      console.error(`${JOB_NAME}: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure computation — regression trees / gradient boosting. No I/O below this
// point in the whole file; every case here is testable on constructed rows
// with no live database. See train-and-evaluate-learned-model.test.ts.
// ============================================================================

interface LeafNode {
  kind: 'leaf'
  value: number
}

interface SplitNode {
  kind: 'split'
  featureIndex: number
  threshold: number
  left: TreeNode
  right: TreeNode
}

export type TreeNode = LeafNode | SplitNode

export interface RegressionTreeHyperparameters {
  maxDepth: number
  minSamplesLeaf: number
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/** Walks a tree to its leaf for one feature vector — the only place a TreeNode's shape is interpreted. */
export function predictWithTree(node: TreeNode, features: readonly number[]): number {
  let current = node
  while (current.kind === 'split') {
    current = features[current.featureIndex] <= current.threshold ? current.left : current.right
  }
  return current.value
}

/**
 * Greedy CART regression tree, squared-error loss, deterministic (no
 * randomness — same input always produces the same tree, which is what
 * makes the leakage test in this file's test suite meaningful: a
 * differently-seeded run could not be compared to itself). For every
 * feature, sorts the node's own indices by that feature's value once, then
 * scans split points left-to-right with running sums of y and y^2 so the SSE
 * of every candidate split is O(1) once the sums are updated — O(n log n)
 * per feature per node, not the O(n^2) a naive re-scan would cost. Stops
 * when `maxDepth` is reached, when a node has fewer than
 * `2 * minSamplesLeaf` rows (no split could satisfy the leaf-size floor on
 * both sides), or when no feature has any candidate split that respects
 * `minSamplesLeaf` on both sides — in every stopping case, returns a leaf at
 * the mean of the node's own targets.
 */
export function buildRegressionTree(
  featureMatrix: readonly (readonly number[])[],
  targets: readonly number[],
  indices: readonly number[],
  depth: number,
  hyperparameters: RegressionTreeHyperparameters,
): TreeNode {
  const leafValue = meanOf(indices.map((i) => targets[i]))
  if (depth >= hyperparameters.maxDepth || indices.length < 2 * hyperparameters.minSamplesLeaf) {
    return { kind: 'leaf', value: leafValue }
  }

  const numFeatures = featureMatrix[0]?.length ?? 0
  let bestSse = Infinity
  let bestFeatureIndex = -1
  let bestThreshold = 0
  let bestLeft: number[] = []
  let bestRight: number[] = []

  for (let featureIndex = 0; featureIndex < numFeatures; featureIndex++) {
    const sorted = [...indices].sort((a, b) => featureMatrix[a][featureIndex] - featureMatrix[b][featureIndex])
    const n = sorted.length

    let sumTotal = 0
    let sumSqTotal = 0
    for (const i of sorted) {
      sumTotal += targets[i]
      sumSqTotal += targets[i] * targets[i]
    }

    let sumLeft = 0
    let sumSqLeft = 0
    for (let splitPos = 1; splitPos < n; splitPos++) {
      const justMovedIndex = sorted[splitPos - 1]
      sumLeft += targets[justMovedIndex]
      sumSqLeft += targets[justMovedIndex] * targets[justMovedIndex]

      const leftCount = splitPos
      const rightCount = n - splitPos
      if (leftCount < hyperparameters.minSamplesLeaf || rightCount < hyperparameters.minSamplesLeaf) continue

      const leftValue = featureMatrix[sorted[splitPos - 1]][featureIndex]
      const rightValue = featureMatrix[sorted[splitPos]][featureIndex]
      if (leftValue === rightValue) continue // no real threshold between two equal values

      const sseLeft = sumSqLeft - (sumLeft * sumLeft) / leftCount
      const sumRight = sumTotal - sumLeft
      const sumSqRight = sumSqTotal - sumSqLeft
      const sseRight = sumSqRight - (sumRight * sumRight) / rightCount
      const sse = sseLeft + sseRight

      if (sse < bestSse) {
        bestSse = sse
        bestFeatureIndex = featureIndex
        bestThreshold = (leftValue + rightValue) / 2
        bestLeft = sorted.slice(0, splitPos)
        bestRight = sorted.slice(splitPos)
      }
    }
  }

  if (bestFeatureIndex === -1) {
    return { kind: 'leaf', value: leafValue }
  }

  return {
    kind: 'split',
    featureIndex: bestFeatureIndex,
    threshold: bestThreshold,
    left: buildRegressionTree(featureMatrix, targets, bestLeft, depth + 1, hyperparameters),
    right: buildRegressionTree(featureMatrix, targets, bestRight, depth + 1, hyperparameters),
  }
}

export interface GbmHyperparameters {
  numTrees: number
  maxDepth: number
  learningRate: number
  minSamplesLeaf: number
}

/**
 * Fixed before this file ever reads a row of real data (file header, "NO
 * TUNING AGAINST THE GATE"). Because, term by term:
 *  - numTrees=60, learningRate=0.08: a conservative, slow-learning boosting
 *    schedule — favours not overfitting the ~7,000-row training fold over
 *    squeezing out training-set MAE, appropriate when the eval read happens
 *    exactly once.
 *  - maxDepth=3: enough to let the FIRST split isolate goalkeepers from
 *    outfield players (elementType) and still leave two more splits for a
 *    real interaction per position-branch, while staying small enough to
 *    read a whole tree by eye — "keep it small and inspectable" (ticket
 *    text).
 *  - minSamplesLeaf=40: comfortably above MIN_BUCKET_SAMPLE_SIZE/2, so a
 *    leaf's mean is never based on a handful of rows, given a training fold
 *    on the order of several thousand rows.
 */
export const DEFAULT_GBM_HYPERPARAMETERS: GbmHyperparameters = {
  numTrees: 60,
  maxDepth: 3,
  learningRate: 0.08,
  minSamplesLeaf: 40,
}

export interface GbmModel {
  initialPrediction: number
  learningRate: number
  trees: readonly TreeNode[]
}

/**
 * Fits a gradient-boosted regression-tree ensemble to `(featureMatrix,
 * targets)` — starts at the mean of `targets`, then repeatedly fits a
 * shallow tree to the CURRENT residuals and adds `learningRate` times that
 * tree's prediction to every row's running total. Deterministic: no random
 * feature/row subsampling, so the same inputs always produce the same
 * model — see this file's own leakage test, which depends on that.
 */
export function fitGradientBoostingModel(
  featureMatrix: readonly (readonly number[])[],
  targets: readonly number[],
  hyperparameters: GbmHyperparameters = DEFAULT_GBM_HYPERPARAMETERS,
): GbmModel {
  if (featureMatrix.length !== targets.length) {
    throw new LearnedModelError(
      `fitGradientBoostingModel: featureMatrix has ${featureMatrix.length} row(s) but targets has ${targets.length} — must match exactly.`,
      'model',
    )
  }
  const initialPrediction = meanOf(targets)
  const predictions = targets.map(() => initialPrediction)
  const allIndices = targets.map((_, i) => i)
  const trees: TreeNode[] = []

  for (let t = 0; t < hyperparameters.numTrees; t++) {
    const residuals = targets.map((y, i) => y - predictions[i])
    const tree = buildRegressionTree(featureMatrix, residuals, allIndices, 0, {
      maxDepth: hyperparameters.maxDepth,
      minSamplesLeaf: hyperparameters.minSamplesLeaf,
    })
    trees.push(tree)
    for (let i = 0; i < predictions.length; i++) {
      predictions[i] += hyperparameters.learningRate * predictWithTree(tree, featureMatrix[i])
    }
  }

  return { initialPrediction, learningRate: hyperparameters.learningRate, trees }
}

export function predictWithGbm(model: GbmModel, features: readonly number[]): number {
  let total = model.initialPrediction
  for (const tree of model.trees) total += model.learningRate * predictWithTree(tree, features)
  return total
}

// ============================================================================
// Pure computation — the train/eval split. THE MOST IMPORTANT FUNCTION IN
// THIS TICKET (ticket text: "a named test proving no gameweek in the
// evaluation set contributed to fitting"). See this file's own test suite,
// "train/eval split — no lookahead into the evaluation set".
// ============================================================================

export interface GameweekKeyed {
  gameweekId: number
}

/**
 * Partitions `rows` by their OWN `gameweekId` against `cutoff` — never a
 * random sample, never shuffled. A row with `gameweekId <= cutoff` is
 * training data; every other row is held out. The partition is total and
 * disjoint by construction (every row goes to exactly one side), which this
 * file's tests assert directly rather than trusting the implication.
 */
export function splitByGameweekCutoff<T extends GameweekKeyed>(rows: readonly T[], cutoff: number): { trainRows: T[]; evalRows: T[] } {
  const trainRows: T[] = []
  const evalRows: T[] = []
  for (const row of rows) {
    if (row.gameweekId <= cutoff) trainRows.push(row)
    else evalRows.push(row)
  }
  return { trainRows, evalRows }
}

// ============================================================================
// Pure computation — feature-vector construction from public.training_features
// (+ a second, live team-strength lookup for the OPPONENT, which
// training_features deliberately does not store — see that table's own
// migration header, "the OPPONENT's own team-strength figures are not
// stored on this row ... left to whichever ticket actually trains a
// model").
// ============================================================================

/**
 * Fixed column order, ~15 columns (ticket text: "gradient boosting on ~15
 * columns"). This exact order is what `buildLearnedFeatureVector` returns
 * and what every tree's `featureIndex` refers to — kept as a named export so
 * a reader inspecting a fitted model's splits can look up which real-world
 * quantity `featureIndex: 3` means, without re-deriving it from this file's
 * body.
 */
export const FEATURE_NAMES = [
  'elementType', // FPL position code, 1-4 — lets one pooled model separate GK/DEF/MID/FWD regimes at the root split.
  'priorMatches', // evidence volume this season — docs/projection-model-backlog.md's G10 cold-start bucketing, as a feature rather than a bucket boundary.
  'xgRatePer90', // unshrunk expected goals per 90 — training_features.xg_rate_per90, imputed 0 when null.
  'xaRatePer90', // unshrunk expected assists per 90 — training_features.xa_rate_per90, imputed 0 when null.
  'recentMinutesAvg', // mean of the last-five-match window (training_features.prior_recent_minutes), falling back to the season average when the window is empty/absent.
  'seasonAvgMinutes', // training_features.season_avg_minutes — docs/model-review-2026-09-02.md 1f found this BEATS the 5-match window for midfielders at the 5-GW horizon; the model gets to see both and find its own blend.
  'shotsOnTargetPerMatch', // training_features.prior_shots_on_target / prior_matches — a volume-of-chances proxy independent of finishing variance.
  'defconHitRate', // prior_defcon_hits / prior_defcon_qualifying_matches, 0 when there is no qualifying match yet.
  'defconQualifyingMatches', // evidence volume behind defconHitRate, so the model can weight a thin defcon sample differently from a deep one.
  'teamGoalsScoredPerMatch', // the player's own club's point-in-time attacking rate (training_features.team_strength_goals_scored / team_strength_matches).
  'teamGoalsConcededPerMatch', // the player's own club's point-in-time defensive rate.
  'teamStrengthMatches', // evidence volume behind both team rates above (0 early in a season).
  'opponentGoalsScoredPerMatch', // this gameweek's scheduled opponent(s)' point-in-time attacking rate, computed live via computeTeamStrengthAsOf (never stored on training_features — see that table's own migration header).
  'opponentGoalsConcededPerMatch', // scheduled opponent(s)' point-in-time defensive rate.
  'fixtureCount', // how many fixtures this gameweek — 0 (blank), 1, or 2 (a double gameweek).
] as const

/** The subset of TrainingFeatureRow (or a five-gameweek leg's stand-in for it — see predictLearnedFiveGameweekTotal) buildLearnedFeatureVector actually reads. */
export type FeatureVectorInput = Pick<
  TrainingFeatureRow,
  | 'prior_matches'
  | 'xg_rate_per90'
  | 'xa_rate_per90'
  | 'prior_recent_minutes'
  | 'season_avg_minutes'
  | 'prior_shots_on_target'
  | 'prior_defcon_qualifying_matches'
  | 'prior_defcon_hits'
  | 'team_strength_matches'
  | 'team_strength_goals_scored'
  | 'team_strength_goals_conceded'
>

/**
 * Builds one FEATURE_NAMES-ordered vector. `legOpponentTeamCodes` and
 * `featureGameweekId` are separate parameters, never read off `row` itself,
 * so the SAME function serves both the single-gameweek case (call with
 * `row.opponent_team_codes` and `row.gameweek_id`) and a five-gameweek
 * window's later legs (call with THAT leg's own scheduled opponents from
 * `lookupClubFixtureSchedule`, but the WINDOW START's `gameweek_id` as
 * `featureGameweekId` — see predictLearnedFiveGameweekTotal's own comment
 * for why every other input stays pinned at the window start, mirroring
 * ticket #193/G13's fix to scripts/run-backtest.ts's own
 * projectAndReconstructWindowGameweek).
 *
 * Every ratio guards its own zero denominator (0, never NaN or a divide
 * error) — a genuine "no evidence yet" case, matching how
 * scripts/build-training-features.ts's own computeRatePer90/
 * computeSeasonAvgMinutes already treat the identical situation on the
 * table this reads.
 */
export function buildLearnedFeatureVector(
  row: FeatureVectorInput,
  position: Position,
  legOpponentTeamCodes: readonly (number | null)[],
  teamMatchRecords: readonly TeamMatchRecord[],
  featureGameweekId: number,
): number[] {
  const recentMinutesAvg =
    row.prior_recent_minutes !== null && row.prior_recent_minutes.length > 0
      ? row.prior_recent_minutes.reduce((sum, m) => sum + m, 0) / row.prior_recent_minutes.length
      : (row.season_avg_minutes ?? 0)

  const shotsOnTargetPerMatch = row.prior_matches > 0 ? row.prior_shots_on_target / row.prior_matches : 0

  const defconQualifyingMatches = row.prior_defcon_qualifying_matches ?? 0
  const defconHitRate = defconQualifyingMatches > 0 ? (row.prior_defcon_hits ?? 0) / defconQualifyingMatches : 0

  const teamStrengthMatches = row.team_strength_matches
  const teamGoalsScoredPerMatch = teamStrengthMatches > 0 ? row.team_strength_goals_scored / teamStrengthMatches : 0
  const teamGoalsConcededPerMatch = teamStrengthMatches > 0 ? row.team_strength_goals_conceded / teamStrengthMatches : 0

  const resolvedOpponents = legOpponentTeamCodes.filter((code): code is number => code !== null)
  const opponentStrengths = resolvedOpponents.map((code) => computeTeamStrengthAsOf(teamMatchRecords, code, featureGameweekId))
  const opponentMatchesTotal = opponentStrengths.reduce((sum, s) => sum + s.matches, 0)
  const opponentGoalsScoredTotal = opponentStrengths.reduce((sum, s) => sum + s.goalsScored, 0)
  const opponentGoalsConcededTotal = opponentStrengths.reduce((sum, s) => sum + s.goalsConceded, 0)
  const opponentGoalsScoredPerMatch = opponentMatchesTotal > 0 ? opponentGoalsScoredTotal / opponentMatchesTotal : 0
  const opponentGoalsConcededPerMatch = opponentMatchesTotal > 0 ? opponentGoalsConcededTotal / opponentMatchesTotal : 0

  return [
    position,
    row.prior_matches,
    row.xg_rate_per90 ?? 0,
    row.xa_rate_per90 ?? 0,
    recentMinutesAvg,
    row.season_avg_minutes ?? 0,
    shotsOnTargetPerMatch,
    defconHitRate,
    defconQualifyingMatches,
    teamGoalsScoredPerMatch,
    teamGoalsConcededPerMatch,
    teamStrengthMatches,
    opponentGoalsScoredPerMatch,
    opponentGoalsConcededPerMatch,
    legOpponentTeamCodes.length,
  ]
}

/**
 * The learned model's own five-gameweek total for one window — the SAME
 * discipline scripts/run-backtest.ts's projectAndReconstructWindowGameweek
 * uses for the incumbent (ticket #193/G13's fix), reapplied to a second
 * model: every point-in-time FORM input (xg/xa rates, minutes structure,
 * defcon, the player's OWN team strength) is read ONCE, from `rowAtG` — the
 * training_features row at the window's START gameweek G — and reused
 * unchanged for all five legs. Only the fixture identity (opponent
 * codes/count) varies leg by leg, drawn from the PUBLISHED schedule at each
 * leg's own gameweek (`clubFixtureSchedule`, via `lookupClubFixtureSchedule`
 * for legs G+1..G+4; `rowAtG.opponent_team_codes` — already the schedule AT
 * G — for leg G itself, never recomputed a second way). Opponent STRENGTH is
 * still evaluated as of G for every leg (never leg-specific), matching G13
 * exactly: "the fixture's IDENTITY is the leg's, while both sides' STRENGTH
 * is measured as of G".
 *
 * Callers only invoke this for a window `classifyFiveGameweekRow` has
 * already accepted into the measured population — every leg's resolvability
 * (feature row present, position/team resolved, actual data known) has
 * already been proven there; this function assumes it, exactly as
 * `projectAndReconstructWindowGameweek` assumes its own row is already
 * resolved by the time it is called.
 */
export function predictLearnedFiveGameweekTotal(
  rowAtG: TrainingFeatureRow,
  position: Position,
  featureGameweekId: number,
  teamMatchRecords: readonly TeamMatchRecord[],
  clubFixtureSchedule: ReadonlyMap<string, readonly (number | null)[]>,
  model: GbmModel,
): number {
  const window = buildFiveGameweekWindow(featureGameweekId)
  let total = 0
  for (const legGameweekId of window) {
    const legOpponentTeamCodes =
      legGameweekId === featureGameweekId
        ? rowAtG.opponent_team_codes
        : rowAtG.team_code === null
          ? []
          : lookupClubFixtureSchedule(clubFixtureSchedule, rowAtG.team_code, legGameweekId)
    const featureVector = buildLearnedFeatureVector(rowAtG, position, legOpponentTeamCodes, teamMatchRecords, featureGameweekId)
    total += predictWithGbm(model, featureVector)
  }
  return total
}

// ============================================================================
// Pure computation — the gate. Boolean comparisons of ALREADY-COMPUTED
// Spearman figures, never a correlation/rank computation of its own.
// ============================================================================

export interface GateLineResult {
  position: Position
  positionName: string
  learnedSpearman: number | null
  thresholdDescription: string
  threshold: number | null
  /** null means insufficient data to compare (either side null) — never guessed as pass or fail. */
  pass: boolean | null
}

/**
 * Builds the four gate lines (file header, "THE GATE"). Midfielder/Forward
 * compare against the FIXED report-10 naive-baseline figures
 * (GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN/GATE_FORWARD_NAIVE_BASELINE_SPEARMAN);
 * Goalkeeper/Defender compare against `incumbentFiveGwByPosition`, computed
 * fresh in THIS run (file header, "THE INCUMBENT IS COMPUTED LIVE"). "Beat"
 * means strictly greater than — a tie is not a pass, matching
 * scripts/run-backtest.ts's own checkOracleCeiling `>=`-fails convention.
 */
export function buildGateResults(
  learnedFiveGwByPosition: Record<Position, number | null>,
  incumbentFiveGwByPosition: Record<Position, number | null>,
): GateLineResult[] {
  return POSITIONS.map((position) => {
    const learnedSpearman = learnedFiveGwByPosition[position]
    if (position === MIDFIELDER || position === FORWARD) {
      const threshold = position === MIDFIELDER ? GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN : GATE_FORWARD_NAIVE_BASELINE_SPEARMAN
      return {
        position,
        positionName: POSITION_NAMES[position],
        learnedSpearman,
        thresholdDescription: 'the naive "prior minutes per match" baseline (report 10, fixed)',
        threshold,
        pass: learnedSpearman === null ? null : learnedSpearman > threshold,
      }
    }
    const threshold = incumbentFiveGwByPosition[position]
    return {
      position,
      positionName: POSITION_NAMES[position],
      learnedSpearman,
      thresholdDescription: 'the incumbent baseline-v1 model, computed fresh in this same run',
      threshold,
      pass: learnedSpearman === null || threshold === null ? null : learnedSpearman > threshold,
    }
  })
}

// ============================================================================
// Report generation — pure string building from already-computed figures.
// ============================================================================

export interface HorizonResultRow {
  label: string
  seasonSpearman: number | null
  byPosition: Record<Position, number | null>
}

export interface LearnedModelReportInput {
  season: string
  gitCommitSha: string
  trainCutoffGameweek: number
  trainRowCount: number
  evalRowCount: number
  fiveGwEvalWindowCount: number
  oneGw: HorizonResultRow[]
  fiveGw: HorizonResultRow[]
  gates: readonly GateLineResult[]
}

function fmtSpearman(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

function buildResultTable(rows: readonly HorizonResultRow[]): string {
  const header = `| Ranker | Season | ${POSITIONS.map((p) => POSITION_NAMES[p]).join(' | ')} |`
  const divider = `|---|---|${POSITIONS.map(() => '---').join('|')}|`
  const lines = rows.map((r) => `| ${r.label} | ${fmtSpearman(r.seasonSpearman)} | ${POSITIONS.map((p) => fmtSpearman(r.byPosition[p])).join(' | ')} |`)
  return [header, divider, ...lines].join('\n')
}

function buildGateTable(gates: readonly GateLineResult[]): string {
  const header = `| Position | Learned model | Must beat | Threshold | Verdict |`
  const divider = `|---|---|---|---|---|`
  const lines = gates.map(
    (g) =>
      `| ${g.positionName} | ${fmtSpearman(g.learnedSpearman)} | ${g.thresholdDescription} | ${fmtSpearman(g.threshold)} | ${g.pass === null ? 'n/a (insufficient data)' : g.pass ? 'PASS' : 'FAIL'} |`,
  )
  return [header, divider, ...lines].join('\n')
}

export function buildReportMarkdown(input: LearnedModelReportInput): string {
  const overallPass = input.gates.every((g) => g.pass === true)
  const anyFail = input.gates.some((g) => g.pass === false)
  const verdictLine = anyFail
    ? "**GATE FAILED.** At least one position did not beat its threshold — see the table below. Per ticket #208's own instruction, this is reported plainly and no tuning follows."
    : overallPass
      ? '**GATE PASSED** on every position with enough data to compare.'
      : '**GATE INCONCLUSIVE** — at least one position had insufficient data to compare (see "n/a" above); no position outright failed.'

  return [
    `# Learned model (learned-v1 candidate) — ticket #208`,
    ``,
    `Season: ${input.season}. Git commit: \`${input.gitCommitSha}\` (this SHA determines whether the incumbent numbers below reflect ticket #207's minutes.ts revert — see file header, "THE INCUMBENT IS COMPUTED LIVE").`,
    ``,
    `Train/eval split: gameweek <= ${input.trainCutoffGameweek} is training data (${input.trainRowCount} row(s)); gameweek > ${input.trainCutoffGameweek} is held out (${input.evalRowCount} single-gameweek row(s), ${input.fiveGwEvalWindowCount} five-gameweek window(s)). The model never saw an eval-fold row's target during fitting — see splitByGameweekCutoff and this file's own leakage test.`,
    ``,
    `## One-gameweek horizon (held-out fold only)`,
    ``,
    buildResultTable(input.oneGw),
    ``,
    `## Five-gameweek horizon (held-out fold only) — the gate's own horizon`,
    ``,
    buildResultTable(input.fiveGw),
    ``,
    `## Gate`,
    ``,
    buildGateTable(input.gates),
    ``,
    verdictLine,
    ``,
  ].join('\n')
}

// ============================================================================
// Main — I/O. Everything above this point is pure and covered by
// train-and-evaluate-learned-model.test.ts with no live database.
// ============================================================================

interface PlayerRow {
  code: number | null
  element_type: number
}

interface MatchStatsForTeamStrengthRow {
  match_id: string
  gameweek: number
  team_code: number | null
  opponent_team_code: number | null
  team_goals_conceded: number | null
}

function toTeamStrengthInput(rows: readonly MatchStatsForTeamStrengthRow[]) {
  return rows.map((r) => ({
    matchId: r.match_id,
    gameweek: r.gameweek,
    teamCode: r.team_code,
    opponentTeamCode: r.opponent_team_code,
    teamGoalsConceded: r.team_goals_conceded,
  }))
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const season = readSeason()
  const reportPath = readReportPath()
  const gitCommitSha = readGitCommitSha()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // ------------------------------------------------------------------
    // 1. players — position fallback, same as scripts/run-backtest.ts.
    // ------------------------------------------------------------------
    const { rows: playerRows, error: playersError } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('code, element_type').order('id', { ascending: true }).range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) throw new LearnedModelError(`players lookup failed: ${playersError.message}`, 'players')
    const { count: playersExpectedCount, error: playersCountError } = await supabase.from('players').select('*', { count: 'exact', head: true })
    if (playersCountError) throw new LearnedModelError(`players count check failed: ${playersCountError.message}`, 'players')
    assertRowCountMatches('players', playerRows.length, playersExpectedCount ?? 0)

    const codeToPosition = new Map<number, Position>()
    for (const player of playerRows) {
      if (player.code !== null) codeToPosition.set(player.code, player.element_type as Position)
    }

    // ------------------------------------------------------------------
    // 2. feature_history — full column set (needed to compute the
    //    incumbent's own baseline-v1 projection via projectRow, which
    //    training_features's own trimmed column set cannot supply).
    // ------------------------------------------------------------------
    const {
      rows: featureHistoryRows,
      error: featureHistoryError,
    } = await fetchAllPages<FeatureHistoryRow>((from, to) =>
      supabase
        .from('feature_history')
        .select(
          'gameweek_id, player_code, element_type, team_code, prior_matches, prior_minutes, prior_xg, prior_xa, prior_saves, prior_clearances, prior_blocks, ' +
            'prior_interceptions, prior_tackles, prior_recoveries, prior_defcon_qualifying_matches, prior_defcon_hits, prior_recent_minutes',
        )
        .eq('season', season)
        .order('gameweek_id', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<FeatureHistoryRow[]>(),
    )
    if (featureHistoryError) {
      throw new LearnedModelError(
        isMissingTable(featureHistoryError, 'feature_history')
          ? `the "feature_history" table does not exist. Apply ${FEATURE_HISTORY_MIGRATION} first.`
          : `feature_history lookup failed: ${featureHistoryError.message}`,
        'feature_history',
      )
    }
    const { count: featureHistoryExpectedCount, error: featureHistoryCountError } = await supabase
      .from('feature_history')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (featureHistoryCountError) throw new LearnedModelError(`feature_history count check failed: ${featureHistoryCountError.message}`, 'feature_history')
    assertRowCountMatches(`feature_history (season=${season})`, featureHistoryRows.length, featureHistoryExpectedCount ?? 0)

    if (featureHistoryRows.length === 0) {
      const message = `${JOB_NAME}: feature_history is empty for season=${season}. Nothing to train against.`
      console.log(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
      process.exit(1)
      return
    }

    // ------------------------------------------------------------------
    // 3. player_match_stats — actuals, and the raw material for team
    //    strength / the club fixture schedule.
    // ------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
    } = await fetchAllPages<ActualSourceRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, match_id, gameweek, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries, team_code, opponent_team_code',
        )
        .eq('season', season)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .order('player_id', { ascending: true })
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<ActualSourceRow[]>(),
    )
    if (matchStatsError) {
      throw new LearnedModelError(
        isMissingTable(matchStatsError, 'player_match_stats')
          ? `the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`
          : `player_match_stats lookup failed: ${matchStatsError.message}`,
        'player_match_stats',
      )
    }
    const { count: matchStatsExpectedCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) throw new LearnedModelError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    assertRowCountMatches(`player_match_stats (season=${season}, competition=${PREMIER_LEAGUE_COMPETITION})`, matchStatsRows.length, matchStatsExpectedCount ?? 0)

    // ------------------------------------------------------------------
    // 4. training_features — the learned model's own feature substrate.
    // ------------------------------------------------------------------
    const {
      rows: trainingFeatureRows,
      error: trainingFeaturesError,
    } = await fetchAllPages<TrainingFeatureRow>((from, to) =>
      supabase
        .from('training_features')
        .select(
          'season, gameweek_id, player_code, element_type, team_code, prior_matches, xg_rate_per90, xa_rate_per90, prior_recent_minutes, ' +
            'season_avg_minutes, prior_shots_on_target, prior_defcon_qualifying_matches, prior_defcon_hits, opponent_team_codes, ' +
            'team_strength_matches, team_strength_goals_scored, team_strength_goals_conceded, computed_at',
        )
        .eq('season', season)
        .order('gameweek_id', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<TrainingFeatureRow[]>(),
    )
    if (trainingFeaturesError) {
      throw new LearnedModelError(
        isMissingTable(trainingFeaturesError, 'training_features')
          ? `the "training_features" table does not exist. Apply ${TRAINING_FEATURES_MIGRATION} and run scripts/build-training-features.ts first.`
          : `training_features lookup failed: ${trainingFeaturesError.message}`,
        'training_features',
      )
    }
    const { count: trainingFeaturesExpectedCount, error: trainingFeaturesCountError } = await supabase
      .from('training_features')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (trainingFeaturesCountError) throw new LearnedModelError(`training_features count check failed: ${trainingFeaturesCountError.message}`, 'training_features')
    assertRowCountMatches(`training_features (season=${season})`, trainingFeatureRows.length, trainingFeaturesExpectedCount ?? 0)

    if (trainingFeatureRows.length === 0) {
      const message = `${JOB_NAME}: training_features is empty for season=${season}. Run scripts/build-training-features.ts first.`
      console.log(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
      process.exit(1)
      return
    }

    const trainingFeaturesByKey = new Map<string, TrainingFeatureRow>()
    for (const row of trainingFeatureRows) trainingFeaturesByKey.set(`${row.player_code}:${row.gameweek_id}`, row)

    // ------------------------------------------------------------------
    // 5. Index actuals; build team strength + the club fixture schedule —
    //    both reused UNMODIFIED from scripts/run-backtest.ts.
    // ------------------------------------------------------------------
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>()
    for (const row of matchStatsRows) {
      if (row.player_code === null) continue
      const key = `${row.player_code}:${row.gameweek}`
      const list = actualByPlayerGameweek.get(key) ?? []
      list.push(row)
      actualByPlayerGameweek.set(key, list)
    }

    const teamMatchRecords = buildTeamMatchRecords(toTeamStrengthInput(matchStatsRows))
    const clubFixtureSchedule = buildClubFixtureSchedule(toTeamStrengthInput(matchStatsRows))

    const resolvedPositionByCode = new Map<number, Position>()
    for (const row of featureHistoryRows) {
      if (resolvedPositionByCode.has(row.player_code)) continue
      const resolution = resolveRowPosition(row, codeToPosition)
      if (resolution.position !== undefined) resolvedPositionByCode.set(row.player_code, resolution.position)
    }

    const positionPriors: ReadonlyMap<string, PositionPrior> = computePositionPriors(featureHistoryRows, (code) => resolvedPositionByCode.get(code))

    // ------------------------------------------------------------------
    // 6. Classify every feature_history row — the incumbent's own
    //    single-gameweek measured population, byte-for-byte the same rule
    //    scripts/run-backtest.ts's main() applies (classifyRow, imported,
    //    never reimplemented). Simplification, stated: hadFixture is left
    //    at its default (true) throughout, so a genuine blank gameweek is
    //    counted under 'didNotFeature' rather than its own 'blankGameweek'
    //    reason — this changes no row's measured/excluded PARTITION (both
    //    reasons are excluded either way), only which named reason a
    //    diagnostic count would report, and this job reports no such
    //    breakdown. fixtureTeamsResolved is NOT simplified — it changes the
    //    incumbent's OWN fixture-aware projection accuracy and is computed
    //    exactly as scripts/run-backtest.ts's main() does.
    // ------------------------------------------------------------------
    const exclusions = emptyExclusionCounts()
    const measured: MeasuredRow[] = []
    const measuredPlayerCodes: number[] = []

    for (const row of featureHistoryRows) {
      const resolution = resolveRowPosition(row, codeToPosition)
      const position = resolution.position
      const actualRowsRaw = actualByPlayerGameweek.get(`${row.player_code}:${row.gameweek_id}`) ?? []

      const fixtureTeamsResolved = resolveFixtureTeams(
        row.team_code,
        actualRowsRaw.map((r) => r.opponent_team_code),
      )

      const classification = classifyRow(row, position, actualRowsRaw.map(toActualMatchStatsInput), true, fixtureTeamsResolved)
      if (classification.kind === 'excluded') {
        incrementExclusion(exclusions, classification.reason as ExclusionReason)
        continue
      }

      const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, row.team_code as number, row.gameweek_id)
      const fixtureExpectedScores = actualRowsRaw.map((r) =>
        computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, r.opponent_team_code as number, row.gameweek_id), SCALE),
      )

      const prior = positionPriors.get(positionPriorKey(row.gameweek_id, classification.position)) ?? fallbackPositionPrior(classification.position)
      const projection = projectRow(row, classification.position, prior, classification.outcome.matchesFound, fixtureExpectedScores)
      const projectedComponents = sumComponentTotals(projection.fixtures.map((f) => pickProjectedComponents(f.components)))

      const baselineMinutes = computeBaselineMinutesPerMatch(row)
      const baselineXgXa = computeBaselineXgXaPerMatch(row)

      measured.push(
        buildMeasuredRow(row.gameweek_id, classification.position, projection.expectedPoints, projectedComponents, classification.outcome, row.prior_matches, baselineMinutes, baselineXgXa),
      )
      measuredPlayerCodes.push(row.player_code)
    }
    assertReconciles(featureHistoryRows.length, measured.length, exclusions)

    // ------------------------------------------------------------------
    // 7. Restrict to rows that also have a training_features entry — "the
    //    same measured population" every ranker below is compared on.
    // ------------------------------------------------------------------
    interface RestrictedRow {
      gameweekId: number
      playerCode: number
      measured: MeasuredRow
      trainingRow: TrainingFeatureRow
    }
    const restrictedRows: RestrictedRow[] = []
    let missingTrainingFeaturesRowCount = 0
    for (let i = 0; i < measured.length; i++) {
      const key = `${measuredPlayerCodes[i]}:${measured[i].gameweekId}`
      const trainingRow = trainingFeaturesByKey.get(key)
      if (trainingRow === undefined) {
        missingTrainingFeaturesRowCount++
        continue
      }
      restrictedRows.push({ gameweekId: measured[i].gameweekId, playerCode: measuredPlayerCodes[i], measured: measured[i], trainingRow })
    }
    if (restrictedRows.length + missingTrainingFeaturesRowCount !== measured.length) {
      throw new LearnedModelError('training_features intersection failed to reconcile against the incumbent measured population', 'reconciliation')
    }

    // ------------------------------------------------------------------
    // 8. The split. Fit on train fold only.
    // ------------------------------------------------------------------
    const { trainRows, evalRows } = splitByGameweekCutoff(restrictedRows, TRAIN_EVAL_GAMEWEEK_CUTOFF)
    if (trainRows.length === 0 || evalRows.length === 0) {
      const message = `${JOB_NAME}: train (${trainRows.length}) or eval (${evalRows.length}) fold is empty for season=${season} at cutoff=${TRAIN_EVAL_GAMEWEEK_CUTOFF} — nothing to fit or evaluate.`
      console.log(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
      process.exit(1)
      return
    }

    const trainFeatureMatrix = trainRows.map((r) => buildLearnedFeatureVector(r.trainingRow, r.measured.position, r.trainingRow.opponent_team_codes, teamMatchRecords, r.gameweekId))
    const trainTargets = trainRows.map((r) => r.measured.actualPoints)
    const model = fitGradientBoostingModel(trainFeatureMatrix, trainTargets, DEFAULT_GBM_HYPERPARAMETERS)

    // ------------------------------------------------------------------
    // 9. One-gameweek horizon, eval fold only.
    // ------------------------------------------------------------------
    const learnedOneGwRows: GenericRankingRow[] = evalRows.map((r) => ({
      position: r.measured.position,
      groupId: r.gameweekId,
      projected: predictWithGbm(model, buildLearnedFeatureVector(r.trainingRow, r.measured.position, r.trainingRow.opponent_team_codes, teamMatchRecords, r.gameweekId)),
      actual: r.measured.actualPoints,
    }))
    const incumbentOneGwRows: GenericRankingRow[] = evalRows.map((r) => ({
      position: r.measured.position,
      groupId: r.gameweekId,
      projected: r.measured.projectedPoints,
      actual: r.measured.actualPoints,
    }))
    const learnedOneGw = summarizeGenericBaselineSpearman('Learned model candidate', learnedOneGwRows)
    const incumbentOneGw = summarizeGenericBaselineSpearman('Incumbent baseline-v1', incumbentOneGwRows)
    const naiveOneGwBaselines: BaselineSummary[] = summarizeBaselines(evalRows.map((r) => r.measured))
    const constantOneGwSpearman = computeGenericConstantBaselineSpearman(evalRows.map((r) => r.measured.actualPoints))

    // ------------------------------------------------------------------
    // 10. Five-gameweek horizon — window candidates are the EVAL fold's own
    //     single-gameweek rows (a window must START in the held-out range
    //     to be a genuine held-out test). classifyFiveGameweekRow (imported,
    //     unmodified) decides which windows are measurable at all; this job
    //     only supplies a second model's prediction for the windows it
    //     already accepted.
    // ------------------------------------------------------------------
    const featureHistoryByPlayerGameweek = buildFeatureHistoryIndex(featureHistoryRows)
    const lastGameweekInData = computeLastGameweekInData(featureHistoryRows)

    const fiveGwExclusions = emptyFiveGameweekExclusionCounts()
    const fiveGwMeasured: FiveGameweekRow[] = []
    const learnedFiveGwRows: GenericRankingRow[] = []

    for (const r of evalRows) {
      const classification = classifyFiveGameweekRow(
        r.playerCode,
        r.measured,
        lastGameweekInData,
        featureHistoryByPlayerGameweek,
        codeToPosition,
        positionPriors,
        actualByPlayerGameweek,
        teamMatchRecords,
        clubFixtureSchedule,
      )
      if (classification.kind === 'excluded') {
        incrementFiveGameweekExclusion(fiveGwExclusions, classification.reason)
        continue
      }
      fiveGwMeasured.push(classification.row)

      const learnedTotal = predictLearnedFiveGameweekTotal(r.trainingRow, r.measured.position, r.gameweekId, teamMatchRecords, clubFixtureSchedule, model)
      learnedFiveGwRows.push({ position: r.measured.position, groupId: r.gameweekId, projected: learnedTotal, actual: classification.row.actualPoints })
    }
    assertFiveGameweekReconciles(evalRows.length, fiveGwMeasured.length, fiveGwExclusions)

    const incumbentFiveGwRows: GenericRankingRow[] = fiveGwMeasured.map((r) => ({ position: r.position, groupId: r.startGameweekId, projected: r.projectedPoints, actual: r.actualPoints }))
    const learnedFiveGw = summarizeGenericBaselineSpearman('Learned model candidate', learnedFiveGwRows)
    const incumbentFiveGw = summarizeGenericBaselineSpearman('Incumbent baseline-v1', incumbentFiveGwRows)
    const naiveFiveGwBaselines: BaselineSummary[] = summarizeFiveGameweekBaselines(fiveGwMeasured)

    // ------------------------------------------------------------------
    // 11. The gate, and the report.
    // ------------------------------------------------------------------
    const gates = buildGateResults(learnedFiveGw.byPosition, incumbentFiveGw.byPosition)

    const oneGw: HorizonResultRow[] = [
      { label: learnedOneGw.label, seasonSpearman: learnedOneGw.seasonSpearman, byPosition: learnedOneGw.byPosition },
      { label: incumbentOneGw.label, seasonSpearman: incumbentOneGw.seasonSpearman, byPosition: incumbentOneGw.byPosition },
      ...naiveOneGwBaselines.map((b) => ({ label: b.label, seasonSpearman: b.seasonSpearman, byPosition: b.byPosition })),
    ]
    const fiveGw: HorizonResultRow[] = [
      { label: learnedFiveGw.label, seasonSpearman: learnedFiveGw.seasonSpearman, byPosition: learnedFiveGw.byPosition },
      { label: incumbentFiveGw.label, seasonSpearman: incumbentFiveGw.seasonSpearman, byPosition: incumbentFiveGw.byPosition },
      ...naiveFiveGwBaselines.map((b) => ({ label: b.label, seasonSpearman: b.seasonSpearman, byPosition: b.byPosition })),
    ]

    const reportMarkdown = buildReportMarkdown({
      season,
      gitCommitSha,
      trainCutoffGameweek: TRAIN_EVAL_GAMEWEEK_CUTOFF,
      trainRowCount: trainRows.length,
      evalRowCount: evalRows.length,
      fiveGwEvalWindowCount: fiveGwMeasured.length,
      oneGw,
      fiveGw,
      gates,
    })
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const anyFail = gates.some((g) => g.pass === false)
    const details: JsonRecord = {
      season,
      gitCommitSha,
      trainCutoffGameweek: TRAIN_EVAL_GAMEWEEK_CUTOFF,
      trainRowCount: trainRows.length,
      evalRowCount: evalRows.length,
      missingTrainingFeaturesRowCount,
      fiveGwEvalWindowCount: fiveGwMeasured.length,
      constantOneGwSpearman,
      gates,
      reportPath,
    }
    const message = `${JOB_NAME}: season ${season} — ${gates.filter((g) => g.pass === true).length}/${gates.length} gate line(s) passed. ${anyFail ? 'GATE FAILED — see report.' : 'No outright failure.'} Report written to ${reportPath}.`
    console.log(message)
    if (anyFail) {
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
      process.exit(1)
      return
    }
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message = err instanceof LearnedModelError ? err.message : err instanceof Error ? `unexpected failure: ${err.message}` : `unexpected failure: ${String(err)}`
    console.error(`${JOB_NAME}: failed: ${message}`)
    try {
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    process.exit(1)
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
