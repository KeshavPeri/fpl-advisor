# Ticket #43 — Paginate the projections read

## HIGH-IMPACT

None this ticket. No Tier 2 decision arose — no data-structure change, no new dependency, no
new external-service commitment, no destructive operation.

## ROUTINE

- **Page size fixed at 1000, not made tunable.** Because 1000 is this Supabase project's
  `db-max-rows` ceiling — any page size at or below it paginates correctly regardless of the
  server's configured cap, and any value above it would silently be capped mid-page by
  PostgREST, reproducing the exact bug this ticket fixes. Documented as non-tunable in
  `scripts/lib/paginate.ts` rather than exposed as a parameter.
- **`fetchAllPages` returns `{rows, error, pages}` instead of throwing**, matching the
  `{data, error}` destructuring convention already used across `scripts/*.ts`. Because call
  sites keep their own existing `isMissingTable`-style error classification unchanged — the
  helper slots into the existing error-handling shape rather than introducing a second one.
  A page is only treated as final when it is *shorter* than the page size (including empty),
  so a result landing exactly on a page boundary always issues one more confirmatory request.
- **Count verification (`assertRowCountMatches`) kept as a separate function from
  `fetchAllPages`**, not folded into it. Because one read in `emit-projections-csv.ts` — the
  beyond-horizon `player_projections` diagnostic — needs pagination (it is unbounded over a
  full season) but not a completeness guard (it is a drift-detection diagnostic, not a
  correctness gate the CSV depends on). Keeping the two composable let that read paginate
  without being forced into a count check it doesn't need.
- **Audit of `scripts/project-points.ts`, every Supabase read checked individually** (ticket's
  own DoD requirement — "we looked and here is what we looked at"):

  | Read | Rows today | Bounded? | Action |
  |---|---|---|---|
  | `gameweeks` (all) | ~38/season | Yes — fixed season length | Left unpaginated |
  | `players` (all) | 587, growing | No — grows with FPL roster | Paginated + count-verified |
  | `teams` (all) | ~20 | Yes — fixed league size | Left unpaginated |
  | `fixtures`, 5-gw horizon | ~50 | Yes — horizon fixed at 5 | Left unpaginated |
  | `fixtures`, `finished=true`, full season | up to 380 | Yes — fixed 20-team season | Left unpaginated |
  | `player_match_stats` (all) | 15,000+ | No — grows every gameweek | **Paginated + count-verified** — the read named explicitly in the ticket |

  Same approach applied to `emit-projections-csv.ts`: `gameweeks`/`teams` left unpaginated
  (bounded); `players` and the main `player_projections` read paginated + count-verified; the
  beyond-horizon `player_projections` diagnostic read paginated but not count-verified, per the
  reasoning above.
- **Import-extension convention preserved per-file, not unified.** `emit-projections-csv.ts`
  imports the new helper as `./lib/paginate.js` (matching that file's existing same-directory
  import style); `project-points.ts` imports it as `./lib/paginate.ts` (matching that file's
  existing `src/lib/*` import style). Both compile clean under `tsconfig.scripts.json`'s
  `allowImportingTsExtensions`. Because introducing a third convention to unify two existing,
  independently-correct ones would be scope creep this bug-fix ticket didn't ask for.

## Note for QA / Keshav

- `playersWithNoProjectionAtAll` and `playerGameweekPairsZeroFilled` reaching `0` against live
  data (DoD item) cannot be verified from a sandboxed build — no live Supabase credentials in
  this environment. Per the ticket's own note, this is confirmed only by a live run after
  merge, which is Keshav's check.
- A pre-existing, harmless false positive: `scripts/project-points.ts` line 21 contains the
  literal substring `.delete(` inside a comment ("`.delete(` does not appear in this file").
  This predates this ticket's changes; flagged here in case a grep-based DoD check trips on it.
