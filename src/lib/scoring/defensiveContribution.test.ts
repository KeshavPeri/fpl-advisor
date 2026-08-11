import { describe, expect, it } from 'vitest'
import { defensiveContributionPoints } from './defensiveContribution.ts'
import { DEFENDER, FORWARD, MIDFIELDER } from './types.ts'

function stats({
  clearances = 0,
  blocks = 0,
  interceptions = 0,
  tackles = 0,
  recoveries = 0,
}: Partial<{
  clearances: number
  blocks: number
  interceptions: number
  tackles: number
  recoveries: number
}>) {
  return { clearances, blocks, interceptions, tackles, recoveries }
}

describe('defensive contribution — defenders (10 CBIT threshold)', () => {
  it('defender on 9 CBIT scores 0', () => {
    expect(defensiveContributionPoints(DEFENDER, stats({ clearances: 9 }))).toBe(0)
  })

  it('defender reaching 10 CBIT scores 2', () => {
    expect(defensiveContributionPoints(DEFENDER, stats({ clearances: 10 }))).toBe(2)
  })

  it('defender on 19 CBIT still scores 2, not more', () => {
    expect(defensiveContributionPoints(DEFENDER, stats({ clearances: 19 }))).toBe(2)
  })

  it('defender on 20 CBIT is capped at 2, not doubled', () => {
    expect(defensiveContributionPoints(DEFENDER, stats({ clearances: 20 }))).toBe(2)
  })

  it('defender recoveries do NOT count toward the CBIT threshold', () => {
    expect(
      defensiveContributionPoints(DEFENDER, stats({ clearances: 9, recoveries: 5 })),
    ).toBe(0)
  })
})

describe('defensive contribution — midfielders/forwards (12 CBIRT threshold)', () => {
  it('midfielder on 11 CBIRT scores 0', () => {
    expect(defensiveContributionPoints(MIDFIELDER, stats({ clearances: 11 }))).toBe(0)
  })

  it('midfielder reaching 12 CBIRT scores 2', () => {
    expect(defensiveContributionPoints(MIDFIELDER, stats({ clearances: 12 }))).toBe(2)
  })

  it('midfielder on 25 CBIRT is capped at 2', () => {
    expect(defensiveContributionPoints(MIDFIELDER, stats({ clearances: 25 }))).toBe(2)
  })

  it('midfielder recoveries count toward the CBIRT threshold', () => {
    expect(
      defensiveContributionPoints(MIDFIELDER, stats({ clearances: 6, recoveries: 6 })),
    ).toBe(2)
  })

  it('forward reaching 12 CBIRT via recoveries scores 2', () => {
    expect(
      defensiveContributionPoints(FORWARD, stats({ tackles: 6, recoveries: 6 })),
    ).toBe(2)
  })
})
