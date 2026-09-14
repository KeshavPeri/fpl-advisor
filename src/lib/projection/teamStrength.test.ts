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
  computeFixtureExpectedScore,
  computeTeamStrengthAsOf,
  fixtureHasSufficientHistory,
  HOME_EXPECTED_SCORE_BONUS,
  MIN_TEAM_PRIOR_MATCHES,
  NEUTRAL_EXPECTED_SCORE_VALUE,
  SCALE,
  teamStrengthRate,
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

describe('computeFixtureExpectedScore (ticket #175)', () => {
  const strong: TeamStrengthRecord = { matches: 10, goalsScored: 20, goalsConceded: 5 } // rate = 1.5
  const weak: TeamStrengthRecord = { matches: 10, goalsScored: 5, goalsConceded: 20 } // rate = -1.5
  const identicalA: TeamStrengthRecord = { matches: 6, goalsScored: 9, goalsConceded: 6 } // rate = 0.5
  const identicalB: TeamStrengthRecord = { matches: 3, goalsScored: 4.5, goalsConceded: 3 } // rate = 0.5, different matches

  it('is exactly 0.5 when two teams have identical prior records — named test', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalA, 4)).toBe(0.5)
  })

  it('is exactly 0.5 for two DIFFERENT teams whose RATE happens to be identical, regardless of scale — the delta cancels to 0, not an approximation', () => {
    expect(computeFixtureExpectedScore(identicalA, identicalB, 1)).toBe(0.5)
    expect(computeFixtureExpectedScore(identicalA, identicalB, 100)).toBe(0.5)
  })

  it('a stronger team gets an expectedScore above 0.5, a weaker one below', () => {
    const strongVsWeak = computeFixtureExpectedScore(strong, weak, 4)
    const weakVsStrong = computeFixtureExpectedScore(weak, strong, 4)
    expect(strongVsWeak).toBeGreaterThan(0.5)
    expect(weakVsStrong).toBeLessThan(0.5)
    expect(strongVsWeak + weakVsStrong).toBeCloseTo(1, 10) // symmetric around 0.5
  })

  it('is clamped to exactly 1 for an extreme delta relative to scale, never a value above 1', () => {
    expect(computeFixtureExpectedScore(strong, weak, 0.1)).toBe(1)
  })

  it('is clamped to exactly 0 for an extreme delta the other way, never a value below 0', () => {
    expect(computeFixtureExpectedScore(weak, strong, 0.1)).toBe(0)
  })

  it('falls back to NEUTRAL_EXPECTED_SCORE_VALUE (0.5) when EITHER team is below MIN_TEAM_PRIOR_MATCHES, even with a huge underlying delta', () => {
    const thin: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 20, goalsConceded: 0 }
    expect(computeFixtureExpectedScore(thin, weak, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
    expect(computeFixtureExpectedScore(strong, thin, 4)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
  })
})

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
  const wideScale = 20 // delta = 3.0, unadjusted expectedScore = 0.5 + 3/20 = 0.65

  it('defaults to 0 — calling with 3 args is byte-identical to calling with an explicit 0 as the 4th', () => {
    // This is exactly how scripts/run-backtest.ts calls this function everywhere
    // in this repo (grep confirms no call site passes a 4th argument) — its
    // own legs carry no venue and must not start guessing one.
    expect(computeFixtureExpectedScore(strong, weak, wideScale)).toBe(computeFixtureExpectedScore(strong, weak, wideScale, 0))
  })

  it('a nonzero homeAdjustment shifts the result by exactly that amount, pre-clamp', () => {
    const withoutAdjustment = computeFixtureExpectedScore(strong, weak, wideScale)
    const withAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, 0.05)
    expect(withoutAdjustment).toBeCloseTo(0.65, 10) // sanity-check the hand-computed comment above
    expect(withAdjustment).toBeCloseTo(withoutAdjustment + 0.05, 10)
  })

  it('a negative homeAdjustment (the away side) shifts the result down by exactly that amount', () => {
    const withoutAdjustment = computeFixtureExpectedScore(strong, weak, wideScale)
    const withAdjustment = computeFixtureExpectedScore(strong, weak, wideScale, -0.05)
    expect(withAdjustment).toBeCloseTo(withoutAdjustment - 0.05, 10)
  })

  it('is still clamped to [0, 1] even with a homeAdjustment pushing past the boundary', () => {
    expect(computeFixtureExpectedScore(strong, weak, 0.1, 0.5)).toBe(1)
    expect(computeFixtureExpectedScore(weak, strong, 0.1, -0.5)).toBe(0)
  })

  it('does NOT apply homeAdjustment when history is insufficient — the neutral fallback stays exactly NEUTRAL_EXPECTED_SCORE_VALUE, not neutral-plus-adjustment', () => {
    const thin: TeamStrengthRecord = { matches: MIN_TEAM_PRIOR_MATCHES - 1, goalsScored: 20, goalsConceded: 0 }
    expect(computeFixtureExpectedScore(thin, weak, 4, 0.09)).toBe(NEUTRAL_EXPECTED_SCORE_VALUE)
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
