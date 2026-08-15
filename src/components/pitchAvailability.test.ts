import { describe, expect, it } from 'vitest'
import { deriveAvailability } from './pitchAvailability'

describe('deriveAvailability — ticket #38 DoD rules', () => {
  it("status 'i' -> solid ring", () => {
    expect(deriveAvailability('i', null).ring).toBe('solid')
  })

  it("status 's' -> solid ring", () => {
    expect(deriveAvailability('s', null).ring).toBe('solid')
  })

  it("status 'u' -> solid ring", () => {
    expect(deriveAvailability('u', null).ring).toBe('solid')
  })

  it("status 'i' wins over a high chance figure — out is out regardless of chance", () => {
    expect(deriveAvailability('i', 75).ring).toBe('solid')
  })

  it("status 'd' with a null chance -> hollow ring", () => {
    expect(deriveAvailability('d', null).ring).toBe('hollow')
  })

  it("status 'a' with a non-null chance below 100 -> hollow ring", () => {
    expect(deriveAvailability('a', 75).ring).toBe('hollow')
  })

  it("status 'd' with a chance of 100 -> still hollow (status 'd' always rings)", () => {
    expect(deriveAvailability('d', 100).ring).toBe('hollow')
  })

  it("status 'a' with no chance set -> no ring", () => {
    expect(deriveAvailability('a', null).ring).toBe('none')
  })

  it("status 'a' with a chance of exactly 100 -> no ring", () => {
    expect(deriveAvailability('a', 100).ring).toBe('none')
  })

  it('every ring carries a non-empty text label for assistive tech, not colour alone', () => {
    expect(deriveAvailability('i', null).label).toBeTruthy()
    expect(deriveAvailability('d', null).label).toBeTruthy()
    expect(deriveAvailability('a', null).label).toBeTruthy()
  })

  it('a hollow ring from a published chance names the percentage in its label', () => {
    expect(deriveAvailability('a', 75).label).toContain('75%')
  })
})
