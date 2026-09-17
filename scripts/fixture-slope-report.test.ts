// Unit tests for scripts/fixture-slope-report.ts -- ticket #244.
//
// No live network call in any test here: every pure function is proven on
// constructed rows/records, the same constraint every other scripts/*.ts
// test file in this repo documents for its own main() (see e.g.
// team-strength-diagnostic.test.ts's own header). fetchPopulation() and
// main() are exercised only by actually running the script (`npx tsx
// scripts/fixture-slope-report.ts`), which this ticket's Builder did against
// real FPL-Core-Insights data -- see the Builder's report and
// ./out/fixture-slope-report.md for that real run's output.

import { describe, expect, it } from 'vitest'
import {
  BUCKET_LABELS,
  BUCKET_UPPER_BOUNDS,
  MATERIALITY_BAND_FRACTION,
  MIN_MEASURED_TEAM_MATCHES,
  MODEL_IMPLIED_CONCEDED_SLOPE,
  PUBLISHED_SCORED_BUCKET_MEANS,
  SCORED_REPRODUCTION_TOLERANCE,
  actualCleanSheetRate,
  bucketCleanSheetStats,
  bucketIndexForExpectedScore,
  bucketRows,
  buildMeasuredRows,
  checkCleanSheetGate,
  checkFalsificationGate,
  cleanSheetLambdaNew,
  cleanSheetLambdaOld,
  endpointSlope,
  isMateriallyFlatterThanModel,
  meanAbsoluteError,
  meanPredictedCleanSheetRate,
  weightedLinearFit,
  type MeasuredRow,
} from './fixture-slope-report.ts'
import { computeFixtureExpectedScore, SCALE, type TeamMatchRecord } from '../src/lib/projection/teamStrength.ts'

// ============================================================================
// bucketIndexForExpectedScore -- the bucketing boundaries. Named tests per
// the DoD.
// ============================================================================

describe('bucketIndexForExpectedScore -- bucketing boundaries', () => {
  it('BUCKET_UPPER_BOUNDS and BUCKET_LABELS match #184\'s own published table', () => {
    expect(BUCKET_UPPER_BOUNDS).toEqual([0.35, 0.45, 0.55, 0.65])
    expect(BUCKET_LABELS).toEqual(['0.00–0.35', '0.35–0.45', '0.45–0.55', '0.55–0.65', '0.65–1.01'])
  })

  it('a value exactly ON each interior boundary resolves to the UPPER bucket (lower-inclusive/upper-exclusive except the last)', () => {
    expect(bucketIndexForExpectedScore(0.35)).toBe(1)
    expect(bucketIndexForExpectedScore(0.45)).toBe(2)
    expect(bucketIndexForExpectedScore(0.55)).toBe(3)
    expect(bucketIndexForExpectedScore(0.65)).toBe(4)
  })

  it('a value just below each boundary stays in the lower bucket', () => {
    expect(bucketIndexForExpectedScore(0.349999)).toBe(0)
    expect(bucketIndexForExpectedScore(0.449999)).toBe(1)
    expect(bucketIndexForExpectedScore(0.549999)).toBe(2)
    expect(bucketIndexForExpectedScore(0.649999)).toBe(3)
  })

  it('the two extremes land in bucket 0 and bucket 4', () => {
    expect(bucketIndexForExpectedScore(0)).toBe(0)
    expect(bucketIndexForExpectedScore(1)).toBe(4)
  })

  it('the middle of each bucket resolves to that bucket', () => {
    expect(bucketIndexForExpectedScore(0.1)).toBe(0)
    expect(bucketIndexForExpectedScore(0.4)).toBe(1)
    expect(bucketIndexForExpectedScore(0.5)).toBe(2)
    expect(bucketIndexForExpectedScore(0.6)).toBe(3)
    expect(bucketIndexForExpectedScore(0.9)).toBe(4)
  })
})

// ============================================================================
// bucketRows -- n, mean expectedScore, mean actual goals scored/conceded.
// ============================================================================

