# Ticket #134 — Add a wildcard and free-hit advisory — so the gap between your squad and a rebuilt one is a number, not a guess

## HIGH-IMPACT

- **Enabling a solver mode (`preseason: true`) never exercised in this project, isolated by
  construction rather than by convention.** Because every downstream consumer of a solve — the
  verdict card, the Telegram sender, the notification schedule — reads "the most recent solve" and
  has no way to tell a probe from the real thing, a leaked row would silently become the app's
  answer, and the consequence here is a fourteen-transfer recommendation rather than a slightly
  wrong one. Isolation is enforced three separate ways, not one: (a) `preseason: true` is reachable
  only through a new, structurally distinct `buildRebuildSolverConfig` function — never
  `buildSolverConfig`, whose own signature has no `variant` field, proved by a runtime test across
  every accepted parameter shape plus a `@ts-expect-error` compile-time test that fails `tsc -b`
  outright if that signature is ever widened; (b) only `squad-rebuild-probe.yml` sets the routing
  environment switch that selects the rebuild path; (c) that workflow calls only
  `emit-projections-csv.ts`, `build-solver-input.ts` and `store-squad-advisory.ts` — grep-verified
  to contain none of `store-solver-output`, `generate-recommendations`, `send-telegram` or
  `snapshot-predictions`.
- **`chip_advisories.solver_run_id` reuses the freshest existing `solver_runs` row for the target
  gameweek, rather than writing a new one.** Because that foreign key is `NOT NULL` and writing a
  new `solver_runs` row would require `store-solver-output.ts` — explicitly forbidden by this
  ticket's own safety-case grep check — reusing the existing row (mirroring `store-chip-advisory.ts`'s
  precedent exactly) is the only option that respects the DoD without inventing a new write path.

## ROUTINE

- One `chip_advisories` row per run represents solution_index 0 (the primal/best solution), not one
  row per solver iteration — the DoD specifies "one row per run" and `solver_runs.objective_value`
  already documents iteration 0 as the objective of record.
- `buildSquadAdvisoryRow` throws, never guesses, if either solve lacks solution_index 0, if the
  baseline played any chip, or if the rebuild didn't actually play the requested variant — matching
  this codebase's established "throw, never guess" discipline.
- The chips-screen API read takes the latest advisory row per chip code (by row `id`), not the
  latest run overall — because the probe is dispatched irregularly, Wildcard and Free Hit are
  independent questions that can each carry their own most recent answer.
- Reused the existing `chips-advisory` CSS classes verbatim for the new advisory rather than
  inventing new ones, per design-reference.md: an established screen should match its existing
  components, and this is not a new-surface ticket, so `frontend-design`/Impeccable were not
  invoked.
