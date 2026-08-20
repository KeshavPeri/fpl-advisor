/**
 * Tests for fetchVerdict's solver-run filtering (ticket #72). The bug this
 * ticket fixes lives entirely in HOW the `solver_picks` query is scoped —
 * `derive.ts`'s arithmetic was never wrong, it was just handed too many
 * rows — so these tests exercise `fetchVerdict` itself against a fake
 * Postgrest layer, rather than only exercising `deriveVerdictView` against
 * already-correct fixtures the way derive.test.ts does. A fixture that is
 * pre-filtered to one run would never have caught this bug; the fake
 * builder below applies `.eq()` filtering the same way a real
 * `WHERE run_id = $1` would, so a query that forgets the filter really
 * does get every run's rows back, exactly as the live bug did.
 */
import { describe, expect, it, vi } from 'vitest'
import { deriveVerdictView } from './derive.ts'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

vi.mock('../supabase', () => ({ supabase: {} }))

// Imported after the mock so `supabase` resolves to the mocked module.
import { supabase } from '../supabase'
import { fetchVerdict } from './api.ts'

/**
 * A minimal fake Postgrest query builder — just enough of supabase-js's
 * chainable surface (`select`/`eq`/`in`/`order`/`limit`/`returns`, plus
 * being awaitable) for api.ts's queries. `.eq()` filtering is applied HERE,
 * inside the fake "server" layer, the same place a real database applies
 * it — this is what makes these tests prove the filter runs in the query,
 * not in memory: a fixture holding a second run's rows only stays out of
 * the result because the fake builder itself refuses to return them.
 */
function fakeFrom(tables: Tables) {
  return (table: string) => {
    const rows = tables[table] ?? []
    const filters: Array<(row: Row) => boolean> = []
    let inFilter: { col: string; vals: readonly unknown[] } | null = null
    let orderCol: string | null = null
    let orderAscending = true
    let limitCount: number | null = null

    const builder = {
      select() {
        return builder
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val)
        return builder
      },
      in(col: string, vals: readonly unknown[]) {
        inFilter = { col, vals }
        return builder
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col
        orderAscending = opts?.ascending ?? true
        return builder
      },
      limit(n: number) {
        limitCount = n
        return builder
      },
      returns() {
        return builder
      },
      then(resolve: (result: { data: Row[]; error: null }) => void) {
        let result = rows.filter((row) => filters.every((f) => f(row)))
        if (inFilter) {
          const { col, vals } = inFilter
          result = result.filter((row) => vals.includes(row[col]))
        }
        if (orderCol !== null) {
          const col = orderCol
          result = [...result].sort((a, b) => {
            const av = a[col] as number | string
            const bv = b[col] as number | string
            if (av === bv) return 0
            const cmp = av < bv ? -1 : 1
            return orderAscending ? cmp : -cmp
          })
        }
        if (limitCount !== null) result = result.slice(0, limitCount)
        resolve({ data: result, error: null })
      },
    }
    return builder
  }
}

function setTables(tables: Tables) {
  ;(supabase as unknown as { from: (table: string) => unknown }).from = fakeFrom(tables)
}

/** A recommendations row with every field api.ts's query selects, sane
 *  defaults, overridable per test. plan_index matters: the query filters
 *  on it, same as the live one does. */
function recommendationRow(overrides: Partial<Row> = {}): Row {
  return {
    plan_index: 0,
    gameweek_id: 10,
    is_roll: false,
    transfer_in_player_id: null,
    transfer_out_player_id: null,
    captain_player_id: 1,
    vice_captain_player_id: 2,
    hit_cost: 0,
    gross_points_rounded: 50,
    net_points_rounded: 50,
    confidence_band: 'clear',
    coverage: [],
    gameweeks: { name: 'Gameweek 10' },
    solution_index: 0,
    solver_run_id: null,
    ...overrides,
  }
}

/** Eleven `solver_picks` rows for one run — one flagged captain, the rest
 *  identical — for the given gameweek/solution/run. */
function elevenPicksForRun(
  runId: number,
  gameweekId: number,
  solutionIndex: number,
  othersExpectedPoints: number,
  captainExpectedPoints: number
): Row[] {
  return [
    {
      gameweek_id: gameweekId,
      solution_index: solutionIndex,
      run_id: runId,
      is_lineup: true,
      is_captain: true,
      expected_points: captainExpectedPoints,
    },
    ...Array.from({ length: 10 }, () => ({
      gameweek_id: gameweekId,
      solution_index: solutionIndex,
      run_id: runId,
      is_lineup: true,
      is_captain: false,
      expected_points: othersExpectedPoints,
    })),
  ]
}

/** Every table fetchVerdict touches, empty/default except what a test overrides. */
function tables(overrides: Partial<Tables> = {}): Tables {
  return {
    recommendations: [recommendationRow()],
    recommendation_reasons: [],
    players: [],
    solver_runs: [],
    solver_picks: [],
    ...overrides,
  }
}

