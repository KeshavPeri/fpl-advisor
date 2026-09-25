// Unit tests for src/lib/teamColours.ts — ticket #276.
import { describe, expect, it } from 'vitest'
import { getTeamColours, KNOWN_TEAM_SHORT_NAMES } from './teamColours'

// This season's 20 clubs (scripts/lib/oddsClubNames.ts's own verified-against-live-data list,
// see teamColours.ts's own header) — the fixture list this ticket's DoD names.
const FIXTURE_SHORT_NAMES = [
  'ARS',
  'AVL',
  'BOU',
  'BRE',
  'BHA',
  'CHE',
  'COV',
  'CRY',
  'EVE',
  'FUL',
  'HUL',
  'IPS',
  'LEE',
  'LIV',
  'MCI',
  'MUN',
  'NEW',
  'NFO',
  'SUN',
  'TOT',
]

describe('teamColours — covers every short_name in the fixture list', () => {
  it('KNOWN_TEAM_SHORT_NAMES is exactly the 20-club fixture list, no more, no fewer', () => {
    expect(KNOWN_TEAM_SHORT_NAMES.length).toBe(20)
    expect([...KNOWN_TEAM_SHORT_NAMES].sort()).toEqual([...FIXTURE_SHORT_NAMES].sort())
  })

  it.each(FIXTURE_SHORT_NAMES)('%s resolves to a primary and a secondary colour', (shortName) => {
    const colours = getTeamColours(shortName)
    expect(colours).toBeDefined()
    expect(colours?.primary).toMatch(/^#[0-9a-f]{6}$/i)
    expect(colours?.secondary).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('no two clubs share the same primary colour', () => {
    const primaries = FIXTURE_SHORT_NAMES.map((name) => getTeamColours(name)?.primary)
    expect(new Set(primaries).size).toBe(FIXTURE_SHORT_NAMES.length)
  })
})

describe('teamColours — no green, no yellow (design-reference.md)', () => {
  function hueDegrees(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    if (delta === 0) return 0
    let hue: number
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
    return hue < 0 ? hue + 360 : hue
  }

  it.each(FIXTURE_SHORT_NAMES)('%s stays out of the banned yellow (45-65°) and green (90-160°) hue bands', (shortName) => {
    const colours = getTeamColours(shortName)
    for (const hex of [colours!.primary, colours!.secondary]) {
      const hue = hueDegrees(hex)
      expect(hue < 45 || hue > 65).toBe(true)
      expect(hue < 90 || hue > 160).toBe(true)
    }
  })
})

describe('teamColours — falls back for an unknown club', () => {
  it('returns undefined for a club not in the list', () => {
    expect(getTeamColours('ZZZ')).toBeUndefined()
  })

  it('returns undefined for null, undefined, or an empty string', () => {
    expect(getTeamColours(null)).toBeUndefined()
    expect(getTeamColours(undefined)).toBeUndefined()
    expect(getTeamColours('')).toBeUndefined()
  })

  it('is case- and whitespace-insensitive on a real short_name', () => {
    expect(getTeamColours(' ars ')).toEqual(getTeamColours('ARS'))
    expect(getTeamColours('ars')).toEqual(getTeamColours('ARS'))
  })
})
