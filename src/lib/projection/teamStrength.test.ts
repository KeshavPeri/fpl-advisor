// Unit tests for src/lib/projection/teamStrength.ts — ticket #175's
// construction, moved here by ticket #229 (see that file's own header for
// the "because"). These are the SAME tests that lived in
// scripts/run-backtest.test.ts before the move, unchanged apart from the
// import path — see that file's own comment pointing here. New tests for
// this ticket's own additions (the `homeAdjustment` parameter and
// `HOME_EXPECTED_SCORE_BONUS`) are appended at the end, under their own
// heading.

import { describe, expect, it } from 'vitest'
import {
  buildTeamMatchRecords,
  buildTeamMatchRecordsFromFixtures,
  computeFixtureExpectedScore,
  computeTeamStrengthAsOf,
  fixtureHasSufficientHistory,
  HOME_EXPECTED_SCORE_BONUS,
  MAX_EXPECTED_SCORE,
  MIN_EXPECTED_SCORE,
  MIN_TEAM_PRIOR_MATCHES,
  NEUTRAL_EXPECTED_SCORE_VALUE,
  SCALE,
  shrunkTeamStrengthRate,
  TEAM_STRENGTH_SHRINKAGE_K,
  teamStrengthRate,
  type FixtureResultRow,
  type MatchStatsForTeamStrength,
  type TeamStrengthRecord,
} from './teamStrength.ts'

function teamStatsRow(overrides: Partial<MatchStatsForTeamStrength> & Pick<MatchStatsForTeamStrength, 'matchId' | 'gameweek' | 'teamCode'>): MatchStatsForTeamStrength {
  return {
    opponentTeamCode: null,
    teamGoalsConceded: null,
    ...overrides,
  }
}

describe('buildTeamMatchRecords — the max-across-players correction (ticket #175)', () => {
  it('a normal match: two teams, several players each — goalsConceded is the MAX across each team\'s own players, goalsScored is the opponent\'s own max', () => {
    const rows: MatchStatsForTeamStrength[] = [
      // Team 10 (three players) concedes 2 (their goalkeeper's figure — the
      // team total — while an outfield player's own goals_conceded-shaped
      // field here is irrelevant; team_goals_conceded is already the
      // TEAM figure per player, see file header).
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 10, opponentTeamCode: 20, teamGoalsConceded: 2 }),
      // Team 20 concedes 1.
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 20, opponentTeamCode: 10, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm1', gameweek: 5, teamCode: 20, opponentTeamCode: 10, teamGoalsConceded: 1 }),
    ]
    const records = buildTeamMatchRecords(rows)
    expect(records).toHaveLength(2)
    const team10 = records.find((r) => r.teamCode === 10)
    const team20 = records.find((r) => r.teamCode === 20)
    expect(team10).toEqual({ matchId: 'm1', gameweek: 5, teamCode: 10, goalsConceded: 2, goalsScored: 1 })
    expect(team20).toEqual({ matchId: 'm1', gameweek: 5, teamCode: 20, goalsConceded: 1, goalsScored: 2 })
  })

  it('a player substituted before a late goal: his 0 must not win over his goalkeeper\'s real 1 — the MAX, never the average or the first row found', () => {
    const rows: MatchStatsForTeamStrength[] = [
      // The substituted outfield player: withdrawn before the late goal, so
      // his own team_goals_conceded is 0.
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 30, opponentTeamCode: 40, teamGoalsConceded: 0 }),
      // His goalkeeper played the full 90 and saw the goal: team_goals_conceded 1.
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 30, opponentTeamCode: 40, teamGoalsConceded: 1 }),
      teamStatsRow({ matchId: 'm2', gameweek: 8, teamCode: 40, opponentTeamCode: 30, teamGoalsConceded: 0 }),
    ]
    const records = buildTeamMatchRecords(rows)
    const team30 = records.find((r) => r.teamCode === 30)
    // The average (0.5) or "first row found" (0) would both be wrong — the
    // team actually conceded 1, and only the max reproduces that.
    expect(team30?.goalsConceded).toBe(1)
    expect(team30?.goalsConceded).not.toBe(0)
    expect(team30?.goalsConceded).not.toBe(0.5)
  })

  it('a 0-0 match: both teams\' real zero is preserved, never skipped as "unknown" (a falsy-check bug would drop it)', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm3', gameweek: 2, teamCode: 50, opponentTeamCode: 60, teamGoalsConceded: 0 }),
      teamStatsRow({ matchId: 'm3', gameweek: 2, teamCode: 60, opponentTeamCode: 50, teamGoalsConceded: 0 }),
    ]
    const records = buildTeamMatchRecords(rows)
    expect(records).toHaveLength(2)
    expect(records.find((r) => r.teamCode === 50)).toEqual({ matchId: 'm3', gameweek: 2, teamCode: 50, goalsConceded: 0, goalsScored: 0 })
    expect(records.find((r) => r.teamCode === 60)).toEqual({ matchId: 'm3', gameweek: 2, teamCode: 60, goalsConceded: 0, goalsScored: 0 })
  })

  it('a match where the opponent side never resolves (no team_goals_conceded rows for it) contributes NOTHING for either side — never a guessed goalsScored', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm4', gameweek: 3, teamCode: 70, opponentTeamCode: 80, teamGoalsConceded: 1 }),
      // Team 80's own row exists (so its opponent pointer is known) but its
      // team_goals_conceded is null throughout — never resolved.
      teamStatsRow({ matchId: 'm4', gameweek: 3, teamCode: 80, opponentTeamCode: 70, teamGoalsConceded: null }),
    ]
    expect(buildTeamMatchRecords(rows)).toEqual([])
  })

  it('rows with a null teamCode are ignored entirely, never grouped under a fake key', () => {
    const rows: MatchStatsForTeamStrength[] = [
      teamStatsRow({ matchId: 'm5', gameweek: 1, teamCode: null as unknown as number, opponentTeamCode: 90, teamGoalsConceded: 1 }),
    ]
    expect(buildTeamMatchRecords(rows)).toEqual([])
  })
})

