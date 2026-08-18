import { describe, expect, it } from 'vitest'
import {
  composeCurrentMessage,
  composeInfeasibleMessage,
  composeNoRecommendationMessage,
  composePlanBLine,
  composeStaleMessage,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  truncateMessage,
} from './message.ts'
import type { SolverStatusInfo } from './solverStatus.ts'

const OPTIMAL: SolverStatusInfo = { isOptimal: true, status: 'Optimal' }
const TIMED_OUT: SolverStatusInfo = { isOptimal: false, status: 'Time limit reached' }
const UNKNOWN: SolverStatusInfo = { isOptimal: false, status: null }

const NO_EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
/** A decimal number — one or more digits, a dot, one or more digits (e.g. "4.2"). Deliberately does not flag "4-point" or "next-best", which contain no such pattern. */
const DECIMAL_NUMBER_PATTERN = /\d+\.\d+/

// ============================================================================
// composeCurrentMessage — the single most important test in this ticket:
// the fully worked example, asserted VERBATIM. Reason lines below are
// exactly what src/lib/recommendation/reasons.ts's buildReasonLines()
// produces for: a transfer with a hit, a captain, a marginal confidence
// band, and one coverage-gap reason (see this ticket's DoD).
// ============================================================================

const WORKED_EXAMPLE_REASON_LINES = [
  'Transfer in Erling Haaland. Transfer out Ivan Toney.',
  'Captain Mohamed Salah. Vice-captain Bukayo Saka.',
  'Costs a 4-point hit — 2 transfer(s) made against 1 free.',
  'Projected gain: 58 points before the hit, 54 after.',
  'A marginal edge over the next-best alternative across the gameweeks ahead.',
  'Erling Haaland has no Premier League match history yet. This projection rests on a position estimate, not real form.',
]

describe('composeCurrentMessage — fully worked example', () => {
  it('matches the expected message VERBATIM: hit, captain, marginal band, one reason, Plan B, no caveat (proven optimum)', () => {
    const message = composeCurrentMessage({
      reasonLines: WORKED_EXAMPLE_REASON_LINES,
      planB: 'Roll your transfer. No changes recommended this gameweek.',
      solverStatus: OPTIMAL,
    })

    expect(message).toBe(
      'Transfer in Erling Haaland. Transfer out Ivan Toney.\n' +
        'Captain Mohamed Salah. Vice-captain Bukayo Saka.\n' +
        'Costs a 4-point hit — 2 transfer(s) made against 1 free.\n' +
        'Projected gain: 58 points before the hit, 54 after.\n' +
        'A marginal edge over the next-best alternative across the gameweeks ahead.\n' +
        'Erling Haaland has no Premier League match history yet. This projection rests on a position estimate, not real form.\n' +
        '\n' +
        'Plan B: Roll your transfer. No changes recommended this gameweek.',
    )
  })

  it('has the decision as its first line — no preamble, no greeting, no deadline restatement before it', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(message.split('\n')[0]).toBe('Transfer in Erling Haaland. Transfer out Ivan Toney.')
  })

  it('contains no emoji anywhere', () => {
    const message = composeCurrentMessage({
      reasonLines: WORKED_EXAMPLE_REASON_LINES,
      planB: 'Roll your transfer. No changes recommended this gameweek.',
      solverStatus: TIMED_OUT,
    })
    expect(message).not.toMatch(NO_EMOJI_PATTERN)
  })

  it('contains no decimal projected-points value — whole numbers only', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(message).not.toMatch(DECIMAL_NUMBER_PATTERN)
  })
})

describe('composeCurrentMessage — roll plan', () => {
  it('states the roll as a confident answer, not an absence', () => {
    const message = composeCurrentMessage({
      reasonLines: ['Roll your transfer. No changes recommended this gameweek.', 'Captain Erling Haaland. Vice-captain Mohamed Salah.'],
      planB: null,
      solverStatus: OPTIMAL,
    })
    expect(message.startsWith('Roll your transfer. No changes recommended this gameweek.')).toBe(true)
  })
})

describe('composeCurrentMessage — solver-status caveat', () => {
  it('adds the caveat when the solve did not reach a proven optimum', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: TIMED_OUT })
    expect(message).toContain(
      'This plan comes from a solve that did not reach a proven optimum (status: Time limit reached). It is usable, but not guaranteed best.',
    )
  })

  it('omits the caveat for a proven optimum', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(message).not.toContain('did not reach a proven optimum')
  })

  it('omits the caveat when the solver status is unknown — never guesses either way', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: UNKNOWN })
    expect(message).not.toContain('proven optimum')
  })
})

describe('composeCurrentMessage — Plan B', () => {
  it('omits the Plan B section entirely when there is no Plan B (a single-solution solve)', () => {
    const message = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(message).not.toContain('Plan B')
  })
})

describe('composeCurrentMessage — empty input', () => {
  it('throws rather than sending a message with no decision in it', () => {
    expect(() => composeCurrentMessage({ reasonLines: [], planB: null, solverStatus: OPTIMAL })).toThrow(/at least one reason line/)
  })
})