describe('fetchVerdict solver-run filtering (ticket #72)', () => {
  it("filters two solver runs' worth of picks down to the recommendation's own run — same figure as a fixture holding only that run", async () => {
    const runAPicks = elevenPicksForRun(100, 10, 0, 4, 6) // an unrelated earlier run
    const runBPicks = elevenPicksForRun(200, 10, 0, 4, 5) // the recommendation's own run

    setTables(
      tables({
        recommendations: [recommendationRow({ solver_run_id: 200 })],
        solver_picks: [...runBPicks],
      })
    )
    const singleRunData = await fetchVerdict()

    setTables(
      tables({
        recommendations: [recommendationRow({ solver_run_id: 200 })],
        solver_picks: [...runAPicks, ...runBPicks],
      })
    )
    const twoRunData = await fetchVerdict()

    expect(twoRunData?.gameweekPicks).toHaveLength(11)
    expect(deriveVerdictView(twoRunData!, 10).gameweekPoints).toBe(
      deriveVerdictView(singleRunData!, 10).gameweekPoints
    )
  })

  it('reproduces the live 20 Aug 2026 composition — 22 lineup rows across two runs raw-summing to 90.2 — and derives the single run\'s total, not the combined ~100', async () => {
    // Each run: ten players at 4.0 + one captain at 5.1 -> raw 45.1 per run,
    // 90.2 combined, matching the ticket's evidence exactly. Captain
    // doubling makes one run's true figure 50 (40 + 5.1*2 = 50.2 -> 50); the
    // pre-fix bug summed both runs AND doubled both captains, landing near
    // 100 (90.2 + 5.1*2 = 100.4 -> 100) — this test asserts the fixed value,
    // not the buggy one.
    const runA = elevenPicksForRun(444, 10, 0, 4.0, 5.1)
    const runB = elevenPicksForRun(555, 10, 0, 4.0, 5.1)

    setTables(
      tables({
        recommendations: [recommendationRow({ solver_run_id: 555 })],
        solver_picks: [...runA, ...runB],
      })
    )

    const data = await fetchVerdict()
    expect(data?.gameweekPicks).toHaveLength(11)

    const view = deriveVerdictView(data!, 10)
    expect(view.gameweekPoints).toBe(50)
    expect(view.gameweekPoints).not.toBe(100)
  })

  it('falls back to the most recently created solver_runs row for the gameweek when solver_run_id is null, rather than summing every run', async () => {
    const olderRunPicks = elevenPicksForRun(1, 10, 0, 100, 100) // obviously-wrong figures if picked
    const newerRunPicks = elevenPicksForRun(2, 10, 0, 4, 5) // the correct, most recent run

    setTables(
      tables({
        recommendations: [recommendationRow({ solver_run_id: null })],
        solver_runs: [
          { id: 1, gameweek_id: 10, created_at: '2026-08-19T09:00:00Z' },
          { id: 2, gameweek_id: 10, created_at: '2026-08-20T09:00:00Z' },
        ],
        solver_picks: [...olderRunPicks, ...newerRunPicks],
      })
    )

    const data = await fetchVerdict()
    expect(data?.gameweekPicks).toHaveLength(11)
    expect(deriveVerdictView(data!, 10).gameweekPoints).toBe(50)
  })

  it('uses the recommendation\'s own solver_run_id, not the gameweek\'s most recent run, when solver_run_id is set', async () => {
    // A later ad-hoc solve for the same gameweek exists (run 20), but this
    // recommendation was built from the earlier run (10) — its own pointer
    // must win, exactly as it would for a stale recommendation whose run is
    // no longer the newest one for its gameweek.
    const ownRunPicks = elevenPicksForRun(10, 8, 0, 4, 5) // -> 50
    const laterUnrelatedRunPicks = elevenPicksForRun(20, 8, 0, 10, 11) // -> 122

    setTables(
      tables({
        recommendations: [recommendationRow({ gameweek_id: 8, solver_run_id: 10 })],
        solver_runs: [
          { id: 10, gameweek_id: 8, created_at: '2026-08-15T09:00:00Z' },
          { id: 20, gameweek_id: 8, created_at: '2026-08-20T09:00:00Z' },
        ],
        solver_picks: [...ownRunPicks, ...laterUnrelatedRunPicks],
      })
    )

    const data = await fetchVerdict()
    expect(data?.gameweekPicks).toHaveLength(11)
    expect(deriveVerdictView(data!, 8).gameweekPoints).toBe(50)
  })

  it('does not blank the card when solver_picks holds no rows at all for the identified run', async () => {
    setTables(
      tables({
        recommendations: [
          recommendationRow({
            solver_run_id: 999,
            transfer_in_player_id: null,
            transfer_out_player_id: null,
          }),
        ],
        recommendation_reasons: [{ gameweek_id: 10, plan_index: 0, order_index: 0, reason: 'Roll your transfer.' }],
        solver_picks: [],
      })
    )

    const data = await fetchVerdict()
    expect(data).not.toBeNull()
    expect(data?.gameweekPicks).toBeNull()
    expect(data?.reasons).toEqual(['Roll your transfer.'])
  })

  it('does not blank the card when no solver_runs row can be resolved for a null solver_run_id', async () => {
    setTables(
      tables({
        recommendations: [recommendationRow({ solver_run_id: null })],
        solver_runs: [],
        solver_picks: [],
      })
    )

    const data = await fetchVerdict()
    expect(data).not.toBeNull()
    expect(data?.gameweekPicks).toBeNull()
  })
})
