import { describe, expect, it } from 'vitest'
import { HIT_COST_PER_TRANSFER, computeHitCost, computeNetPoints } from './hitCost.ts'

describe('computeHitCost', () => {
  it('zero hits: transfers made equals free transfers available', () => {
    expect(computeHitCost(1, 1)).toBe(0)
    expect(computeHitCost(2, 2)).toBe(0)
  })

  it('zero hits: transfers made is below free transfers available (rolled transfers)', () => {
    expect(computeHitCost(0, 2)).toBe(0)
  })

  it('one hit: exactly one transfer beyond the free allowance', () => {
    expect(computeHitCost(2, 1)).toBe(HIT_COST_PER_TRANSFER)
    expect(computeHitCost(2, 1)).toBe(4)
  })

  it('two hits: two transfers beyond the free allowance', () => {
    expect(computeHitCost(3, 1)).toBe(2 * HIT_COST_PER_TRANSFER)
    expect(computeHitCost(3, 1)).toBe(8)
  })

  it('floors at zero — never a negative hit cost when free transfers exceed transfers made', () => {
    expect(computeHitCost(0, 5)).toBe(0)
  })

  it('rounds noisy solver floats before subtracting, so 0.9999999999999996 transfers against 1 free transfer costs nothing', () => {
    expect(computeHitCost(0.9999999999999996, 1)).toBe(0)
  })

  it('rounds a noisy free-transfers figure too: 1.0000000000000044 free transfers against 2 made is exactly one hit', () => {
    expect(computeHitCost(2, 1.0000000000000044)).toBe(4)
  })
})

describe('computeNetPoints', () => {
  it('subtracts the hit cost from the gross projected gain', () => {
    expect(computeNetPoints(20, 4)).toBe(16)
  })

  it('equals the gross figure when there is no hit', () => {
    expect(computeNetPoints(15.5, 0)).toBe(15.5)
  })

  it('can go negative — a hit that is not worth it is not hidden', () => {
    expect(computeNetPoints(2, 4)).toBe(-2)
  })
})
