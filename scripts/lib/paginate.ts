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

/**
 * Fetches every row of a query by issuing `.range(from, to)` requests of
 * `pageSize` until a page shorter than `pageSize` — including an outright
 * empty page — proves the source is exhausted.
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
    const { data, error } = await fetchPage(from, to)
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
