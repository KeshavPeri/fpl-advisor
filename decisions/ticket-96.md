# Ticket #96 — Add the rolling accuracy display

## HIGH-IMPACT

None. No decision touched accounts, credentials, destructive Supabase operations, or a new
framework/library choice, and nothing here failed the "expensive to reverse after ten more
tickets" test — every judgment call below is a convention choice within an otherwise
fully-specified ticket.

## ROUTINE

- The settled/unsettled distinction is enforced inside the *pure* `derive.ts` (via a
  `toSettledRow` step) rather than relied on solely from `api.ts`'s database filter — because the
  DoD requires a `derive.test.ts` unit test proving unsettled rows don't affect figures, and
  `derive.test.ts` is the only test file this ticket's scope allows. `api.ts` still also filters
  server-side for pagination-volume reasons, so the rule is enforced twice deliberately, not
  redundantly by accident.
- `selectCurrentModelVersion` picks the model_version with the most settled rows, tie-broken by
  latest `capturedAt`, rather than by recency alone — because a brand-new version with one row
  would otherwise "win" over an established version with thousands of rows, wrongly presenting as
  no-data on a card that has plenty. This satisfies "read `model_version` but don't race two"
  without hardcoding a version string into `src/lib/`, which is scoped to jobs (`scripts/`) only.
- Pagination in `src/lib/accuracy/api.ts` is a small self-contained `.range()` loop rather than an
  import of `scripts/lib/paginate.ts` — `CLAUDE.md`'s sharing rule runs one direction only
  (`scripts/` may import `src/lib/`, never the reverse), and this loop is too small to be worth
  being the ticket that crosses that boundary backwards.
- Gameweek labels are built as `Gameweek ${id}` directly in `derive.ts` rather than joined from
  the `gameweeks` table — matches the existing fallback convention in `verdict/derive.ts` and
  `reasoning/derive.ts`, and avoids adding a second paginated read to a card whose own read is
  already the largest in the app.
- MAE and mean signed error are rounded to 2 decimal places for display — enough precision to be
  meaningful in the 1.0–3.5 sanity-bound range without implying false accuracy, consistent with
  the ticket's explicit decimals-permitted carve-out for measurement figures (as opposed to
  projections).
