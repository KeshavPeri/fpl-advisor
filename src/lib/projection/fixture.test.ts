import { describe, expect, it } from 'vitest'
import {
  ATTACKING_MULTIPLIER_MAX,
  ATTACKING_MULTIPLIER_MIN,
  ATTACKING_MULTIPLIER_OFFSET,
  DEFENSIVE_MULTIPLIER_OFFSET,
  HOME_ADVANTAGE_ELO,
  LEAGUE_BASELINE_GOALS_PER_TEAM,
  attackingMultiplier,
  defensiveMultiplier,
  expectedGoalsConceded,
  expectedScore,
  expectedScoreFromDifficulty,
} from './fixture.ts'

describe('expectedScore', () => {
  it('equal elo at home is between 0.592 and 0.593', () => {
    const value = expectedScore(1500, 1500, true)
    expect(value).toBeGreaterThan(0.592)
    expect(value).toBeLessThan(0.593)
  })

  it('home advantage constant is 65', () => {
    expect(HOME_ADVANTAGE_ELO).toBe(65)
  })

  it('matches the stated formula directly for an unequal pair', () => {
    const eloFor = 1600
    const eloAgainst = 1450
    const value = expectedScore(eloFor, eloAgainst, true)
    const expected = 1 / (1 + 10 ** ((eloAgainst - eloFor - 65) / 400))
    expect(value).toBeCloseTo(expected, 12)
  })

  it('is symmetric: expectedScore(a,b,true) + expectedScore(b,a,false) === 1, for three distinct elo pairs', () => {
    const pairs: Array<[number, number]> = [
      [1500, 1500],
      [1650, 1400],
      [1300, 1720],
    ]
    for (const [a, b] of pairs) {
      const sum = expectedScore(a, b, true) + expectedScore(b, a, false)
      expect(sum).toBeCloseTo(1, 12)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-12)
    }
  })

  it('a much stronger team at home approaches (but never reaches) 1', () => {
    const value = expectedScore(2000, 1200, true)
    expect(value).toBeLessThan(1)
    expect(value).toBeGreaterThan(0.98)
  })
})

describe('expectedScoreFromDifficulty — the documented elo-null fallback', () => {
  it('FDR 3 (an average fixture) is neutral: 0.5', () => {
    expect(expectedScoreFromDifficulty(3)).toBe(0.5)
  })
  it('FDR 1 (easiest) is higher than FDR 5 (hardest)', () => {
    expect(expectedScoreFromDifficulty(1)).toBeGreaterThan(expectedScoreFromDifficulty(5))
  })
  it('the table is monotonically decreasing from FDR 1 to FDR 5', () => {
    const values = [1, 2, 3, 4, 5].map(expectedScoreFromDifficulty)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1])
    }
  })
  it('every value stays within [0, 1]', () => {
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const value = expectedScoreFromDifficulty(difficulty)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
  it('an out-of-range difficulty falls back to the neutral 0.5, not NaN or an error', () => {
    expect(expectedScoreFromDifficulty(0)).toBe(0.5)
    expect(expectedScoreFromDifficulty(9)).toBe(0.5)
  })
})

// ============================================================================
// Ticket #182 -- attackingMultiplier damped to its measured slope
// (docs/model-review-2026-09-02.md §1b; full derivation and bucket table
// quoted in ATTACKING_MULTIPLIER_OFFSET's own comment in fixture.ts).
// ============================================================================

