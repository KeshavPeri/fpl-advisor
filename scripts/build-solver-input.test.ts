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
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BuildInputError,
  DECAY_BASE,
  EV_PER_PRICE_CUTOFF,
  HIT_COST,
  ITERATION_CRITERION,
  KEEP_TOP_EV_PERCENT,
  NO_TRANSFER_LAST_GWS,
  XMIN_LB,
  analyzeProjectionsCsv,
  buildRebuildSolverConfig,
  buildSolverConfig,
  buildTeamJson,
  buildWideningJobRunDetails,
  deriveDatasource,
  failNoSquad,
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

  // --------------------------------------------------------------------
  // Ticket #95 — widening keep_top_ev_percent (shipped default 5) and
  // ev_per_price_cutoff (shipped default 30), explicitly, for the first
  // time. See KEEP_TOP_EV_PERCENT's and EV_PER_PRICE_CUTOFF's own comments
  // in build-solver-input.ts for the percentile semantics and rationale.
  // --------------------------------------------------------------------

  it('sets keep_top_ev_percent to 25 and ev_per_price_cutoff to 10 — widened from the shipped 5 and 30', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.keep_top_ev_percent).toBe(25)
    expect(config.ev_per_price_cutoff).toBe(10)
    expect(config.keep_top_ev_percent).toBe(KEEP_TOP_EV_PERCENT)
    expect(config.ev_per_price_cutoff).toBe(EV_PER_PRICE_CUTOFF)
  })

  it('full-object equality: the built config matches the known-good baseline exactly (horizon/xmin_lb/decay_base/chip_limits/etc.), so an accidental edit to any other setting fails this test', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300 })
    expect(config).toEqual({
      horizon: 3,
      team_data: 'json',
      preseason: false,
      xmin_lb: 150,
      keep_top_ev_percent: 25,
      ev_per_price_cutoff: 10,
      no_transfer_last_gws: 0,
      decay_base: 0.9,
      datasource: 'fpladvisor',
      chip_limits: { bb: 0, wc: 0, fh: 0, tc: 0 },
      secs: 300,
      solver: 'highs',
      num_iterations: 3,
      iteration_criteria: 'this_gw_transfer_in',
      verbose: true,
      print_result_table: true,
      print_squads: true,
      print_transfer_chip_summary: true,
    })
  })

  // --------------------------------------------------------------------
  // Ticket #108 — stop inheriting no_transfer_last_gws (shipped default 2)
  // from the solver. See NO_TRANSFER_LAST_GWS's own comment in
  // build-solver-input.ts for the full because.
  // --------------------------------------------------------------------

  it('sets no_transfer_last_gws to 0, overriding the shipped default of 2', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.no_transfer_last_gws).toBe(0)
    expect(config.no_transfer_last_gws).toBe(NO_TRANSFER_LAST_GWS)
  })

  // --------------------------------------------------------------------
  // Ticket #120 — stop inheriting decay_base (shipped default 0.9, unchanged
  // here) from the solver. See DECAY_BASE's own comment in
  // build-solver-input.ts for the discount mechanics and the because.
  // --------------------------------------------------------------------

  it('sets decay_base to 0.9, matching the shipped default but no longer inheriting it silently', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.decay_base).toBe(0.9)
    expect(config.decay_base).toBe(DECAY_BASE)
  })

  it('sets num_iterations to 3 — ticket #47, so the solve produces Plan A/B/C — and iteration_criteria explicitly rather than the shipped default', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.num_iterations).toBe(3)
    expect(config.iteration_criteria).toBe(ITERATION_CRITERION)
  })

  it('sets iteration_criteria to "this_gw_transfer_in", NOT the shipped "this_gw_transfer_in_out" — ticket #60: the _in_out criterion let the optimiser vary only the (nearly-free) outgoing bench player, producing three plans with the same incoming player, same captain and identical scores', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' })
    expect(config.iteration_criteria).toBe('this_gw_transfer_in')
    expect(config.iteration_criteria).not.toBe('this_gw_transfer_in_out')
    expect(ITERATION_CRITERION).toBe('this_gw_transfer_in')
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

  // --------------------------------------------------------------------
  // Ticket #114 — the dispatch-only chip probe's `chipProbe` param. The
  // production path (`chipProbe` unset) must be byte-for-byte identical to
  // the pre-#114 output; only an explicit `chipProbe: true` changes
  // anything, and it changes ONLY chip_limits.
  // --------------------------------------------------------------------

  it('CHIP_PROBE unset: chipProbe omitted produces the exact pre-#114 config, full-object-equality', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300 })
    expect(config).toEqual({
      horizon: 3,
      team_data: 'json',
      preseason: false,
      xmin_lb: 150,
      keep_top_ev_percent: 25,
      ev_per_price_cutoff: 10,
      no_transfer_last_gws: 0,
      decay_base: 0.9,
      datasource: 'fpladvisor',
      chip_limits: { bb: 0, wc: 0, fh: 0, tc: 0 },
      secs: 300,
      solver: 'highs',
      num_iterations: 3,
      iteration_criteria: 'this_gw_transfer_in',
      verbose: true,
      print_result_table: true,
      print_squads: true,
      print_transfer_chip_summary: true,
    })
  })

  it('CHIP_PROBE unset: chipProbe explicitly false produces the identical config too', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300, chipProbe: false })
    expect(config.chip_limits).toEqual({ bb: 0, wc: 0, fh: 0, tc: 0 })
  })

  it('CHIP_PROBE set: chip_limits becomes { bb: 1, wc: 0, fh: 0, tc: 1 } and every other key is unchanged from the unset case, full-object-equality', () => {
    const config = buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300, chipProbe: true })
    expect(config).toEqual({
      horizon: 3,
      team_data: 'json',
      preseason: false,
      xmin_lb: 150,
      keep_top_ev_percent: 25,
      ev_per_price_cutoff: 10,
      no_transfer_last_gws: 0,
      decay_base: 0.9,
      datasource: 'fpladvisor',
      chip_limits: { bb: 1, wc: 0, fh: 0, tc: 1 },
      secs: 300,
      solver: 'highs',
      num_iterations: 3,
      iteration_criteria: 'this_gw_transfer_in',
      verbose: true,
      print_result_table: true,
      print_squads: true,
      print_transfer_chip_summary: true,
    })
  })

  it('preseason is false in BOTH the CHIP_PROBE-unset and CHIP_PROBE-set cases — must never regress to the shipped true, which wipes the squad', () => {
    expect(buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' }).preseason).toBe(false)
    expect(buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', chipProbe: true }).preseason).toBe(false)
  })

  // --------------------------------------------------------------------
  // Ticket #134 — the production config can never carry preseason: true.
  // This is the ticket's own DoD item: "A named test asserts that no code
  // path can produce preseason: true together with a config destined for
  // the production solve. Whatever form that takes... it must be provable
  // from the tests, not from reading carefully."
  //
  // Two proofs, deliberately not one: a runtime proof (every parameter
  // shape buildSolverConfig actually accepts still returns preseason:
  // false) and a compile-time proof (buildSolverConfig's own parameter
  // type has no field that could route a call to a rebuild variant at
  // all — see the @ts-expect-error test below, checked by `tsc -b`, i.e.
  // `npm run build`, not just by vitest).
  // --------------------------------------------------------------------

  it('buildSolverConfig returns preseason: false for every parameter shape it accepts — the production path never wobbles', () => {
    expect(buildSolverConfig({ horizon: 3, datasource: 'fpladvisor' }).preseason).toBe(false)
    expect(buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', chipProbe: true }).preseason).toBe(false)
    expect(buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', chipProbe: false }).preseason).toBe(false)
    expect(buildSolverConfig({ horizon: 5, datasource: 'x', secs: 60, chipProbe: true }).preseason).toBe(false)
  })

  it(
    "buildSolverConfig's own parameter type has no `variant` field — passing one is a TypeScript compile error, " +
      "not a runtime possibility that could be missed by a test fixture that forgets to try it",
    () => {
      // @ts-expect-error — buildSolverConfig's params type is exactly
      // `{ horizon; datasource; secs?; chipProbe? }`. There is no `variant`
      // field to set. If this line ever stops being a type error — e.g.
      // because a future edit widens buildSolverConfig's own signature to
      // accept a rebuild variant, reopening the exact path ticket #134
      // closes — this @ts-expect-error directive itself becomes an "unused
      // @ts-expect-error" error, so `tsc -b` (npm run build) fails either
      // way the drift could happen. This is a type-level assertion, not a
      // runtime one — it proves nothing to vitest at run time, and needs
      // none of the network/filesystem infrastructure the rest of this
      // file avoids.
      buildSolverConfig({ horizon: 3, datasource: 'fpladvisor', variant: 'wc' })
    },
  )
})

// ============================================================================
// buildRebuildSolverConfig — ticket #134 (feature-list item 28). The ONLY
// function in this file that can return preseason: true, and the ONLY place
// chip_limits.wc or chip_limits.fh can become 1.
// ============================================================================

describe('buildRebuildSolverConfig', () => {
  it('wc variant: full-object equality — preseason true, chip_limits { bb:0, wc:1, fh:0, tc:0 }, every other key matches buildSolverConfig\'s own output for the same params', () => {
    const config = buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300, variant: 'wc' })
    expect(config).toEqual({
      horizon: 3,
      team_data: 'json',
      preseason: true,
      xmin_lb: 150,
      keep_top_ev_percent: 25,
      ev_per_price_cutoff: 10,
      no_transfer_last_gws: 0,
      decay_base: 0.9,
      datasource: 'fpladvisor',
      chip_limits: { bb: 0, wc: 1, fh: 0, tc: 0 },
      secs: 300,
      solver: 'highs',
      num_iterations: 3,
      iteration_criteria: 'this_gw_transfer_in',
      verbose: true,
      print_result_table: true,
      print_squads: true,
      print_transfer_chip_summary: true,
    })
  })

  it('fh variant: full-object equality — preseason true, chip_limits { bb:0, wc:0, fh:1, tc:0 }, every other key matches buildSolverConfig\'s own output for the same params', () => {
    const config = buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', secs: 300, variant: 'fh' })
    expect(config).toEqual({
      horizon: 3,
      team_data: 'json',
      preseason: true,
      xmin_lb: 150,
      keep_top_ev_percent: 25,
      ev_per_price_cutoff: 10,
      no_transfer_last_gws: 0,
      decay_base: 0.9,
      datasource: 'fpladvisor',
      chip_limits: { bb: 0, wc: 0, fh: 1, tc: 0 },
      secs: 300,
      solver: 'highs',
      num_iterations: 3,
      iteration_criteria: 'this_gw_transfer_in',
      verbose: true,
      print_result_table: true,
      print_squads: true,
      print_transfer_chip_summary: true,
    })
  })

  it('never sets both wc and fh — each variant produces exactly one of them at 1, the other pinned to 0', () => {
    const wc = buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', variant: 'wc' })
    const fh = buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', variant: 'fh' })
    expect(wc.chip_limits.wc).toBe(1)
    expect(wc.chip_limits.fh).toBe(0)
    expect(fh.chip_limits.wc).toBe(0)
    expect(fh.chip_limits.fh).toBe(1)
  })

  it('every non-chip_limits, non-preseason key is IDENTICAL between the two variants — they differ only in which chip is on', () => {
    const wc = buildRebuildSolverConfig({ horizon: 4, datasource: 'x', secs: 120, variant: 'wc' })
    const fh = buildRebuildSolverConfig({ horizon: 4, datasource: 'x', secs: 120, variant: 'fh' })
    const { chip_limits: wcLimits, ...wcRest } = wc
    const { chip_limits: fhLimits, ...fhRest } = fh
    expect(wcRest).toEqual(fhRest)
    expect(wcLimits).not.toEqual(fhLimits)
  })

  it('reuses buildSolverConfig\'s own horizon validation — throws above 5, same as the production path', () => {
    expect(() => buildRebuildSolverConfig({ horizon: 6, datasource: 'fpladvisor', variant: 'wc' })).toThrow(BuildInputError)
    expect(() => buildRebuildSolverConfig({ horizon: 6, datasource: 'fpladvisor', variant: 'wc' })).toThrow(/exceeds 5/)
  })

  it('preseason: true is reachable ONLY through this function — buildSolverConfig itself never returns it (see the describe block above)', () => {
    expect(buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', variant: 'wc' }).preseason).toBe(true)
    expect(buildRebuildSolverConfig({ horizon: 3, datasource: 'fpladvisor', variant: 'fh' }).preseason).toBe(true)
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

// ============================================================================
// buildWideningJobRunDetails — ticket #95's "counters proving the widening
// happened", written into build-solver-input's job_runs details. Deliberately
// does NOT include a post-filter pool size — that number only exists in
// dev/solver.py's own stdout, not visible to this job.
// ============================================================================

describe('buildWideningJobRunDetails', () => {
  it('carries the projections-CSV player count and both configured widening values', () => {
    const details = buildWideningJobRunDetails(487)
    expect(details).toEqual({
      projectionsPlayerCount: 487,
      keepTopEvPercent: 25,
      evPerPriceCutoff: 10,
    })
  })

  it('always reflects the current KEEP_TOP_EV_PERCENT / EV_PER_PRICE_CUTOFF constants, not a copied value', () => {
    const details = buildWideningJobRunDetails(1)
    expect(details.keepTopEvPercent).toBe(KEEP_TOP_EV_PERCENT)
    expect(details.evPerPriceCutoff).toBe(EV_PER_PRICE_CUTOFF)
  })
})

// ============================================================================
// failNoSquad — ticket #83. No Supabase involved: the function only touches
// $GITHUB_OUTPUT and throws, so both effects are provable here the same way
// the rest of this file proves things — no mocking required.
// ============================================================================

describe('failNoSquad', () => {
  it('rejects with a BuildInputError whose message names the gameweek id and says no squad is stored', async () => {
    await expect(failNoSquad(7)).rejects.toBeInstanceOf(BuildInputError)
    await expect(failNoSquad(7)).rejects.toThrow(/no squad is stored/)
    await expect(failNoSquad(7)).rejects.toThrow(/gameweek 7/)
  })

  it('writes squad_found=false to $GITHUB_OUTPUT before throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-solver-input-test-'))
    const outputPath = join(dir, 'github_output')
    const previousGithubOutput = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = outputPath
    try {
      await expect(failNoSquad(9)).rejects.toBeInstanceOf(BuildInputError)
      const written = await readFile(outputPath, 'utf8')
      expect(written).toBe('squad_found=false\n')
    } finally {
      if (previousGithubOutput === undefined) delete process.env.GITHUB_OUTPUT
      else process.env.GITHUB_OUTPUT = previousGithubOutput
      await rm(dir, { recursive: true, force: true })
    }
  })
})
