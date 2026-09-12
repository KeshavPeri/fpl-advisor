// Unit tests for scripts/ingest-gameweek-live-stats.ts — ticket #224.
//
// This job's live event/{gw}/live/ fetch and Supabase writes can't be exercised without a real
// network call and a live Supabase project (same limitation every scripts/*.ts test file already
// documents — see e.g. scripts/settle-predictions.test.ts). validateLiveStatsShape,
// parseLiveElements and mapLiveRowsToPlayerCode are pure functions with no I/O of their own, so
// they are exercised directly on constructed event/{gw}/live/-shaped payloads instead.
//
// This ticket's own DoD names three shape-validation cases explicitly: "a well-formed payload, a
// missing `stats` key, and an empty `elements` array." The three describe blocks below are named
// after exactly those cases.

import { describe, expect, it } from 'vitest'
import { mapLiveRowsToPlayerCode, parseLiveElements, validateLiveStatsShape } from './ingest-gameweek-live-stats.ts'

const ENDPOINT = 'https://fantasy.premierleague.com/api/event/3/live/'

/** A minimal, well-formed event/{gw}/live/ element — only the fields this job reads. */
function element(overrides: { id?: unknown; stats?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    id: 1,
    stats: { bonus: 2, bps: 28, minutes: 90, total_points: 8, ...overrides.stats },
    ...(overrides.id !== undefined ? { id: overrides.id } : {}),
  }
}

describe('validateLiveStatsShape — a well-formed payload', () => {
  it('does not throw for a response with a non-empty elements array whose entries all carry a stats object', () => {
    const payload = { elements: [element({ id: 1 }), element({ id: 2 })] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).not.toThrow()
  })
})

describe('validateLiveStatsShape — a missing "stats" key', () => {
  it('throws when an element has no "stats" field at all', () => {
    const payload = { elements: [element({ id: 1 }), { id: 2 }] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).toThrow(/missing a "stats" object/)
  })

  it('throws when an element\'s "stats" field is present but not an object (e.g. a string)', () => {
    const payload = { elements: [{ id: 1, stats: 'not-an-object' }] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).toThrow(/missing a "stats" object/)
  })

  it('names the offending element\'s id in the thrown message, when it is present', () => {
    const payload = { elements: [element({ id: 1 }), { id: 42 }] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).toThrow(/id 42/)
  })
})

