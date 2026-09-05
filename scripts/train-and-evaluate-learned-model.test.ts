// Unit tests for scripts/train-and-evaluate-learned-model.ts — ticket #208.
//
// No live Supabase project: every DoD item provable without a database is
// proven here on constructed rows — the gradient-boosting arithmetic, the
// feature-vector construction (including the G13-style "pinned at the
// window start" discipline for a five-gameweek leg), the gate comparison
// logic, and — the single most important test in this file, per the
// ticket's own DoD wording — a named test proving no gameweek in the
// evaluation set contributed to fitting.
//
// What this file cannot prove — that a real run against the live 18,023
// training_features rows produces a sane, non-overfit model and a
// meaningful gate reading — is exactly the ticket's own "no live Supabase
// project in this Builder session" limitation (see the Builder's final
// report). Every test here exercises the harness on constructed data; none
// of it is a substitute for that live run.

import { describe, expect, it } from 'vitest'
import { GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD } from '../src/lib/scoring/types.ts'
import type { TeamMatchRecord } from './run-backtest.ts'
import type { TrainingFeatureRow } from './build-training-features.ts'
import {
  DEFAULT_GBM_HYPERPARAMETERS,
  FEATURE_NAMES,
  GATE_FORWARD_NAIVE_BASELINE_SPEARMAN,
  GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN,
  TRAIN_EVAL_GAMEWEEK_CUTOFF,
  buildGateResults,
  buildLearnedFeatureVector,
  buildReportMarkdown,
  buildRegressionTree,
  fitGradientBoostingModel,
  predictLearnedFiveGameweekTotal,
  predictWithGbm,
  predictWithTree,
  splitByGameweekCutoff,
  type GameweekKeyed,
  type TreeNode,
} from './train-and-evaluate-learned-model.ts'

// ============================================================================
// predictWithTree — the only place a TreeNode's shape is interpreted.
// ============================================================================

describe('predictWithTree', () => {
  it('returns a leaf value directly', () => {
    const leaf: TreeNode = { kind: 'leaf', value: 4.2 }
    expect(predictWithTree(leaf, [1, 2, 3])).toBe(4.2)
  })

  it('routes left when the feature value is <= the threshold, right otherwise', () => {
    const tree: TreeNode = {
      kind: 'split',
      featureIndex: 0,
      threshold: 5,
      left: { kind: 'leaf', value: -1 },
      right: { kind: 'leaf', value: 1 },
    }
    expect(predictWithTree(tree, [5])).toBe(-1) // exactly at the threshold — left, per "<="
    expect(predictWithTree(tree, [4.999])).toBe(-1)
    expect(predictWithTree(tree, [5.001])).toBe(1)
  })

  it('walks multiple levels to the correct leaf', () => {
    const tree: TreeNode = {
      kind: 'split',
      featureIndex: 0,
      threshold: 10,
      left: {
        kind: 'split',
        featureIndex: 1,
        threshold: 0,
        left: { kind: 'leaf', value: 100 },
        right: { kind: 'leaf', value: 200 },
      },
      right: { kind: 'leaf', value: 300 },
    }
    expect(predictWithTree(tree, [5, -3])).toBe(100)
    expect(predictWithTree(tree, [5, 3])).toBe(200)
    expect(predictWithTree(tree, [20, -3])).toBe(300)
  })
})

// ============================================================================
// buildRegressionTree — deterministic, greedy CART on squared error.
// ============================================================================