describe('computeTeamStrengthAsOf — THE LOOKAHEAD GUARD (ticket #175, the most important test in the ticket)', () => {
  it('a gameweek-3 projection sees gameweeks 1 and 2 only — never gameweek 3 itself or later', () => {
    const records = [
      { matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'b', gameweek: 2, teamCode: 1, goalsConceded: 0, goalsScored: 1 },
      // Gameweek 3's own record is deliberately huge and distinguishable —
      // a leak would be dramatic and obvious, not a rounding-level difference.
      { matchId: 'c', gameweek: 3, teamCode: 1, goalsConceded: 0, goalsScored: 100 },
      // A later gameweek, further proof `<` not `<=` is the guard.
      { matchId: 'd', gameweek: 4, teamCode: 1, goalsConceded: 0, goalsScored: 200 },
    ]
    const strength = computeTeamStrengthAsOf(records, 1, 3)
    expect(strength).toEqual({ matches: 2, goalsScored: 3, goalsConceded: 1 })
    expect(strength.goalsScored).not.toBe(103)
    expect(strength.goalsScored).not.toBe(303)
  })

  it('a gameweek-1 team has no prior record at all: matches=0, never a guessed value', () => {
    const records = [{ matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 }]
    expect(computeTeamStrengthAsOf(records, 1, 1)).toEqual({ matches: 0, goalsScored: 0, goalsConceded: 0 })
  })

  it('only the requested teamCode\'s records are summed — another team\'s history never leaks in', () => {
    const records = [
      { matchId: 'a', gameweek: 1, teamCode: 1, goalsConceded: 1, goalsScored: 2 },
      { matchId: 'a', gameweek: 1, teamCode: 2, goalsConceded: 2, goalsScored: 1 },
    ]
    expect(computeTeamStrengthAsOf(records, 1, 5)).toEqual({ matches: 1, goalsScored: 2, goalsConceded: 1 })
  })
})

describe('SCALE', () => {
  it('is 5.6225 -- see this file\'s own comment for the calibration', () => {
    expect(SCALE).toBe(5.6225)
  })
})

