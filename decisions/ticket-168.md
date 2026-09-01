# Ticket #168 — Diagnose and fix the forward assist rate

## HIGH-IMPACT

- **Shipped no change to the projection model, because direct measurement ruled out both
  candidate mechanisms and the one real contributing cause sits outside this ticket's file
  scope.** Reconstructed the position-prior and appearance-weighted rate computation directly
  from FPL-Core-Insights (both ingested seasons, same PL-only filter as #148/#162), reproducing
  the calibration report's own population sizes exactly (73 distinct current-roster forward
  codes; 46 found with real 2025/26 minutes against the report's stated 48 — confirming the
  reconstruction matches the live join). Findings: position prior forward xA/90 = 0.0586, close
  to the established-forward (≥5 nineties, n=35) median of 0.0538, not far below it as the
  "prior drags recommendable forwards down" hypothesis would require — the top-15 recommendable
  forwards' own raw xA/90 (0.0531, minutes-weighted) sits *below* the prior, so shrinkage pulls
  it up, not down. Fringe players (&lt;5 nineties) carry only 4.3% of the prior's minutes-weighted
  total, too small to produce a 33-point gap — ruling out mechanism 1 (position prior) and
  mechanism 2 (population dilution) as originally framed. #155's identical pSixtyPlus-weighted
  formula applies to goals too, on the same 73-forward population, and goals are clean (0.97x) —
  further ruling out mechanism 2. A real, measured, asymmetric effect does exist: the 44 forwards
  dropped from the current roster since 2025/26 had *higher* xA/90 (0.0728) but *lower* xG/90
  (0.2768) than the 51 retained — survivorship bias in `scripts/project-points.ts`'s
  current-roster join, shaped exactly right to explain why goals project cleanly and assists
  don't. That file is outside this ticket's scope (`src/lib/projection/` only), and correcting
  for it inside `rates.ts`/`expectedPoints.ts` would be architecturally indistinguishable from a
  second, explicitly-forbidden assist conversion factor layered on top of #148's already-measured
  one. Recorded the full diagnostic as a code comment in `expectedPoints.ts` (pointer from
  `rates.ts`) so the finding is not lost, and added tests proving every other component —
  including GK/DEF/MID assist output specifically — is byte-identical to the pre-ticket formula.
  **Follow-up recommended:** a ticket scoped to `scripts/project-points.ts` testing whether
  widening the position-prior's source population, or a survivorship-aware correction in the
  roster join itself, closes the remaining gap.

## ROUTINE

- No routine (Tier 3) decisions this ticket — no constant was introduced, so there was no clamp
  range or naming convention to choose. The only concrete artifact is the diagnostic comment
  block itself, which is documentation rather than a design decision.
