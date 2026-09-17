# Ticket #244 — Measure the defensive slope, is the attack/defence asymmetry real?

## HIGH-IMPACT

- **Damped `defensiveMultiplier`/`expectedGoalsConceded` in `fixture.ts` from `2 × (1 − es)` to `clamp(1.5 − es, 0, 2)`, mirroring #182's attacking-side fix, because** the measured goals-conceded slope (endpoint ≈−1.43, weighted least-squares ≈−1.50, n=758 resolvable 2025-2026 team-matches) is materially flatter than the model-implied −2.9 — well outside the ticket's ±15% materiality band. The goals-scored reproduction of #184's own table matched within 0.002 goals/bucket, confirming the measurement harness is trustworthy before acting on it.
- **Replaced the ticket's original falsification gate 3 with a Builder-runnable clean-sheet accuracy check, because** the original gate (run `scripts/calibration-report.ts` before/after against live Supabase) needed credentials no Builder sandbox has, and a proper before/after would have required re-running `project-points` against live data — something a Builder should never do (`LEARNINGS-second-build-wave.md` §20: only write gates the Builder can evaluate). The replacement gate is a direct test of the thing that actually matters: whether the damped formula's `exp(-lambda)` clean-sheet prediction tracks the real, measured clean-sheet rate better than the pre-#244 formula did, computed from data already fetched in this same run. Result: **PASS** — NEW formula's mean absolute error against actual clean-sheet rate (0.0373) is lower than OLD's (0.0412) across the same 5 buckets, so the linear slope fix also improved real-world clean-sheet calibration rather than trading it away for a better-looking slope, which is what G12's non-linearity concern (`pCleanSheet = exp(-λ)`) was warning against.

## ROUTINE

- Measurement performed directly against FPL-Core-Insights CSVs, no Supabase required — matches the precedent set by `teamStrength.ts`'s own `SCALE` calibration.
- `TEAM_STRENGTH_SHRINKAGE_K = 0` used on this measurement path, since the rates are already season-length — the regime `SCALE` was originally fitted on — and shrinking them would have moved the x-axis away from the one #184's attacking figures were measured against.
- `expectedGoalsConceded` rewritten to call `defensiveMultiplier` directly rather than restating the formula, strengthening the "never allowed to drift apart" invariant by construction rather than by test alone.
- Gate 3's per-bucket `exp(-lambda)` means are pooled directly over the underlying team-matches, never a two-level mean-of-means over unequal bucket sizes, per explicit instruction — avoids bucket-size bias in the MAE comparison.
- Found and fixed a report bug while building the new gate: the goals-CONCEDED table's "model" column was calling the live (already-damped, on this branch) `expectedGoalsConceded()` instead of reproducing the literal pre-#244 formula — now computed independently so the report stays correct regardless of commit order on the branch.

## Status

Code-complete and self-consistent; ticket remains `status:blocked` pending #238's merge (see issue #244 for the scope-collision detail — `expectedPoints.test.ts` has 7 assertions that go stale under this change and that file is owned by #238 in this batch). Once #238 merges to `main`, this branch rebases onto it and the orchestrator updates only the assertions that fail purely from `expectedGoalsConceded`'s changed numeric output.