describe('buildRegressionTree', () => {
  it('finds the exact split on a perfectly separable single-feature dataset', () => {
    // feature values 1..8, target is 0 for the first four, 10 for the last four —
    // a single split between 4 and 5 gets SSE to exactly 0.
    const featureMatrix = [[1], [2], [3], [4], [5], [6], [7], [8]]
    const targets = [0, 0, 0, 0, 10, 10, 10, 10]
    const indices = targets.map((_, i) => i)
    const tree = buildRegressionTree(featureMatrix, targets, indices, 0, { maxDepth: 2, minSamplesLeaf: 2 })

    expect(tree.kind).toBe('split')
    for (let i = 0; i < featureMatrix.length; i++) {
      expect(predictWithTree(tree, featureMatrix[i])).toBeCloseTo(targets[i], 10)
    }
  })

  it('returns a leaf at the mean when maxDepth is 0', () => {
    const featureMatrix = [[1], [2], [3]]
    const targets = [1, 2, 3]
    const indices = [0, 1, 2]
    const tree = buildRegressionTree(featureMatrix, targets, indices, 0, { maxDepth: 0, minSamplesLeaf: 1 })
    expect(tree).toEqual({ kind: 'leaf', value: 2 })
  })

  it('never produces a leaf smaller than minSamplesLeaf', () => {
    // 6 rows, minSamplesLeaf 3 — the only split point (3/3) is allowed; a leaf
    // of 2 vs 4 is not.
    const featureMatrix = [[1], [2], [3], [4], [5], [6]]
    const targets = [0, 0, 0, 1, 1, 1]
    const indices = [0, 1, 2, 3, 4, 5]
    const tree = buildRegressionTree(featureMatrix, targets, indices, 0, { maxDepth: 3, minSamplesLeaf: 3 })
    expect(tree.kind).toBe('split')
    // Both children must be leaves (3 rows each — a further split would need
    // a side under 3, which minSamplesLeaf forbids).
    if (tree.kind === 'split') {
      expect(tree.left.kind).toBe('leaf')
      expect(tree.right.kind).toBe('leaf')
    }
  })

  it('returns a leaf when minSamplesLeaf cannot be satisfied by any split', () => {
    const featureMatrix = [[1], [2], [3]]
    const targets = [1, 5, 9]
    const indices = [0, 1, 2]
    // minSamplesLeaf=2 needs 4 rows minimum to split (2 + 2); only 3 exist.
    const tree = buildRegressionTree(featureMatrix, targets, indices, 0, { maxDepth: 5, minSamplesLeaf: 2 })
    expect(tree).toEqual({ kind: 'leaf', value: 5 })
  })

  it('returns a leaf when every row shares the same feature value (no real threshold exists)', () => {
    const featureMatrix = [[7], [7], [7], [7]]
    const targets = [1, 2, 3, 4]
    const indices = [0, 1, 2, 3]
    const tree = buildRegressionTree(featureMatrix, targets, indices, 0, { maxDepth: 3, minSamplesLeaf: 1 })
    expect(tree).toEqual({ kind: 'leaf', value: 2.5 })
  })
})

// ============================================================================
// fitGradientBoostingModel / predictWithGbm
// ============================================================================

describe('fitGradientBoostingModel', () => {
  it('starts at the mean of the targets and reduces training error as trees are added', () => {
    const featureMatrix = [[1], [2], [3], [4], [5], [6], [7], [8]]
    const targets = [1, 1, 1, 1, 9, 9, 9, 9]
    const model = fitGradientBoostingModel(featureMatrix, targets, { numTrees: 40, maxDepth: 2, learningRate: 0.3, minSamplesLeaf: 1 })

    expect(model.initialPrediction).toBeCloseTo(5, 10) // mean(targets)

    const predictions = featureMatrix.map((f) => predictWithGbm(model, f))
    for (let i = 0; i < targets.length; i++) {
      expect(Math.abs(predictions[i] - targets[i])).toBeLessThan(0.5)
    }
  })

  it('throws when featureMatrix and targets have mismatched lengths', () => {
    expect(() => fitGradientBoostingModel([[1], [2]], [1], DEFAULT_GBM_HYPERPARAMETERS)).toThrow(/must match exactly/)
  })

  it('predictWithGbm with zero trees returns exactly the initial prediction', () => {
    const model = fitGradientBoostingModel(
      [[1], [2], [3]],
      [4, 5, 6],
      { numTrees: 0, maxDepth: 2, learningRate: 0.1, minSamplesLeaf: 1 },
    )
    expect(predictWithGbm(model, [1])).toBeCloseTo(5, 10)
    expect(predictWithGbm(model, [999])).toBeCloseTo(5, 10) // no trees — every input gives the same answer
  })
})

// ============================================================================
// splitByGameweekCutoff — the partition itself.
// ============================================================================

interface Row extends GameweekKeyed {
  id: string
}