describe('bucketRows', () => {
  const rows: MeasuredRow[] = [
    { matchId: 'm1', gameweek: 5, teamCode: 1, expectedScoreValue: 0.1, actualGoalsScored: 0, actualGoalsConceded: 3 },
    { matchId: 'm2', gameweek: 5, teamCode: 2, expectedScoreValue: 0.2, actualGoalsScored: 1, actualGoalsConceded: 2 },
    { matchId: 'm3', gameweek: 6, teamCode: 3, expectedScoreValue: 0.5, actualGoalsScored: 2, actualGoalsConceded: 1 },
    { matchId: 'm4', gameweek: 7, teamCode: 4, expectedScoreValue: 0.9, actualGoalsScored: 3, actualGoalsConceded: 0 },
  ]

  it('groups rows into the correct bucket and reports n, mean es, mean actual scored/conceded', () => {
    const buckets = bucketRows(rows)
    expect(buckets).toHaveLength(5)
    expect(buckets[0].n).toBe(2) // 0.1 and 0.2
    expect(buckets[0].meanExpectedScore).toBeCloseTo(0.15, 10)
    expect(buckets[0].meanActualGoalsScored).toBeCloseTo(0.5, 10)
    expect(buckets[0].meanActualGoalsConceded).toBeCloseTo(2.5, 10)
    expect(buckets[2].n).toBe(1) // 0.5
    expect(buckets[4].n).toBe(1) // 0.9
    expect(buckets[1].n).toBe(0)
    expect(buckets[3].n).toBe(0)
  })

  it('an empty bucket reports n=0 and mean 0, never NaN', () => {
    const buckets = bucketRows(rows)
    expect(buckets[1].n).toBe(0)
    expect(Number.isNaN(buckets[1].meanExpectedScore)).toBe(false)
    expect(buckets[1].meanExpectedScore).toBe(0)
  })

  it('an empty population produces five empty buckets, not an error', () => {
    const buckets = bucketRows([])
    expect(buckets).toHaveLength(5)
    for (const b of buckets) expect(b.n).toBe(0)
  })
})

// ============================================================================
// endpointSlope and weightedLinearFit -- the two slope figures, matching
// #184's own presentation. weightedLinearFit against a known synthetic
// input is a named test per the DoD.
// ============================================================================

describe('endpointSlope', () => {
  it('is (high bucket y - low bucket y) / (high bucket x - low bucket x), over the first and last bucket only', () => {
    const buckets = bucketRows([
      { matchId: 'a', gameweek: 1, teamCode: 1, expectedScoreValue: 0.1, actualGoalsScored: 1, actualGoalsConceded: 2 },
      { matchId: 'b', gameweek: 1, teamCode: 2, expectedScoreValue: 0.9, actualGoalsScored: 3, actualGoalsConceded: 0.4 },
    ])
    // bucket 0 mean es = 0.1, y = 1; bucket 4 mean es = 0.9, y = 3.
    expect(endpointSlope(buckets, (b) => b.meanActualGoalsScored)).toBeCloseTo((3 - 1) / (0.9 - 0.1), 10)
    expect(endpointSlope(buckets, (b) => b.meanActualGoalsConceded)).toBeCloseTo((0.4 - 2) / (0.9 - 0.1), 10)
  })
})