describe('teamStrengthRate', () => {
  it('is (goalsScored - goalsConceded) / matches', () => {
    expect(teamStrengthRate({ matches: 4, goalsScored: 10, goalsConceded: 6 })).toBeCloseTo(1, 10)
  })

  it('is 0 with no prior matches, never a division by zero', () => {
    expect(teamStrengthRate({ matches: 0, goalsScored: 0, goalsConceded: 0 })).toBe(0)
  })

  it('named test (ticket #242 DoD): is UNCHANGED by this ticket -- still the raw, unshrunk figure scripts/team-strength-diagnostic.ts\'s club table reports; shrinkage lives only in the new shrunkTeamStrengthRate, never here', () => {
    const record = { matches: 4, goalsScored: 10, goalsConceded: 6 }
    expect(teamStrengthRate(record)).toBe((record.goalsScored - record.goalsConceded) / record.matches)
    expect(teamStrengthRate(record)).not.toBe(shrunkTeamStrengthRate(record, TEAM_STRENGTH_SHRINKAGE_K))
  })
})

describe('fixtureHasSufficientHistory / MIN_TEAM_PRIOR_MATCHES (ticket #175)', () => {
  it('true only when BOTH teams meet MIN_TEAM_PRIOR_MATCHES', () => {
    const enough: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES, goalsScored: 5, goalsConceded: 3 }
    const notEnough: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 5, goalsConceded: 3 }
    expect(fixtureHasSufficientHistory(enough, enough)).toBe(true)
    expect(fixtureHasSufficientHistory(enough, notEnough)).toBe(false)
    expect(fixtureHasSufficientHistory(notEnough, enough)).toBe(false)
    expect(fixtureHasSufficientHistory(notEnough, notEnough)).toBe(false)
  })
})

describe('computeFixtureExpectedScore (ticket #175, clamp bounds and shrinkage default updated by ticket #242)', () => {
  const strong: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 } // rate = 1.5
  const weak: TeamStrengthRecord = { matches: 10, goalsScored: 5, goalsConceded: 20 } // rate = -1.5
  const identicalA: TeamStrengthRecord = { matches: 6, goalsScored: 9, goalsConceded: 6 } // rate = 0.5
  const identicalB: TeamStrengthRecord = { matches: 3, goalsScored: 4.5, goalsConceded: 3 } // rate = 0.5, different matches

  it('is exactly 0.5 when two teams have identical prior records — named test — regardless of shrinkageK, since the SAME record shrinks to the SAME value and cancels', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalA, 4)).toBe(0.5)
    expect(computeFixtureExpectedScore(identicalA, identicalA, 4, 0, 0)).toBe(0.5)
    expect(computeFixtureExpectedScore(identicalA, identicalA, 4, 0, 8)).toBe(0.5)
  })

  it('with shrinkageK = 0 (pre-#242 behaviour): 0.5 for two DIFFERENT teams whose RATE happens to be identical, regardless of scale — the delta cancels to 0, not an approximation', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalB, 1, 0, 0)).toBe(0.5)
    expect(computeFixtureExpectedScore(identicalA, identicalB, 100, 0, 0)).toBe(0.5)
  })

  it('ticket #242: with the DEFAULT (nonzero) shrinkageK, two teams with the SAME raw rate but DIFFERENT match counts no longer cancel to exactly 0.5 — shrinkage is sensitive to sample size by design (see the next describe block for the directional test)', () => {
    const withDefaultShrinkage = computeFixtureExpectedScore(identicalA, identicalB, 4)
    expect(withDefaultShrinkage).not.toBe(0.5)
  })

  it('a stronger team gets an expectedScore above 0.5, a weaker one below (default shrinkageK — symmetric here since both records have equal matches)', () => {
    const strongVsWeak = computeFixtureExpectedScore(strong, weak, 4)
    const weakVsStrong = computeFixtureExpectedScore(weak, strong, 4)
    expect(strongVsWeak).toBeGreaterThan(0.5)
    expect(weakVsStrong).toBeLessThan(0.5)
    expect(strongVsWeak + weakVsStrong).toBeCloseTo(1, 10) // symmetric around 0.5
  })

  it('ticket #242: is clamped to exactly MAX_EXPECTED_SCORE (0.95) for an extreme delta relative to scale, never a value above it', () => {
    expect(computeFixtureExpectedScore(strong, weak, 0.1)).toBe(MAX_EXPECTED_SCORE)
    expect(computeFixtureExpectedScore(strong, weak, 0.1)).toBe(0.95)
  })

  it('ticket #242: is clamped to exactly MIN_EXPECTED_SCORE (0.05) for an extreme delta the other way, never a value below it', () => {
    expect(computeFixtureExpectedScore(weak, strong, 0.1)).toBe(MIN_EXPECTED_SCORE)
    expect(computeFixtureExpectedScore(weak, strong, 0.1)).toBe(0.05)
  })

  it('falls back to NEUTRAL_EXPECTED_SCORE_VALUE (0.5) when EITHER team is below MIN_TEAM_PRIOR_MATCHES, even with a huge underlying delta', () => {
    const thin: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 20, goalsConceded: 0 }
    expect(computeFixtureExpectedScore(thin, weak, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
    expect(computeFixtureExpectedScore(strong, thin, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
  })
})

// ============================================================================
// Ticket #242 — shrinkage toward the league mean.
// ============================================================================

describe('shrunkTeamStrengthRate (ticket #242)', () => {
  const record: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 } // raw rate = 1.5

  it('is (goalsScored - goalsConceded) / (matches + k)', () => {
    expect(shrunkTeamStrengthRate(record, 5)).toBeCloseTo(15 / 15, 10) // = 1.0
    expect(shrunkTeamStrengthRate(record, 0)).toBeCloseTo(15 / 10, 10) // = 1.5
  })

  it('named test: k = 0 reproduces teamStrengthRate\'s unshrunk figure exactly, not an approximation', () => {
    expect(shrunkTeamStrengthRate(record, 0)).toBe(teamStrengthRate(record))
  })

  it('named test: a club with MORE matches is shrunk proportionally LESS than one with fewer, for the same raw rate', () => {
    const fewerMatches: TeamStrengthRecord = { matches: 3, goalsScored: 4.5, goalsConceded: 3 } // raw rate 0.5
    const moreMatches: TeamStrengthRecord = { matches: 30, goalsScored: 45, goalsConceded: 30 } // raw rate 0.5, same raw rate
    const k = 5
    const rawRate = teamStrengthRate(fewerMatches)
    expect(rawRate).toBeCloseTo(teamStrengthRate(moreMatches), 10) // same starting point

    const shrunkFewer = shrunkTeamStrengthRate(fewerMatches, k)
    const shrunkMore = shrunkTeamStrengthRate(moreMatches, k)
    // Both are pulled DOWN from the raw 0.5 toward the league mean (0), but
    // the club with more matches is pulled proportionally less -- its
    // shrunk rate sits CLOSER to the raw rate than the few-match club's does.
    expect(Math.abs(shrunkMore - rawRate)).toBeLessThan(Math.abs(shrunkFewer - rawRate))
    expect(shrunkFewer).toBeLessThan(shrunkMore)
  })

  it('shrinks toward exactly 0 (the league mean) as k grows arbitrarily large relative to matches', () => {
    expect(shrunkTeamStrengthRate(record, 100_000)).toBeCloseTo(0, 3)
  })
})