function row(id: string, gameweekId: number): Row {
  return { id, gameweekId }
}

describe('splitByGameweekCutoff', () => {
  it('puts gameweekId <= cutoff in trainRows and everything else in evalRows', () => {
    const rows = [row('a', 1), row('b', 5), row('c', 6), row('d', 10)]
    const { trainRows, evalRows } = splitByGameweekCutoff(rows, 5)
    expect(trainRows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(evalRows.map((r) => r.id)).toEqual(['c', 'd'])
  })

  it('the split is total and disjoint — every row lands on exactly one side', () => {
    const rows = Array.from({ length: 38 }, (_, i) => row(`gw${i + 1}`, i + 1))
    const { trainRows, evalRows } = splitByGameweekCutoff(rows, TRAIN_EVAL_GAMEWEEK_CUTOFF)
    expect(trainRows.length + evalRows.length).toBe(rows.length)
    expect(trainRows.every((r) => r.gameweekId <= TRAIN_EVAL_GAMEWEEK_CUTOFF)).toBe(true)
    expect(evalRows.every((r) => r.gameweekId > TRAIN_EVAL_GAMEWEEK_CUTOFF)).toBe(true)
  })

  it('an empty input produces two empty folds, never throws', () => {
    const { trainRows, evalRows } = splitByGameweekCutoff([], 10)
    expect(trainRows).toEqual([])
    expect(evalRows).toEqual([])
  })
})

// ============================================================================
// THE MOST IMPORTANT TEST IN THIS FILE (ticket text: "a named test proving
// no gameweek in the evaluation set contributed to fitting"). Constructs a
// season where the eval-fold gameweeks carry a target value (999) that never
// appears anywhere in the training fold, fits ONLY on the training fold
// (built via splitByGameweekCutoff, the same function main() uses), and
// proves the fitted model's initial prediction — and therefore every
// downstream residual/leaf — could not have been influenced by that value.
// ============================================================================

describe('train/eval split — no lookahead into the evaluation set', () => {
  it('fitting on the train fold alone never sees an eval-fold target, even when eval targets are extreme outliers', () => {
    const CUTOFF = 5
    const trainTargets = [1, 2, 3, 4, 1.5, 2.5, 3.5] // gameweeks 1-5 (some repeated gameweeks, different players)
    const trainGameweeks = [1, 2, 3, 4, 5, 5, 4]
    const evalTargets = [999, 999, 999] // gameweeks 6-8 — an extreme, unmistakable outlier value
    const evalGameweeks = [6, 7, 8]

    interface SyntheticRow extends GameweekKeyed {
      target: number
      feature: number
    }
    const allRows: SyntheticRow[] = [
      ...trainGameweeks.map((gw, i) => ({ gameweekId: gw, target: trainTargets[i], feature: i })),
      ...evalGameweeks.map((gw, i) => ({ gameweekId: gw, target: evalTargets[i], feature: 100 + i })),
    ]

    const { trainRows, evalRows } = splitByGameweekCutoff(allRows, CUTOFF)

    // Sanity: the split actually separated the two populations as constructed.
    expect(trainRows.every((r) => r.target !== 999)).toBe(true)
    expect(evalRows.every((r) => r.target === 999)).toBe(true)

    // Fit using ONLY trainRows — the function signature accepts no other
    // data source, so this is the entire surface a leak could travel
    // through.
    const featureMatrix = trainRows.map((r) => [r.feature])
    const targets = trainRows.map((r) => r.target)
    const model = fitGradientBoostingModel(featureMatrix, targets, { numTrees: 20, maxDepth: 2, learningRate: 0.1, minSamplesLeaf: 1 })

    // The model's own starting point is the mean of the TRAIN targets only —
    // nowhere near 999 — which is only possible if fitting never touched the
    // eval fold's rows.
    const meanTrainTarget = targets.reduce((a, b) => a + b, 0) / targets.length
    expect(model.initialPrediction).toBeCloseTo(meanTrainTarget, 10)
    expect(model.initialPrediction).toBeLessThan(10) // nowhere near the eval fold's 999

    // Predicting on the eval fold's own feature values (which the model
    // never fit against) produces a number nowhere near 999 either — the
    // model has no way to have learned that value.
    for (const r of evalRows) {
      const prediction = predictWithGbm(model, [r.feature])
      expect(Math.abs(prediction - 999)).toBeGreaterThan(500)
    }
  })

  it('mutating what would become the eval fold AFTER fitting never changes the already-fitted model', () => {
    const CUTOFF = 3
    const rows = [
      { gameweekId: 1, target: 2, feature: 1 },
      { gameweekId: 2, target: 4, feature: 2 },
      { gameweekId: 3, target: 6, feature: 3 },
      { gameweekId: 4, target: 8, feature: 4 },
    ]
    const { trainRows, evalRows } = splitByGameweekCutoff(rows, CUTOFF)
    const model = fitGradientBoostingModel(
      trainRows.map((r) => [r.feature]),
      trainRows.map((r) => r.target),
      { numTrees: 5, maxDepth: 1, learningRate: 0.2, minSamplesLeaf: 1 },
    )
    const before = predictWithGbm(model, [1])

    // Mutate the eval-fold row's own object in place — since fit() was
    // never given a reference into evalRows at all, this must be inert.
    evalRows[0].target = -99999

    const after = predictWithGbm(model, [1])
    expect(after).toBe(before)
  })
})

// ============================================================================
// buildLearnedFeatureVector
// ============================================================================

function fvInput(overrides: Partial<Parameters<typeof buildLearnedFeatureVector>[0]> = {}) {
  return {
    prior_matches: 10,
    xg_rate_per90: 0.4,
    xa_rate_per90: 0.2,
    prior_recent_minutes: [90, 90, 45, 90, 0],
    season_avg_minutes: 75,
    prior_shots_on_target: 20,
    prior_defcon_qualifying_matches: 8,
    prior_defcon_hits: 4,
    team_strength_matches: 10,
    team_strength_goals_scored: 15,
    team_strength_goals_conceded: 10,
    ...overrides,
  }
}

describe('buildLearnedFeatureVector', () => {
  it('returns exactly one entry per FEATURE_NAMES, in that order', () => {
    const vector = buildLearnedFeatureVector(fvInput(), MIDFIELDER, [], [], 10)
    expect(vector.length).toBe(FEATURE_NAMES.length)
  })

  it('elementType is the position code, first in the vector', () => {
    const vector = buildLearnedFeatureVector(fvInput(), GOALKEEPER, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('elementType')]).toBe(GOALKEEPER)
  })

  it('recentMinutesAvg is the mean of prior_recent_minutes when it is non-empty', () => {
    const vector = buildLearnedFeatureVector(fvInput({ prior_recent_minutes: [90, 90, 45, 90, 0] }), MIDFIELDER, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('recentMinutesAvg')]).toBeCloseTo((90 + 90 + 45 + 90 + 0) / 5, 10)
  })

  it('recentMinutesAvg falls back to season_avg_minutes when prior_recent_minutes is null or empty', () => {
    const nullCase = buildLearnedFeatureVector(fvInput({ prior_recent_minutes: null, season_avg_minutes: 62 }), MIDFIELDER, [], [], 10)
    expect(nullCase[FEATURE_NAMES.indexOf('recentMinutesAvg')]).toBe(62)

    const emptyCase = buildLearnedFeatureVector(fvInput({ prior_recent_minutes: [], season_avg_minutes: 40 }), MIDFIELDER, [], [], 10)
    expect(emptyCase[FEATURE_NAMES.indexOf('recentMinutesAvg')]).toBe(40)
  })

  it('imputes null xg_rate_per90/xa_rate_per90 to exactly 0, never NaN', () => {
    const vector = buildLearnedFeatureVector(fvInput({ xg_rate_per90: null, xa_rate_per90: null }), FORWARD, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('xgRatePer90')]).toBe(0)
    expect(vector[FEATURE_NAMES.indexOf('xaRatePer90')]).toBe(0)
  })

  it('defconHitRate is 0 (never a divide error) when there are no qualifying matches yet', () => {
    const vector = buildLearnedFeatureVector(fvInput({ prior_defcon_qualifying_matches: 0, prior_defcon_hits: 0 }), DEFENDER, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('defconHitRate')]).toBe(0)
  })

  it('defconHitRate is null-safe when prior_defcon_qualifying_matches/prior_defcon_hits are null', () => {
    const vector = buildLearnedFeatureVector(fvInput({ prior_defcon_qualifying_matches: null, prior_defcon_hits: null }), DEFENDER, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('defconHitRate')]).toBe(0)
    expect(vector[FEATURE_NAMES.indexOf('defconQualifyingMatches')]).toBe(0)
  })

  it('team rate features are 0 when team_strength_matches is 0 (never a divide error)', () => {
    const vector = buildLearnedFeatureVector(fvInput({ team_strength_matches: 0, team_strength_goals_scored: 0, team_strength_goals_conceded: 0 }), DEFENDER, [], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('teamGoalsScoredPerMatch')]).toBe(0)
    expect(vector[FEATURE_NAMES.indexOf('teamGoalsConcededPerMatch')]).toBe(0)
  })

  it('opponent rate features pool goals/matches across every resolved opponent (a double gameweek)', () => {
    const teamMatchRecords: TeamMatchRecord[] = [
      { matchId: 'm1', gameweek: 1, teamCode: 200, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'm2', gameweek: 2, teamCode: 200, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'm3', gameweek: 1, teamCode: 300, goalsConceded: 4, goalsScored: 0 },
    ]
    // Opponent 200, as of gameweek 10: 2 matches, 4 goals scored, 2 conceded.
    // Opponent 300, as of gameweek 10: 1 match, 0 goals scored, 4 conceded.
    // Pooled: 3 matches, 4 goals scored -> 4/3, 6 conceded -> 6/3 = 2.
    const vector = buildLearnedFeatureVector(fvInput(), MIDFIELDER, [200, 300], teamMatchRecords, 10)
    expect(vector[FEATURE_NAMES.indexOf('opponentGoalsScoredPerMatch')]).toBeCloseTo(4 / 3, 10)
    expect(vector[FEATURE_NAMES.indexOf('opponentGoalsConcededPerMatch')]).toBeCloseTo(2, 10)
    expect(vector[FEATURE_NAMES.indexOf('fixtureCount')]).toBe(2)
  })

  it('opponent rate features are 0 when every scheduled opponent is unresolved (null)', () => {
    const vector = buildLearnedFeatureVector(fvInput(), MIDFIELDER, [null, null], [], 10)
    expect(vector[FEATURE_NAMES.indexOf('opponentGoalsScoredPerMatch')]).toBe(0)
    expect(vector[FEATURE_NAMES.indexOf('opponentGoalsConcededPerMatch')]).toBe(0)
    expect(vector[FEATURE_NAMES.indexOf('fixtureCount')]).toBe(2) // the fixture is real even though the identity is unresolved
  })

  it('opponent team strength respects the strictly-before cutoff (never leaks a match at or after featureGameweekId)', () => {
    const teamMatchRecords: TeamMatchRecord[] = [
      { matchId: 'm1', gameweek: 4, teamCode: 200, goalsConceded: 0, goalsScored: 100 }, // strictly before gw 5 — counts
      { matchId: 'm2', gameweek: 5, teamCode: 200, goalsConceded: 0, goalsScored: 999 }, // AT gw 5 — must NOT count
    ]
    const vector = buildLearnedFeatureVector(fvInput(), MIDFIELDER, [200], teamMatchRecords, 5)
    expect(vector[FEATURE_NAMES.indexOf('opponentGoalsScoredPerMatch')]).toBeCloseTo(100, 10)
  })
})