describe('weightedLinearFit -- weighted least-squares fit against a known synthetic input (named test per the DoD)', () => {
  it('recovers the exact line y = 2 + 3x when every point lies exactly on it, regardless of weights', () => {
    const points = [
      { x: 0, y: 2, weight: 10 },
      { x: 1, y: 5, weight: 20 },
      { x: 2, y: 8, weight: 5 },
      { x: 3, y: 11, weight: 100 },
    ]
    const fit = weightedLinearFit(points)
    expect(fit.slope).toBeCloseTo(3, 8)
    expect(fit.intercept).toBeCloseTo(2, 8)
  })

  it('a hand-computed unequal-weight case: two points, weights 1 and 3 -- matches the textbook weighted normal-equations formula directly', () => {
    // x=0,y=0,w=1 and x=1,y=4,w=3.
    // W=4, Wx=3, Wy=12, Wxx=3, Wxy=12.
    // slope = (4*12 - 3*12) / (4*3 - 3*3) = (48-36)/(12-9) = 12/3 = 4.
    // intercept = (12 - 4*3)/4 = 0/4 = 0.
    const fit = weightedLinearFit([
      { x: 0, y: 0, weight: 1 },
      { x: 1, y: 4, weight: 3 },
    ])
    expect(fit.slope).toBeCloseTo(4, 10)
    expect(fit.intercept).toBeCloseTo(0, 10)
  })

  it('a zero-weight point contributes nothing to the fit', () => {
    const withZero = weightedLinearFit([
      { x: 0, y: 0, weight: 1 },
      { x: 1, y: 4, weight: 3 },
      { x: 100, y: -9999, weight: 0 },
    ])
    const without = weightedLinearFit([
      { x: 0, y: 0, weight: 1 },
      { x: 1, y: 4, weight: 3 },
    ])
    expect(withZero.slope).toBeCloseTo(without.slope, 10)
    expect(withZero.intercept).toBeCloseTo(without.intercept, 10)
  })

  it('all-zero weights returns 0/0 rather than throwing or NaN propagating unexpectedly', () => {
    const fit = weightedLinearFit([
      { x: 0, y: 0, weight: 0 },
      { x: 1, y: 4, weight: 0 },
    ])
    expect(fit.slope).toBe(0)
    expect(fit.intercept).toBe(0)
  })

  it('reproduces #184\'s own reported weighted slope (~1.50) on its own published bucket table', () => {
    // fixture.ts's own ATTACKING_MULTIPLIER_OFFSET comment table.
    const buckets = [
      { x: 0.251, y: 1.04, weight: 123 },
      { x: 0.401, y: 1.23, weight: 138 },
      { x: 0.5, y: 1.35, weight: 176 },
      { x: 0.599, y: 1.61, weight: 138 },
      { x: 0.749, y: 1.75, weight: 123 },
    ]
    const fit = weightedLinearFit(buckets)
    expect(fit.slope).toBeGreaterThan(1.4)
    expect(fit.slope).toBeLessThan(1.6)
  })
})

// ============================================================================
// isMateriallyFlatterThanModel -- the +/-15% decision band.
// ============================================================================

describe('isMateriallyFlatterThanModel', () => {
  it('MODEL_IMPLIED_CONCEDED_SLOPE is -2.9 (at the current LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45) and the band fraction is 15%', () => {
    expect(MODEL_IMPLIED_CONCEDED_SLOPE).toBeCloseTo(-2.9, 10)
    expect(MATERIALITY_BAND_FRACTION).toBe(0.15)
  })

  it('the model-implied slope itself is never "materially flatter" than itself', () => {
    expect(isMateriallyFlatterThanModel(MODEL_IMPLIED_CONCEDED_SLOPE)).toBe(false)
  })

  it('exactly at the +/-15% boundary is NOT materially flatter (boundary is inclusive of "within")', () => {
    expect(isMateriallyFlatterThanModel(MODEL_IMPLIED_CONCEDED_SLOPE * 0.85)).toBe(false)
    expect(isMateriallyFlatterThanModel(MODEL_IMPLIED_CONCEDED_SLOPE * 1.15)).toBe(false)
  })

  it('just outside the +/-15% boundary IS materially flatter', () => {
    expect(isMateriallyFlatterThanModel(MODEL_IMPLIED_CONCEDED_SLOPE * 0.849)).toBe(true)
    expect(isMateriallyFlatterThanModel(MODEL_IMPLIED_CONCEDED_SLOPE * 1.151)).toBe(true)
  })

  it('the real measured value (~-1.43, per the Builder\'s live run) is materially flatter', () => {
    expect(isMateriallyFlatterThanModel(-1.43)).toBe(true)
  })

  it('a positive slope (wrong sign) is judged on magnitude, not sign -- still materially flatter if its magnitude is far from 2.9', () => {
    expect(isMateriallyFlatterThanModel(1.43)).toBe(true)
  })
})

// ============================================================================
// checkFalsificationGate.
// ============================================================================

