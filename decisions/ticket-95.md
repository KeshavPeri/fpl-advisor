# Ticket #95 — Widen the solver's player pool

## HIGH-IMPACT

- **`build-solver-input.ts` now writes a second `job_runs` row on its success path — a
  widening-config audit row — alongside the pipeline-outcome row already written elsewhere in the
  `solver-run` pipeline, which the script's own header previously documented as "exactly one
  `job_runs` row fires per run."** Because the ticket's DoD requires the widening counters
  (projections-CSV player count, `keep_top_ev_percent`, `ev_per_price_cutoff`) to be provable even
  when the downstream solve times out or `store-solver-output.ts` never runs — which is exactly
  the human-observable failure signal the ticket names for "25% is too wide" — writing them only
  at the very end of the pipeline would make them invisible on the one run where they matter most.
  `job_runs` is documented as append-only (its migration's own `COMMENT ON TABLE`: "Rows
  accumulate — never upserted"), so a second row for a distinct purpose (widening-config audit vs.
  pipeline-outcome audit) fits the table's actual design. The header comment in
  `build-solver-input.ts` was updated to explain this is a second kind of row, not a violation of
  the original one-row invariant.

## ROUTINE

- `keep_top_ev_percent` and `ev_per_price_cutoff` widened from the shipped 5/30 to 25/10 exactly
  as pre-specified in the ticket, expressed as named exported constants (`KEEP_TOP_EV_PERCENT`,
  `EV_PER_PRICE_CUTOFF`) with comments stating the shipped default, the actual percentile
  mechanics quoted from `dev/solver.py`, and that the widening is deliberate and unmeasured.
- `buildWideningJobRunDetails(projectionsPlayerCount)` was written as a separate pure exported
  function rather than folded into `buildSolverConfig`'s return value, so the player-count-derived
  audit data stays decoupled from the solver config object — which must never carry a stray extra
  key the Python solver doesn't expect.
- `job_runs.details` JSON fields use camelCase (`projectionsPlayerCount`, `keepTopEvPercent`,
  `evPerPriceCutoff`), matching the snake_case-to-camelCase convention already used for
  `baseDetails` in `store-solver-output.ts`.
- The new audit table in `docs/solver-notes.md` matches the existing document's table style, used
  already for its CSV-columns section.
