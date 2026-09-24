// Unit tests for scripts/emit-projections-csv.ts's pure CSV-shaping
// functions — ticket #34. No Supabase, no filesystem, no solver: every DoD
// item that can be proven without a database is proven here (header shape,
// quoting, position mapping, zero-fill, the model_version primary-key
// collision, and the empty-gameweek hard-failure signal). What cannot be
// proven here — that emitted `ID` values survive the solver's live inner
// merge — is explicitly out of this ticket's scope (see docs/solver-notes.md
// and the ticket's own Notes section); that is item 12's job.

import { describe, expect, it } from 'vitest'
import {
  buildHeaderRow,
  buildProjectionsCsv,
  csvField,
  findEmptyGameweeks,
  mapPosition,
  mergeActiveAndFallbackProjections,
  projectionKey,
  type CsvPlayerInput,
  type ProjectionValue,
} from './emit-projections-csv.js'

// ============================================================================
// buildHeaderRow — the exact contract dev/solver.py's prep_data reads.
// ============================================================================

describe('buildHeaderRow', () => {
  it('produces the exact header string for a horizon starting at gameweek 3, 5 gameweeks long', () => {
    const header = buildHeaderRow([3, 4, 5, 6, 7])
    expect(header).toBe('ID,Pos,Name,Team,3_Pts,3_xMins,4_Pts,4_xMins,5_Pts,5_xMins,6_Pts,6_xMins,7_Pts,7_xMins')
  })

  it('uses absolute FPL gameweek numbers, not offsets, for a horizon starting at gameweek 1', () => {
    const header = buildHeaderRow([1, 2])
    expect(header).toBe('ID,Pos,Name,Team,1_Pts,1_xMins,2_Pts,2_xMins')
  })
})

// ============================================================================
// mapPosition — one named test per position, per the DoD.
// ============================================================================

describe('mapPosition', () => {
  it('maps element_type 1 to G', () => {
    expect(mapPosition(1)).toBe('G')
  })

  it('maps element_type 2 to D', () => {
    expect(mapPosition(2)).toBe('D')
  })

  it('maps element_type 3 to M', () => {
    expect(mapPosition(3)).toBe('M')
  })

  it('maps element_type 4 to F', () => {
    expect(mapPosition(4)).toBe('F')
  })

  it('throws on an unrecognised element_type rather than silently mis-mapping', () => {
    expect(() => mapPosition(5)).toThrow(/unknown players\.element_type/)
  })
})

// ============================================================================
// csvField — quoting, per the DoD's "comma and a double quote" named test.
// ============================================================================

describe('csvField', () => {
  it('leaves a plain number unquoted and free of thousands separators', () => {
    expect(csvField(1234)).toBe('1234')
    expect(csvField(4.5)).toBe('4.5')
    expect(csvField(0)).toBe('0')
  })

  it('leaves a plain name unquoted', () => {
    expect(csvField('Salah')).toBe('Salah')
  })

  it('quotes and escapes a name containing both a comma and a double quote', () => {
    // e.g. a hypothetical web_name like: Smith, "Jonny" Jr.
    expect(csvField('Smith, "Jonny" Jr.')).toBe('"Smith, ""Jonny"" Jr."')
  })

  it('quotes a name containing only a comma', () => {
    expect(csvField('Smith, Jonny')).toBe('"Smith, Jonny"')
  })

  it('quotes a name containing only a double quote', () => {
    expect(csvField('Jonny "The Wall" Smith')).toBe('"Jonny ""The Wall"" Smith"')
  })
})

// ============================================================================
// findEmptyGameweeks — the hard-failure signal.
// ============================================================================

describe('findEmptyGameweeks', () => {
  it('returns an empty array when every horizon gameweek has at least one projection row', () => {
    expect(findEmptyGameweeks([3, 4, 5], new Set([3, 4, 5]))).toEqual([])
  })

  it('reports every horizon gameweek with zero projection rows, in horizon order', () => {
    expect(findEmptyGameweeks([3, 4, 5, 6], new Set([3, 5]))).toEqual([4, 6])
  })
})

// ============================================================================
// buildProjectionsCsv — zero-fill, completeness, and the coverage counts
// that feed job_runs.details.
// ============================================================================

function player(overrides: Partial<CsvPlayerInput> = {}): CsvPlayerInput {
  return { id: 1, webName: 'Salah', teamShortName: 'LIV', elementType: 3, ...overrides }
}