describe('TEAM_STRENGTH_SHRINKAGE_K (ticket #242)', () => {
  it('is 5 -- see this file\'s own comment for the calibration (fitted on gameweek 5, 16 Sept 2026)', () => {
    expect(TEAM_STRENGTH_SHRINKAGE_K).toBe(5)
  })
})

describe('MIN_EXPECTED_SCORE / MAX_EXPECTED_SCORE (ticket #242)', () => {
  it('are 0.05 and 0.95 -- no fixture is a certainty', () => {
    expect(MIN_EXPECTED_SCORE).toBe(0.05)
    expect(MAX_EXPECTED_SCORE).toBe(0.95)
  })
})

describe('computeFixtureExpectedScore: shrinkageK parameter (ticket #242)', () => {
  const strong: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 }
  const weak: TeamStrengthRecord = { matches: 10, goalsScored: 5, goalsConceded: 20 }

  // scale = 20 (not 4, as elsewhere in this file) deliberately keeps both the
  // shrunk and unshrunk values well inside (MIN_EXPECTED_SCORE,
  // MAX_EXPECTED_SCORE) -- at scale 4 both clamp to the same boundary value
  // and the two can no longer be told apart.
  const wideScale = 20

  it('defaults to TEAM_STRENGTH_SHRINKAGE_K -- calling with 4 args is byte-identical to passing it explicitly as the 5th', () => {
    expect(computeFixtureExpectedScore(strong, weak, wideScale, 0)).toBe(computeFixtureExpectedScore(strong, weak, wideScale, 0, TEAM_STRENGTH_SHRINKAGE_K))
  })

  it('named test: shrinkageK = 0 reproduces the pre-#242 unshrunk figure exactly (the formula this repo shipped through ticket #235)', () => {
    const preTicket242Value = clampToUnitForComparison(0.5 + (teamStrengthRate(strong) - teamStrengthRate(weak)) / wideScale)
    expect(computeFixtureExpectedScore(strong, weak, wideScale, 0, 0)).toBeCloseTo(preTicket242Value, 10)
  })

  it('a nonzero shrinkageK pulls the expectedScore CLOSER to 0.5 than shrinkageK = 0 does, for the same inputs -- shrinkage narrows the spread, never widens it', () => {
    const unshrunk = computeFixtureExpectedScore(strong, weak, wideScale, 0, 0)
    const shrunk = computeFixtureExpectedScore(strong, weak, wideScale, 0, 5)
    expect(Math.abs(shrunk - 0.5)).toBeLessThan(Math.abs(unshrunk - 0.5))
  })
})