describe('validateLiveStatsShape — an empty "elements" array', () => {
  it('throws for a response whose elements array is present but empty', () => {
    const payload = { elements: [] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).toThrow(/elements" array is empty/)
  })
})

describe('validateLiveStatsShape — other malformed top-level shapes', () => {
  it('throws when the response is not a JSON object at all', () => {
    expect(() => validateLiveStatsShape('not-an-object', ENDPOINT)).toThrow(/not a JSON object/)
  })

  it('throws when "elements" is missing entirely', () => {
    expect(() => validateLiveStatsShape({}, ENDPOINT)).toThrow(/missing an "elements" array/)
  })

  it('throws when "elements" is present but not an array', () => {
    expect(() => validateLiveStatsShape({ elements: 'nope' }, ENDPOINT)).toThrow(/missing an "elements" array/)
  })

  it('throws when an element in the array is not an object', () => {
    const payload = { elements: [element({ id: 1 }), 'not-an-object'] }
    expect(() => validateLiveStatsShape(payload, ENDPOINT)).toThrow(/is not a JSON object/)
  })
})

describe('parseLiveElements', () => {
  it('parses bonus, bps, minutes and total_points verbatim from a well-formed element', () => {
    const result = parseLiveElements([element({ id: 7, stats: { bonus: 3, bps: 41, minutes: 90, total_points: 12 } })])
    expect(result.rows).toEqual([{ elementId: 7, bonus: 3, bps: 41, minutes: 90, totalPoints: 12 }])
    expect(result.skippedMissingElementId).toBe(0)
    expect(result.skippedMissingNumericStat).toEqual([])
  })

  it('writes a real, measured zero for bonus/bps/minutes/total_points rather than skipping it', () => {
    const result = parseLiveElements([element({ id: 9, stats: { bonus: 0, bps: 0, minutes: 0, total_points: 0 } })])
    expect(result.rows).toEqual([{ elementId: 9, bonus: 0, bps: 0, minutes: 0, totalPoints: 0 }])
  })

  it('carries a negative bps through verbatim (cards and other negative-BPS actions can take it below zero)', () => {
    const result = parseLiveElements([element({ id: 10, stats: { bonus: 0, bps: -3, minutes: 90, total_points: 1 } })])
    expect(result.rows[0].bps).toBe(-3)
  })

  it('excludes (never guesses) an element whose id is non-numeric', () => {
    const result = parseLiveElements([{ id: 'not-a-number', stats: { bonus: 1, bps: 10, minutes: 90, total_points: 5 } }])
    expect(result.rows).toEqual([])
    expect(result.skippedMissingElementId).toBe(1)
  })

  it('excludes (never guesses a 0 for) an element missing one required numeric stat field', () => {
    const result = parseLiveElements([{ id: 11, stats: { bonus: 1, bps: 10, minutes: 90 } }]) // no total_points
    expect(result.rows).toEqual([])
    expect(result.skippedMissingNumericStat).toEqual([11])
  })

  it('excludes an element whose numeric stat field is a non-numeric string', () => {
    const result = parseLiveElements([{ id: 12, stats: { bonus: 'many', bps: 10, minutes: 90, total_points: 5 } }])
    expect(result.rows).toEqual([])
    expect(result.skippedMissingNumericStat).toEqual([12])
  })

  it('reconciles: every element lands in rows, skippedMissingElementId or skippedMissingNumericStat, exactly once', () => {
    const elements = [
      element({ id: 1 }),
      { id: 'bad' },
      { id: 2, stats: { bonus: 1, bps: 5, minutes: 90 } }, // missing total_points
    ]
    const result = parseLiveElements(elements)
    expect(result.rows.length + result.skippedMissingElementId + result.skippedMissingNumericStat.length).toBe(elements.length)
  })
})

describe('mapLiveRowsToPlayerCode', () => {
  it('maps a parsed row to its player_code via the id -> code map', () => {
    const parsed = [{ elementId: 1, bonus: 2, bps: 28, minutes: 90, totalPoints: 8 }]
    const result = mapLiveRowsToPlayerCode(3, parsed, new Map([[1, 12345]]))
    expect(result.rows).toEqual([{ gameweek_id: 3, player_code: 12345, bonus: 2, bps: 28, minutes: 90, total_points: 8 }])
    expect(result.unmappableElementIds).toEqual([])
  })

  it('excludes (never guesses) an element id with no matching players row at all', () => {
    const parsed = [{ elementId: 999, bonus: 0, bps: 0, minutes: 0, totalPoints: 0 }]
    const result = mapLiveRowsToPlayerCode(3, parsed, new Map())
    expect(result.rows).toEqual([])
    expect(result.unmappableElementIds).toEqual([999])
  })

  it('excludes an element id whose players row has a null code', () => {
    const parsed = [{ elementId: 5, bonus: 0, bps: 0, minutes: 0, totalPoints: 0 }]
    const result = mapLiveRowsToPlayerCode(3, parsed, new Map([[5, null]]))
    expect(result.rows).toEqual([])
    expect(result.unmappableElementIds).toEqual([5])
  })

  it('stamps every mapped row with the given gameweek_id', () => {
    const parsed = [
      { elementId: 1, bonus: 0, bps: 0, minutes: 90, totalPoints: 2 },
      { elementId: 2, bonus: 0, bps: 0, minutes: 90, totalPoints: 2 },
    ]
    const result = mapLiveRowsToPlayerCode(7, parsed, new Map([[1, 100], [2, 200]]))
    expect(result.rows.every((r) => r.gameweek_id === 7)).toBe(true)
  })
})
