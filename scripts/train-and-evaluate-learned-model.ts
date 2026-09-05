// Learned model, THIRD slice — ticket #214 (fair-gate re-run). Ticket #208's
// first live run (report 12) mixed two kinds of threshold in one gate table:
// Goalkeeper/Defender were judged against the incumbent computed live, on
// the held-out fold; Midfielder/Forward were judged against 0.464/0.476 —
// literal constants lifted from report 10, a FULL-SEASON report, and the
// held-out fold (gameweeks 29-38) scores every ranker roughly 0.05 higher
// than its full-season figure. The pass/fail split (2 of 4) fell straight
// along that seam, not along a real finding. This ticket does not retrain
// anything — same model type, same hyperparameters, same feature list as
// #208 (see DEFAULT_GBM_HYPERPARAMETERS/FEATURE_NAMES, both untouched). It
// replaces the EVALUATION only: every threshold is now computed live, on the
// SAME fold as the model it judges, and the whole thing is repeated across
// four independent train/eval cutoffs so a one-split fluke cannot pass as a
// finding. See docs/projection-model-backlog.md's G16 entries for #208/#207/
// #209's own history, and this ticket's own new entry for what changed here.
//
// ============================================================================
// SHIPS NOTHING USER-VISIBLE.
// ============================================================================
// No projection is written, no player_projections row gains a new
// model_version, no CSV changes, no recommendation moves. This is a
// measurement job — it reads training_features and player_match_stats,
// fits one model per split, evaluates each, and reports a table plus a
// plain per-position verdict. Its only Supabase write is one job_runs row.
//
// ============================================================================
// THE GATE — restated here so a reader never has to cross-reference
// docs/projection-model-backlog.md to know the rule.
// ============================================================================
// For every position, at the five-gameweek horizon: the learned model must
// beat the INCUMBENT's own figure — never a naive baseline, never a number
// quoted from any report — on the MAJORITY of TRAIN_EVAL_GAMEWEEK_CUTOFFS'
// splits. Beating a naive baseline is not sufficient: the incumbent already
// beats every naive baseline at every position except midfield and forward
// (docs/projection-model-backlog.md G15), so a naive-baseline gate would pass
// a model that is a genuine downgrade at goalkeeper/defender. See
// buildGateResults for the exact win/loss/verdict arithmetic, and its own
// comment for the "because" behind the three-way verdict (ship / do not ship
// / too close to call) rather than a bare pass/fail.
//
// ============================================================================
// THE INCUMBENT IS COMPUTED LIVE, NEVER QUOTED FROM A PAST REPORT — AT EVERY
// SPLIT.
// ============================================================================
// A sibling ticket (#213) widens PlayerProjectionInput and changes what
// estimateMinutes returns, on its own branch in this same batch — that
// changes every incumbent number once merged, and this job never assumes a
// merge order. It imports src/lib/projection/ dynamically (via
// scripts/run-backtest.ts's own projectRow) and computes the incumbent's
// baseline-v1 figures fresh, every split, from whatever those modules
// contain on the branch/commit actually checked out. The report and
// job_runs details both record the checked-out git commit SHA (see
// `readGitCommitSha` below) and a plain-language note on which minutes model
// that SHA reflects, precisely so a reader can tell, after the fact, whether
// a given run's incumbent numbers predate #213's change — never guessed,
// always checkable. The naive baselines are ALSO computed live, per split,
// on that split's own held-out fold — never a number carried over from
// report 10 or any other report. This is the whole defect #214 fixes: no
// figure in the gate table is a literal constant carried over from a report,
// for any position.
//
// ============================================================================
// REUSE, NEVER REIMPLEMENT (this ticket's own DoD, grep-checkable).
// ============================================================================
// This file defines NO Spearman correlation, NO rank function, and NO
// five-gameweek window classifier of its own. Every ranking figure below is
// produced by summarizeGenericBaselineSpearman / summarizeBaselines /
// summarizeFiveGameweekBaselines, all imported from scripts/run-backtest.ts,
// never edited by this ticket (out of scope, and #215 edits that file
// concurrently in this same batch on a separate branch). The five-gameweek
// population is built by literally calling that file's own
// classifyFiveGameweekRow for every candidate window — this job supplies a
// SECOND model's predictions (the learned model's) for the exact same
// windows that function already proved are safe to measure; it does not
// re-derive which windows those are.
//
// ============================================================================
// THE MODEL — unchanged from #208. Small, inspectable, no new dependency.
// ============================================================================
// Gradient-boosted regression trees over FEATURE_NAMES (15 columns), hand
// written below (buildRegressionTree / fitGradientBoostingModel) rather than
// pulled from an ML package. Hyperparameters, fixed before any real data is
// read (no tuning against the gate, and #214's own scope forbids retraining
// to chase it): 60 trees, max depth 3, learning rate 0.08, min 40 samples
// per leaf. NONE of this changed for #214 — only the evaluation did.
//
// ============================================================================
// THE SPLIT — gameweek-block, not row-random, REPEATED across four cutoffs.
// ============================================================================
// TRAIN_EVAL_GAMEWEEK_CUTOFFS partitions every row by its OWN gameweek_id,
// once per cutoff in the array: a row belongs to that split's training fold
// iff gameweekId <= cutoff. This is a temporal split, not a random one,
// because the DoD requires proving no gameweek the model is SCORED on ever
// contributed to FITTING it, at EVERY cutoff — a random row-level split
// could not make that claim, since a five-gameweek window's legs would then
// span both folds unpredictably. A separate model is fit for each cutoff
// (fitting is cheap — a few thousand rows, 60 shallow trees — and reusing
// one model across cutoffs would defeat the point of testing whether an edge
// survives a different amount of training data too). See
// splitByGameweekCutoff's own tests, and the "no lookahead into the
// evaluation set" describe block in this file's test file, now parameterized
// over every cutoff in TRAIN_EVAL_GAMEWEEK_CUTOFFS — the single most
// important test this ticket touches.
//
// ============================================================================
// NO TUNING AGAINST THE GATE, AND NO RETRAINING (#214's own scope line).
// ============================================================================
// The hyperparameters, the split cutoffs and the feature list are all fixed
// BEFORE this file's own main() ever reads a row of real data — they are
// module-level constants, not env-configurable, so there is no dial to turn
// after seeing a disappointing number. Fit once per cutoff, evaluate once
// per cutoff, report whatever comes out for all four. If a position's gate
// fails, this job says so plainly (see buildReportMarkdown's gate section)
// and does not retry with different numbers or a different model.
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
 * The train/eval splits — REPEATED, per ticket #214's own scope ("evaluate
 * across several train/eval cutoffs — gameweek 22, 25, 28 and 31"). Each
 * cutoff is a GAMEWEEK boundary, not a row-random split (see file header,
 * "THE SPLIT"): a row with gameweekId <= the cutoff is that split's training
 * data, every other row is held out FOR THAT SPLIT. 22/25/28/31 of the
 * season's 38 gameweeks leave held-out folds of 16/13/10/7 gameweeks
 * respectively — every one comfortably clears MIN_BUCKET_SAMPLE_SIZE (50)
 * per position at the one-gameweek horizon, and every one leaves at least
 * one five-gameweek window start (cutoff 31's eval fold is gameweeks 32-38,
 * giving window starts 32/33/34). Fixed before this file ever reads a row of
 * real data — see file header, "NO TUNING AGAINST THE GATE" — and never
 * env-configurable, for the same reason.
 */