/** Test-only helper: the OLD [0, 1] clamp, to compute what pre-#242 code would have produced for comparison -- never used in production code, only to state an expected value without a second copy of the new clamp's bounds. */
function clampToUnitForComparison(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

// ============================================================================
// Ticket #229 — homeAdjustment (optional, defaults to 0) and
// HOME_EXPECTED_SCORE_BONUS.
// ============================================================================

describe('computeFixtureExpectedScore: homeAdjustment (ticket #229)', () => {
  const strong: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 } // rate = 1.5
  const weak: TeamStrengthRecord = { matches: 10, goalsScored: 5, goalsConceded: 20 } // rate = -1.5
  // A larger scale than the describe block above so strong-vs-weak lands well
  // inside (0, 1) rather than at the clamp boundary — the whole point of this
  // section is to observe homeAdjustment's effect on the UNCLAMPED value.
  // shrinkageK is pinned to 0 explicitly throughout this block (ticket #242)
  // so these tests isolate homeAdjustment's own effect from shrinkage's —
  // shrinkage has its own describe blocks above. With k=0, delta = 3.0,
  // unadjusted expectedScore = 0.5 + 3/20 = 0.65 (unchanged from before #242).
  const wideScale = 20

  it('defaults to 0 — calling with 3 args is byte-identical to calling with an explicit 0 as the 4th (shrinkageK held at its own default in both calls)', () => {
    // This is exactly how scripts/run-backtest.ts calls this function everywhere
    // in this repo (grep confirms no call site passes a 4th argument) — its
    // own legs carry no venue and must not start guessing one.
    expect(computeFixtureExpectedScore(strong, weak, wideScale)).toBe(computeFixtureExpectedScore(strong, weak, wideScale, 0))
  })

  it('a nonzero homeAdjustment shifts the result by exactly that amount, pre-clamp', () => {
    const withoutAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, 0, 0)
    const withAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, 0.05, 0)
    expect(withoutAdjustment).toBeCloseTo(0.65, 10) // sanity-check the hand-computed comment above
    expect(withAdjustment).toBeCloseTo(withoutAdjustment + 0.05, 10)
  })

  it('a negative homeAdjustment (the away side) shifts the result down by exactly that amount', () => {
    const withoutAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, 0, 0)
    const withAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, -0.05, 0)
    expect(withAdjustment).toBeCloseTo(withoutAdjustment - 0.05, 10)
  })

  it('ticket #242: is still clamped to [MIN_EXPECTED_SCORE, MAX_EXPECTED_SCORE] even with a homeAdjustment pushing past the boundary', () => {
    expect(computeFixtureExpectedScore(strong, weak, 0.1, 0.5)).toBe(MAX_EXPECTED_SCORE)
    expect(computeFixtureExpectedScore(weak, strong, 0.1, -0.5)).toBe(MIN_EXPECTED_SCORE)
  })

  it('does NOT apply homeAdjustment when history is insufficient — the neutral fallback stays exactly NEUTRAL_EXPECTED_SCORE_VALUE, not neutral-plus-adjustment', () => {
    const thin: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 20, goalsConceded: 0 }
    expect(computeFixtureExpectedScore(thin, weak, 4, 0.09)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
  })

  it('ticket #242: two clubs with identical records still produce exactly 0.5 plus the home term, regardless of shrinkageK — named test', () => {
    const identical: TeamStrengthRecord = { matches: 8, goalsScored: 12, goalsConceded: 8 }
    expect(computeFixtureExpectedScore(identical, identical, wideScale, HOME_EXPECTED_SCORE_BONUS)).toBeCloseTo(0.5 + HOME_EXPECTED_SCORE_BONUS, 10)
    expect(computeFixtureExpectedScore(identical, identical, wideScale, HOME_EXPECTED_SCORE_BONUS, 0)).toBeCloseTo(0.5 + HOME_EXPECTED_SCORE_BONUS, 10)
    expect(computeFixtureExpectedScore(identical, identical, wideScale, HOME_EXPECTED_SCORE_BONUS, 8)).toBeCloseTo(0.5 + HOME_EXPECTED_SCORE_BONUS, 10)
  })
})