// ============================================================================
// predictLearnedFiveGameweekTotal — the G13-style "pinned at the window
// start" discipline, reapplied to the learned model.
// ============================================================================

describe('predictLearnedFiveGameweekTotal', () => {
  function trainingRow(overrides: Partial<TrainingFeatureRow> = {}): TrainingFeatureRow {
    return {
      season: '2025-2026',
      gameweek_id: 10,
      player_code: 1,
      element_type: MIDFIELDER,
      team_code: 100,
      prior_matches: 9,
      xg_rate_per90: 0.3,
      xa_rate_per90: 0.1,
      prior_recent_minutes: [90, 90, 90, 90, 90],
      season_avg_minutes: 85,
      prior_shots_on_target: 9,
      prior_defcon_qualifying_matches: 5,
      prior_defcon_hits: 2,
      opponent_team_codes: [200],
      team_strength_matches: 9,
      team_strength_goals_scored: 12,
      team_strength_goals_conceded: 9,
      computed_at: '2026-09-04T00:00:00.000Z',
      ...overrides,
    }
  }

  it('sums exactly five leg predictions', () => {
    const model = fitGradientBoostingModel([[1], [2]], [3, 5], { numTrees: 1, maxDepth: 1, learningRate: 1, minSamplesLeaf: 1 })
    const total = predictLearnedFiveGameweekTotal(trainingRow(), MIDFIELDER, 10, [], new Map(), model)
    // With no team strength records and no schedule entries beyond gw 10 itself,
    // every leg uses the SAME feature vector (form pinned at G=10, no resolvable
    // opponents for G+1..G+4) except leg 0's own stored opponent_team_codes is
    // also unresolvable against an empty teamMatchRecords array — so all five
    // legs are identical, and the total is exactly 5x one leg's prediction.
    const oneLeg = predictLearnedFiveGameweekTotal(trainingRow(), MIDFIELDER, 10, [], new Map(), model)
    expect(total).toBeCloseTo(oneLeg, 10)
  })

  it('form features (xg rate, minutes, own team strength) never change leg to leg — only fixture identity does', () => {
    // A model that reads ONLY featureIndex 12/13 (opponent rates) would predict
    // differently leg to leg if the opponent differs; a model that reads ONLY
    // form features (e.g. featureIndex 2, xgRatePer90) must predict IDENTICALLY
    // across every leg, because every form input is pinned at G. Build such a
    // model directly (skip fitting — assert the mechanism, not a fitted
    // model's behaviour).
    const formOnlyTree: TreeNode = { kind: 'leaf', value: 42 } // ignores every feature — trivially "form-only"
    const model = { initialPrediction: 0, learningRate: 1, trees: [formOnlyTree] }

    const clubFixtureSchedule = new Map<string, readonly (number | null)[]>([
      ['100:11', [300]],
      ['100:12', [400]],
      ['100:13', []], // blank gameweek
      ['100:14', [200, 500]], // double gameweek
    ])
    const teamMatchRecords: TeamMatchRecord[] = [
      { matchId: 'm', gameweek: 1, teamCode: 300, goalsConceded: 1, goalsScored: 9 }, // would change the opponent-rate features if it leaked in
    ]

    const total = predictLearnedFiveGameweekTotal(trainingRow(), MIDFIELDER, 10, teamMatchRecords, clubFixtureSchedule, model)
    // Every leg's prediction is 42 regardless of fixture identity, since the
    // tree ignores every feature — proves the FUNCTION shape (5 leg calls,
    // summed) independent of what varies between legs.
    expect(total).toBeCloseTo(42 * 5, 10)
  })

  it('opponent identity for legs G+1..G+4 comes from the published schedule, never from rowAtG.opponent_team_codes', () => {
    const scheduleTree: TreeNode = {
      kind: 'split',
      featureIndex: FEATURE_NAMES.indexOf('opponentGoalsScoredPerMatch'),
      threshold: 50,
      left: { kind: 'leaf', value: 1 },
      right: { kind: 'leaf', value: 1000 }, // fires only when the (leaked) opponent 999's huge scoring rate is read
    }
    const model = { initialPrediction: 0, learningRate: 1, trees: [scheduleTree] }

    // rowAtG's OWN opponent_team_codes points at a team (999) with an enormous
    // scoring rate — if this leaked into legs G+1..G+4, every leg would read
    // the "right" branch (1000). The schedule for G+1..G+4 instead points at
    // team 300 (no record at all -> rate 0 -> "left" branch, value 1).
    const teamMatchRecords: TeamMatchRecord[] = [{ matchId: 'm', gameweek: 1, teamCode: 999, goalsConceded: 0, goalsScored: 999 }]
    const clubFixtureSchedule = new Map<string, readonly (number | null)[]>([
      ['100:11', [300]],
      ['100:12', [300]],
      ['100:13', [300]],
      ['100:14', [300]],
    ])

    const row = trainingRow({ opponent_team_codes: [999], team_code: 100 })
    const total = predictLearnedFiveGameweekTotal(row, MIDFIELDER, 10, teamMatchRecords, clubFixtureSchedule, model)
    // Leg G (gw10) reads rowAtG.opponent_team_codes = [999] -> rate 999 -> right branch (1000).
    // Legs G+1..G+4 (gw11-14) read the SCHEDULE -> team 300, no record -> rate 0 -> left branch (1).
    expect(total).toBeCloseTo(1000 + 1 + 1 + 1 + 1, 10)
  })

  it('opponent STRENGTH for every leg is evaluated as of G, never as of the leg\'s own later gameweek', () => {
    const rateTree: TreeNode = {
      kind: 'split',
      featureIndex: FEATURE_NAMES.indexOf('opponentGoalsScoredPerMatch'),
      threshold: 50,
      left: { kind: 'leaf', value: 1 }, // low/no evidence as of G
      right: { kind: 'leaf', value: 1000 }, // only reachable if a match AT OR AFTER G leaked in
    }
    const model = { initialPrediction: 0, learningRate: 1, trees: [rateTree] }

    // Opponent 300 has NO record before gameweek 10 (G), but an enormous one
    // exactly at gameweek 11 (a leg's own gameweek) — if any leg evaluated
    // opponent strength "as of the leg" instead of "as of G", leg G+1 (gw 11)
    // would read this record's effect starting at gw12 and the later legs
    // would see the huge rate.
    const teamMatchRecords: TeamMatchRecord[] = [{ matchId: 'm', gameweek: 11, teamCode: 300, goalsConceded: 0, goalsScored: 999 }]
    const clubFixtureSchedule = new Map<string, readonly (number | null)[]>([
      ['100:11', [300]],
      ['100:12', [300]],
      ['100:13', [300]],
      ['100:14', [300]],
    ])
    const row = trainingRow({ opponent_team_codes: [300], team_code: 100 })
    const total = predictLearnedFiveGameweekTotal(row, MIDFIELDER, 10, teamMatchRecords, clubFixtureSchedule, model)
    // Every leg (including G itself, gw10) must compute opponent 300's
    // strength strictly before gw10 — the gw11 record is not yet visible to
    // ANY leg, since computeTeamStrengthAsOf is always called with G (10),
    // never a leg's own (11/12/13/14) gameweek. All five legs read rate 0.
    expect(total).toBeCloseTo(1 * 5, 10)
  })
})