describe('attackingMultiplier', () => {
  it('equals 1.0 exactly at expectedScore = 0.5 -- the most important test in this ticket: an even fixture must stay unadjusted after the damping', () => {
    expect(attackingMultiplier(0.5)).toBe(1.0)
  })

  it('is ATTACKING_MULTIPLIER_OFFSET + expectedScore (slope 1, half the pre-#182 slope of 2)', () => {
    // Hand-computed: 0.5 + 0.3 = 0.8; 0.5 + 0.9 = 1.4. (Pre-#182 these were 0.6 and 1.8 --
    // deliberately different values, since this ticket's whole point is to change the slope.)
    expect(attackingMultiplier(0.3)).toBeCloseTo(0.5 + 0.3, 10)
    expect(attackingMultiplier(0.9)).toBeCloseTo(0.5 + 0.9, 10)
    expect(ATTACKING_MULTIPLIER_OFFSET).toBe(0.5)
  })

  it('is clamped to [ATTACKING_MULTIPLIER_MIN, ATTACKING_MULTIPLIER_MAX] = [0, 2] for an out-of-range expectedScore -- named test proving the clamp binds', () => {
    // expectedScore = -1 -> raw 0.5 + -1 = -0.5, clamped up to the floor, 0.
    expect(attackingMultiplier(-1)).toBe(0)
    expect(ATTACKING_MULTIPLIER_MIN).toBe(0)
    // expectedScore = 2 -> raw 0.5 + 2 = 2.5, clamped down to the ceiling, 2 -- note the
    // damped formula never reaches 2 for any expectedScore inside its real [0, 1] domain
    // (max there is 0.5 + 1 = 1.5), so this exercises only the defensive out-of-range path.
    expect(attackingMultiplier(2)).toBe(2)
    expect(ATTACKING_MULTIPLIER_MAX).toBe(2)
  })

  it('within the valid [0, 1] expectedScore domain the clamp never binds -- output ranges exactly [0.5, 1.5]', () => {
    expect(attackingMultiplier(0)).toBeCloseTo(0.5, 10)
    expect(attackingMultiplier(1)).toBeCloseTo(1.5, 10)
  })
})

// ============================================================================
// Ticket #244 -- defensiveMultiplier / expectedGoalsConceded damped to their
// measured slope, the mirror of what ticket #182 did for attackingMultiplier.
// See DEFENSIVE_MULTIPLIER_OFFSET's own comment in fixture.ts for the full
// derivation and the measured bucket table (scripts/fixture-slope-report.ts).
// ============================================================================

describe('expectedGoalsConceded', () => {
  it('equals leagueBaselineGoals exactly at expectedScore = 0.5 -- the most important test in this ticket: an even fixture must stay unadjusted after the damping', () => {
    expect(expectedGoalsConceded(1.45, 0.5)).toBeCloseTo(1.45, 10)
    expect(expectedGoalsConceded(LEAGUE_BASELINE_GOALS_PER_TEAM, 0.5)).toBeCloseTo(LEAGUE_BASELINE_GOALS_PER_TEAM, 10)
  })
  it('is leagueBaselineGoals x defensiveMultiplier(expectedScore) -- ticket #244: this is now defined in terms of defensiveMultiplier directly, not a separately-stated formula', () => {
    expect(expectedGoalsConceded(1.5, 0.7)).toBeCloseTo(1.5 * defensiveMultiplier(0.7), 10)
    expect(expectedGoalsConceded(1.5, 0.7)).toBeCloseTo(1.5 * (DEFENSIVE_MULTIPLIER_OFFSET - 0.7), 10)
  })
  it('is clamped at zero from below for an expectedScore far above 1 (defensiveMultiplier itself clamps to 0 there)', () => {
    expect(expectedGoalsConceded(1.5, 3)).toBe(0)
  })
  it('never returns a negative value', () => {
    expect(expectedGoalsConceded(1.5, 1.0)).toBeGreaterThanOrEqual(0)
    expect(expectedGoalsConceded(1.5, 5)).toBeGreaterThanOrEqual(0)
  })
})