export const TRAIN_EVAL_GAMEWEEK_CUTOFFS: readonly number[] = [22, 25, 28, 31]

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
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
// Spearman figures, never a correlation/rank computation of its own. This is
// the section ticket #214 replaces almost entirely: one split's worth of
// pass/fail booleans becomes a per-position record across every split in
// TRAIN_EVAL_GAMEWEEK_CUTOFFS, reduced to a plain verdict.
// ============================================================================

/** One position's result at ONE split — the atom every gate figure is built from. */
export interface SplitGateLine {
  cutoff: number
  learnedSpearman: number | null
  incumbentSpearman: number | null
  /**
   * Whether the learned model beat the incumbent AT THIS SPLIT — "beat"
   * means strictly greater than, matching scripts/run-backtest.ts's own
   * checkOracleCeiling `>=`-fails convention (a tie is not a win). Null when
   * either side lacks enough data to compare — never guessed as a win or a
   * loss, and never counted toward wins/losses below.
   */
  beat: boolean | null
}

export type PositionVerdict = 'ship' | 'do-not-ship' | 'too-close-to-call' | 'insufficient-data'

export interface PositionGateResult {
  position: Position
  positionName: string
  splits: readonly SplitGateLine[]
  wins: number
  losses: number
  /** Splits where both sides had enough data to compare — wins + losses. */
  comparableSplits: number
  /**
   * The ticket's own three-way verdict, read off the win/loss count across
   * TRAIN_EVAL_GAMEWEEK_CUTOFFS' splits (see this function's own comment for
   * the "because"). 'insufficient-data' is a fourth, honest state this
   * ticket's own instruction not to guess requires — never folded into
   * 'do-not-ship'.
   */
  verdict: PositionVerdict
}

