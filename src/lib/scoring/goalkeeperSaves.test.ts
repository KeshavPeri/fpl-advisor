import { describe, expect, it } from 'vitest'
import { goalkeeperSavePoints } from './goalkeeperSaves.ts'

describe('goalkeeper save points — uncapped, groups of three', () => {
  it('2 saves scores 0', () => {
    expect(goalkeeperSavePoints(2)).toBe(0)
  })

  it('3 saves scores 1', () => {
    expect(goalkeeperSavePoints(3)).toBe(1)
  })

  it('5 saves scores 1 (incomplete second group)', () => {
    expect(goalkeeperSavePoints(5)).toBe(1)
  })

  it('6 saves scores 2', () => {
    expect(goalkeeperSavePoints(6)).toBe(2)
  })

  it('9 saves scores 3', () => {
    expect(goalkeeperSavePoints(9)).toBe(3)
  })

  it('30 saves scores 10 — no upper bound', () => {
    expect(goalkeeperSavePoints(30)).toBe(10)
  })
})