describe('defensiveMultiplier -- ticket #244: damped from slope 2 to slope 1, the exact mirror of attackingMultiplier', () => {
  it('equals 1.0 exactly at expectedScore = 0.5 -- the most important test in this ticket: an even fixture must stay unadjusted after the damping', () => {
    expect(defensiveMultiplier(0.5)).toBe(1.0)
  })
  it('is DEFENSIVE_MULTIPLIER_OFFSET - expectedScore (slope magnitude 1, half the pre-#244 slope of 2)', () => {
    // Hand-computed: 1.5 - 0.3 = 1.2; 1.5 - 0.9 = 0.6. (Pre-#244 these were 1.4 and 0.2 --
    // deliberately different values, since this ticket's whole point is to change the slope.)
    expect(defensiveMultiplier(0.3)).toBeCloseTo(1.5 - 0.3, 10)
    expect(defensiveMultiplier(0.9)).toBeCloseTo(1.5 - 0.9, 10)
    expect(DEFENSIVE_MULTIPLIER_OFFSET).toBe(1.5)
  })
  it('returns 1.5 at expectedScore = 0 (certain loss -- maximum shot pressure) -- half the pre-#244 value of 2.0', () => {
    expect(defensiveMultiplier(0)).toBeCloseTo(1.5, 10)
  })
  it('returns 0.5 at expectedScore = 1 (certain win -- minimum shot pressure) -- half the pre-#244 value of 0.0, never all the way to zero any more', () => {
    expect(defensiveMultiplier(1)).toBeCloseTo(0.5, 10)
  })
  it('the clamps hold at both ends -- named test per the DoD: a wildly out-of-range expectedScore is still clamped to [0, 2]', () => {
    expect(defensiveMultiplier(-10)).toBe(2)
    expect(defensiveMultiplier(10)).toBe(0)
  })
  it('within the valid [0, 1] expectedScore domain the clamp never binds -- output ranges exactly [0.5, 1.5], the exact mirror of attackingMultiplier\'s [0.5, 1.5]', () => {
    expect(defensiveMultiplier(0)).toBeCloseTo(1.5, 10)
    expect(defensiveMultiplier(1)).toBeCloseTo(0.5, 10)
  })
  it('agrees with expectedGoalsConceded by construction: expectedGoalsConceded(b, s) === b x defensiveMultiplier(s), across five values of s', () => {
    const leagueBaselineGoals = 1.45
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      expect(expectedGoalsConceded(leagueBaselineGoals, s)).toBeCloseTo(leagueBaselineGoals * defensiveMultiplier(s), 12)
    }
  })
  it('attackingMultiplier(es) + defensiveMultiplier(es) === 2.0 for every expectedScore in [0, 1] -- the elegant mirror-symmetry consequence documented in DEFENSIVE_MULTIPLIER_OFFSET\'s own comment, not independently chosen', () => {
    for (const s of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(attackingMultiplier(s) + defensiveMultiplier(s)).toBeCloseTo(2.0, 10)
    }
  })
})

describe('ticket #244: defensiveMultiplier and expectedGoalsConceded (which the clean-sheet, goals-conceded and saves components all derive from) match their NEW, damped formula for a fixed expectedScore -- named test, per the DoD (the pre-#244 version of this same test proved the OLD formula; see git history / decisions/ticket-182.md for that snapshot)', () => {
  it.each([0, 0.25, 0.5, 0.75, 1] as const)('expectedScore = %s', (s) => {
    // Hand-computed post-#244 values -- DEFENSIVE_MULTIPLIER_OFFSET - s, and leagueBaselineGoals x that:
    const expectedDefensiveMultiplier = 1.5 - s
    const leagueBaselineGoals = 1.45
    const expectedGoalsConcededHand = Math.max(0, leagueBaselineGoals * (1.5 - s))

    expect(defensiveMultiplier(s)).toBeCloseTo(expectedDefensiveMultiplier, 12)
    expect(expectedGoalsConceded(leagueBaselineGoals, s)).toBeCloseTo(expectedGoalsConcededHand, 12)

    // attackingMultiplier and defensiveMultiplier at the SAME expectedScore are deliberately
    // different (except at s = 0.5, where both are exactly 1.0) -- confirming the two
    // multipliers really are independent, not accidentally sharing one code path, even though
    // (post-#244) they are exact mirrors of one another (see the "+ === 2.0" test above).
    if (s !== 0.5) {
      expect(attackingMultiplier(s)).not.toBeCloseTo(defensiveMultiplier(s), 5)
    } else {
      expect(attackingMultiplier(s)).toBeCloseTo(defensiveMultiplier(s), 12)
    }
  })
})

describe('every returned value is finite', () => {
  it.each([
    [1500, 1500, true],
    [1000, 2000, false],
    [0, 0, true],
  ] as const)('expectedScore(%j, %j, %j)', (a, b, home) => {
    expect(Number.isFinite(expectedScore(a, b, home))).toBe(true)
  })
})