/**
 * One split's per-position five-gameweek figures — learned AND incumbent,
 * both computed fresh on that split's own held-out fold (file header, "THE
 * INCUMBENT IS COMPUTED LIVE ... AT EVERY SPLIT"). What main() feeds
 * buildGateResults, one entry per cutoff in TRAIN_EVAL_GAMEWEEK_CUTOFFS.
 */
export interface FiveGwSplitGateInput {
  cutoff: number
  learnedByPosition: Record<Position, number | null>
  incumbentByPosition: Record<Position, number | null>
}

/**
 * Builds one PositionGateResult per position (file header, "THE GATE"):
 * for EVERY position — never just goalkeeper/defender, never a naive
 * baseline for any position — the learned model is compared against the
 * INCUMBENT, on the five-gameweek target, split by split.
 *
 * The verdict, and why it is three-way rather than a bare pass/fail:
 *  - `ship` — the learned model beat the incumbent on a genuine MAJORITY of
 *    the comparable splits (wins > losses). This is the ticket's own gate
 *    restated ("on the majority of splits"), read as a recommendation to
 *    ship rather than a bare boolean.
 *  - `do-not-ship` — the incumbent won a majority (losses > wins). Shipping
 *    something that loses on most splits is not an upgrade (ticket text).
 *  - `too-close-to-call` — an exact tie (wins === losses > 0), which with
 *    four splits means 2-2: the model and the incumbent split the verdict
 *    down the middle. The ticket's own notes are explicit that "a 0.016
 *    midfield edge that halves under a second split is not evidence of
 *    anything yet" — a result that flips depending on which half of the
 *    splits you look at is exactly that shape, and calling it a plain win
 *    or a plain loss would overstate the evidence either way.
 *  - `insufficient-data` — no split had enough data on both sides to
 *    compare at all. Never guessed as any of the above.
 */