// ============================================================================
// Ticket #235 — buildTeamMatchRecordsFromFixtures. See teamStrength.ts's own
// header section for the "because" (blank fotmob_name -> the player_match_stats
// path never fires for the current season).
// ============================================================================

function fixtureResultRow(overrides: Partial<FixtureResultRow> & Pick<FixtureResultRow, 'fixtureId' | 'gameweek' | 'homeTeamId' | 'awayTeamId'>): FixtureResultRow {
  return {
    homeScore: null,
    awayScore: null,
    finished: false,
    ...overrides,
  }
}

const CODE_BY_ID = new Map<number, number | null>([
  [1, 10], // home team id 1 -> code 10
  [2, 20], // away team id 2 -> code 20
])

describe('buildTeamMatchRecordsFromFixtures (ticket #235)', () => {
  it('a finished fixture produces two mirrored records', () => {
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 39, gameweek: 4, homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 1, finished: true }),
    ]
    const { records, unresolvableTeamCodeCount } = buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID)
    expect(records).toHaveLength(2)
    expect(records.find((r) => r.teamCode === 10)).toEqual({ matchId: '39', gameweek: 4, teamCode: 10, goalsScored: 2, goalsConceded: 1 })
    expect(records.find((r) => r.teamCode === 20)).toEqual({ matchId: '39', gameweek: 4, teamCode: 20, goalsScored: 1, goalsConceded: 2 })
    expect(unresolvableTeamCodeCount).toBe(0)
  })

  it('an unfinished fixture produces none, even with real-looking scores present', () => {
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 1, gameweek: 1, homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, finished: false }),
    ]
    expect(buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID).records).toEqual([])
  })

  it('a null score (either side) produces none for that fixture -- never a guessed 0', () => {
    const homeNull: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 1, gameweek: 1, homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: 0, finished: true }),
    ]
    const awayNull: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 2, gameweek: 1, homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: null, finished: true }),
    ]
    expect(buildTeamMatchRecordsFromFixtures(homeNull, CODE_BY_ID).records).toEqual([])
    expect(buildTeamMatchRecordsFromFixtures(awayNull, CODE_BY_ID).records).toEqual([])
  })

  it("an unresolvable teams.id produces no record for that side only and is counted -- the OTHER side still resolves normally", () => {
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 5, gameweek: 2, homeTeamId: 1, awayTeamId: 999, homeScore: 3, awayScore: 0, finished: true }),
    ]
    const { records, unresolvableTeamCodeCount } = buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({ matchId: '5', gameweek: 2, teamCode: 10, goalsScored: 3, goalsConceded: 0 })
    expect(unresolvableTeamCodeCount).toBe(1)
  })

  it('a teams.id present in the map but mapped to a null code is treated the same as absent -- counted, never a guessed code', () => {
    const codeByIdWithNull = new Map<number, number | null>([[1, 10], [2, null]])
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 6, gameweek: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 1, finished: true }),
    ]
    const { records, unresolvableTeamCodeCount } = buildTeamMatchRecordsFromFixtures(rows, codeByIdWithNull)
    expect(records).toHaveLength(1)
    expect(records[0].teamCode).toBe(10)
    expect(unresolvableTeamCodeCount).toBe(1)
  })

  it('both sides unresolvable: no records, both counted', () => {
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 7, gameweek: 2, homeTeamId: 998, awayTeamId: 999, homeScore: 1, awayScore: 1, finished: true }),
    ]
    const { records, unresolvableTeamCodeCount } = buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID)
    expect(records).toEqual([])
    expect(unresolvableTeamCodeCount).toBe(2)
  })

  it("two fixtures between the SAME two clubs (e.g. the reverse fixture, or what would be \"last season's\" meeting if such a row were ever present) are kept as two independent records, never collapsed -- matchId (the fixture id) distinguishes them, not team pairing", () => {
    const rows: FixtureResultRow[] = [
      // First meeting: team 1 at home, wins 3-0.
      fixtureResultRow({ fixtureId: 1, gameweek: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 3, awayScore: 0, finished: true }),
      // Reverse fixture, later in the season: team 2 at home, wins 1-0. A
      // DIFFERENT fixture id -- if fixture identity were ignored and only
      // the team pairing mattered, this would overwrite or merge with the
      // first row instead of contributing its own separate record.
      fixtureResultRow({ fixtureId: 30, gameweek: 20, homeTeamId: 2, awayTeamId: 1, homeScore: 1, awayScore: 0, finished: true }),
    ]
    const { records } = buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID)
    expect(records).toHaveLength(4) // 2 fixtures x 2 sides each -- nothing merged
    const team10Records = records.filter((r) => r.teamCode === 10)
    expect(team10Records).toHaveLength(2)
    expect(team10Records.map((r) => r.matchId).sort()).toEqual(['1', '30'])
    // Each fixture's own result is preserved independently -- team 10 scored
    // 3 in fixture 1 and 0 in fixture 30, never averaged or overwritten.
    expect(team10Records.find((r) => r.matchId === '1')).toMatchObject({ goalsScored: 3, goalsConceded: 0 })
    expect(team10Records.find((r) => r.matchId === '30')).toMatchObject({ goalsScored: 0, goalsConceded: 1 })
  })

  it('an empty input produces no records and a zero count, not an error', () => {
    const { records, unresolvableTeamCodeCount } = buildTeamMatchRecordsFromFixtures([], CODE_BY_ID)
    expect(records).toEqual([])
    expect(unresolvableTeamCodeCount).toBe(0)
  })

  it('feeds computeTeamStrengthAsOf correctly end to end -- the lookahead guard still holds on fixture-sourced records', () => {
    const rows: FixtureResultRow[] = [
      fixtureResultRow({ fixtureId: 1, gameweek: 1, homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0, finished: true }),
      fixtureResultRow({ fixtureId: 2, gameweek: 4, homeTeamId: 1, awayTeamId: 2, homeScore: 9, awayScore: 0, finished: true }), // must NOT be seen "before gameweek 4"
    ]
    const { records } = buildTeamMatchRecordsFromFixtures(rows, CODE_BY_ID)
    const strength = computeTeamStrengthAsOf(records, 10, 4)
    expect(strength).toEqual({ matches: 1, goalsScored: 2, goalsConceded: 0 })
  })
})

