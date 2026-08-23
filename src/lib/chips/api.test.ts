/**
 * Tests for fetchChipSourceData's "most recently synced squads row" read —
 * ticket #85's own DoD names this case explicitly: "a gameweek's row does
 * not exist until that gameweek's sync has run. Named test for the no-row
 * case." Exercised against a fake Postgrest layer (same pattern
 * src/lib/verdict/api.test.ts already establishes), not just against
 * derive.ts fixtures, since the behaviour under test lives entirely in HOW
 * the `squads` query is scoped and ordered.
 *
 * NOTE: this file is not on ticket #85's own scope-constraint file list —
 * only derive.test.ts is named there. It exists because the DoD explicitly
 * requires a named test for this exact case, and that behaviour lives in
 * api.ts, not derive.ts, so no fixture-only test could cover it. Flagged to
 * the orchestrator as a scope deviation in the Builder's handoff.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

vi.mock('../supabase', () => ({ supabase: {} }))

// Imported after the mock so `supabase` resolves to the mocked module —
// same ordering note as src/lib/verdict/api.test.ts.
import { supabase } from '../supabase'
import { fetchChipSourceData } from './api.ts'

/**
 * A minimal fake Postgrest query builder — just enough of supabase-js's
 * chainable surface (`select`/`eq`/`order`/`limit`/`returns`, plus being
 * awaitable) for api.ts's two queries. `.eq()`/`.order()`/`.limit()` are all
 * applied HERE, inside the fake "server" layer — the same place a real
 * database applies them — so these tests prove the query itself is scoped
 * correctly, not that the result merely looks right after being pre-filtered
 * by the test.
 */
function fakeFrom(tables: Tables) {
  return (table: string) => {
    const rows = tables[table] ?? []
    const filters: Array<(row: Row) => boolean> = []
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

describe('fetchChipSourceData — the no-row case', () => {
  it('returns an empty chipsUsed array, not an error, when squads holds no api_sync row at all', async () => {
    setTables({
      gameweeks: [{ id: 1, deadline_time: '2026-08-14T17:30:00Z' }],
      squads: [],
    })

    const data = await fetchChipSourceData()
    expect(data.chipsUsed).toEqual([])
    expect(data.gameweeks).toEqual([{ id: 1, deadlineMs: new Date('2026-08-14T17:30:00Z').getTime() }])
  })
})

describe('fetchChipSourceData — most recently synced squads row', () => {
  it('reads the highest gameweek_id api_sync row, not the first one found or an arbitrary one', async () => {
    setTables({
      gameweeks: [],
      squads: [
        { gameweek_id: 3, source: 'api_sync', chips_used: [{ name: 'wildcard', event: 3, time: null }] },
        { gameweek_id: 7, source: 'api_sync', chips_used: [{ name: 'bboost', event: 7, time: null }] },
      ],
    })

    const data = await fetchChipSourceData()
    expect(data.chipsUsed).toEqual([{ name: 'bboost', event: 7, time: null }])
  })

  it('ignores a manual-entry row even at a higher gameweek_id than the latest api_sync row', async () => {
    setTables({
      gameweeks: [],
      squads: [
        { gameweek_id: 5, source: 'api_sync', chips_used: [{ name: 'wildcard', event: 5, time: null }] },
        { gameweek_id: 9, source: 'manual', chips_used: [] },
      ],
    })

    const data = await fetchChipSourceData()
    expect(data.chipsUsed).toEqual([{ name: 'wildcard', event: 5, time: null }])
  })

  it('drops a malformed chip entry rather than throwing, keeping the well-formed ones', async () => {
    setTables({
      gameweeks: [],
      squads: [
        {
          gameweek_id: 4,
          source: 'api_sync',
          chips_used: [{ name: 'wildcard', event: 4, time: null }, { event: 5 }, 'not-an-object'],
        },
      ],
    })

    const data = await fetchChipSourceData()
    expect(data.chipsUsed).toEqual([{ name: 'wildcard', event: 4, time: null }])
  })
})
