/**
 * In-game money formatting (product-brief.md §8, §4 — Tier 3, not real
 * money). Every price, bank and squad-value figure in the schema is stored
 * as an integer in tenths of a million (players.now_cost's own convention;
 * see #9's migration note), never a float. This is the single place that
 * turns that integer into "£8.5m" — one decimal place, £ symbol.
 */
export function formatMoney(tenthsOfMillion: number): string {
  return `£${(tenthsOfMillion / 10).toFixed(1)}m`
}

/**
 * Parses a user-typed £m string ("0.5", "99.5") into tenths of a million.
 * Returns null if the string isn't a non-negative number with at most one
 * decimal place — the caller turns that into a validation message.
 */
export function parseMoneyInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d)?$/.test(trimmed)) return null
  const tenths = Math.round(Number.parseFloat(trimmed) * 10)
  return Number.isFinite(tenths) ? tenths : null
}

/** The inverse of parseMoneyInput — tenths of a million back to an editable "8.5" string. */
export function tenthsToInputString(tenths: number): string {
  return (tenths / 10).toFixed(1)
}

/**
 * Extracts a human-readable message from anything a `catch` block might see.
 *
 * supabase-js does not reject with an `Error` on a Postgrest-level failure
 * (RLS denial, permission error, missing table/column, malformed query, a
 * bare network error) — by default it *resolves* `{ data: null, error }`,
 * where `error` is a plain `{ message, details, hint, code }` object, not an
 * `Error` instance. `src/lib/squad/api.ts` re-throws that object as-is, so a
 * naive `err instanceof Error ? err.message : String(err)` falls through to
 * `String(err)` for it, which stringifies a plain object to the useless
 * literal "[object Object]" — silently violating design-reference.md's rule
 * that error text must say what happened. Every catch block in this app
 * should route through this function instead of reimplementing the check.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message
  }
  return String(err)
}
