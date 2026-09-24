## Why

Market odds are the best public signal for a single fixture (Štrumbelj & Šikonja 2010; FPL Pulse
uses bookmaker 1X2 as features). #261 built the converter and four seasons of historical odds, but
`gbm-v1` doesn't use them yet.

## Measured already (25 Sept, orchestrator, offline, same code as `main`)

2025-26 walk-forward, same folds as `evaluate.py`, 1-GW points model, with vs without four odds
features (`lambda_for, lambda_against, p_win, p_cs`), odds on 99.9% of single-fixture rows:

| | without odds | with odds | ppm baseline |
|---|---|---|---|
| Primary: 5-GW Spearman, active (13,259 rows) | 0.5889 | 0.5859 | 0.4531 |
| GW 2–10 slice, active 5-GW | 0.6097 | 0.6044 | 0.4970 |
| GK+DEF, active 5-GW | 0.5714 | 0.5669 | 0.4107 |
| **Captain avg pts, 60 most-owned, 37 GWs** | 5.65 | **6.65** | 5.97 |
| Top-11 avg pts | 4.86 | 4.77 | 3.52 |

Captain gain per GW: mean +1.00, bootstrap 90% interval +0.35 to +1.76, better in 10 GWs, worse in
3, same in 24. Odds barely move season-wide ranking, as the diagnosis predicted (§1c, §4e), but they
pick better captains, which is the call where the fixture matters most.

**Note:** without odds, the model's captain (5.65) is *worse* than points-per-appearance (5.97) on
the same rows. Odds fix that. This ticket's gate is therefore the captain check, not the
GW 2–10 / GK+DEF slices in diagnosis §8 R2-T1, which odds fail.

## Build

- `model/fpl_odds/history.py` — **contract bug from #261:** `season` comes out as `'2223'`, but
  history uses `'2022-23'`. Output `'2022-23'` style. Nothing joins without this fix. The
  orchestrator's first try matched 0 rows.
- `model/fpl_model/features.py` — when `odds` is given, join on **(season, home_code, away_code)**.
  Each ordered pairing happens once a season, so no dates are needed. Derive home/away from
  `team_code`, `opp_team_code`, `was_home` (≥0.5 = home). Add `lambda_for, lambda_against, p_win,
  p_cs = exp(-lambda_against)` from the row's own side. NaN when there are no odds or `nfix != 1`.
  When the same pairing has both `football-data` and `the-odds-api` rows, use `football-data`. Same
  code path for training and decision frames. Append the four names to `FEATURES` behind
  `USE_ODDS = True`, and keep all signatures unchanged.
- `model/fpl_model/sources.py` — only if the join needs a helper there. Keep `load_history`'s
  signature.
- `model/fpl_model/evaluate.py` — pass `load_odds_history()` in. Print with/without odds side by
  side for: the primary gate, GW 2–10, GK+DEF, captain and top-11. **Also print the ppm baseline's
  captain and top-11 on the same rows** (missing today). Keep every existing gate.

## Offline gate — computed by you

1. Liveness: print odds coverage on single-fixture rows in the test season. **Fail if under 95%.**
   Identical with/without numbers are a FAIL.
2. Primary gate (the existing one) still passes with odds on.
3. Primary with odds ≥ primary without − 0.005 (measured −0.003).
4. Captain avg with odds ≥ captain without + 0.30 (measured +1.00).
5. Top-11 with odds ≥ top-11 without − 0.15 (measured −0.09).

If 3, 4 or 5 fails: set `USE_ODDS = False`, commit the report with the numbers, and stop. Do not tune.

## Definition of done — offline only

- `cd model && python -m pytest tests` passes, including new `tests/test_features_odds.py`: a
  single-fixture row gets its fixture's λ; a DGW row gets NaN; home/away sides are not swapped; the
  run-1 parity test still passes with odds given.
- `python -m fpl_model.evaluate` exits 0; `model/reports/eval-latest.md` and `model/README.md`
  updated (two lines on the odds result).

## Post-merge owner check (does not block this PR)

None. Live picks up odds automatically once the nightly-job ticket is also merged.

## Files

Edit: `model/fpl_odds/history.py`, `model/tests/test_fpl_odds_history.py` (season format),
`model/fpl_model/features.py`, `model/fpl_model/sources.py`, `model/fpl_model/evaluate.py`,
`model/reports/eval-latest.md`, `model/README.md`. New: `model/tests/test_features_odds.py`.
Do not touch `model/fpl_model/live.py` or anything in `.github/` (another ticket tonight).
