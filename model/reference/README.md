# 2026-09-24 GBM experiments

Evidence behind `../../MODEL-DIAGNOSIS-2026-09-24.md` §1b and §4. Public data only, no Supabase.

```
cd ~/Projects/app-factory/experiments/2026-09-24-gbm && python3 -m venv .venv && .venv/bin/pip install lightgbm pandas numpy scipy pyarrow && .venv/bin/python reference_gbm.py && .venv/bin/python ablations.py && .venv/bin/python fpl_ep_benchmark.py
```

- `reference_gbm.py` — loads vaastav 2022-23..2025-26 (pinned SHA), builds point-in-time features,
  2025-26 walk-forward LightGBM, prints the §4b/§4c figures. ~3 min.
- `ablations.py` — one season vs four (§4d), fixture features on/off (§4e), captain checks (§1b, §4g). ~6 min.
- `fpl_ep_benchmark.py` — FPL's own `ep_next` as a pre-deadline benchmark from FPL-Core-Insights (§4f).

Expected output (24 Sept 2026 run):
```
featured 1-GW  gbm 0.346  minutes 0.264  ppm 0.258  n=10824
featured 5-GW  gbm5 0.431 gbm1 0.411 minutes 0.376 ppm 0.388 n=9613
active   1-GW  gbm 0.571  minutes 0.351  ppm 0.350  n=14882
active   5-GW  gbm1 0.595 gbm5 0.590 minutes 0.442 ppm 0.452 n=13259
multi-season y5  gbm 0.465 | single-season y5 gbm 0.416 | minutes baseline 0.423
prev_ep_next vs this GW 0.279
```
Downloads are cached in `./cache` (set `DATA_DIR` to move it). Not part of the app; the production
version is specified in the diagnosis file §6–§8.
