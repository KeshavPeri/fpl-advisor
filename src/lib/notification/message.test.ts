import { describe, expect, it } from 'vitest'
import {
  appendChipExpiryLine,
  applyWindowMarker,
  composeCurrentMessage,
  composeInfeasibleMessage,
  composeNoRecommendationMessage,
  composePlanBLine,
  composeStaleMessage,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  truncateMessage,
  type ChipExpiryNotificationInput,
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

// ============================================================================
// applyWindowMarker — ticket #90. The 24h and 10h deadline reminders must be
// distinguishable at a glance even when the underlying recommendation (and
// therefore the composed message) has not changed between the two sends.
// ============================================================================

describe('applyWindowMarker', () => {
  it('the 24-hour and 10-hour markers produced from an IDENTICAL composed message are not byte-identical', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })

    const twentyFourHour = applyWindowMarker(base, 'deadline_24h')
    const tenHour = applyWindowMarker(base, 'deadline_10h')

    expect(twentyFourHour).not.toBe(tenHour)
  })

  it('the 24-hour message says it is the first look', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    const message = applyWindowMarker(base, 'deadline_24h')
    expect(message.split('\n')[0]).toMatch(/first look/i)
  })

  it('the 10-hour message says the deadline is close', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    const message = applyWindowMarker(base, 'deadline_10h')
    expect(message.split('\n')[0]).toMatch(/deadline is close/i)
  })

  it('the marker leads the message, ahead of the underlying decision', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    const message = applyWindowMarker(base, 'deadline_10h')
    const lines = message.split('\n\n')
    expect(lines[0]).not.toBe(WORKED_EXAMPLE_REASON_LINES[0])
    expect(message).toContain(base)
  })

  it('a manual send carries no window framing — the message passes through unchanged', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(applyWindowMarker(base, 'manual')).toBe(base)
  })

  it('carries no live countdown or exact hours-remaining figure — the message is composed once and read later', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    expect(applyWindowMarker(base, 'deadline_24h')).not.toMatch(/\d+\s*h(ours?)?\b/i)
    expect(applyWindowMarker(base, 'deadline_10h')).not.toMatch(/\d+\s*h(ours?)?\b/i)
  })

  it('contains no emoji, no decimals, and no exclamation point — product-brief.md §8 / design-reference.md interface-writing rules', () => {
    const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })
    for (const trigger of ['deadline_24h', 'deadline_10h'] as const) {
      const message = applyWindowMarker(base, trigger)
      expect(message).not.toMatch(NO_EMOJI_PATTERN)
      expect(message).not.toMatch(DECIMAL_NUMBER_PATTERN)
      expect(message).not.toContain('!')
    }
  })
})

// ============================================================================
// appendChipExpiryLine — ticket #97 (item 26). Appends a chip-expiry line to
// the deadline_24h/deadline_10h reminders, ONLY at the top two urgency bands
// src/lib/chips/derive.ts computes ('pressing' and 'final'); 'none' and
// 'noted' — and a null input — leave the message untouched.
// ============================================================================

describe('appendChipExpiryLine', () => {
  const base = composeCurrentMessage({ reasonLines: WORKED_EXAMPLE_REASON_LINES, planB: null, solverStatus: OPTIMAL })

  const NONE: ChipExpiryNotificationInput = { band: 'none', chipNames: [], gameweeksRemaining: 0 }
  const NOTED: ChipExpiryNotificationInput = { band: 'noted', chipNames: ['Wildcard'], gameweeksRemaining: 6 }
  const PRESSING: ChipExpiryNotificationInput = { band: 'pressing', chipNames: ['Wildcard'], gameweeksRemaining: 3 }
  const FINAL: ChipExpiryNotificationInput = {
    band: 'final',
    chipNames: ['Wildcard', 'Triple Captain'],
    gameweeksRemaining: 2,
  }

  it('leaves the message unchanged when chipExpiry is null (no chip data supplied)', () => {
    expect(appendChipExpiryLine(base, null)).toBe(base)
  })

  it('leaves the message unchanged at band "none"', () => {
    expect(appendChipExpiryLine(base, NONE)).toBe(base)
  })

  it('leaves the message unchanged at band "noted" — quiet on the chips screen, silent in the notification', () => {
    expect(appendChipExpiryLine(base, NOTED)).toBe(base)
  })

  it('appends a line at band "pressing"', () => {
    const message = appendChipExpiryLine(base, PRESSING)
    expect(message).not.toBe(base)
    expect(message.startsWith(base)).toBe(true)
    expect(message).toContain('Wildcard')
    expect(message).toContain('3 gameweeks')
  })

  it('appends a line at band "final"', () => {
    const message = appendChipExpiryLine(base, FINAL)
    expect(message).not.toBe(base)
    expect(message).toContain('Wildcard and Triple Captain')
    expect(message).toContain('2 gameweeks')
  })

  it('names every chip at risk, joined in English, not just the first one', () => {
    const threeChips: ChipExpiryNotificationInput = {
      band: 'final',
      chipNames: ['Wildcard', 'Free Hit', 'Triple Captain'],
      gameweeksRemaining: 1,
    }
    const message = appendChipExpiryLine(base, threeChips)
    expect(message).toContain('Wildcard, Free Hit and Triple Captain')
  })

  it('pluralises "gameweek" correctly for exactly one gameweek remaining', () => {
    const oneGameweek: ChipExpiryNotificationInput = { band: 'final', chipNames: ['Wildcard'], gameweeksRemaining: 1 }
    const message = appendChipExpiryLine(base, oneGameweek)
    expect(message).toContain('1 gameweek left')
    expect(message).not.toContain('1 gameweeks')
  })

  it('says nothing about which chip to play — only names it and states the gameweeks left', () => {
    const message = appendChipExpiryLine(base, PRESSING)
    expect(message.toLowerCase()).not.toMatch(/\bplay\b|\brecommend/)
  })

  it('never carries a live countdown, a decimal figure, an exclamation point, or an emoji', () => {
    for (const input of [PRESSING, FINAL]) {
      const message = appendChipExpiryLine(base, input)
      expect(message).not.toMatch(DECIMAL_NUMBER_PATTERN)
      expect(message).not.toContain('!')
      expect(message).not.toMatch(NO_EMOJI_PATTERN)
      expect(message).not.toMatch(/\d+\s*h(ours?)?\b/i)
    }
  })

  it('composes after applyWindowMarker, on top of the fully-marked message', () => {
    const marked = applyWindowMarker(base, 'deadline_10h')
    const message = appendChipExpiryLine(marked, FINAL)
    expect(message.startsWith(marked)).toBe(true)
    expect(message).toContain('Wildcard and Triple Captain')
  })
})