describe('buildProjectionsCsv', () => {
  it('writes a fully-projected player with no zero-fill and correct row count', () => {
    const horizon = [3, 4]
    const projections = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 4.2, expectedMinutes: 90 }],
      [projectionKey(1, 4), { expectedPoints: 5.1, expectedMinutes: 85 }],
    ])
    const result = buildProjectionsCsv([player()], horizon, projections)

    expect(result.csv).toBe(
      'ID,Pos,Name,Team,3_Pts,3_xMins,4_Pts,4_xMins\n' + '1,M,Salah,LIV,4.2,90,5.1,85\n',
    )
    expect(result.rowsWritten).toBe(1)
    expect(result.playerGameweekPairsZeroFilled).toBe(0)
    expect(result.playersWithNoProjectionAtAll).toBe(0)
  })

  it('zero-fills a missing (player, gameweek) pair rather than leaving an empty cell or dropping the column', () => {
    const horizon = [3, 4]
    const projections = new Map<string, ProjectionValue>([[projectionKey(1, 3), { expectedPoints: 4.2, expectedMinutes: 90 }]])
    const result = buildProjectionsCsv([player()], horizon, projections)

    expect(result.csv).toBe('ID,Pos,Name,Team,3_Pts,3_xMins,4_Pts,4_xMins\n' + '1,M,Salah,LIV,4.2,90,0,0\n')
    expect(result.playerGameweekPairsZeroFilled).toBe(1)
    expect(result.playersWithNoProjectionAtAll).toBe(0) // partial coverage, not "no projection at all"
  })

  it('counts a player with zero projection rows across the whole horizon as playersWithNoProjectionAtAll, still zero-filled and still written', () => {
    const horizon = [3, 4]
    const result = buildProjectionsCsv([player({ id: 2, webName: 'Bench Player' })], horizon, new Map())

    expect(result.rowsWritten).toBe(1)
    expect(result.playersWithNoProjectionAtAll).toBe(1)
    expect(result.playerGameweekPairsZeroFilled).toBe(2)
    expect(result.csv).toContain('2,M,Bench Player,LIV,0,0,0,0')
  })

  it('passes expected_minutes through unmodified — a double-gameweek value over 90 is not clamped or divided by 90', () => {
    const horizon = [3]
    const projections = new Map<string, ProjectionValue>([[projectionKey(1, 3), { expectedPoints: 9.4, expectedMinutes: 180 }]])
    const result = buildProjectionsCsv([player()], horizon, projections)

    expect(result.csv).toContain('9.4,180')
  })

  it('reports a player below the low-expected-minutes threshold, summed across the whole horizon', () => {
    const horizon = [3, 4]
    const projections = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 1, expectedMinutes: 30 }],
      [projectionKey(1, 4), { expectedPoints: 1, expectedMinutes: 30 }],
    ])
    const result = buildProjectionsCsv([player()], horizon, projections, 100)
    expect(result.lowExpectedMinutesPlayerCount).toBe(1)
  })

  it('does not flag a player at or above the low-expected-minutes threshold', () => {
    const horizon = [3, 4]
    const projections = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 4, expectedMinutes: 60 }],
      [projectionKey(1, 4), { expectedPoints: 4, expectedMinutes: 40 }],
    ])
    const result = buildProjectionsCsv([player()], horizon, projections, 100)
    expect(result.lowExpectedMinutesPlayerCount).toBe(0)
  })

  it('writes every row with a trailing newline and no missing columns across multiple players', () => {
    const horizon = [3, 4, 5]
    const projections = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 4, expectedMinutes: 90 }],
      [projectionKey(2, 4), { expectedPoints: 2, expectedMinutes: 45 }],
    ])
    const result = buildProjectionsCsv([player({ id: 1 }), player({ id: 2, webName: 'Sub' })], horizon, projections)

    expect(result.csv.endsWith('\n')).toBe(true)
    expect(result.csv.endsWith('\n\n')).toBe(false)
    const lines = result.csv.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3) // header + 2 players
    for (const dataLine of lines.slice(1)) {
      expect(dataLine.split(',')).toHaveLength(4 + horizon.length * 2) // ID,Pos,Name,Team + 3 gw pairs
    }
  })
})

// ============================================================================
// model_version primary-key collision — proving the filter matters, at the
// level this ticket's pure functions can prove it: two rows for the same
// player/gameweek from different model_version reads would collide in the
// projectionByKey map passed in, because the map is keyed only on
// (playerId, gameweekId). The production code (scripts/emit-projections-csv.ts
// main()) prevents this upstream by filtering the Supabase query itself with
// .eq('model_version', MODEL_VERSION) before this map is ever built — see the
// file header's "model_version: filtered, not left open" section. This test
// documents the collision buildProjectionsCsv would otherwise be exposed to,
// so the reason for that upstream filter stays visible from the test file
// alone.
// ============================================================================

