import { describe, expect, it } from 'vitest'
import { totalMatchPoints, type MatchPointComponents } from './totalMatchPoints.ts'

const zeroed: MatchPointComponents = {
  appearancePoints: 0,
  goalPoints: 0,
  assistPoints: 0,
  cleanSheetPoints: 0,
  goalsConcededPoints: 0,
  savePoints: 0,
  defensiveContributionPoints: 0,
  penaltySavePoints: 0,
  penaltyMissPoints: 0,
  yellowCardPoints: 0,
  redCardPoints: 0,
  ownGoalPoints: 0,
  bonusPoints: 0,
}

describe('total match points — sums component stats', () => {
  it('sums a full mix of components, including negative ones', () => {
    const total = totalMatchPoints({
      ...zeroed,
      appearancePoints: 2,
      goalPoints: 5,
      assistPoints: 3,
      cleanSheetPoints: 1,
      defensiveContributionPoints: 2,
      yellowCardPoints: -1,
      bonusPoints: 3,
    })
    expect(total).toBe(15)
  })

  it('all-zero components sum to 0', () => {
    expect(totalMatchPoints(zeroed)).toBe(0)
  })
})