describe('checkFalsificationGate', () => {
  const passingBuckets = bucketRows(
    PUBLISHED_SCORED_BUCKET_MEANS.map((mean, i) => ({
      matchId: `m${i}`,
      gameweek: 1,
      teamCode: i,
      expectedScoreValue: [0.25, 0.4, 0.5, 0.6, 0.75][i],
      actualGoalsScored: mean,
      actualGoalsConceded: 0,
    })),
  )

  it('population gate passes at exactly the minimum and fails one below it', () => {
    expect(checkFalsificationGate(MIN_MEASURED_TEAM_MATCHES, passingBuckets).populationGate.passed).toBe(true)
    expect(checkFalsificationGate(MIN_MEASURED_TEAM_MATCHES - 1, passingBuckets).populationGate.passed).toBe(false)
  })

  it('reproduction gate passes when every bucket mean matches the published figure exactly', () => {
    const gate = checkFalsificationGate(700, passingBuckets)
    expect(gate.reproductionGate.passed).toBe(true)
    expect(gate.reproductionGate.deltas.every((d) => d === 0)).toBe(true)
  })

  it('reproduction gate fails when one bucket is off by more than the tolerance', () => {
    const badBuckets = bucketRows([
      { matchId: 'm0', gameweek: 1, teamCode: 0, expectedScoreValue: 0.25, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[0] + SCORED_REPRODUCTION_TOLERANCE + 0.01, actualGoalsConceded: 0 },
      { matchId: 'm1', gameweek: 1, teamCode: 1, expectedScoreValue: 0.4, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[1], actualGoalsConceded: 0 },
      { matchId: 'm2', gameweek: 1, teamCode: 2, expectedScoreValue: 0.5, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[2], actualGoalsConceded: 0 },
      { matchId: 'm3', gameweek: 1, teamCode: 3, expectedScoreValue: 0.6, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[3], actualGoalsConceded: 0 },
      { matchId: 'm4', gameweek: 1, teamCode: 4, expectedScoreValue: 0.75, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[4], actualGoalsConceded: 0 },
    ])
    const gate = checkFalsificationGate(700, badBuckets)
    expect(gate.reproductionGate.passed).toBe(false)
    expect(Math.abs(gate.reproductionGate.deltas[0])).toBeGreaterThan(SCORED_REPRODUCTION_TOLERANCE)
  })

  it('exactly AT the tolerance boundary still passes (inclusive)', () => {
    const boundaryBuckets = bucketRows([
      { matchId: 'm0', gameweek: 1, teamCode: 0, expectedScoreValue: 0.25, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[0] + SCORED_REPRODUCTION_TOLERANCE, actualGoalsConceded: 0 },
      { matchId: 'm1', gameweek: 1, teamCode: 1, expectedScoreValue: 0.4, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[1], actualGoalsConceded: 0 },
      { matchId: 'm2', gameweek: 1, teamCode: 2, expectedScoreValue: 0.5, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[2], actualGoalsConceded: 0 },
      { matchId: 'm3', gameweek: 1, teamCode: 3, expectedScoreValue: 0.6, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[3], actualGoalsConceded: 0 },
      { matchId: 'm4', gameweek: 1, teamCode: 4, expectedScoreValue: 0.75, actualGoalsScored: PUBLISHED_SCORED_BUCKET_MEANS[4], actualGoalsConceded: 0 },
    ])
    expect(checkFalsificationGate(700, boundaryBuckets).reproductionGate.passed).toBe(true)
  })
})

// ============================================================================
// buildMeasuredRows -- opponent lookup by matchId, and TEAM_STRENGTH_SHRINKAGE_K
// = 0 on this path. Named test for K=0 per the DoD.
// ============================================================================

