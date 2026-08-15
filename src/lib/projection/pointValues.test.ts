import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../scoring/types.ts'
import {
  APPEARANCE_POINTS_60_PLUS,
  APPEARANCE_POINTS_UNDER_60,
  ASSIST_POINTS,
  cleanSheetPoints,
  expectedAppearancePoints,
  goalPoints,
  goalsConcededPointsApply,
  savePointsApply,
} from './pointValues.ts'

describe('goal points by position — the 2026/27 published values', () => {
  it('goalkeeper is 10, not the historical 6', () => {
    expect(goalPoints(GOALKEEPER)).toBe(10)
  })
  it('defender is 6', () => {
    expect(goalPoints(DEFENDER)).toBe(6)
  })
  it('midfielder is 5', () => {
    expect(goalPoints(MIDFIELDER)).toBe(5)
  })
  it('forward is 4', () => {
    expect(goalPoints(FORWARD)).toBe(4)
  })
})

describe('clean sheet points by position', () => {
  it('goalkeeper and defender are both 4', () => {
    expect(cleanSheetPoints(GOALKEEPER)).toBe(4)
    expect(cleanSheetPoints(DEFENDER)).toBe(4)
  })
  it('midfielder is 1', () => {
    expect(cleanSheetPoints(MIDFIELDER)).toBe(1)
  })
  it('forward is 0', () => {
    expect(cleanSheetPoints(FORWARD)).toBe(0)
  })
})

describe('assist points: flat 3 for every position', () => {
  it('is 3', () => {
    expect(ASSIST_POINTS).toBe(3)
  })
})

describe('goals-conceded points apply only to goalkeepers and defenders', () => {
  it('goalkeeper: yes', () => expect(goalsConcededPointsApply(GOALKEEPER)).toBe(true))
  it('defender: yes', () => expect(goalsConcededPointsApply(DEFENDER)).toBe(true))
  it('midfielder: no', () => expect(goalsConcededPointsApply(MIDFIELDER)).toBe(false))
  it('forward: no', () => expect(goalsConcededPointsApply(FORWARD)).toBe(false))
})

describe('save points apply only to goalkeepers', () => {
  it('goalkeeper: yes', () => expect(savePointsApply(GOALKEEPER)).toBe(true))
  it('defender: no', () => expect(savePointsApply(DEFENDER)).toBe(false))
  it('midfielder: no', () => expect(savePointsApply(MIDFIELDER)).toBe(false))
  it('forward: no', () => expect(savePointsApply(FORWARD)).toBe(false))
})

describe('expected appearance points', () => {
  it('pAppears 0.75, pSixtyPlus 0.60 -> 1.35, within 0.001 (ticket #33 example)', () => {
    expect(expectedAppearancePoints(0.75, 0.6)).toBeCloseTo(1.35, 3)
  })
  it('is pAppears * APPEARANCE_POINTS_UNDER_60 + pSixtyPlus * (60_PLUS - UNDER_60)', () => {
    const pAppears = 0.42
    const pSixtyPlus = 0.2
    const expected =
      pAppears * APPEARANCE_POINTS_UNDER_60 + pSixtyPlus * (APPEARANCE_POINTS_60_PLUS - APPEARANCE_POINTS_UNDER_60)
    expect(expectedAppearancePoints(pAppears, pSixtyPlus)).toBeCloseTo(expected, 10)
  })
  it('zero probabilities give zero points', () => {
    expect(expectedAppearancePoints(0, 0)).toBe(0)
  })
  it('certain full appearance (pAppears=1, pSixtyPlus=1) gives 2', () => {
    expect(expectedAppearancePoints(1, 1)).toBe(2)
  })
})