// ============================================================================
// mergeActiveAndFallbackProjections — ticket #260. DoD items 2 and 3.
// ============================================================================

describe('mergeActiveAndFallbackProjections', () => {
  it('DoD item 2: with active === fallback (same map), every pair comes from that one map and no fallback pair is used', () => {
    const horizon = [3, 4]
    const players = [player({ id: 1 }), player({ id: 2, webName: 'Sub' })]
    const baseline = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 4.2, expectedMinutes: 90 }],
      [projectionKey(1, 4), { expectedPoints: 5.1, expectedMinutes: 85 }],
      [projectionKey(2, 3), { expectedPoints: 1, expectedMinutes: 20 }],
      [projectionKey(2, 4), { expectedPoints: 2, expectedMinutes: 30 }],
    ])

    const merged = mergeActiveAndFallbackProjections(players, horizon, baseline, baseline)

    expect(merged.fallbackPairsUsed).toBe(0)
    expect(buildProjectionsCsv(players, horizon, merged.projectionByKey).csv).toBe(buildProjectionsCsv(players, horizon, baseline).csv)
  })

  it('DoD item 3: a gap in the active model for one (player, gameweek) pair comes from the fallback; every other pair comes from active', () => {
    const horizon = [3, 4]
    const players = [player({ id: 1 }), player({ id: 2, webName: 'Sub' })]
    const active = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 9, expectedMinutes: 90 }],
      // (1, 4) deliberately absent from active — this is the gap.
      [projectionKey(2, 3), { expectedPoints: 3, expectedMinutes: 60 }],
      [projectionKey(2, 4), { expectedPoints: 4, expectedMinutes: 70 }],
    ])
    const fallback = new Map<string, ProjectionValue>([
      [projectionKey(1, 3), { expectedPoints: 4.2, expectedMinutes: 90 }],
      [projectionKey(1, 4), { expectedPoints: 5.1, expectedMinutes: 85 }],
      [projectionKey(2, 3), { expectedPoints: 1, expectedMinutes: 20 }],
      [projectionKey(2, 4), { expectedPoints: 2, expectedMinutes: 30 }],
    ])

    const merged = mergeActiveAndFallbackProjections(players, horizon, active, fallback)

    expect(merged.fallbackPairsUsed).toBe(1)
    expect(merged.projectionByKey.get(projectionKey(1, 3))).toEqual({ expectedPoints: 9, expectedMinutes: 90 }) // from active
    expect(merged.projectionByKey.get(projectionKey(1, 4))).toEqual({ expectedPoints: 5.1, expectedMinutes: 85 }) // from fallback
    expect(merged.projectionByKey.get(projectionKey(2, 3))).toEqual({ expectedPoints: 3, expectedMinutes: 60 }) // from active
    expect(merged.projectionByKey.get(projectionKey(2, 4))).toEqual({ expectedPoints: 4, expectedMinutes: 70 }) // from active
  })

  it('leaves a pair unset (for buildProjectionsCsv to zero-fill) when neither active nor fallback has it', () => {
    const horizon = [3]
    const players = [player({ id: 1 })]
    const merged = mergeActiveAndFallbackProjections(players, horizon, new Map(), new Map())
    expect(merged.projectionByKey.size).toBe(0)
    expect(merged.fallbackPairsUsed).toBe(0)
    expect(buildProjectionsCsv(players, horizon, merged.projectionByKey).playerGameweekPairsZeroFilled).toBe(1)
  })
})

describe('projectionKey / model_version filtering rationale', () => {
  it('keys only on (playerId, gameweekId) — a second model_version row for the same pair would silently overwrite the first if the caller failed to filter by model_version before building this map', () => {
    const map = new Map<string, ProjectionValue>()
    map.set(projectionKey(1, 3), { expectedPoints: 4, expectedMinutes: 90 }) // 'baseline-v1'
    map.set(projectionKey(1, 3), { expectedPoints: 9, expectedMinutes: 90 }) // hypothetical second model_version, same key
    expect(map.size).toBe(1)
    expect(map.get(projectionKey(1, 3))?.expectedPoints).toBe(9) // proves the collision, not a feature to rely on
  })
})