describe('buildMeasuredRows', () => {
  // Two clubs (1 and 2) with a clearly unequal (but not certainty-clamping)
  // prior record as of gameweek 10: club 1 has won every prior match 1-0,
  // club 2 has lost every prior match 0-1. Each prior match has both sides
  // recorded (against throwaway opponents 100+gw / 200+gw) so every record
  // resolves an opponent and skippedNoOpponentRecord stays 0. Both clubs
  // have well over MIN_TEAM_PRIOR_MATCHES (3) prior matches, so a real
  // (non-neutral-fallback) expectedScore is computed for their gameweek-10
  // meeting.
  function priorRecords(): TeamMatchRecord[] {
    const records: TeamMatchRecord[] = []
    for (let gw = 1; gw <= 4; gw++) {
      records.push({ matchId: `prior-1-${gw}`, gameweek: gw, teamCode: 1, goalsScored: 1, goalsConceded: 0 })
      records.push({ matchId: `prior-1-${gw}`, gameweek: gw, teamCode: 100 + gw, goalsScored: 0, goalsConceded: 1 })
      records.push({ matchId: `prior-2-${gw}`, gameweek: gw, teamCode: 2, goalsScored: 0, goalsConceded: 1 })
      records.push({ matchId: `prior-2-${gw}`, gameweek: gw, teamCode: 200 + gw, goalsScored: 1, goalsConceded: 0 })
    }
    return records
  }

  it('builds one row per side of a resolvable match, with the opponent found by matchId (not team pairing)', () => {
    const records: TeamMatchRecord[] = [
      ...priorRecords(),
      { matchId: 'final', gameweek: 10, teamCode: 1, goalsScored: 2, goalsConceded: 1 },
      { matchId: 'final', gameweek: 10, teamCode: 2, goalsScored: 1, goalsConceded: 2 },
    ]
    const { rows, skippedNoOpponentRecord } = buildMeasuredRows(records)
    expect(skippedNoOpponentRecord).toBe(0)
    const finalRows = rows.filter((r) => r.matchId === 'final')
    expect(finalRows).toHaveLength(2)
    const team1Row = finalRows.find((r) => r.teamCode === 1)!
    const team2Row = finalRows.find((r) => r.teamCode === 2)!
    expect(team1Row.actualGoalsScored).toBe(2)
    expect(team1Row.actualGoalsConceded).toBe(1)
    expect(team2Row.actualGoalsScored).toBe(1)
    expect(team2Row.actualGoalsConceded).toBe(2)
    // Club 1 (much stronger prior record) should have a HIGHER expectedScore
    // than club 2 in the same fixture.
    expect(team1Row.expectedScoreValue).toBeGreaterThan(team2Row.expectedScoreValue)
    expect(team1Row.expectedScoreValue).toBeGreaterThan(0.5)
    expect(team2Row.expectedScoreValue).toBeLessThan(0.5)
  })

  it('TEAM_STRENGTH_SHRINKAGE_K = 0 on this path -- named test per the DoD: matches computeFixtureExpectedScore(..., shrinkageK=0) exactly, and differs from the K=5 default', () => {
    const records: TeamMatchRecord[] = [
      ...priorRecords(),
      { matchId: 'final', gameweek: 10, teamCode: 1, goalsScored: 2, goalsConceded: 1 },
      { matchId: 'final', gameweek: 10, teamCode: 2, goalsScored: 1, goalsConceded: 2 },
    ]
    const { rows } = buildMeasuredRows(records)
    const team1Row = rows.find((r) => r.matchId === 'final' && r.teamCode === 1)!

    // Hand-computed via the SAME unmodified library function, shrinkageK=0 explicit.
    const ownStrength = { matches: 4, goalsScored: 4, goalsConceded: 0 }
    const opponentStrength = { matches: 4, goalsScored: 0, goalsConceded: 4 }
    const expectedAtK0 = computeFixtureExpectedScore(ownStrength, opponentStrength, SCALE, 0, 0)
    const expectedAtK5Default = computeFixtureExpectedScore(ownStrength, opponentStrength, SCALE, 0, 5)

    expect(team1Row.expectedScoreValue).toBeCloseTo(expectedAtK0, 10)
    // K=0 and K=5 give genuinely different numbers for this lopsided a
    // record -- proves this script is not accidentally using the K=5 default.
    expect(Math.abs(expectedAtK0 - expectedAtK5Default)).toBeGreaterThan(0.001)
    expect(team1Row.expectedScoreValue).not.toBeCloseTo(expectedAtK5Default, 3)
  })

  it('a match missing its opponent-side record is skipped and counted, never guessed', () => {
    const records: TeamMatchRecord[] = [{ matchId: 'orphan', gameweek: 1, teamCode: 1, goalsScored: 1, goalsConceded: 0 }]
    const { rows, skippedNoOpponentRecord } = buildMeasuredRows(records)
    expect(rows).toHaveLength(0)
    expect(skippedNoOpponentRecord).toBe(1)
  })

  it('a team with fewer than MIN_TEAM_PRIOR_MATCHES prior matches on either side falls to the neutral 0.5 expectedScore, and is still counted in the population (not excluded)', () => {
    const records: TeamMatchRecord[] = [
      { matchId: 'early', gameweek: 1, teamCode: 5, goalsScored: 4, goalsConceded: 0 },
      { matchId: 'early', gameweek: 1, teamCode: 6, goalsScored: 0, goalsConceded: 4 },
    ]
    const { rows } = buildMeasuredRows(records)
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.expectedScoreValue).toBe(0.5)
  })
})

