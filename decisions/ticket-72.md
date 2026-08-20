# Ticket #72 — Filter the verdict card to one solver run

## HIGH-IMPACT

None. This ticket is a query-scoping fix against an existing column
(`recommendations.solver_run_id`) plus an arithmetic guard — no new
dependency, no data-structure change, no framework or service choice.

## ROUTINE

- The eleven-player guard was placed in `derive.ts`'s pure
  `sumGameweekPoints` rather than in `api.ts`, matching the existing
  convention from ticket #68 that the scoring arithmetic lives in one
  place.
- The null-`solver_run_id` fallback query filters only by `gameweek_id`,
  not `solution_index` — confirmed against
  `supabase/migrations/20260816090000_solver_output.sql` that
  `solver_runs` is a per-execution table with no `solution_index` column,
  so filtering on it isn't possible or meaningful there.
- `src/lib/verdict/api.test.ts` is the first test in this codebase to
  mock `../supabase` and exercise an `api.ts` function's actual query
  construction (every prior `*.test.ts` here tests pure functions only).
  Confined to one test file, no new dependency — noted here as a pattern
  a future ticket may want to reuse or diverge from, not a decision that
  needed escalating.
