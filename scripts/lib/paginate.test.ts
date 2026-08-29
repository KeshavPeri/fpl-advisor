// Unit tests for scripts/lib/paginate.ts — ticket #43 (truncation guard) and
// ticket #152 (ordering guard). No network for the pagination-behaviour
// tests: fetchAllPages is exercised against an in-memory array sliced the
// same way a real `.range(from, to)` request would be, which is enough to
// prove the looping and termination logic. What this file cannot prove —
// that PostgREST actually caps an unbounded `.select()` at 1,000 rows — is
// server-side behaviour of the real Supabase project and can only be
// confirmed by a live run (see the ticket's Notes section).
//
// The ordering-guard tests in the second `describe` block below DO exercise
// the real, installed `@supabase/postgrest-js` client (via
// `@supabase/supabase-js`'s `createClient`) rather than a hand-written
// mock — ticket #152 requires proving the guard against the actual library
// shape, not an approximation of it. Network is still avoided by injecting
// a stub `fetch` through the client's `global.fetch` option; the
// no-`.order()` case additionally asserts that stub was never called, which
// is what proves the guard runs before the first page is awaited.

import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  assertRowCountMatches,
  DEFAULT_PAGE_SIZE,
  fetchAllPages,
  RowCountMismatchError,
  UnorderedPaginationError,
  type PageResponse,
} from './paginate.js'

/**
 * A `PromiseLike<PageResponse<T>>` that also carries the `url` property a
 * real (ordered) PostgREST query builder exposes, so the pagination-behaviour
 * tests below satisfy `fetchAllPages`'s ordering guard without depending on
 * the real network client. This is deliberately NOT used by the guard tests
 * themselves (see the second `describe` block), which exercise the real
 * installed client instead.
 */
class FakeOrderedPage<T> implements PromiseLike<PageResponse<T>> {
  readonly url: URL
  private readonly response: PageResponse<T>

  constructor(response: PageResponse<T>) {
    this.response = response
    this.url = new URL('https://example.supabase.co/rest/v1/test_table')
    this.url.searchParams.set('order', 'id.asc')
  }

  then<TResult1 = PageResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: PageResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected)
  }
}

/** Builds a fetchPage function backed by an in-memory array, shaped like an ordered `.range(from, to)` Supabase call. */
function pagedSource<T>(source: readonly T[]): (from: number, to: number) => FakeOrderedPage<T> {
  return (from, to) => new FakeOrderedPage({ data: source.slice(from, to + 1), error: null })
}

describe('fetchAllPages', () => {
  it('fetches every row of a 2,500-row source across multiple pages', async () => {
    const source = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
    let callCount = 0
    const fetchPage = (from: number, to: number) => {
      callCount++
      return new FakeOrderedPage<{ id: number }>({ data: source.slice(from, to + 1), error: null })
    }

    const result = await fetchAllPages<{ id: number }>(fetchPage)

    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(2500)
    expect(result.rows[0]).toEqual({ id: 0 })
    expect(result.rows[2499]).toEqual({ id: 2499 })
    // 1000 + 1000 + 500 -- the third page is already short, so no further
    // confirmatory request is needed.
    expect(callCount).toBe(3)
    expect(result.pages).toBe(3)
  })

  it('terminates on an exactly-page-sized final page rather than looping forever', async () => {
    const pageSize = 10
    // Exactly two full pages, no partial final page -- the case a naive
    // "stop when the page is full" implementation gets wrong.
    const source = Array.from({ length: 20 }, (_, i) => ({ id: i }))
    let callCount = 0
    const fetchPage = (from: number, to: number) => {
      callCount++
      return new FakeOrderedPage<{ id: number }>({ data: source.slice(from, to + 1), error: null })
    }

    const result = await fetchAllPages<{ id: number }>(fetchPage, pageSize)

    expect(result.rows).toHaveLength(20)
    // Proves it did not mistake the second, exactly-page-sized page for the
    // end: it must issue a third request, receive an empty page, and only
    // then stop. A version that stopped as soon as a page came back full
    // would show callCount === 2 here and would also be the version that
    // loops forever on a source whose true length is an exact multiple of
    // pageSize but that keeps growing between requests.
    expect(callCount).toBe(3)
    expect(result.pages).toBe(3)
  })

  it('returns an empty result for an empty source without looping', async () => {
    const result = await fetchAllPages<{ id: number }>(pagedSource<{ id: number }>([]))
    expect(result.rows).toEqual([])
    expect(result.pages).toBe(1)
    expect(result.error).toBeNull()
  })

  it('uses DEFAULT_PAGE_SIZE (1000) when no page size is given, matching this project\'s db-max-rows ceiling', async () => {
    const source = Array.from({ length: DEFAULT_PAGE_SIZE }, (_, i) => ({ id: i }))
    let callCount = 0
    const fetchPage = (from: number, to: number) => {
      callCount++
      expect(to - from + 1).toBe(DEFAULT_PAGE_SIZE)
      return new FakeOrderedPage<{ id: number }>({ data: source.slice(from, to + 1), error: null })
    }
    const result = await fetchAllPages<{ id: number }>(fetchPage)
    expect(result.rows).toHaveLength(DEFAULT_PAGE_SIZE)
    // A page exactly the default size still triggers the confirmatory
    // empty-page request.
    expect(callCount).toBe(2)
  })

  it('stops immediately and surfaces a page-level error without accumulating further pages', async () => {
    let callCount = 0
    const fetchPage = (_from: number, _to: number) => {
      callCount++
      return new FakeOrderedPage<{ id: number }>({
        data: null,
        error: { code: 'PGRST205', message: 'relation "widgets" does not exist' },
      })
    }

    const result = await fetchAllPages<{ id: number }>(fetchPage, 10)

    expect(result.error).toEqual({ code: 'PGRST205', message: 'relation "widgets" does not exist' })
    expect(result.rows).toEqual([])
    expect(callCount).toBe(1)
  })
})

