// Shared PostgREST pagination helper — ticket #43.
//
// THE BUG THIS FILE EXISTS TO PREVENT. A Supabase `.select()` with no
// explicit `.range()` is silently capped by PostgREST's server-side
// `db-max-rows` setting (1000 on this project). There is no error, no
// warning, and no partial-result marker in the response — a truncated read
// looks, at the call site, exactly like a table that legitimately has fewer
// rows. That blindness is what shipped: scripts/emit-projections-csv.ts read
// player_projections unbounded, got exactly 1,000 of the 2,935 rows
// project-points.ts had written, and zero-filled the other 1,935 as if the
// projections didn't exist. `db-max-rows` is a server-side project setting,
// not something this repo controls — the only durable fix is a client that
// pages until it has proven the source is exhausted, then checks its own
// work. That is what this module does, and nothing else.
//
// USAGE. Callers own the query — filters, ordering, column selection — and
// pass a function that runs one page of it with an explicit `.range(from,
// to)`. This module owns only the looping: it keeps requesting pages until
// one comes back shorter than the page size (including empty), which is the
// one signal that cannot be produced by a server-side cap silently trimming
// a full page. Do not "fix" the 1,000-row ceiling by raising a `.limit()`
// instead of pagination — a fixed limit just moves the cliff to wherever
// the data outgrows it next, silently, in exactly the same way.
//
// VERIFICATION. Pagination alone proves the loop terminated; it does not
// prove the result is complete (a query bug, an RLS policy, or a dropped
// page could all terminate a loop early without an error). Every read this
// ticket cares about pairs `fetchAllPages` with `assertRowCountMatches`
// against an independent `count`-only query for the same filter — the guard
// that would have caught the original bug on its first run.

/** Structural subset of PostgrestError this module needs — matches the `isMissingTable` convention duplicated across scripts/*.ts (see CLAUDE.md's note on small helpers not needing a shared import). */
export interface PostgrestLikeError {
  code?: string
  message?: string
}

/**
 * This Supabase project's PostgREST `db-max-rows` ceiling. Not configurable
 * from this repo (server-side project setting) — this constant exists so
 * every call site pages in units that are safe regardless of the ceiling,
 * not so the ceiling can be tuned here. A page size at or below this value
 * always pages correctly; a page size above it would silently be capped
 * mid-page by the server, which is the exact bug this module exists to
 * prevent. Do not raise it without first raising `db-max-rows` on the
 * Supabase project itself (an owner-only, Tier 1 change this repo does not
 * make) and confirming the new ceiling.
 */
export const DEFAULT_PAGE_SIZE = 1000

export interface PageResponse<T> {
  data: T[] | null
  error: PostgrestLikeError | null
}

export interface FetchAllPagesResult<T> {
  rows: T[]
  error: PostgrestLikeError | null
  pages: number
}

// THE SECOND BUG THIS FILE EXISTS TO PREVENT (ticket #152). Postgres makes no
// promise that two separate queries against the same table return rows in
// the same order. Paging a table with no `.order()` therefore issues N
// independent, unordered queries -- between any two of them the server is
// free to hand back rows in a different sequence, so a row can land on two
// pages (duplicated) or on none (dropped). `assertRowCountMatches` cannot
// catch this: one row duplicated and one row dropped leaves the total count
// unchanged. The only fix is to refuse to page a query that has no
// deterministic ordering at all, before a single page is requested.
//
// MECHANISM (verified against the installed @supabase/postgrest-js, 2.112.2,
// 29 Aug 2026 -- see scripts/lib/paginate.test.ts for the proof). A
// PostgREST query builder is a thenable: `fetchPage(from, to)` returns the
// builder itself, synchronously, before anything is awaited. `.order()`
// writes its clause into the builder's `url.searchParams` under the key
// `order` (or `<referencedTable>.order` for a referenced-table ordering,
// which does NOT establish a deterministic order on this table's own rows
// and must not satisfy this guard). That means the returned-but-unawaited
// object can be inspected for a bare `order` key before the first page is
// requested at all.

/**
 * Thrown by the ordering guard inside `fetchAllPages`. Covers two distinct
 * failures that both amount to "cannot prove this page request is
 * ordered": a recognisable query object with no `.order()` clause, and an
 * object whose shape this guard does not recognise at all (see
 * `isOrderableQueryShape` below) -- the guard fails CLOSED on the latter
 * rather than assuming an unfamiliar shape is fine.
 */
export class UnorderedPaginationError extends Error {
  constructor(detail: string) {
    super(
      `Refusing to page an unordered query (${detail}). A multi-page read with no ` +
        `deterministic .order() can duplicate one row and drop another between pages ` +
        `while the total row count stays the same -- add .order() on the table's full ` +
        `primary key (outermost column first) before calling fetchAllPages.`,
    )
    this.name = 'UnorderedPaginationError'
  }
}