describe('HOME_EXPECTED_SCORE_BONUS (ticket #229)', () => {
  it('is the exact expected-score equivalent of HOME_ADVANTAGE_ELO (65) at parity: 1 / (1 + 10 ** (-65 / 400)) - 0.5', () => {
    expect(HOME_EXPECTED_SCORE_BONUS).toBe(1 / (1 + 10 ** (-65 / 400)) - 0.5)
  })

  // NOTE: the ticket text states this constant as "0.0927". Evaluating the
  // ticket's OWN stated formula gives 0.092466... which rounds to 0.0925, not
  // 0.0927 -- a discrepancy in the ticket text's rounding, not in the
  // formula. This implementation follows the formula (stated as the
  // authoritative derivation, "derived...: <formula>"), not the rounded
  // literal, and is called out in the Builder's report as a Tier 3 note
  // rather than silently "corrected" to match 0.0927 by fitting a different
  // formula.
  it('rounds to 0.0925 (to 4 d.p.) -- see the note above on the ticket text\'s own rounding', () => {
    expect(HOME_EXPECTED_SCORE_BONUS).toBeCloseTo(0.0925, 4)
  })

  it('is a small positive nudge, not a large or negative one — sanity bound on the derived constant', () => {
    expect(HOME_EXPECTED_SCORE_BONUS).toBeGreaterThan(0)
    expect(HOME_EXPECTED_SCORE_BONUS).toBeLessThan(0.5)
  })
})