// ============================================================================
// Gate 3 (replaced) -- clean-sheet probability check computed from the SAME
// measured rows, no Supabase. See scripts/fixture-slope-report.ts's own
// comment above checkCleanSheetGate for the full "why" (LEARNINGS
// -second-build-wave.md §20; the original gate needed a live before/after
// calibration-report.ts run this Builder session cannot do).
// ============================================================================

describe('cleanSheetLambdaOld / cleanSheetLambdaNew', () => {
  it('reproduce the two formulas by hand: b x 2 x (1-es), and b x (1.5-es)', () => {
    expect(cleanSheetLambdaOld(1.45, 0.3)).toBeCloseTo(1.45 * 2 * 0.7, 12)
    expect(cleanSheetLambdaNew(1.45, 0.3)).toBeCloseTo(1.45 * 1.2, 12)
  })
  it('both equal leagueBaselineGoals exactly at es = 0.5 -- an even fixture is unadjusted under both formulas', () => {
    expect(cleanSheetLambdaOld(1.45, 0.5)).toBeCloseTo(1.45, 12)
    expect(cleanSheetLambdaNew(1.45, 0.5)).toBeCloseTo(1.45, 12)
  })
})

describe('meanPredictedCleanSheetRate -- the exp(-lambda) bucket-mean helper, against a known synthetic input (named test per the spec)', () => {
  const rows: MeasuredRow[] = [
    { matchId: 'a', gameweek: 1, teamCode: 1, expectedScoreValue: 0.3, actualGoalsScored: 0, actualGoalsConceded: 2 },
    { matchId: 'b', gameweek: 1, teamCode: 2, expectedScoreValue: 0.6, actualGoalsScored: 0, actualGoalsConceded: 1 },
    { matchId: 'c', gameweek: 1, teamCode: 3, expectedScoreValue: 0.9, actualGoalsScored: 0, actualGoalsConceded: 0 },
  ]
  const leagueBaselineGoals = 1.45

  it('OLD lambda (b x 2 x (1-es)): pooled mean of exp(-lambda) over the three rows matches the hand-computed value', () => {
    // Hand-computed (leagueBaselineGoals=1.45, lambdaOld = 1.45*2*(1-es)):
    //   es=0.3 -> lambda=2.03 -> exp(-2.03) = 0.131335521148...
    //   es=0.6 -> lambda=1.16 -> exp(-1.16) = 0.313486180882...
    //   es=0.9 -> lambda=0.29 -> exp(-0.29) = 0.748263567578...
    // mean = 0.397695089869...
    const rate = meanPredictedCleanSheetRate(rows, leagueBaselineGoals, cleanSheetLambdaOld)
    expect(rate).toBeCloseTo(0.397695089869, 9)
  })

  it('NEW lambda (b x (1.5-es)): pooled mean of exp(-lambda) over the SAME three rows matches the hand-computed value', () => {
    // Hand-computed (lambdaNew = 1.45*(1.5-es)):
    //   es=0.3 -> lambda=1.74  -> exp(-1.74) = 0.175520400616...
    //   es=0.6 -> lambda=1.305 -> exp(-1.305) = 0.271172535045...
    //   es=0.9 -> lambda=0.87  -> exp(-0.87) = 0.418951549247...
    // mean = 0.288548161636...
    const rate = meanPredictedCleanSheetRate(rows, leagueBaselineGoals, cleanSheetLambdaNew)
    expect(rate).toBeCloseTo(0.288548161636, 9)
  })

  it('an empty row set returns 0, not NaN', () => {
    expect(meanPredictedCleanSheetRate([], leagueBaselineGoals, cleanSheetLambdaOld)).toBe(0)
  })

  it('pools directly, never a two-level mean-of-means: matches a hand-summed/divided average, not an average of two sub-group averages', () => {
    // Splitting the same 3 rows into a group of 1 and a group of 2 and
    // averaging THOSE two group-means would give a different (wrong) number
    // from the single pooled mean over all 3 rows -- this test proves the
    // function does the latter.
    const group1 = rows.slice(0, 1) // just the es=0.3 row
    const group2 = rows.slice(1) // the es=0.6 and es=0.9 rows
    const rate1 = meanPredictedCleanSheetRate(group1, leagueBaselineGoals, cleanSheetLambdaOld)
    const rate2 = meanPredictedCleanSheetRate(group2, leagueBaselineGoals, cleanSheetLambdaOld)
    const wrongMeanOfMeans = (rate1 + rate2) / 2
    const pooled = meanPredictedCleanSheetRate(rows, leagueBaselineGoals, cleanSheetLambdaOld)
    expect(pooled).not.toBeCloseTo(wrongMeanOfMeans, 6)
    expect(pooled).toBeCloseTo(0.397695089869, 9)
  })
})

