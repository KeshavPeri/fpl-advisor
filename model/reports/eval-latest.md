# gbm-v1 offline evaluation

Generated 2026-09-24T15:31:15+00:00 · backend `lightgbm` · docs/model-diagnosis-2026-09-24.md §7/§8.

## Liveness

| Model | Fold from GW | Through GW | n_train | n_test | pred std |
|---|---|---|---|---|---|
| 1-GW (points) | 1 | 7 | 80618 | 5073 | 1.2895 |
| 1-GW (points) | 8 | 14 | 85691 | 5258 | 1.4871 |
| 1-GW (points) | 15 | 21 | 90949 | 5429 | 1.4655 |
| 1-GW (points) | 22 | 28 | 96378 | 5684 | 1.4915 |
| 1-GW (points) | 29 | 35 | 102062 | 5375 | 1.5262 |
| 1-GW (points) | 36 | 38 | 107437 | 2519 | 1.5681 |
| 5-GW (y5) | 1 | 7 | 70966 | 5073 | 5.9853 |
| 5-GW (y5) | 8 | 14 | 73073 | 5258 | 6.6834 |
| 5-GW (y5) | 15 | 21 | 78277 | 5429 | 6.7967 |
| 5-GW (y5) | 22 | 28 | 83586 | 5684 | 6.6857 |
| 5-GW (y5) | 29 | 35 | 89139 | 5375 | 6.4094 |
| 5-GW (y5) | 36 | 38 | 94716 | 2519 | 7.0055 |

No liveness failures: every fold has test rows and non-constant predictions.

## Primary gate — active population, 5-GW, pooled, g <= 34

n = 13259. Reference (24 Sept 2026 run): GBM 0.595, ppm 0.452, minutes 0.442.

- GBM: **0.589**
- ppm baseline: 0.453
- minutes baseline: 0.443
- Gate: GBM >= 0.55 AND GBM >= ppm + 0.08 (0.533) AND every position >= its ppm + 0.05

| Position | n | GBM | ppm baseline | ppm + 0.05 | reference ppm |
|---|---|---|---|---|---|
| GK | 819 | 0.561 | 0.318 | 0.368 | 0.318 |
| DEF | 4699 | 0.558 | 0.409 | 0.459 | 0.409 |
| MID | 6188 | 0.600 | 0.480 | 0.530 | 0.48 |
| FWD | 1553 | 0.616 | 0.509 | 0.559 | 0.5 |

**Primary gate: PASS**

## Secondary gate — featured population, 5-GW

n = 9613. Reference: GBM (5-GW model) 0.411, minutes 0.376.

- GBM (1-GW model, summed in production): 0.408
- GBM (dedicated 5-GW model, evaluation reference only): 0.426
- minutes baseline: 0.376
- Gate: GBM (1-GW model) >= minutes + 0.02 (0.396)

**Secondary gate: PASS**

## Informational — never gated

- 1-GW featured Spearman: 0.341 (n=10824, reference 0.346)
- Captain pick avg points (top 60 by `own_pct_rank` each GW, this model's top pick): 5.65 (reference ~6.5)
- Top-11 avg points (best XI by this model's predictions, players with a fixture that GW): 4.86 (reference ~4.7)
- Mean bias on active rows (pred - actual, 1-GW): +0.028 (should be under 0.10 in magnitude)

## Overall: PASS
