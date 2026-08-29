# Ticket #152 — Order every paginated read deterministically

## HIGH-IMPACT

- **Built the ordering guard as a structural inspection of the unawaited PostgREST builder's
  `url.searchParams`, failing closed on any unrecognisable shape, because this is the only point
  in the codebase that can catch "ordered vs. not" before a single network call is made, and this
  ticket changes how every job in the repository reads data.** `fetchAllPages` takes an opaque
  thunk `(from, to) => PromiseLike<...>`; the thunk returns the PostgREST builder synchronously,
  before it is awaited, and `.order()` writes into `this.url.searchParams` under the bare `order`
  key (a referenced-table ordering writes `<table>.order` instead, which the guard is careful not
  to accept as satisfying it). Verified directly against the installed `@supabase/postgrest-js`
  2.112.2 rather than assumed — the ticket flagged this as the crux and warned that a required
  `ordering` parameter the helper never verifies is the same invariant moved, not a real guard.
  `isOrderableQueryShape` only accepts an object whose `.url` is an actual `URL` instance;
  anything else — including a future postgrest-js that no longer exposes the query URL, or a
  hand-rolled stub — throws `UnorderedPaginationError` rather than passing through, proven by a
  test using a plain `{ data: [], error: null }` object. This is the point of the ticket; the 31
  `.order()` calls below are the mechanical consequence of the guard existing, not the fix itself.

- **Fixed `src/lib/decisions/api.ts`'s `fetchAllDecisionRows`, one call site outside the ticket's
  listed scope, because the ticket's own definition of done (#6) is unconditional and
  grep-checkable: every `.range(` in `scripts/` and `src/` must sit in a chain that also contains
  `.order(` on a unique key, with no exceptions.** The function ordered `recommendation_decisions`
  by `decided_at` alone — not that table's primary key (`id`) and not guaranteed unique — so it was
  a second instance of exactly the defect this ticket exists to close. Shipping a ticket titled
  "order every paginated read deterministically" while knowingly leaving a second affected site
  unordered would contradict the ticket on its own terms. Fixed minimally rather than escalated:
  kept `decided_at` ascending as the primary sort (preserves existing output order for every
  caller) and added `.order('id', { ascending: true })` as a tiebreaker, which only changes the
  relative order of rows that already tied on `decided_at` — a strict correctness improvement with
  no ambiguity in the correct answer, since the table's real primary key is unambiguous from its
  own migration. `fetchAllGameweeks` in the same file was already ordered by its real primary key
  (`id`) and was left untouched.

## ROUTINE

- Ascending order, outermost primary-key column first, at every site — no ticket text specified a
  direction, and ascending matches every already-correct site in the codebase (e.g. `gameweeks` by
  `id`, `recommendation_reasons` by `plan_index, order_index`).
- Where a table's primary-key column isn't in the site's `.select()` list (e.g. `player_id` /
  `match_id` on several `player_match_stats` reads, `player_id` / `model_version` on the
  emit-projections-csv beyond-horizon check), ordered by it anyway without adding it to `select` —
  confirmed this is legal in postgrest-js rather than assumed; `.order()` does not require the
  column to be selected.
- `UnorderedPaginationError`'s constructor takes one `detail` string built by the caller (page
  range plus reason) rather than separate structured fields, matching the existing
  `RowCountMismatchError`'s one-string-message style in the same file.
- The two fake-Postgrest test builders in `scripts/notification-schedule.test.ts` and
  `scripts/send-telegram.test.ts` had their `.order()` no-op turned into one that actually records
  state, matching what real postgrest-js does — the guard correctly rejected the old fakes as
  unrecognisable shapes once it existed, since a no-op `.order()` never touches `url.searchParams`.

## Call site → table → ordering → primary key

