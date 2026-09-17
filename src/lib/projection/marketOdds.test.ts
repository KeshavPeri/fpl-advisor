// Unit tests for src/lib/projection/marketOdds.ts — ticket #238.

import { describe, expect, it } from 'vitest'
import {
  isMarketOddsFresh,
  marketExpectedScore,
  median,
  medianOddsAcrossBooks,
  MARKET_ODDS_FRESHNESS_HOURS,
  removeOverround,
  type MarketOddsPrices,
} from './marketOdds.ts'

// ============================================================================
// median — DoD-named test: "the median across an even and an odd number of books"
// ============================================================================

describe('median', () => {
  it('an ODD number of values returns the middle one, once sorted', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('an EVEN number of values returns the average of the two middle ones, once sorted', () => {
    expect(median([2, 4])).toBe(3)
    expect(median([8, 2, 6, 4])).toBe(5) // sorted: 2,4,6,8 -> (4+6)/2
  })

  it('a single value returns itself', () => {
    expect(median([7])).toBe(7)
  })

  it('an empty array returns 0, never NaN', () => {
    expect(median([])).toBe(0)
  })

  it('does not mutate its input array (sorts a copy)', () => {
    const input = [3, 1, 2]
    median(input)
    expect(input).toEqual([3, 1, 2])
  })
})

describe('medianOddsAcrossBooks', () => {
  it('takes the median of each of the three prices independently, across an EVEN number of books', () => {
    const rows: MarketOddsPrices[] = [
      { home: 1.5, draw: 4.0, away: 6.0 },
      { home: 1.7, draw: 3.6, away: 5.0 },
      { home: 1.6, draw: 3.8, away: 5.5 },
      { home: 1.8, draw: 3.4, away: 4.5 },
    ]
    // home sorted: 1.5,1.6,1.7,1.8 -> (1.6+1.7)/2 = 1.65
    // draw sorted: 3.4,3.6,3.8,4.0 -> (3.6+3.8)/2 = 3.7
    // away sorted: 4.5,5.0,5.5,6.0 -> (5.0+5.5)/2 = 5.25
    expect(medianOddsAcrossBooks(rows)).toEqual({ home: 1.65, draw: 3.7, away: 5.25 })
  })

  it('takes the median of each of the three prices independently, across an ODD number of books', () => {
    const rows: MarketOddsPrices[] = [
      { home: 1.5, draw: 4.0, away: 6.0 },
      { home: 1.7, draw: 3.6, away: 5.0 },
      { home: 1.6, draw: 3.8, away: 5.5 },
    ]
    // home sorted: 1.5,1.6,1.7 -> 1.6; draw sorted: 3.6,3.8,4.0 -> 3.8; away sorted: 5.0,5.5,6.0 -> 5.5
    expect(medianOddsAcrossBooks(rows)).toEqual({ home: 1.6, draw: 3.8, away: 5.5 })
  })
})

// ============================================================================
// removeOverround — DoD-named test: "overround removal on a known three-price example"
// ============================================================================

describe('removeOverround', () => {
  it('a known three-price example: home 2.0, draw 3.5, away 4.0', () => {
    // raw = 1/2, 2/7, 1/4 = 14/28, 8/28, 7/28 -> overround = 29/28
    const result = removeOverround({ home: 2.0, draw: 3.5, away: 4.0 })
    expect(result.overround).toBeCloseTo(29 / 28, 10)
    expect(result.pHome).toBeCloseTo(14 / 29, 10)
    expect(result.pDraw).toBeCloseTo(8 / 29, 10)
    expect(result.pAway).toBeCloseTo(7 / 29, 10)
  })

  it('the three probabilities always sum to exactly 1 (proportional normalisation, by construction)', () => {
    const result = removeOverround({ home: 1.8, draw: 3.9, away: 4.6 })
    expect(result.pHome + result.pDraw + result.pAway).toBeCloseTo(1, 10)
  })

  it('a book with no margin at all (overround exactly 1) leaves the raw probabilities unchanged', () => {
    // 1/2 + 1/4 + 1/4 = 1 exactly -> home 2.0, draw 4.0, away 4.0
    const result = removeOverround({ home: 2.0, draw: 4.0, away: 4.0 })
    expect(result.overround).toBeCloseTo(1, 10)
    expect(result.pHome).toBeCloseTo(0.5, 10)
    expect(result.pDraw).toBeCloseTo(0.25, 10)
    expect(result.pAway).toBeCloseTo(0.25, 10)
  })
})

// ============================================================================
// marketExpectedScore
// ============================================================================

describe('marketExpectedScore', () => {
  const probabilities = { pHome: 14 / 29, pDraw: 8 / 29, pAway: 7 / 29 }

  it('home = pHome + 0.5 * pDraw', () => {
    expect(marketExpectedScore(probabilities, 'home')).toBeCloseTo(18 / 29, 10)
  })

  it('away = pAway + 0.5 * pDraw', () => {
    expect(marketExpectedScore(probabilities, 'away')).toBeCloseTo(11 / 29, 10)
  })

  it('home + away sum to exactly 1 -- the draw is split evenly, the elo-expected-score definition', () => {
    const home = marketExpectedScore(probabilities, 'home')
    const away = marketExpectedScore(probabilities, 'away')
    expect(home + away).toBeCloseTo(1, 10)
  })

  it('an even three-way market (no favourite) gives exactly 0.5 for both sides', () => {
    const even = { pHome: 1 / 3, pDraw: 1 / 3, pAway: 1 / 3 }
    expect(marketExpectedScore(even, 'home')).toBeCloseTo(0.5, 10)
    expect(marketExpectedScore(even, 'away')).toBeCloseTo(0.5, 10)
  })
})

// ============================================================================
// isMarketOddsFresh -- DoD-named behaviour: "odds older than 48h are not used" (the precedence
// side of this is tested in expectedPoints.test.ts; this is the underlying arithmetic).
// ============================================================================

describe('isMarketOddsFresh', () => {
  const HOUR = 60 * 60 * 1000

  it('exactly at the 48h boundary is still fresh (inclusive)', () => {
    expect(isMarketOddsFresh(0, MARKET_ODDS_FRESHNESS_HOURS * HOUR)).toBe(true)
  })

  it('one millisecond past the 48h boundary is stale', () => {
    expect(isMarketOddsFresh(0, MARKET_ODDS_FRESHNESS_HOURS * HOUR + 1)).toBe(false)
  })

  it('a row fetched in the future relative to "now" (clock skew) is fresh', () => {
    expect(isMarketOddsFresh(10 * HOUR, 5 * HOUR)).toBe(true)
  })

  it('a custom freshness window overrides the default', () => {
    expect(isMarketOddsFresh(0, 2 * HOUR, 1)).toBe(false)
    expect(isMarketOddsFresh(0, 2 * HOUR, 3)).toBe(true)
  })
})
