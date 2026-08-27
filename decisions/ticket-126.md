# Ticket #126 — Add a chip advisory from a second chip-enabled solve

## HIGH-IMPACT

- **`chip_advisories` is keyed `(gameweek_id, solution_index, chip_code)`, with `delta` as a
  DB-`GENERATED` column, not app-computed.** Because the real probe output shows a single solve
  can play two chips together (`TC2, BB4`), "one row per (gameweek, solution_index)" as loosely
  stated in the ticket needs `chip_code` in the key to hold both without collision. Making `delta`
  a generated column makes "stored delta = chip-enabled objective − chip-free objective" provably
  true from the schema itself, closing the exact class of bug that produced #72's doubled
  `solver_picks` figure.
- **Chip *choice* never reaches the recommendation — only the *delta* does.** Because a
  five-gameweek rolling horizon can never see the double gameweek or easy fixture that makes
  holding a chip worth it, the solver's chip timing is structurally always "now." Presenting that
  timing as a decision would violate product-brief.md §6a — no recommendation beats a wrong one.
- **The per-gameweek `CHIP` cross-check reads a single flat line for the whole log, not one per
  iteration.** Because the ticket itself describes "a CHIP TC/BB line inside each gameweek block"
  and "a Transfer Overview section" in the singular, and the one real example shows all three
  iterations sharing an identical chip decision. A genuine future divergence between iterations is
  still caught — loudly, via the cross-check failure — never silently misread.
- **`store-chip-advisory.ts` re-parses the normal run's own log with the same parser, rather than
  extending `solver_runs`'s schema.** Because `solver_runs.objective_value` is a single figure
  (iteration 0 only), while three iterations each need their own chip-free baseline for a fair
  delta, and `store-solver-output.ts` and its migration are explicitly out of this ticket's scope.

## ROUTINE

- `scripts/build-solver-input.ts` and its test file left completely unchanged — ticket #114
  already built and fully tested the exact `CHIP_PROBE` mechanism and the byte-for-byte-identical
  / full-object-equality guarantees this ticket's DoD asks for; editing it would have duplicated
  existing, working coverage.
- The chip-enabled solve's config and log get their own artifact paths (`CHIP_SOLVER_CONFIG_PATH`,
  `CHIP_SOLVER_LOG_PATH`); `TEAM_JSON_PATH` and `PROJECTIONS_CSV_PATH` are reused byte-for-byte
  between the two solves, matching the ticket's explicit "same team.json, same projections CSV."
- The results-CSV output directory is not separated between the two solves, since neither storage
  script ever reads a results CSV — documented inline; two new artifact uploads (chip log, chip
  config) added for debuggability, matching the workflow's existing thorough-artifact convention.
- Workflow `timeout-minutes` raised from 20 to 35, to cover two ~300s solves plus existing
  overhead.
- New workflow steps placed after "Generate recommendations" and before "Send Telegram
  notification," so the pre-existing recommendation chain is visually untouched in the diff.
- Chip advisory UI intentionally uses no accent colour (unlike used/lost chip slots), so it reads
  as neutral information rather than an endorsement.
- The `chip_advisories` query in `src/lib/chips/api.ts` filters to the newest `solver_run_id` for
  the target gameweek only, so an older night's advisory never lingers on screen.