describe('actualCleanSheetRate', () => {
  it('is the share of rows with actualGoalsConceded === 0', () => {
    const rows: MeasuredRow[] = [
      { matchId: 'a', gameweek: 1, teamCode: 1, expectedScoreValue: 0.5, actualGoalsScored: 1, actualGoalsConceded: 0 },
      { matchId: 'b', gameweek: 1, teamCode: 2, expectedScoreValue: 0.5, actualGoalsScored: 1, actualGoalsConceded: 1 },
      { matchId: 'c', gameweek: 1, teamCode: 3, expectedScoreValue: 0.5, actualGoalsScored: 1, actualGoalsConceded: 0 },
      { matchId: 'd', gameweek: 1, teamCode: 4, expectedScoreValue: 0.5, actualGoalsScored: 1, actualGoalsConceded: 3 },
    ]
    expect(actualCleanSheetRate(rows)).toBeCloseTo(0.5, 12)
  })
  it('an empty row set returns 0, not NaN', () => {
    expect(actualCleanSheetRate([])).toBe(0)
  })
})

describe('bucketCleanSheetStats', () => {
  it('groups rows into the SAME 5 buckets bucketRows uses, and reports n plus all three pooled rates per bucket', () => {
    const rows: MeasuredRow[] = [
      { matchId: 'a', gameweek: 1, teamCode: 1, expectedScoreValue: 0.1, actualGoalsScored: 0, actualGoalsConceded: 0 },
      { matchId: 'b', gameweek: 1, teamCode: 2, expectedScoreValue: 0.2, actualGoalsScored: 0, actualGoalsConceded: 2 },
      { matchId: 'c', gameweek: 1, teamCode: 3, expectedScoreValue: 0.9, actualGoalsScored: 0, actualGoalsConceded: 1 },
    ]
    const buckets = bucketCleanSheetStats(rows, 1.45)
    expect(buckets).toHaveLength(5)
    expect(buckets[0].n).toBe(2)
    expect(buckets[0].actualCleanSheetRate).toBeCloseTo(0.5, 12) // one of the two conceded 0
    expect(buckets[4].n).toBe(1)
    expect(buckets[4].actualCleanSheetRate).toBe(0)
    expect(buckets[1].n).toBe(0)
    expect(buckets[1].actualCleanSheetRate).toBe(0)
  })
})

describe('meanAbsoluteError', () => {
  it('is the unweighted mean of |predicted - actual| across all buckets, regardless of bucket n', () => {
    const buckets = [
      { label: 'a', n: 1000, actualCleanSheetRate: 0.2, oldPredictedCleanSheetRate: 0.3, newPredictedCleanSheetRate: 0.25 },
      { label: 'b', n: 1, actualCleanSheetRate: 0.5, oldPredictedCleanSheetRate: 0.5, newPredictedCleanSheetRate: 0.9 },
    ]
    // OLD errors: |0.3-0.2|=0.1, |0.5-0.5|=0 -> mean 0.05.
    // NEW errors: |0.25-0.2|=0.05, |0.9-0.5|=0.4 -> mean 0.225.
    expect(meanAbsoluteError(buckets, (b) => b.oldPredictedCleanSheetRate)).toBeCloseTo(0.05, 12)
    expect(meanAbsoluteError(buckets, (b) => b.newPredictedCleanSheetRate)).toBeCloseTo(0.225, 12)
  })
})

