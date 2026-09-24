# Ticket #258 — gbm-v1: a learned projection model trained on four seasons, with an offline gate

## HIGH-IMPACT

None this ticket.

## ROUTINE

- The offline gate's "≥ ppm baseline + 0.08" / "≥ minutes baseline + 0.02" thresholds are compared
  against baselines computed on this run's own 2025-26 walk-forward, not the hardcoded reference
  numbers in the ticket (which are printed for comparison only). Because the brief's gate language
  most naturally reads as "beat the baseline measured the same way, on the same data", not a frozen
  external constant that could drift from how this run's populations are actually built.
- Team-rolling features use goals-for/goals-against only (`gf`/`ga`), dropping the reference
  script's rolling team-xG aggregate (`t_txg_k`/`o_txg_k`). The frozen `history` contract (§8,
  "Contracts frozen in run 1") carries only `gf`/`ga` per row, and §4e's own ablation shows rolling
  team form is worth <0.001 Spearman either way — documented in `model/README.md`.
- `train.fit`/`predict` return/accept a thin `Model` wrapper rather than a raw `lightgbm.Booster`,
  so the same call sites work unchanged under the scikit-learn `HistGradientBoostingRegressor`
  fallback path. Documented in `model/README.md`.

## Note, not a decision

Captain-pick average (5.65) came in below the diagnosis doc's reference (~6.5) even though every
gated metric reproduces the reference almost exactly. This is an informational-only metric (the
ticket says "print, never gate" for it) and was not tuned or chased, per the ticket's "do not tune"
instruction. Builder's best guess: using `own_pct_rank` for pool selection (the ticket's own
requirement) instead of raw ownership counts changes which 60 players are considered each week.
Worth a look if a future ticket cares about this figure specifically.
