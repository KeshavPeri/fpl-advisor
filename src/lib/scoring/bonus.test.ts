import { describe, expect, it } from 'vitest'
import { allocateBonusPoints } from './bonus.ts'

describe('bonus allocation — no tie', () => {
  it('awards 3/2/1 to the top three by BPS', () => {
    const result = allocateBonusPoints([
      { id: 'a', bps: 40 },
      { id: 'b', bps: 30 },
      { id: 'c', bps: 20 },
      { id: 'd', bps: 10 },
    ])
    expect(result).toEqual([
      { id: 'a', bonus: 3 },
      { id: 'b', bonus: 2 },
      { id: 'c', bonus: 1 },
      { id: 'd', bonus: 0 },
    ])
  })
})

describe('bonus allocation — tie for first', () => {
  it('both players tied for first get 3; the next player gets 1; nobody gets 2', () => {
    const result = allocateBonusPoints([
      { id: 'a', bps: 40 },
      { id: 'b', bps: 40 },
      { id: 'c', bps: 30 },
    ])
    expect(result).toEqual([
      { id: 'a', bonus: 3 },
      { id: 'b', bonus: 3 },
      { id: 'c', bonus: 1 },
    ])
  })
})

describe('bonus allocation — tie for second', () => {
  it('leader gets 3, both tied for second get 2; nobody gets 1', () => {
    const result = allocateBonusPoints([
      { id: 'a', bps: 40 },
      { id: 'b', bps: 30 },
      { id: 'c', bps: 30 },
      { id: 'd', bps: 20 },
    ])
    expect(result).toEqual([
      { id: 'a', bonus: 3 },
      { id: 'b', bonus: 2 },
      { id: 'c', bonus: 2 },
      { id: 'd', bonus: 0 },
    ])
  })
})

describe('bonus allocation — tie for third', () => {
  it('leader gets 3, second gets 2, every player tied for third gets 1', () => {
    const result = allocateBonusPoints([
      { id: 'a', bps: 40 },
      { id: 'b', bps: 30 },
      { id: 'c', bps: 20 },
      { id: 'd', bps: 20 },
      { id: 'e', bps: 10 },
    ])
    expect(result).toEqual([
      { id: 'a', bonus: 3 },
      { id: 'b', bonus: 2 },
      { id: 'c', bonus: 1 },
      { id: 'd', bonus: 1 },
      { id: 'e', bonus: 0 },
    ])
  })
})
