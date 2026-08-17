import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE_CLEAR_THRESHOLD,
  CONFIDENCE_MARGINAL_THRESHOLD,
  applyCoverageFloor,
  deriveConfidenceBand,
} from './confidence.ts'

describe('deriveConfidenceBand', () => {
  it('is "clear" at exactly the clear threshold and above', () => {
    expect(deriveConfidenceBand(CONFIDENCE_CLEAR_THRESHOLD)).toBe('clear')
    expect(deriveConfidenceBand(5)).toBe('clear')
  })

  it('is "marginal" at exactly the marginal threshold and up to (not including) the clear threshold', () => {
    expect(deriveConfidenceBand(CONFIDENCE_MARGINAL_THRESHOLD)).toBe('marginal')
    expect(deriveConfidenceBand(1)).toBe('marginal')
    expect(deriveConfidenceBand(CONFIDENCE_CLEAR_THRESHOLD - 0.01)).toBe('marginal')
  })

  it('is "coin-flip" below the marginal threshold', () => {
    expect(deriveConfidenceBand(0)).toBe('coin-flip')
    expect(deriveConfidenceBand(0.49)).toBe('coin-flip')
  })

  it('treats the gap as unsigned — a negative gap (Plan B scoring worse, expressed the other way round) is not "more confident" than the same positive gap', () => {
    expect(deriveConfidenceBand(-5)).toBe('clear')
    expect(deriveConfidenceBand(-0.1)).toBe('coin-flip')
  })
})

describe('applyCoverageFloor', () => {
  it('leaves the band unchanged when there is no coverage gap', () => {
    expect(applyCoverageFloor('clear', false)).toBe('clear')
    expect(applyCoverageFloor('marginal', false)).toBe('marginal')
    expect(applyCoverageFloor('coin-flip', false)).toBe('coin-flip')
  })

  it('drops "clear" to "marginal" when there is a coverage gap', () => {
    expect(applyCoverageFloor('clear', true)).toBe('marginal')
  })

  it('drops "marginal" to "coin-flip" when there is a coverage gap', () => {
    expect(applyCoverageFloor('marginal', true)).toBe('coin-flip')
  })

  it('is a floor, not a ceiling: "coin-flip" cannot go any lower, and a coverage gap never raises a band', () => {
    expect(applyCoverageFloor('coin-flip', true)).toBe('coin-flip')
  })
})
