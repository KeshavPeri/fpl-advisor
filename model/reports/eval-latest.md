# gbm-v1 offline evaluation

Generated 2026-09-24T20:38:38+00:00 · backend `lightgbm` · docs/model-diagnosis-2026-09-24.md §7/§8.

## Liveness

| Model | Fold from GW | Through GW | n_train | n_test | pred std |
|---|---|---|---|---|---|
| 1-GW (points) | 1 | 7 | 80618 | 5073 | 1.2953 |
| 1-GW (points) | 8 | 14 | 85691 | 5258 | 1.4975 |
| 1-GW (points) | 15 | 21 | 90949 | 5429 | 1.4783 |
| 1-GW (points) | 22 | 28 | 96378 | 5684 | 1.4990 |
| 1-GW (points) | 29 | 35 | 102062 | 5375 | 1.5208 |
| 1-GW (points) | 36 | 38 | 107437 | 2519 | 1.5427 |
| 5-GW (y5) | 1 | 7 | 70966 | 5073 | 6.0040 |
| 5-GW (y5) | 8 | 14 | 73073 | 5258 | 6.6614 |
| 5-GW (y5) | 15 | 21 | 78277 | 5429 | 6.7905 |
| 5-GW (y5) | 22 | 28 | 83586 | 5684 | 6.6101 |
| 5-GW (y5) | 29 | 35 | 89139 | 5375 | 6.3789 |
| 5-GW (y5) | 36 | 38 | 94716 | 2519 | 6.9661 |
| 1-GW (points, no-odds ablation) | 1 | 7 | 80618 | 5073 | 1.2895 |
| 1-GW (points, no-odds ablation) | 8 | 14 | 85691 | 5258 | 1.4871 |
| 1-GW (points, no-odds ablation) | 15 | 21 | 90949 | 5429 | 1.4655 |
| 1-GW (points, no-odds ablation) | 22 | 28 | 96378 | 5684 | 1.4915 |
| 1-GW (points, no-odds ablation) | 29 | 35 | 102062 | 5375 | 1.5262 |
| 1-GW (points, no-odds ablation) | 36 | 38 | 107437 | 2519 | 1.5681 |

No liveness failures: every fold has test rows and non-constant predictions.

## Primary gate — active population, 5-GW, pooled, g <= 34

n = 13259. Reference (24 Sept 2026 run): GBM 0.595, ppm 0.452, minutes 0.442.

- GBM: **0.586**
- ppm baseline: 0.453
- minutes baseline: 0.443
- Gate: GBM >= 0.55 AND GBM >= ppm + 0.08 (0.533) AND every position >= its ppm + 0.05

| Position | n | GBM | ppm baseline | ppm + 0.05 | reference ppm |
|---|---|---|---|---|---|
| GK | 819 | 0.549 | 0.318 | 0.368 | 0.318 |
| DEF | 4699 | 0.556 | 0.409 | 0.459 | 0.409 |
| MID | 6188 | 0.598 | 0.480 | 0.530 | 0.48 |
| FWD | 1553 | 0.612 | 0.509 | 0.559 | 0.5 |

**Primary gate: PASS**

## Secondary gate — featured population, 5-GW

n = 9613. Reference: GBM (5-GW model) 0.411, minutes 0.376.

- GBM (1-GW model, summed in production): 0.406
- GBM (dedicated 5-GW model, evaluation reference only): 0.430
- minutes baseline: 0.376
- Gate: GBM (1-GW model) >= minutes + 0.02 (0.396)

**Secondary gate: PASS**

## Market-odds features (ticket #264)

Odds coverage on single-fixture 2025-26 rows: **99.9%** (gate: >= 95%; reference 99.9%).

| Metric | without odds | with odds | ppm baseline | reference (without / with) |
|---|---|---|---|---|
| Primary: 5-GW Spearman, active (n=13259) | 0.5889 | 0.5859 | 0.4531 | 0.5889 / 0.5859 |
| GW 2-10 slice, active 5-GW | 0.6097 | 0.6044 | 0.4970 | 0.6097 / 0.6044 |
| GK+DEF, active 5-GW | 0.5714 | 0.5669 | 0.4107 | 0.5714 / 0.5669 |
| Captain avg pts (top 60 by `own_pct_rank`) | 5.65 | 6.65 | 5.97 | 5.65 / 6.65 |
| Top-11 avg pts | 4.86 | 4.77 | 3.52 | 4.86 / 4.77 |

- Gate 3 (primary, with >= without - 0.005): PASS
- Gate 4 (captain, with >= without + 0.3): PASS
- Gate 5 (top-11, with >= without - 0.15): PASS

**Market-odds gate: PASS** (GW 2-10 and GK+DEF slices above are informational only — the ticket's own gate is the captain/top-11/primary checks, not those two slices).

## Informational — never gated

- 1-GW featured Spearman: 0.347 (n=10824, reference 0.346)
- Captain pick avg points (top 60 by `own_pct_rank` each GW, this model's top pick): 6.65 (reference ~6.5) — ppm baseline's captain on the same rows: 5.97
- Top-11 avg points (best XI by this model's predictions, players with a fixture that GW): 4.77 (reference ~4.7) — ppm baseline's top-11 on the same rows: 3.52
- Mean bias on active rows (pred - actual, 1-GW): +0.025 (should be under 0.10 in magnitude)

## Overall: PASS