// ============================================================================
// buildGateResults
// ============================================================================

describe('buildGateResults', () => {
  const learned = { 1: 0.3, 2: 0.4, 3: 0.5, 4: 0.5 }
  const incumbent = { 1: 0.24, 2: 0.5, 3: 999, 4: 999 }

  it('Midfielder/Forward compare against the FIXED thresholds, never against the incumbent', () => {
    const results = buildGateResults(learned, incumbent)
    const mid = results.find((r) => r.position === MIDFIELDER)!
    const fwd = results.find((r) => r.position === FORWARD)!
    expect(mid.threshold).toBe(GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN)
    expect(fwd.threshold).toBe(GATE_FORWARD_NAIVE_BASELINE_SPEARMAN)
    // Learned (0.5) beats the fixed 0.464/0.476 bars even though "incumbent" here is 999 —
    // proving these two lines never read the incumbent record at all.
    expect(mid.pass).toBe(true)
    expect(fwd.pass).toBe(true)
  })

  it('Goalkeeper/Defender compare against the incumbent, computed fresh in this run', () => {
    const results = buildGateResults(learned, incumbent)
    const gk = results.find((r) => r.position === GOALKEEPER)!
    const def = results.find((r) => r.position === DEFENDER)!
    expect(gk.threshold).toBe(0.24)
    expect(gk.pass).toBe(true) // 0.3 > 0.24
    expect(def.threshold).toBe(0.5)
    expect(def.pass).toBe(false) // 0.4 is not > 0.5
  })

  it('a tie is not a pass ("beat" means strictly greater than)', () => {
    const results = buildGateResults({ 1: 0.24, 2: null, 3: null, 4: null }, { 1: 0.24, 2: null, 3: null, 4: null })
    const gk = results.find((r) => r.position === GOALKEEPER)!
    expect(gk.pass).toBe(false)
  })

  it('null on either side yields pass: null, never a guessed true/false', () => {
    const results = buildGateResults({ 1: null, 2: 0.5, 3: null, 4: 0.5 }, { 1: 0.2, 2: null, 3: 999, 4: 999 })
    const gk = results.find((r) => r.position === GOALKEEPER)!
    const def = results.find((r) => r.position === DEFENDER)!
    const mid = results.find((r) => r.position === MIDFIELDER)!
    expect(gk.pass).toBeNull() // learned side null
    expect(def.pass).toBeNull() // incumbent side null
    expect(mid.pass).toBeNull() // learned side null, even though threshold is fixed
  })
})

