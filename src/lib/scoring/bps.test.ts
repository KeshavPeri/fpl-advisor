import { describe, expect, it } from 'vitest'
import { bpsFromBeingTackled, bpsFromCbi, bpsFromSave, bpsFromSaves } from './bps.ts'

describe('BPS from CBI — 2026/27 is 1 per 3 actions (was 2)', () => {
  it('2 CBI actions score 0 BPS', () => {
    expect(bpsFromCbi(2)).toBe(0)
  })

  it('3 CBI actions score 1 BPS', () => {
    expect(bpsFromCbi(3)).toBe(1)
  })

  it('5 CBI actions score 1 BPS (incomplete second group of three)', () => {
    expect(bpsFromCbi(5)).toBe(1)
  })

  it('6 CBI actions score 2 BPS', () => {
    expect(bpsFromCbi(6)).toBe(2)
  })
})

describe('BPS from being tackled — 2026/27 removes the penalty', () => {
  it('being tackled contributes 0 BPS', () => {
    expect(bpsFromBeingTackled()).toBe(0)
  })
})

describe('goalkeeper BPS from saves — 2026/27 values, per save', () => {
  it('one ordinary save scores 2 BPS', () => {
    expect(bpsFromSave({ insideBox: false, isBigChance: false, isPenaltySave: false })).toBe(2)
  })

  it('one save inside the box scores 3 BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: false, isPenaltySave: false })).toBe(3)
  })

  it('one save of a big chance scores 3 BPS', () => {
    expect(bpsFromSave({ insideBox: false, isBigChance: true, isPenaltySave: false })).toBe(3)
  })

  it('one save inside the box that is also a big chance scores 4 BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: true, isPenaltySave: false })).toBe(4)
  })

  it('a penalty save scores a flat 7 BPS (down from 8), not stacked with ordinary save BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: true, isPenaltySave: true })).toBe(7)
  })

  it('three ordinary saves in a match accumulate to 6 BPS, not a flat per-match award', () => {
    const saves = [
      { insideBox: false, isBigChance: false, isPenaltySave: false },
      { insideBox: false, isBigChance: false, isPenaltySave: false },
      { insideBox: false, isBigChance: false, isPenaltySave: false },
    ]
    expect(bpsFromSaves(saves)).toBe(6)
  })
})
