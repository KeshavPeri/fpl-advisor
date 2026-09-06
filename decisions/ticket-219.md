# Ticket #219 — Ingest FPL's own penalties_order and measure whether it belongs in the model

## HIGH-IMPACT

- **Used a within-season half-split (GW1-19 build / GW20-38 held-out) on the completed
  2025-2026 season as the falsification-check instrument, rather than a live backtest run.**
  Chose this because this run has no live Supabase project to query and `scripts/run-backtest.ts`
  is owned by ticket #220 in the same batch (out of scope for this ticket). The half-split, run
  against real 2025-2026 data with the actual `shrunkRate` / `SHRINKAGE_K` / goal-conversion code
  reused verbatim, gives a real, reproducible falsification test rather than an argued one.

- **Confirmed the ingested xG already includes penalty value, and recorded this as settled in
  `docs/projection-model-backlog.md` (entry G18).** Chose to independently re-derive this from the
  raw FPL-Core-Insights CSVs (isolating player-match rows where the only shot that match was a
  penalty attempt: 25 rows across the full 2025-2026 season, mean 0.7899 xG, stdev 0.0003 — a
  near-fixed constant) rather than rely on a prior finding by citation, because the brief's
  §1d/G1 double-count inventory in the backlog doc specifically warns against acting on an assumed
  answer to this question. Traced the value through `rates.ts`'s `xgPer90` into
  `expectedPoints.ts`'s `expectedGoals` to confirm it flows in unmodified. This corroborates
  ticket #218's earlier finding with an independent instrument.

- **Neither candidate treatment (explicit penalty scoring term, or reduced shrinkage for
  first-choice takers) shipped.** Chose not to ship because the brief says a model change ships
  only if it clears its own falsification check (`LEARNINGS-second-build-wave.md` §17 precedent):
  Treatment B (explicit term) was never built because the xG finding above means it would
  double-count; Treatment A (reduced `SHRINKAGE_K` for `penalties_order === 1` takers) was built
  and measured, but at every tested K (2, 1, 0.5) Forward and Midfielder goal calibration got
  *worse*, not better (Forward 0.9851 → 0.9755, Midfielder 0.9407 → 0.9355 at K=0.5), failing the
  ticket's explicit "must improve" gate. The ingest and the written finding ship as a complete
  ticket on their own, per the ticket's own fallback instruction.

## ROUTINE

- `penalties_order` stored as `smallint`, matching the existing `element_type` column's
  precedent on `public.players` rather than a plain `integer`.
- No range validation applied to the ingested `penalties_order` value (not constrained to 1-3):
  the source has been observed to publish values up to 5, and validating a narrower range would
  silently drop future data rather than surface a genuine source change.
- Added the `isMainModule` guard to `scripts/ingest-fpl.ts`, matching the convention already used
  by every other `scripts/*.ts` job, because it was the one ingest job with no test file — without
  the guard, importing it for the new test would trigger a real `main()` run and `process.exit(1)`
  and crash the test process.