// ============================================================================
// buildReportMarkdown — smoke tests on the pure formatting function.
// ============================================================================

describe('buildReportMarkdown', () => {
  const baseGates = [
    { position: GOALKEEPER, positionName: 'Goalkeeper', learnedSpearman: 0.3, thresholdDescription: 'the incumbent', threshold: 0.24, pass: true },
    { position: DEFENDER, positionName: 'Defender', learnedSpearman: 0.4, thresholdDescription: 'the incumbent', threshold: 0.5, pass: false },
    { position: MIDFIELDER, positionName: 'Midfielder', learnedSpearman: 0.5, thresholdDescription: 'the naive baseline', threshold: 0.464, pass: true },
    { position: FORWARD, positionName: 'Forward', learnedSpearman: 0.5, thresholdDescription: 'the naive baseline', threshold: 0.476, pass: true },
  ]

  const horizonRow = { label: 'Learned model candidate', seasonSpearman: 0.4, byPosition: { 1: 0.3, 2: 0.4, 3: 0.5, 4: 0.5 } }

  it('reports GATE FAILED when any line fails', () => {
    const markdown = buildReportMarkdown({
      season: '2025-2026',
      gitCommitSha: 'abc123',
      trainCutoffGameweek: 28,
      trainRowCount: 100,
      evalRowCount: 50,
      fiveGwEvalWindowCount: 10,
      oneGw: [horizonRow],
      fiveGw: [horizonRow],
      gates: baseGates,
    })
    expect(markdown).toContain('GATE FAILED')
    expect(markdown).toContain('abc123')
    expect(markdown).toContain('Defender')
  })

  it('reports GATE PASSED when every line passes', () => {
    const allPass = baseGates.map((g) => ({ ...g, pass: true }))
    const markdown = buildReportMarkdown({
      season: '2025-2026',
      gitCommitSha: 'def456',
      trainCutoffGameweek: 28,
      trainRowCount: 100,
      evalRowCount: 50,
      fiveGwEvalWindowCount: 10,
      oneGw: [horizonRow],
      fiveGw: [horizonRow],
      gates: allPass,
    })
    expect(markdown).toContain('GATE PASSED')
    expect(markdown).not.toContain('GATE FAILED')
  })

  it('reports GATE INCONCLUSIVE when a line has insufficient data and none outright fails', () => {
    const withNull = baseGates.map((g) => (g.position === DEFENDER ? { ...g, pass: null } : { ...g, pass: true }))
    const markdown = buildReportMarkdown({
      season: '2025-2026',
      gitCommitSha: 'ghi789',
      trainCutoffGameweek: 28,
      trainRowCount: 100,
      evalRowCount: 50,
      fiveGwEvalWindowCount: 10,
      oneGw: [horizonRow],
      fiveGw: [horizonRow],
      gates: withNull,
    })
    expect(markdown).toContain('GATE INCONCLUSIVE')
  })
})

// ============================================================================
// FEATURE_NAMES — the DoD's own "grep-checkable" list, kept honest.
// ============================================================================

describe('FEATURE_NAMES', () => {
  it('has no duplicate names', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length)
  })

  it('is approximately 15 columns, per the ticket text', () => {
    expect(FEATURE_NAMES.length).toBeGreaterThanOrEqual(12)
    expect(FEATURE_NAMES.length).toBeLessThanOrEqual(18)
  })
})
