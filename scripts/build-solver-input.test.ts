// Unit tests for scripts/build-solver-input.ts's pure functions — ticket
// #41. No Supabase, no filesystem, no solver: every DoD item provable
// without a database is proven here (the config's team_data/preseason/
// xmin_lb/chip_limits, the horizon derived from a real CSV shape rather than
// hardcoded, and team.json's exact shape). What cannot be proven here — that
// the resulting files actually make dev/solver.py solve — is the workflow's
// job (.github/workflows/solver-run.yml), verified by an actual run; see
// decisions/ticket-41.md.

import { describe, expect, it } from 'vitest'
import { parse } from 'csv-parse/sync'
import {
  BuildInputError,
  HIT_COST,
  XMIN_LB,
  analyzeProjectionsCsv,
  buildSolverConfig,
  buildTeamJson,
  deriveDatasource,
  type TeamJsonPickInput,
} from './build-solver-input.js'

// ============================================================================
// deriveDatasource — the config's `datasource` value must match the CSV's
// own filename, by construction, not by two independently-typed strings.
// ============================================================================

describe('deriveDatasource', () => {
  it('strips the .csv extension from a plain filename', () => {
    expect(deriveDatasource('fpladvisor.csv')).toBe('fpladvisor')
  })

  it('strips the .csv extension from a path with directories', () => {
    expect(deriveDatasource('solver/data/fpladvisor.csv')).toBe('fpladvisor')
  })

  it('leaves a filename with no extension unchanged', () => {
    expect(deriveDatasource('solver/data/fpladvisor')).toBe('fpladvisor')
  })
})

// ============================================================================
// analyzeProjectionsCsv — horizon derived from the CSV's actual header, per
// the DoD's named test: "a config built from a three-gameweek CSV requests a
// horizon of 3, not 5 and not 8."
// ============================================================================

function csvRecords(text: string): Array<Record<string, string>> {
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
}

describe('analyzeProjectionsCsv', () => {
  it('derives a horizon of 3 from a three-gameweek CSV — not 5, not 8', () => {
    const records = csvRecords(
      'ID,Pos,Name,Team,1_Pts,1_xMins,2_Pts,2_xMins,3_Pts,3_xMins\n' + '1,G,Keeper,ARS,4.1,90,3.9,90,4.0,90\n',
    )
    const { horizonGwIds } = analyzeProjectionsCsv(records)
    expect(horizonGwIds).toEqual([1, 2, 3])
    expect(horizonGwIds.length).toBe(3)
    expect(horizonGwIds.length).not.toBe(5)
    expect(horizonGwIds.length).not.toBe(8)
  })

  it('derives a horizon of 5 from a five-gameweek CSV with a non-1 starting gameweek', () => {
    const header = 'ID,Pos,Name,Team,' + [7, 8, 9, 10, 11].flatMap((gw) => [`${gw}_Pts`, `${gw}_xMins`]).join(',')
    const row = '1,D,Defender,MCI,' + [7, 8, 9, 10, 11].flatMap(() => ['3.0', '90']).join(',')
    const { horizonGwIds } = analyzeProjectionsCsv(csvRecords(`${header}\n${row}\n`))
    expect(horizonGwIds).toEqual([7, 8, 9, 10, 11])
  })

  it('flags a gameweek as empty when every row zero-fills both its Pts and xMins columns', () => {
    const records = csvRecords(
      'ID,Pos,Name,Team,1_Pts,1_xMins,2_Pts,2_xMins\n' + '1,G,Keeper,ARS,4.1,90,0,0\n' + '2,D,Defender,ARS,2.0,90,0,0\n',
    )
    const { horizonGwIds, emptyGameweekIds } = analyzeProjectionsCsv(records)
    expect(horizonGwIds).toEqual([1, 2])
    expect(emptyGameweekIds).toEqual([2])
  })

  it('does not flag a gameweek as empty when at least one player has a non-zero projection', () => {
    const records = csvRecords(
      'ID,Pos,Name,Team,1_Pts,1_xMins\n' + '1,G,Keeper,ARS,0,0\n' + '2,D,Defender,ARS,3.2,90\n',
    )
    const { emptyGameweekIds } = analyzeProjectionsCsv(records)
    expect(emptyGameweekIds).toEqual([])
  })

  it('returns an empty horizon for a CSV with no {gw}_Pts columns at all', () => {
    const records = csvRecords('ID,Pos,Name,Team\n1,G,Keeper,ARS\n')
    expect(analyzeProjectionsCsv(records).horizonGwIds).toEqual([])
  })
})

// ============================================================================
// buildSolverConfig — the settings overrides the ticket is won or lost on.
// ============================================================================