export function buildGateResults(splits: readonly FiveGwSplitGateInput[]): PositionGateResult[] {
  return POSITIONS.map((position) => {
    const splitLines: SplitGateLine[] = splits.map((s) => {
      const learnedSpearman = s.learnedByPosition[position]
      const incumbentSpearman = s.incumbentByPosition[position]
      const beat = learnedSpearman === null || incumbentSpearman === null ? null : learnedSpearman > incumbentSpearman
      return { cutoff: s.cutoff, learnedSpearman, incumbentSpearman, beat }
    })
    const wins = splitLines.filter((l) => l.beat === true).length
    const losses = splitLines.filter((l) => l.beat === false).length
    const comparableSplits = wins + losses
    let verdict: PositionVerdict
    if (comparableSplits === 0) verdict = 'insufficient-data'
    else if (wins > losses) verdict = 'ship'
    else if (losses > wins) verdict = 'do-not-ship'
    else verdict = 'too-close-to-call'
    return { position, positionName: POSITION_NAMES[position], splits: splitLines, wins, losses, comparableSplits, verdict }
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

/** One split's full result — population, and both horizons' ranker tables (learned, incumbent, all three naive baselines — file header, "side by side ... over identical populations"). */
export interface SplitResult {
  cutoff: number
  trainRowCount: number
  evalRowCount: number
  fiveGwEvalWindowCount: number
  oneGw: readonly HorizonResultRow[]
  fiveGw: readonly HorizonResultRow[]
}

export interface LearnedModelReportInput {
  season: string
  gitCommitSha: string
  /** Plain-language statement of which minutes model the incumbent figures reflect — DoD: "states which minutes model the incumbent figures reflect." Never asserts a specific merge state this job cannot observe; states what IS checkable (the SHA) and what is NOT yet reflected (ticket #213's concurrent change). */
  incumbentMinutesModelNote: string
  splits: readonly SplitResult[]
  gates: readonly PositionGateResult[]
}

function fmtSpearman(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

function fmtSigned(value: number | null): string {
  if (value === null) return 'n/a'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(3)}`
}

function buildResultTable(rows: readonly HorizonResultRow[]): string {
  const header = `| Ranker | Season | ${POSITIONS.map((p) => POSITION_NAMES[p]).join(' | ')} |`
  const divider = `|---|---|${POSITIONS.map(() => '---').join('|')}|`
  const lines = rows.map((r) => `| ${r.label} | ${fmtSpearman(r.seasonSpearman)} | ${POSITIONS.map((p) => fmtSpearman(r.byPosition[p])).join(' | ')} |`)
  return [header, divider, ...lines].join('\n')
}

function buildSplitSection(split: SplitResult): string {
  return [
    `### Split: train on gameweek <= ${split.cutoff}, evaluate on gameweek > ${split.cutoff}`,
    ``,
    `Training rows: ${split.trainRowCount}. Held-out rows: ${split.evalRowCount} single-gameweek, ${split.fiveGwEvalWindowCount} five-gameweek window(s). A separate model is fit for this split alone (file header, "THE SPLIT — ... REPEATED across four cutoffs") — the model never saw an eval-fold row's target during fitting; see splitByGameweekCutoff's own tests and this file's leakage test, now run at every cutoff in TRAIN_EVAL_GAMEWEEK_CUTOFFS.`,
    ``,
    `**One-gameweek horizon (this split's held-out fold only):**`,
    ``,
    buildResultTable(split.oneGw),
    ``,
    `**Five-gameweek horizon (this split's held-out fold only) — the gate's own horizon:**`,
    ``,
    buildResultTable(split.fiveGw),
  ].join('\n')
}

/**
 * Per-position summary across every split, at the five-gameweek horizon —
 * DoD: "the spread across splits shown". Margin = learned − incumbent; a
 * positive margin is a split the learned model won. Min/max/range make the
 * spread itself a number in the table, not something a reader has to
 * eyeball from four separate split sections.
 */
function buildCrossSplitSummaryTable(gates: readonly PositionGateResult[]): string {
  const header = `| Position | ${gates[0]?.splits.map((s) => `GW<=${s.cutoff} margin`).join(' | ') ?? ''} | Min | Max | Spread | Wins | Losses | Verdict |`
  const divider = `|---|${gates[0]?.splits.map(() => '---').join('|') ?? ''}|---|---|---|---|---|---|`
  const lines = gates.map((g) => {
    const margins = g.splits.map((s) => (s.learnedSpearman === null || s.incumbentSpearman === null ? null : s.learnedSpearman - s.incumbentSpearman))
    const comparableMargins = margins.filter((m): m is number => m !== null)
    const min = comparableMargins.length > 0 ? Math.min(...comparableMargins) : null
    const max = comparableMargins.length > 0 ? Math.max(...comparableMargins) : null
    const spread = min !== null && max !== null ? max - min : null
    return `| ${g.positionName} | ${margins.map(fmtSigned).join(' | ')} | ${fmtSigned(min)} | ${fmtSigned(max)} | ${fmtSpearman(spread)} | ${g.wins} | ${g.losses} | ${fmtVerdict(g.verdict)} |`
  })
  return [header, divider, ...lines].join('\n')
}

function fmtVerdict(verdict: PositionVerdict): string {
  switch (verdict) {
    case 'ship':
      return 'SHIP'
    case 'do-not-ship':
      return 'DO NOT SHIP'
    case 'too-close-to-call':
      return 'TOO CLOSE TO CALL'
    case 'insufficient-data':
      return 'INSUFFICIENT DATA'
  }
}

function buildGateTable(gates: readonly PositionGateResult[]): string {
  const header = `| Position | Wins | Losses | Comparable splits | Verdict |`
  const divider = `|---|---|---|---|---|`
  const lines = gates.map((g) => `| ${g.positionName} | ${g.wins} | ${g.losses} | ${g.comparableSplits} | ${fmtVerdict(g.verdict)} |`)
  return [header, divider, ...lines].join('\n')
}

export function buildReportMarkdown(input: LearnedModelReportInput): string {
  const verdictLines = input.gates.map((g) => {
    switch (g.verdict) {
      case 'ship':
        return `- **${g.positionName}: SHIP.** The learned model beat the incumbent on ${g.wins} of ${g.comparableSplits} comparable split(s) — a majority.`
      case 'do-not-ship':
        return `- **${g.positionName}: DO NOT SHIP.** The incumbent beat the learned model on ${g.losses} of ${g.comparableSplits} comparable split(s) — shipping this would be a downgrade.`
      case 'too-close-to-call':
        return `- **${g.positionName}: TOO CLOSE TO CALL.** ${g.wins} win(s) and ${g.losses} loss(es) out of ${g.comparableSplits} comparable split(s) — an edge that flips depending which splits you look at is not yet evidence of anything.`
      case 'insufficient-data':
        return `- **${g.positionName}: INSUFFICIENT DATA.** No split had enough data on both sides to compare.`
    }
  })

  return [
    `# Learned model (learned-v1 candidate) — ticket #214, fair-gate re-run`,
    ``,
    `Season: ${input.season}. Git commit: \`${input.gitCommitSha}\`.`,
    ``,
    input.incumbentMinutesModelNote,
    ``,
    `Every threshold below is computed live, in this same run, on the same held-out fold as the model it is compared against — no figure is quoted from any previous report, for any position (ticket #214's own defect fix). The gate is repeated across ${input.splits.length} independent train/eval cutoffs (gameweek ${input.splits.map((s) => s.cutoff).join(', ')}) so a single-split result is never mistaken for a finding.`,
    ``,
    `## Results by split`,
    ``,
    ...input.splits.map((s) => buildSplitSection(s)),
    ``,
    `## Five-gameweek per-position summary across splits — the gate's own horizon`,
    ``,
    `Margin = learned model's Spearman minus the incumbent's, on that split's held-out fold. Positive means the learned model won that split.`,
    ``,
    buildCrossSplitSummaryTable(input.gates),
    ``,
    `## Gate`,
    ``,
    `For every position: does the learned model beat the incumbent on the five-gameweek target, on a majority of splits? Beating a naive baseline is never sufficient — the incumbent already beats every naive baseline at every position except midfield and forward (docs/projection-model-backlog.md G15).`,
    ``,
    buildGateTable(input.gates),
    ``,
    `## Verdict`,
    ``,
    ...verdictLines,
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
    // 8-10. REPEATED per split (ticket #214's own scope: "evaluate across
    //    several train/eval cutoffs"). Every cutoff in
    //    TRAIN_EVAL_GAMEWEEK_CUTOFFS gets its OWN split, its OWN model (fit
    //    on that split's training fold only), and its OWN one-gameweek /
    //    five-gameweek figures — learned, incumbent, and all three naive
    //    baselines, all read from that split's held-out fold alone. A split
    //    with an empty train or eval fold is skipped (recorded, never
    //    silently dropped) rather than aborting the whole run — the other
    //    splits still carry a genuine reading. `featureHistoryByPlayerGameweek`,
    //    `lastGameweekInData`, `teamMatchRecords` and `clubFixtureSchedule`
    //    are season-wide and computed once, outside the loop; they do not
    //    depend on the split.
    // ------------------------------------------------------------------
    const featureHistoryByPlayerGameweek = buildFeatureHistoryIndex(featureHistoryRows)
    const lastGameweekInData = computeLastGameweekInData(featureHistoryRows)

    const splitResults: SplitResult[] = []
    const fiveGwGateInputs: FiveGwSplitGateInput[] = []
    const skippedCutoffs: number[] = []

    for (const cutoff of TRAIN_EVAL_GAMEWEEK_CUTOFFS) {
      const { trainRows, evalRows } = splitByGameweekCutoff(restrictedRows, cutoff)
      if (trainRows.length === 0 || evalRows.length === 0) {
        console.log(`${JOB_NAME}: skipping cutoff=${cutoff} — train (${trainRows.length}) or eval (${evalRows.length}) fold is empty for season=${season}.`)
        skippedCutoffs.push(cutoff)
        continue
      }

      const trainFeatureMatrix = trainRows.map((r) => buildLearnedFeatureVector(r.trainingRow, r.measured.position, r.trainingRow.opponent_team_codes, teamMatchRecords, r.gameweekId))
      const trainTargets = trainRows.map((r) => r.measured.actualPoints)
      const model = fitGradientBoostingModel(trainFeatureMatrix, trainTargets, DEFAULT_GBM_HYPERPARAMETERS)

      // -- One-gameweek horizon, this split's held-out fold only. --
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

      // -- Five-gameweek horizon — window candidates are THIS split's eval
      //    fold rows (a window must START in the held-out range to be a
      //    genuine held-out test for THIS split). --
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

      splitResults.push({
        cutoff,
        trainRowCount: trainRows.length,
        evalRowCount: evalRows.length,
        fiveGwEvalWindowCount: fiveGwMeasured.length,
        oneGw,
        fiveGw,
      })
      fiveGwGateInputs.push({ cutoff, learnedByPosition: learnedFiveGw.byPosition, incumbentByPosition: incumbentFiveGw.byPosition })
    }

    if (splitResults.length === 0) {
      const message = `${JOB_NAME}: every split (${TRAIN_EVAL_GAMEWEEK_CUTOFFS.join(', ')}) had an empty train or eval fold for season=${season} — nothing to fit or evaluate.`
      console.log(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
      process.exit(1)
      return
    }

    // ------------------------------------------------------------------
    // 11. The gate (across every split above), and the report.
    // ------------------------------------------------------------------
    const gates = buildGateResults(fiveGwGateInputs)

    const incumbentMinutesModelNote =
      `Incumbent figures reflect \`src/lib/projection/minutes.ts\` exactly as checked out at commit \`${gitCommitSha}\` above. ` +
      `Ticket #213, running concurrently in this same batch on a separate branch, widens \`PlayerProjectionInput\` and changes what ` +
      `\`estimateMinutes\` returns — this run predates that change (it was never visible in this job's worktree). A re-run after #213 ` +
      `merges would read a different incumbent and should not be compared line-for-line against this one, or against report 12's ` +
      `figures (a different fold methodology — single arbitrary split, not repeated splits).`

    const reportMarkdown = buildReportMarkdown({
      season,
      gitCommitSha,
      incumbentMinutesModelNote,
      splits: splitResults,
      gates,
    })
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const shipCount = gates.filter((g) => g.verdict === 'ship').length
    const doNotShipCount = gates.filter((g) => g.verdict === 'do-not-ship').length
    const anyDoNotShip = doNotShipCount > 0
    const details: JsonRecord = {
      season,
      gitCommitSha,
      trainEvalGameweekCutoffs: TRAIN_EVAL_GAMEWEEK_CUTOFFS,
      skippedCutoffs,
      missingTrainingFeaturesRowCount,
      splits: splitResults.map((s) => ({ cutoff: s.cutoff, trainRowCount: s.trainRowCount, evalRowCount: s.evalRowCount, fiveGwEvalWindowCount: s.fiveGwEvalWindowCount })),
      gates,
      reportPath,
    }
    const message = `${JOB_NAME}: season ${season} — ${shipCount}/${gates.length} position(s) SHIP, ${doNotShipCount}/${gates.length} DO NOT SHIP. Report written to ${reportPath}.`
    console.log(message)
    if (anyDoNotShip) {
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