| Call site | Table | `.order()` applied | Primary key |
|---|---|---|---|
| `scripts/build-feature-history.ts:559` | player_match_stats | player_id, match_id | (player_id, match_id) |
| `scripts/calibration-report.ts:1188` | players | id | (id) |
| `scripts/calibration-report.ts:1236` | player_match_stats | player_id, match_id | (player_id, match_id) |
| `scripts/calibration-report.ts:1304` | player_projections | gameweek_id, player_id, model_version | (gameweek_id, player_id, model_version) |
| `scripts/emit-projections-csv.ts:400` | players | id | (id) |
| `scripts/emit-projections-csv.ts:447` | player_projections | gameweek_id, player_id, model_version | same |
| `scripts/emit-projections-csv.ts:512` | player_projections | gameweek_id, player_id, model_version | same |
| `scripts/generate-recommendations.ts:426` | solver_picks | solution_index, gameweek_id, player_id | (solution_index, gameweek_id, player_id) |
| `scripts/generate-recommendations.ts:474` | solver_picks | solution_index, gameweek_id, player_id | same |
| `scripts/generate-recommendations.ts:731` | player_match_stats | player_id, match_id | (player_id, match_id) |
| `scripts/generate-recommendations.ts:769` | players | id | (id) |
| `scripts/notification-schedule.ts:211` | notifications | id | (id) |
| `scripts/project-points.ts:511` | players | id | (id) |
| `scripts/project-points.ts:610` | player_match_stats | player_id, match_id | (player_id, match_id) |
| `scripts/run-backtest.ts:1791` | players | id | (id) |
| `scripts/run-backtest.ts:1818` | feature_history | season, gameweek_id, player_code | (season, gameweek_id, player_code) |
| `scripts/run-backtest.ts:1862` | player_match_stats | player_id, match_id | (player_id, match_id) |
| `scripts/send-telegram.ts:405` | recommendations | gameweek_id, plan_index | (gameweek_id, plan_index) |
| `scripts/settle-predictions.ts:453` | prediction_log | gameweek_id, player_id, model_version | (gameweek_id, player_id, model_version) |
| `scripts/settle-predictions.ts:522` | fixtures | id | (id) |
| `scripts/settle-predictions.ts:577` | prediction_log | gameweek_id, player_id, model_version | same |
| `scripts/snapshot-predictions.ts:269` | player_projections | gameweek_id, player_id, model_version | same |
| `scripts/preflight-check.ts:1259` | squad_picks | gameweek_id, squad_position | (gameweek_id, squad_position) |
| `scripts/preflight-check.ts:1298` | player_projections | gameweek_id, player_id, model_version | same |
| `scripts/preflight-check.ts:1315` | players | id | (id) |
| `scripts/preflight-check.ts:1325` | teams | id | (id) |
| `scripts/preflight-check.ts:1332` | fixtures | id | (id) |
| `scripts/preflight-check.ts:1454` | teams | id | (id) |
| `scripts/preflight-check.ts:1470` | fixtures | id | (id) |
| `scripts/preflight-check.ts:1508` | player_match_stats | player_id, match_id | (player_id, match_id) — the failing check 7 |
| `scripts/preflight-check.ts:1575` | notifications | id | (id) |
| `src/lib/accuracy/api.ts:~82` | prediction_log | gameweek_id, player_id, model_version (was gameweek_id alone) | (gameweek_id, player_id, model_version) |
| `src/lib/decisions/api.ts` (`fetchAllDecisionRows`, not in ticket's list) | recommendation_decisions | decided_at (kept, primary sort), id (added, tiebreaker) | (id) |

## Known limitation

`src/` and `scripts/` are separate compilation environments, and the sharing rule runs one way —
`scripts/` may import `src/lib/`, never the reverse. `src/lib/accuracy/api.ts` therefore cannot
import the `scripts/lib/paginate.ts` guard and keeps its own pagination loop, fixed for ordering
only. No `src/`-side copy of the guard was added. This means `src/lib/accuracy/api.ts` and
`src/lib/decisions/api.ts` remain unguarded against a future unordered read being reintroduced —
only the `scripts/` call sites are protected by `UnorderedPaginationError`.