/**
 * The narrow structural shape this guard needs from the object a page thunk
 * returns, synchronously, before it is awaited. `url` is declared
 * `protected` on the real PostgrestBuilder/PostgrestFilterBuilder classes in
 * the shipped `.d.ts` (`@supabase/postgrest-js` 2.112.2), so this repo
 * cannot import that type and read `.url` off it directly -- TypeScript
 * would reject the access. This interface, plus the `unknown`-typed
 * structural check in `isOrderableQueryShape`, is the narrow, commented
 * escape hatch that reads the field anyway without reaching for a blanket
 * `any`: it asserts only the one property this guard actually uses.
 */
interface OrderableQueryShape {
  url: URL
}

/**
 * Fails CLOSED: returns `true` only for an object that actually exposes a
 * `URL` at `.url` (which is what every real PostgREST builder does, ordered
 * or not). Anything else -- a plain object, a bare `Promise`, a future
 * postgrest-js version that renamed or restructured the field, a hand-rolled
 * test stub -- returns `false`, and the caller below throws rather than
 * silently treating an unrecognisable shape as ordered.
 */
function isOrderableQueryShape(value: unknown): value is OrderableQueryShape {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { url?: unknown }
  return candidate.url instanceof URL
}

/**
 * Throws `UnorderedPaginationError` unless `pending` is a recognisable query
 * object carrying a bare `order` key in its URL's search params. Deliberately
 * checks the bare key only -- a referenced-table ordering writes
 * `<referencedTable>.order` instead (see the mechanism note above) and does
 * not make this table's own row order deterministic.
 */
function assertQueryIsOrdered(pending: unknown, from: number, to: number): void {
  if (!isOrderableQueryShape(pending)) {
    throw new UnorderedPaginationError(
      `page [${from}, ${to}]: the page thunk returned an object this guard does not ` +
        `recognise as a PostgREST query (no readable .url) -- failing closed rather than ` +
        `assuming an unfamiliar shape is ordered`,
    )
  }
  if (!pending.url.searchParams.has('order')) {
    throw new UnorderedPaginationError(`page [${from}, ${to}]: query has no .order() clause`)
  }
}

/**
 * Fetches every row of a query by issuing `.range(from, to)` requests of
 * `pageSize` until a page shorter than `pageSize` — including an outright
 * empty page — proves the source is exhausted.
 *
 * Before each page is awaited, the (already-constructed, not-yet-resolved)
 * query object is checked for a deterministic `.order()` clause and the call
 * throws `UnorderedPaginationError` if none is found — see the mechanism
 * note above this function. This runs on every page, not just the first:
 * the check is a synchronous, no-network inspection of a URL that has
 * already been built, so repeating it costs nothing and does not assume the
 * caller builds every page's query identically.
 *
 * A page whose length is exactly `pageSize` is deliberately NOT treated as
 * the end: this function always issues one further request to confirm
 * exhaustion, because a page landing exactly on the page-size boundary is,
 * by length alone, indistinguishable from a page silently capped by the
 * server. See this module's test file for the named test that proves this
 * termination behaviour rather than an infinite loop.
 *
 * On a page-level error, returns immediately with whatever rows were
 * accumulated so far and the error — matching the `{ data, error }`
 * destructuring convention every scripts/*.ts job already uses, so a caller
 * can still run its own `isMissingTable`-style classification on the error
 * without this module needing to know about it.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<FetchAllPagesResult<T>> {
  const rows: T[] = []
  let pages = 0
  let from = 0

  for (;;) {
    const to = from + pageSize - 1
    const pending = fetchPage(from, to)
    assertQueryIsOrdered(pending, from, to)
    const { data, error } = await pending
    if (error) {
      return { rows, error, pages }
    }
    pages++
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return { rows, error: null, pages }
}

/**
 * Thrown by `assertRowCountMatches`. A named class rather than a bare Error
 * purely so the message is built in one place; every scripts/*.ts job today
 * just lets it fall into its existing outer catch-all like any other
 * failure, which already records a failed `job_runs` row and exits
 * non-zero.
 */
export class RowCountMismatchError extends Error {
  context: string
  fetchedCount: number
  expectedCount: number

  constructor(context: string, fetchedCount: number, expectedCount: number) {
    super(
      `${context}: paginated fetch returned ${fetchedCount} row(s) but an independent count query for the same ` +
        `filter reports ${expectedCount}. Refusing to proceed with a possibly-truncated read.`,
    )
    this.name = 'RowCountMismatchError'
    this.context = context
    this.fetchedCount = fetchedCount
    this.expectedCount = expectedCount
  }
}

/**
 * The guard this ticket is actually about. `fetchAllPages` terminating
 * without error proves the loop ended correctly; it does not prove the
 * result is the whole table for the filter that was asked for. This
 * compares the row count a paginated read accumulated against an
 * independent `count`-only query for the same filter, and throws — naming
 * both numbers — if they disagree, rather than trusting a fetch that merely
 * didn't error.
 */
export function assertRowCountMatches(context: string, fetchedCount: number, expectedCount: number): void {
  if (fetchedCount !== expectedCount) {
    throw new RowCountMismatchError(context, fetchedCount, expectedCount)
  }
}