describe('buildSolverConfig', () => {
  it('sets team_data to "json" — never the solver\'s other mode that would read FPL\'s authenticated squad endpoint', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.team_data).toBe('json')
  })

  it('sets preseason to false explicitly, overriding the solver\'s shipped user_settings.json default of true', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.preseason).toBe(false)
  })

  it('sets xmin_lb to 150, overriding the shipped 300', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.xmin_lb).toBe(150)
    expect(config.xmin_lb).toBe(XMIN_LB)
  })

  it('keeps every chip_limits value at 0', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.chip_limits).toEqual({ bb: 0, wc: 0, fh: 0, tc: 0 })
  })

  it('sets num_iterations to 3 — ticket #47, so the solve produces Plan A/B/C — and iteration_criteria explicitly rather than the shipped default', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.num_iterations).toBe(3)
    expect(config.iteration_criteria).toBe('this_gw_transfer_in_out')
  })

  it('sets the datasource to whatever the CSV-derived value is, matching the CSV\'s own filename', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.datasource).toBe('fpladvisor')
  })

  it('composes end to end: a three-gameweek CSV produces a config with horizon 3, not 5, not 8', () => {
    const records = csvRecords('ID,Pos,Name,Team,1_Pts,1_xMins,2_Pts,2_xMins,3_Pts,3_xMins\n1,G,Keeper,ARS,4,90,4,90,4,90\n')
    const { horizonGwIds } = analyzeProjectionsCsv(records)
    const config = buildSolverConfig({ horizon: horizonGwIds.length, datasource: 'fpladvisor' })
    expect(config.horizon).toBe(3)
    expect(config.horizon).not.toBe(5)
    expect(config.horizon).not.toBe(8)
  })

  it('throws rather than silently accepting a horizon above 5', () => {
    expect(() => buildSolverConfig({ horizon: 6, datasource: 'fpladvisor' })).toThrow(BuildInputError)
    expect(() => buildSolverConfig({ horizon: 8, datasource: 'fpladvisor' })).toThrow(/exceeds 5/)
  })

  it('throws on a non-positive horizon', () => {
    expect(() => buildSolverConfig({ horizon: 0, datasource: 'fpladvisor' })).toThrow(BuildInputError)
  })

  it('defaults secs to the module\'s own time-limit constant, shorter than the workflow job\'s own timeout', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.secs).toBe(300)
  })

  it('accepts an explicit secs override', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 120 })
    expect(config.secs).toBe(120)
  })
})

// ============================================================================
// buildTeamJson — data/team.json's exact shape, built from squads/
// squad_picks, never from FPL's authenticated squad endpoint.
// ============================================================================

function fifteenPicks(overrides: Partial<TeamJsonPickInput>[] = []): TeamJsonPickInput[] {
  const base: TeamJsonPickInput[] = Array.from({ length: 15 }, (_, i) => ({
    playerId: 100 + i,
    squadPosition: i + 1,
    isStarting: i < 11,
    isCaptain: i === 0,
    isViceCaptain: i === 1,
    nowCost: 50 + i,
    elementType: (i % 4) + 1,
  }))
  overrides.forEach((o, i) => Object.assign(base[i], o))
  return base
}

describe('buildTeamJson', () => {
  const squad = { bank: 5, squadValue: 1000, freeTransfers: 1 }

  it('produces exactly 15 picks, each with element, purchase_price, selling_price and element_type', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.picks).toHaveLength(15)
    for (const pick of team.picks) {
      expect(pick).toHaveProperty('element')
      expect(pick).toHaveProperty('purchase_price')
      expect(pick).toHaveProperty('selling_price')
      expect(pick).toHaveProperty('element_type')
    }
  })

  it('sets purchase_price and selling_price both to the player\'s current now_cost', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.picks[0].purchase_price).toBe(50)
    expect(team.picks[0].selling_price).toBe(50)
  })

  it('produces an empty chips array', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.chips).toEqual([])
  })

  it('carries bank, value, cost and limit on the transfers object', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.transfers.bank).toBe(5)
    expect(team.transfers.value).toBe(1000)
    expect(team.transfers.cost).toBe(HIT_COST)
    expect(team.transfers.limit).toBe(1)
  })

  it('sets transfers.made to 0 — required by dev/solver.py even though team.json.sample omits it from its minimal shape', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.transfers.made).toBe(0)
  })

  it('sets multiplier 2 for the captain, 1 for a starting non-captain, 0 for the bench', () => {
    const team = buildTeamJson(squad, fifteenPicks())
    expect(team.picks[0].multiplier).toBe(2) // captain
    expect(team.picks[2].multiplier).toBe(1) // starting, not captain
    expect(team.picks[14].multiplier).toBe(0) // bench
  })

  it('throws if given anything other than exactly 15 picks', () => {
    expect(() => buildTeamJson(squad, fifteenPicks().slice(0, 14))).toThrow(BuildInputError)
    expect(() => buildTeamJson(squad, fifteenPicks().slice(0, 14))).toThrow(/expected exactly 15/)
  })
})
