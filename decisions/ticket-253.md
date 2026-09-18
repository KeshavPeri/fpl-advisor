# Ticket #253 — Re-fit the bonus ALPHA on a full season, not one gameweek

## HIGH-IMPACT

- **Tier 2 — did not ship a re-fitted `ALPHA`; left it at `1` in `src/lib/projection/bonus.ts`.**
  **Because** the ticket's own mandatory reproduction pre-check failed: reconstructing 2026-2027
  GW2/GW3 bonus at ALPHA=1 gave top-20 mean projected bonus 0.379/0.426 against #241's published
  0.338/0.334 — both roughly 2–4x outside the required ±0.02 tolerance — for a structural reason,
  not a coding defect. The offline single-season reconstruction pattern in `run-backtest.ts`,
  which the ticket explicitly instructed the Builder to follow, has no equivalent of ticket #113's
  two-stage cross-season shrinkage that the live `project-points.ts` model leans on heavily at
  season start, when there is little current-season evidence yet. The ticket's own falsification
  text says plainly: "if it does not reproduce, the reconstruction is wrong and no fit from it can
  be trusted." Separately and independently, the candidate ALPHA=1.69 also failed Gate 2b (mean
  per-fixture allocated total 5.50 vs required >5.70). Both routes converge on the same answer, so
  there was no live fork requiring Keshav's own judgement — classified **Tier 2, not Tier 1**, by
  the Analyst (escalation.md's four Tier-1 categories — money, personal data, new
  accounts/credentials, destructive live-data ops — do not apply here). This is a valid negative
  result, the same shape as the ticket's own stated contingency for Gate 1 ("if it is not lower,
  ALPHA does not change, and that is a valid result — ship the report and say so").
- **Tier 2 — declined to build two-stage cross-season shrinkage into the offline reconstruction
  within this ticket's scope**, even though doing so might have closed the reproduction gap.
  **Because** that logic belongs to whichever ticket owns `project-points.ts`'s historical/current
  split (#113's territory) — replicating it in a separate offline script risks exactly the "second
  copy to get wrong" problem CLAUDE.md's "Sharing code between scripts/ and src/" section warns
  about for scoring/projection logic. A real full-season refit, if still wanted, needs its own
  ticket scoped by whoever owns that split.
- **Tier 2 — declined to re-scope the reproduction check to a later, less cross-season-dependent
  gameweek to force a pass.** **Because** that would launder around a real structural
  reconstruction gap rather than surface it, producing false confidence that the offline fit is
  trustworthy when it still lacks the shrinkage the live model depends on.

## ROUTINE

- **Tier 3 — new offline fit script `scripts/fit-bonus-alpha.ts` (+ `.test.ts`) added**, beyond
  the ticket's stated file list. **Because** the ticket explicitly asked for an offline fit "driven
  the same way `scripts/run-backtest.ts` drives the rest of the model," and no existing script did
  that — a new script was the only way to satisfy the instruction. It reuses `expectedBps`,
  `nonAppearanceBps`, and `allocateFixtureBonus` from `bonus.ts` unmodified rather than
  duplicating logic, matching the established pattern from ticket #33. Verified by QA: no second
  projection path exists anywhere in the diff.
- **Tier 3 — `scripts/bonus-validation-report.ts` extended to read `player_gameweek_history` for
  past seasons while keeping its existing `gameweek_live_stats` path for the current season**,
  naming which source each season came from in its own output — per the ticket's explicit
  instruction that a report silently mixing two instruments is worse than one that names them.

All entries above were verified by QA (PASS, 18 Sep 2026), including an independent, live
re-run of `scripts/fit-bonus-alpha.ts` offline against the real FPL-Core-Insights CSVs, which
reproduced the fitted ALPHA (1.69), both gate outcomes, and both reproduction-check failures
exactly as reported.