// ============================================================================
// composePlanBLine
// ============================================================================

describe('composePlanBLine', () => {
  it('prefixes the stored Plan B headline with "Plan B: "', () => {
    expect(composePlanBLine('Transfer in Cole Palmer. Transfer out Ivan Toney.')).toBe('Plan B: Transfer in Cole Palmer. Transfer out Ivan Toney.')
  })
})

// ============================================================================
// composeStaleMessage
// ============================================================================

describe('composeStaleMessage', () => {
  it('leads with the decision, then states the age explicitly, pluralising "gameweeks" correctly', () => {
    const message = composeStaleMessage({
      reasonLines: WORKED_EXAMPLE_REASON_LINES,
      recommendationGameweekId: 3,
      currentGameweekId: 5,
      planB: null,
      solverStatus: OPTIMAL,
    })
    const paragraphs = message.split('\n\n')
    expect(paragraphs[0]).toBe('Transfer in Erling Haaland. Transfer out Ivan Toney.')
    expect(paragraphs[1]).toBe('This is the gameweek 3 plan, 2 gameweeks old — gameweek 5 has no recommendation yet.')
  })

  it('uses the singular "gameweek" for exactly one gameweek behind', () => {
    const message = composeStaleMessage({
      reasonLines: WORKED_EXAMPLE_REASON_LINES,
      recommendationGameweekId: 4,
      currentGameweekId: 5,
      planB: null,
      solverStatus: OPTIMAL,
    })
    expect(message).toContain('This is the gameweek 4 plan, 1 gameweek old — gameweek 5 has no recommendation yet.')
  })

  it('never presents a stale recommendation as current — the age line is always present', () => {
    const message = composeStaleMessage({
      reasonLines: WORKED_EXAMPLE_REASON_LINES,
      recommendationGameweekId: 3,
      currentGameweekId: 5,
      planB: 'Roll your transfer. No changes recommended this gameweek.',
      solverStatus: OPTIMAL,
    })
    expect(message).toMatch(/gameweeks? old/)
  })

  it('throws rather than sending a message with no decision in it', () => {
    expect(() =>
      composeStaleMessage({ reasonLines: [], recommendationGameweekId: 3, currentGameweekId: 5, planB: null, solverStatus: OPTIMAL }),
    ).toThrow(/at least one reason line/)
  })
})

// ============================================================================
// composeInfeasibleMessage / composeNoRecommendationMessage — product-
// brief.md §6c's specific, actionable infeasible message versus the general
// failure notice. Distinct wording, verified here so they can never collapse
// into the same generic string by accident.
// ============================================================================

describe('composeInfeasibleMessage', () => {
  it('names the gameweek and says the squad does not reconcile — the specific §6c message, not a generic error', () => {
    const message = composeInfeasibleMessage(7)
    expect(message).toContain('gameweek 7')
    expect(message).toMatch(/doesn't reconcile|does not reconcile|doesn.t match/)
    expect(message).not.toBe(composeNoRecommendationMessage(7))
  })

  it('leads with the decision/finding as its first line', () => {
    expect(composeInfeasibleMessage(7).split('\n')[0]).toBe("The squad for gameweek 7 doesn't reconcile with FPL.")
  })
})

describe('composeNoRecommendationMessage', () => {
  it('says what failed rather than being silent, naming the gameweek', () => {
    const message = composeNoRecommendationMessage(7)
    expect(message).toContain('gameweek 7')
    expect(message.split('\n')[0]).toBe('No recommendation is available for gameweek 7.')
  })
})

// ============================================================================
// truncateMessage — the named oversized-input test.
// ============================================================================

describe('truncateMessage', () => {
  it('returns the text unchanged when it already fits', () => {
    expect(truncateMessage('short message', 'short message')).toBe('short message')
  })

  it('truncates oversized input to fit Telegram\'s limit while preserving the headline/decision in full', () => {
    const headline = 'Transfer in Erling Haaland. Transfer out Ivan Toney.'
    const hugeTail = 'x'.repeat(10_000)
    const fullText = `${headline}\n${hugeTail}`

    const result = truncateMessage(fullText, headline)

    expect(result.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH)
    expect(result.startsWith(headline)).toBe(true)
    expect(result).toContain('[Message truncated')
  })

  it('composeCurrentMessage itself stays within the Telegram limit for an oversized set of reason lines', () => {
    const headline = 'Transfer in Erling Haaland. Transfer out Ivan Toney.'
    const reasonLines = [headline, ...Array.from({ length: 50 }, (_, i) => `Reason line ${i}: `.repeat(50))]
    const message = composeCurrentMessage({ reasonLines, planB: 'Roll your transfer. No changes recommended this gameweek.', solverStatus: OPTIMAL })

    expect(message.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH)
    expect(message.startsWith(headline)).toBe(true)
  })
})