describe('fetchAllPages ordering guard (ticket #152)', () => {
  /** A stub `fetch` for supabase-js's `global.fetch` option, so these tests exercise the real postgrest-js query builder without any network I/O. */
  function stubFetch(rows: unknown[]) {
    return vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } }))
  }

  function makeClient(fetchImpl: ReturnType<typeof stubFetch>) {
    return createClient('https://example.supabase.co', 'fake-publishable-key', {
      global: { fetch: fetchImpl as unknown as typeof fetch },
    })
  }

  it('passes an ordered query built via the real installed @supabase/postgrest-js client', async () => {
    const fetchImpl = stubFetch([{ id: 1 }])
    const supabase = makeClient(fetchImpl)

    const result = await fetchAllPages<{ id: number }>(
      (from, to) => supabase.from('players').select('id').order('id').range(from, to),
      10,
    )

    expect(result.error).toBeNull()
    expect(result.rows).toEqual([{ id: 1 }])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws UnorderedPaginationError for a real postgrest-js query with no .order(), before any page is fetched', async () => {
    const fetchImpl = stubFetch([{ id: 1 }])
    const supabase = makeClient(fetchImpl)

    await expect(
      fetchAllPages<{ id: number }>((from, to) => supabase.from('players').select('id').range(from, to), 10),
    ).rejects.toThrow(UnorderedPaginationError)
    // The guard ran before the first page was awaited -- no HTTP call was made at all.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not accept a referenced-table ordering as ordering this table\'s own rows', async () => {
    const fetchImpl = stubFetch([{ id: 1, teams: { name: 'A' } }])
    const supabase = makeClient(fetchImpl)

    await expect(
      fetchAllPages<{ id: number }>(
        (from, to) =>
          supabase
            .from('players')
            .select('id, teams(name)')
            .order('name', { referencedTable: 'teams' })
            .range(from, to),
        10,
      ),
    ).rejects.toThrow(UnorderedPaginationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed and throws when the page thunk returns an object of unrecognisable shape, rather than passing it through', async () => {
    const fetchPage = () => ({ data: [], error: null }) as unknown as PromiseLike<PageResponse<{ id: number }>>

    await expect(fetchAllPages<{ id: number }>(fetchPage, 10)).rejects.toThrow(UnorderedPaginationError)
  })
})

describe('assertRowCountMatches', () => {
  it('does not throw when the fetched count equals the independent count', () => {
    expect(() => assertRowCountMatches('players', 587, 587)).not.toThrow()
  })

  it('throws RowCountMismatchError naming both numbers when they disagree -- the guard the original bug needed', () => {
    expect(() => assertRowCountMatches('player_projections', 1000, 2935)).toThrow(RowCountMismatchError)
    expect(() => assertRowCountMatches('player_projections', 1000, 2935)).toThrow(/1000/)
    expect(() => assertRowCountMatches('player_projections', 1000, 2935)).toThrow(/2935/)
    expect(() => assertRowCountMatches('player_projections', 1000, 2935)).toThrow(/player_projections/)
  })
})
