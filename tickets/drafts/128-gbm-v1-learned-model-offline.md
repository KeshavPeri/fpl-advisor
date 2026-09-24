## Why

`baseline-v1` barely beats a naive "minutes per appearance" ranker over five gameweeks (0.409 vs 0.407,
featured players — `docs/projection-model-backlog.md`, close-out #220/#222). The learned model #214 was
parked because it was trained on one season. On public data, the same kind of model trained on three
prior seasons plus in-season clearly wins (`docs/model-diagnosis-2026-09-24.md` §4d).

Source: OpenFPL (arXiv 2508.09992 — four seasons, windows of 1/3/5/10/38 matches, gradient-boosted
trees) and FPL Pulse (five seasons, ownership and transfer features).

**Measured already, offline, on 2025-26 walk-forward** (`model/reference/reference_gbm.py`, re-run
24 Sept): 5-GW Spearman on active players, zeros included — GBM 0.595 vs points-per-appearance 0.452
vs minutes-per-appearance 0.442, 13,259 rows.

This ticket builds that model as production code under `model/`. **Nothing live changes.**

## Build

Port `model/reference/reference_gbm.py` into the modules below, with the exact signatures in
`docs/model-diagnosis-2026-09-24.md` §8 "Contracts frozen in run 1". Copy those signatures and the
column lists into `model/README.md` — later tickets import them and must not change them.

- `sources.py` — `load_history(through)`. Completed seasons from vaastav at the pinned SHA
  `9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88` (2022-23 to 2025-26: `gws/merged_gw.csv`,
  `players_raw.csv` for `id → code`, `teams.csv` for team `code`). Current season from
  FPL-Core-Insights `data/2026-2027/By%20Gameweek/GW{n}/player_gameweek_stats.csv` (per-GW, not
  cumulative; `id → player_code` via `data/2026-2027/players.csv`; `now_cost` is decimal millions,
  ×10 to tenths). Core's `By Gameweek/GW{n}/fixtures.csv` holds cup games too — keep only
  `tournament == 'prem'`; `home_team`/`away_team` there are team codes. Cache under `model/.cache/`.
- `features.py` — the reference features, with these changes: ownership and net transfers as
  **percentile ranks within the gameweek** (`own_pct_rank`, `transfers_rank`); team features keyed on
  team `code`, not name. Run 1 accepts `odds` and ignores it.
- `train.py` — `fit`, `predict`, `contributions` (top 5 via `pred_contrib=True`). A points model and
  a minutes model. Reference params, fixed seeds.
- `availability.py` — Python copy of `availabilityFactor` in `src/lib/projection/minutes.ts`
  (lines 122–129), with the same cases as `minutes.test.ts`.
- `evaluate.py` — `python -m fpl_model.evaluate` writes `model/reports/eval-latest.md` and exits
  non-zero if any gate below fails. Rank players at gameweek g by the 1-GW points prediction, as the
  reference does.

Key is always player `code`, never element id.

## Offline gate — computed by you, before marking done

2025-26 walk-forward, retrain at GW 1, 8, 15, 22, 29, 36; g ≤ 34; pooled Spearman.

1. **Liveness first:** report row counts per population and per retrain. Fail if any fold has zero
   test rows or predictions are constant.
2. **Primary:** active players (≥1 appearance in previous 5 GW rows), 5-GW total with zeros.
   Reference 0.595. **Pass if ≥ 0.55 AND ≥ ppm baseline + 0.08 AND every position ≥ its ppm
   baseline + 0.05** (reference ppm by position: GK 0.318, DEF 0.409, MID 0.480, FWD 0.500).
3. **Secondary:** featured players, 5-GW. Reference 0.411 vs minutes baseline 0.376. **Pass if
   ≥ minutes baseline + 0.02.**
4. Print, never gate: 1-GW featured (ref 0.346); captain and top-11 average points from the 60
   most-owned each GW (ref ≈6.5 and ≈4.7 — see `model/reference/ablations.py`); mean bias on active
   rows (should be under 0.10).

**If a gate is missed: stop and report the numbers. Do not tune.**

## Definition of done — offline only

- `cd model && pip install -r requirements.txt && python -m pytest tests` passes.
- Leakage tests: changing GW g's actuals leaves GW g features unchanged; a synthetic player whose
  points jump only at g+1 has no feature change at g; no training row is in the test season at or
  after the cutoff.
- Parity test: for 2025-26 GW 20, `build_decision_frame` rows equal `build_training_frame` rows for
  the same players, column for column.
- `python -m fpl_model.evaluate` exits 0; `model/reports/eval-latest.md` committed with every figure.
- If LightGBM won't install, use scikit-learn `HistGradientBoostingRegressor` and say so. If vaastav
  or Core can't be fetched, stop and report.
- `npm run build` and `npm run lint` still clean.

## Post-merge owner check (does not block this PR)

None. Nothing live changes.

## Out of scope

Odds features, the nightly job, Supabase, anything under `src/` or `scripts/`.

## Files

New: `model/requirements.txt` (lightgbm>=4.3, pandas>=2.2, numpy, scipy, pyarrow, requests, pytest),
`model/README.md`, `model/fpl_model/{__init__,sources,features,train,evaluate,availability}.py`,
`model/tests/{test_features_leakage,test_parity,test_availability,test_evaluate_smoke}.py`,
`model/reports/eval-latest.md`. Edit: `.gitignore` (add `model/.cache/`, `.venv/`, `__pycache__/`),
`feature-list.md` (items 30 and 31 → in progress). Do not edit `model/reference/` or
`model/data/`.