describe('checkCleanSheetGate', () => {
  it('PASSES when NEW MAE is strictly lower than OLD MAE', () => {
    // Construct rows where the NEW (damped) formula's clean-sheet prediction
    // is obviously closer to the observed rate than the OLD formula's, at
    // both extremes. Hand-computed (leagueBaselineGoals=1.45):
    //   es=0.2: predOld=exp(-2.32)=0.09827, predNew=exp(-1.885)=0.15183
    //   es=0.8: predOld=exp(-0.58)=0.55990, predNew=exp(-1.015)=0.36240
    // Setting the observed rate to 0.15 (low bucket, 3/20) and 0.35 (high
    // bucket, 7/20) -- close to predNew at both ends, far from predOld --
    // gives oldMae=0.05232, newMae=0.00285 (verified independently, see the
    // gate's own oldMae/newMae assertions below).
    const rows: MeasuredRow[] = []
    for (let i = 0; i < 20; i++) {
      rows.push({ matchId: `low-${i}`, gameweek: 1, teamCode: 1, expectedScoreValue: 0.2, actualGoalsScored: 0, actualGoalsConceded: i < 3 ? 0 : 2 })
    }
    for (let i = 0; i < 20; i++) {
      rows.push({ matchId: `high-${i}`, gameweek: 1, teamCode: 2, expectedScoreValue: 0.8, actualGoalsScored: 0, actualGoalsConceded: i < 7 ? 0 : 2 })
    }
    const gate = checkCleanSheetGate(rows, 1.45)
    expect(gate.oldMae).toBeCloseTo(0.05232, 4)
    expect(gate.newMae).toBeCloseTo(0.00285, 4)
    expect(gate.passed).toBe(true)
    expect(gate.newMae).toBeLessThan(gate.oldMae)
  })

  it('STOPS (passed=false) when NEW MAE is >= OLD MAE -- constructed so the OLD formula is actually the better predictor', () => {
    // Mirror-image of the PASS case: an actual clean-sheet rate that tracks
    // the STEEPER (OLD) curve, not the damped one.
    const rows: MeasuredRow[] = []
    for (let i = 0; i < 50; i++) {
      // es=0.2 (hard fixture): OLD lambda = 1.45*2*0.8=2.32 -> predicted CS rate ~0.098.
      // Set actual close to that, far from NEW's prediction (lambda=1.45*1.3=1.885 -> ~0.152).
      rows.push({ matchId: `low-${i}`, gameweek: 1, teamCode: 1, expectedScoreValue: 0.2, actualGoalsScored: 0, actualGoalsConceded: i < 5 ? 0 : 3 })
    }
    for (let i = 0; i < 50; i++) {
      // es=0.8 (easy fixture): OLD lambda=1.45*2*0.2=0.58 -> predicted CS rate ~0.560.
      rows.push({ matchId: `high-${i}`, gameweek: 1, teamCode: 2, expectedScoreValue: 0.8, actualGoalsScored: 0, actualGoalsConceded: i < 28 ? 0 : 3 })
    }
    // Hand-computed: actualLow=5/50=0.10 (close to predOld=0.0983, far from
    // predNew=0.1518); actualHigh=28/50=0.56 (close to predOld=0.5599, far
    // from predNew=0.3624) -- oldMae=0.000366, newMae=0.04989.
    const gate = checkCleanSheetGate(rows, 1.45)
    expect(gate.oldMae).toBeCloseTo(0.000366, 5)
    expect(gate.newMae).toBeCloseTo(0.04989, 4)
    expect(gate.passed).toBe(false)
    expect(gate.newMae).toBeGreaterThanOrEqual(gate.oldMae)
  })

  it('equal MAE is a STOP, not a PASS (strict inequality only)', () => {
    // Degenerate construction: force OLD and NEW to predict identically by
    // using es=0.5, where cleanSheetLambdaOld and cleanSheetLambdaNew both
    // equal leagueBaselineGoals exactly -- MAE is then necessarily equal.
    const rows: MeasuredRow[] = [
      { matchId: 'a', gameweek: 1, teamCode: 1, expectedScoreValue: 0.5, actualGoalsScored: 0, actualGoalsConceded: 0 },
      { matchId: 'b', gameweek: 1, teamCode: 2, expectedScoreValue: 0.5, actualGoalsScored: 0, actualGoalsConceded: 1 },
    ]
    const gate = checkCleanSheetGate(rows, 1.45)
    expect(gate.oldMae).toBeCloseTo(gate.newMae, 12)
    expect(gate.passed).toBe(false)
  })
})
