# Ticket #213 — decisions log

## HIGH-IMPACT

None.

## ROUTINE

- **Exported `shrunkRate` from `src/lib/projection/rates.ts` instead of duplicating the
  formula in `minutes.ts`**, renaming its second parameter (`ninetiesPlayed` → `observedCount`)
  for the new call site; behaviour-preserving, no existing caller affected (the parameter is
  positional). Because the ticket explicitly requires reusing `rates.ts`'s existing shrinkage
  shape and constant rather than inventing a second shrinkage convention in the codebase
  (`docs/projection-model-backlog.md` G6), and the function was private. This is a scope
  deviation from the ticket's stated file list (`rates.ts` isn't named) — flagged here and in
  the end-of-run note rather than silently taken.
- **The season figure is current-season-only**, not a second cascade shrinking toward
  multi-season history. Because a second shrinkage stage would be out of this ticket's scope,
  and it must match exactly what the naive "prior minutes per match" baseline measures — the
  same number the falsification check compares the shrunk model against.
- **`pSixtyPlus` is untouched by the season figure.** Because the diagnosed defect and the
  ticket's scope are both about the mean-minutes figure; the backlog's §1f names
  `expectedMinutes`, not the 60-minute-rate.
- **`scripts/calibration-report.ts` left unmodified.** It is not actually a
  `PlayerProjectionInput` producer — it only reads already-written `player_projections` rows
  from Supabase and never constructs an input or calls `estimateMinutes`. It inherits the fix
  for free once `project-points.ts` writes shrunk projections. The ticket's DoD lists it as a
  producer to update; this corrects that assumption rather than making an unnecessary change.

## Known limitation, not a decision

Same wall as #214/G9/G11/G13/#208: this Builder session has no live Supabase project, so the
ticket's own "STOP AND REPORT" falsification check (midfield 0.421→0.464, forward 0.442→0.476
under a live `run-backtest` run) could not be executed. The shrinkage math, its collapse at both
ends, and its direction/magnitude on two named concrete cases are proven by unit test and a
throwaway synthetic end-to-end script; no real Spearman figures exist yet. A live
`run-backtest` run reading the "Ticket #201/#213" unshrunk-vs-shrunk section is required before
the falsification check can be called satisfied — this is the pipeline's standing pattern, not
a shortcut taken on this ticket.
