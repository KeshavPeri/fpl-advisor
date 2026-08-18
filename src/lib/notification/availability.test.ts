import { describe, expect, it } from 'vitest'
import { classifyAvailability } from './availability.ts'

describe('classifyAvailability', () => {
  it('is "current" when the latest recommendation matches the current gameweek', () => {
    expect(classifyAvailability({ currentGameweekId: 5, latestRecommendationGameweekId: 5 })).toEqual({ kind: 'current' })
  })

  it('is "none" when no recommendation has ever been stored', () => {
    expect(classifyAvailability({ currentGameweekId: 5, latestRecommendationGameweekId: null })).toEqual({ kind: 'none' })
  })

  it('is "stale" when the latest recommendation is for an older gameweek, and reports how far behind it is', () => {
    expect(classifyAvailability({ currentGameweekId: 5, latestRecommendationGameweekId: 3 })).toEqual({
      kind: 'stale',
      recommendationGameweekId: 3,
      currentGameweekId: 5,
      gameweeksBehind: 2,
    })
  })

  it('treats a recommendation for a LATER gameweek than "current" as current, not an error', () => {
    // Can happen if the gameweeks table's own "next unpassed deadline" lookup
    // lags a fresh solve — the plan is still the best forward-looking one
    // available, not stale data being presented as new.
    expect(classifyAvailability({ currentGameweekId: 5, latestRecommendationGameweekId: 6 })).toEqual({ kind: 'current' })
  })

  it('one gameweek behind is singular in wording elsewhere, but this function itself always reports the plain count', () => {
    expect(classifyAvailability({ currentGameweekId: 4, latestRecommendationGameweekId: 3 })).toEqual({
      kind: 'stale',
      recommendationGameweekId: 3,
      currentGameweekId: 4,
      gameweeksBehind: 1,
    })
  })
})
