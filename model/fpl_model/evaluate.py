"""`python -m fpl_model.evaluate` — the offline gate (docs/model-diagnosis-2026-09-24.md §7, §8).

2025-26 walk-forward: retrain at GW 1, 8, 15, 22, 29, 36, evaluate each fold on the gameweeks up
to the next retrain (or GW38 after the last one). Writes `model/reports/eval-latest.md` and exits
non-zero if any gate fails. This module never tunes: a missed gate is reported, not chased.

Points model target: `total_points` (1-GW). Minutes model target: `minutes`. A separate `y5`
target (sum of the next 5 gameweeks' actual points, computed once on the full frame — never a
leakage risk, since it is the evaluation *label*, not a model input) is used only to score the
5-GW horizon: production sums five 1-GW predictions rather than training a dedicated 5-GW model
(docs/model-diagnosis-2026-09-24.md §6b: "the solver needs a number per gameweek anyway").

Ticket #264: market-odds features. `full` is built once WITH `fpl_odds.history.load_odds_history()`
joined in (this is the production frame — `FEATURES` includes the four odds columns whenever
`fpl_model.features.USE_ODDS` is True, which it is by default). The odds ablation below trains a
second 1-GW model on the SAME frame but with the four odds columns excluded from its feature list,
so "with odds" vs "without odds" is a same-data, same-code comparison — the only thing that
differs is whether the model was allowed to see `lambda_for`/`lambda_against`/`p_win`/`p_cs`.
"""
from __future__ import annotations

import datetime as dt
import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from fpl_model import train as train_module
from fpl_model.features import FEATURES, SEASON_INDEX, build_training_frame
from fpl_model.sources import load_history
from fpl_odds.history import load_odds_history

TEST_SEASON = '2025-26'
TEST_SI = SEASON_INDEX[TEST_SEASON]
CUTOFFS = (1, 8, 15, 22, 29, 36)
LAST_GW_5GW = 34  # primary/secondary 5-GW metrics: g <= 34 (docs/model-diagnosis-2026-09-24.md §7)

# Ticket #264: the four market-odds feature names, kept in sync with fpl_model.features'
# _ODDS_FEATURES (not imported directly since it's a private module constant — this list is the
# public contract the ticket itself names: "lambda_for, lambda_against, p_win, p_cs").
ODDS_FEATURES = ['lambda_for', 'lambda_against', 'p_win', 'p_cs']
FEATURES_NO_ODDS = [f for f in FEATURES if f not in ODDS_FEATURES]

ODDS_COVERAGE_FLOOR = 0.95
ODDS_PRIMARY_TOLERANCE = 0.005   # gate 3: primary with odds >= primary without - this
ODDS_CAPTAIN_MIN_GAIN = 0.30     # gate 4: captain with odds >= captain without + this
ODDS_TOP11_TOLERANCE = 0.15      # gate 5: top-11 with odds >= top-11 without - this

# Reference figures from the 24 Sept 2026 run (docs/model-diagnosis-2026-09-24.md §4b/§4c/§4g),
# printed for comparison only. Gates below use THIS run's own baselines, never these constants.
REFERENCE = {
    'active_5gw_gbm': 0.595, 'active_5gw_ppm': 0.452, 'active_5gw_minutes': 0.442,
    'featured_5gw_gbm': 0.411, 'featured_5gw_minutes': 0.376,
    'featured_1gw_gbm': 0.346,
    'ppm_by_position': {'GK': 0.318, 'DEF': 0.409, 'MID': 0.480, 'FWD': 0.500},
    'captain_avg': 6.5, 'top11_avg': 4.7,
    # Ticket #264 offline gate measurement (25 Sept 2026), see the ticket body — printed for
    # comparison only, same rule as every other REFERENCE entry.
    'odds_primary_no_odds': 0.5889, 'odds_primary_with_odds': 0.5859,
    'odds_gw2_10_no_odds': 0.6097, 'odds_gw2_10_with_odds': 0.6044,
    'odds_gkdef_no_odds': 0.5714, 'odds_gkdef_with_odds': 0.5669,
    'odds_captain_no_odds': 5.65, 'odds_captain_with_odds': 6.65,
    'odds_top11_no_odds': 4.86, 'odds_top11_with_odds': 4.77,
    'odds_coverage': 0.999,
}

REPORT_PATH = os.path.join(os.path.dirname(__file__), '..', 'reports', 'eval-latest.md')


def _sp(df: pd.DataFrame, a: str, b: str) -> float:
    ok = df[[a, b]].dropna()
    if len(ok) < 2:
        return float('nan')
    return float(spearmanr(ok[a], ok[b]).statistic)


def _load_full_frame(odds: pd.DataFrame) -> pd.DataFrame:
    """All completed rows across the four vaastav seasons, with point-in-time features. Passing
    ('2026-27', 1) to `load_history` returns every vaastav season in full and no Core rows
    (range(1, 1) is empty) — i.e. exactly the pinned 2022-23..2025-26 dataset in one call."""
    history = load_history(('2026-27', 1))
    return build_training_frame(history, odds)


def _add_y5(full: pd.DataFrame) -> pd.DataFrame:
    full = full.copy()
    full['y5'] = (
        full.groupby(['code', 'si'])['total_points']
        .transform(lambda x: x[::-1].rolling(5, min_periods=5).sum()[::-1])
    )
    return full


def _fit_with_features(frame: pd.DataFrame, target: str, feats: list[str], seed: int = 0) -> train_module.Model:
    """Same params/backend/seed as `train.fit`, parameterised by an explicit feature list instead
    of the module-level `FEATURES` constant. Used only for the ticket #264 with/without-odds
    ablation below — production training always goes through `train.fit` (feats=None here), which
    uses `FEATURES` unchanged, exactly as before this ticket. `train.predict` already takes its
    feature list from `model.feats` rather than the global constant, so it is reused as-is for
    both variants."""
    train_rows = frame.dropna(subset=[target])
    x = train_module._numeric(train_rows, feats)
    y = pd.to_numeric(train_rows[target], errors='coerce')
    if train_module.BACKEND == 'lightgbm':
        params = dict(train_module.PARAMS, seed=seed)
        booster = train_module.lgb.train(
            params, train_module.lgb.Dataset(x, y), num_boost_round=train_module.NUM_BOOST_ROUND)
    else:
        from sklearn.ensemble import HistGradientBoostingRegressor
        booster = HistGradientBoostingRegressor(
            learning_rate=0.03, max_leaf_nodes=31, min_samples_leaf=100,
            l2_regularization=1.0, max_iter=train_module.NUM_BOOST_ROUND, random_state=seed,
        )
        booster.fit(x, y)
    return train_module.Model(booster, feats)


def _walk_forward(full: pd.DataFrame, target: str, feats: list[str] | None = None) -> tuple[pd.Series, list[dict]]:
    """`feats=None` (the default) trains through `train.fit`, i.e. the production model over the
    full `FEATURES` list. `feats=FEATURES_NO_ODDS` runs the ticket #264 without-odds ablation on
    the identical train/test split — see `_fit_with_features`."""
    out = pd.Series(np.nan, index=full.index)
    lag = 4 if target == 'y5' else 0
    folds = []
    for i, c in enumerate(CUTOFFS):
        hi = CUTOFFS[i + 1] if i + 1 < len(CUTOFFS) else 39
        train_rows = full[
            (full['si'] < TEST_SI) | ((full['si'] == TEST_SI) & (full['gw'] < c - lag))
        ].dropna(subset=[target])
        test_rows = full[(full['si'] == TEST_SI) & (full['gw'] >= c) & (full['gw'] < hi)]
        if feats is None:
            model = train_module.fit(train_rows, target)
        else:
            model = _fit_with_features(train_rows, target, feats)
        preds = train_module.predict(model, test_rows) if len(test_rows) else np.array([])
        out.loc[test_rows.index] = preds
        folds.append({
            'cutoff': c, 'through_gw': hi - 1, 'n_train': len(train_rows), 'n_test': len(test_rows),
            'pred_std': float(np.std(preds)) if len(preds) else 0.0,
        })
    return out, folds


def _liveness_failures(folds: list[dict], label: str) -> list[str]:
    problems = []
    for f in folds:
        if f['n_test'] == 0:
            problems.append(f'{label}: fold starting GW{f["cutoff"]} has zero test rows')
        elif f['pred_std'] == 0.0:
            problems.append(f'{label}: fold starting GW{f["cutoff"]} has constant predictions')
    return problems


def _top11_and_captain(t: pd.DataFrame, pred_col: str) -> tuple[float, float]:
    """Informational decision checks (docs/model-diagnosis-2026-09-24.md §7, §4g): captain pick
    from the 60 most-owned players each GW (by `own_pct_rank`, the source-independent ownership
    signal — see model/README.md); top-11 = the best XI by this ranker's own predictions (1 GK +
    10 outfield) among players with a fixture that GW."""
    caps, tops = [], []
    for _, x in t.groupby('gw'):
        pool = x.dropna(subset=['own_pct_rank', pred_col]).nlargest(60, 'own_pct_rank')
        if len(pool):
            caps.append(pool.nlargest(1, pred_col)['total_points'].iloc[0])
        fielded = x[(x['nfix'] > 0)].dropna(subset=[pred_col])
        xi = pd.concat([
            fielded[fielded['position'] == 'GK'].nlargest(1, pred_col),
            fielded[fielded['position'] != 'GK'].nlargest(10, pred_col),
        ])
        if len(xi) == 11:
            tops.append(xi['total_points'].mean())
    return (float(np.mean(caps)) if caps else float('nan'),
            float(np.mean(tops)) if tops else float('nan'))


def run() -> tuple[str, bool]:
    print(f'backend: {train_module.BACKEND}')
    odds_history = load_odds_history()
    full = _load_full_frame(odds_history)
    full = _add_y5(full)

    full['pred1'], folds1 = _walk_forward(full, 'total_points')
    full['pred5'], folds5 = _walk_forward(full, 'y5')
    full['pred1_no_odds'], folds1_no_odds = _walk_forward(full, 'total_points', feats=FEATURES_NO_ODDS)

    t = full[(full['si'] == TEST_SI) & (full['gw'] >= 2)].copy()
    t['ppm'] = (t['sd_pts'] / t['sd_apps']).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    t['mpm'] = (t['sd_minutes'] / t['sd_apps']).replace([np.inf, -np.inf], np.nan).fillna(0.0)

    featured = t[(t['minutes'] > 0) & (t['sd_apps'] > 0)]
    active = t[t['r5_app'] > 0]
    featured5 = featured[(featured['gw'] <= LAST_GW_5GW) & featured['y5'].notna()]
    active5 = active[(active['gw'] <= LAST_GW_5GW) & active['y5'].notna()]

    liveness = (
        _liveness_failures(folds1, '1-GW model')
        + _liveness_failures(folds5, '5-GW model')
        + _liveness_failures(folds1_no_odds, '1-GW model (no-odds ablation)')
    )

    # --- Ticket #264: odds coverage liveness check --------------------------------------------
    single_fixture_test = t[t['nfix'] == 1]
    odds_coverage = (
        float(single_fixture_test['lambda_for'].notna().mean()) if len(single_fixture_test) else 0.0
    )
    if odds_coverage < ODDS_COVERAGE_FLOOR:
        liveness.append(
            f'odds coverage on single-fixture {TEST_SEASON} rows is {odds_coverage:.1%}, '
            f'below the {ODDS_COVERAGE_FLOOR:.0%} floor'
        )

    # --- Primary gate: active population, 5-GW, pooled -------------------------------------
    active_5gw_gbm = _sp(active5, 'pred1', 'y5')
    active_5gw_gbm_no_odds = _sp(active5, 'pred1_no_odds', 'y5')
    active_5gw_ppm = _sp(active5, 'ppm', 'y5')
    active_5gw_minutes = _sp(active5, 'mpm', 'y5')
    by_position = {}
    for pos in ['GK', 'DEF', 'MID', 'FWD']:
        q = active5[active5['position'] == pos]
        by_position[pos] = {'gbm': _sp(q, 'pred1', 'y5'), 'ppm': _sp(q, 'ppm', 'y5'), 'n': len(q)}

    primary_pass = (
        active_5gw_gbm >= 0.55
        and active_5gw_gbm >= active_5gw_ppm + 0.08
        and all(by_position[p]['gbm'] >= by_position[p]['ppm'] + 0.05 for p in by_position)
    )

    # --- Secondary gate: featured population, 5-GW -------------------------------------------
    featured_5gw_gbm1 = _sp(featured5, 'pred1', 'y5')
    featured_5gw_gbm5 = _sp(featured5, 'pred5', 'y5')
    featured_5gw_minutes = _sp(featured5, 'mpm', 'y5')
    secondary_pass = featured_5gw_gbm1 >= featured_5gw_minutes + 0.02

    # --- Informational only, never gated ------------------------------------------------------
    featured_1gw_gbm = _sp(featured, 'pred1', 'total_points')
    captain_avg, top11_avg = _top11_and_captain(t, 'pred1')
    captain_avg_no_odds, top11_avg_no_odds = _top11_and_captain(t, 'pred1_no_odds')
    captain_avg_ppm, top11_avg_ppm = _top11_and_captain(t, 'ppm')
    mean_bias = float((active['pred1'] - active['total_points']).dropna().mean())

    # --- Ticket #264: GW 2-10 and GK+DEF slices, printed for information only (the ticket's own
    # gate is the captain check below, not these two — see the ticket body) -------------------
    gw2_10 = active5[(active5['gw'] >= 2) & (active5['gw'] <= 10)]
    odds_gw2_10_with = _sp(gw2_10, 'pred1', 'y5')
    odds_gw2_10_no_odds = _sp(gw2_10, 'pred1_no_odds', 'y5')
    odds_gw2_10_ppm = _sp(gw2_10, 'ppm', 'y5')

    gkdef = active5[active5['position'].isin(['GK', 'DEF'])]
    odds_gkdef_with = _sp(gkdef, 'pred1', 'y5')
    odds_gkdef_no_odds = _sp(gkdef, 'pred1_no_odds', 'y5')
    odds_gkdef_ppm = _sp(gkdef, 'ppm', 'y5')

    # --- Ticket #264 offline gate (checked against THIS run's own with/without numbers, never
    # the REFERENCE constants) -------------------------------------------------------------------
    odds_primary_gate_pass = active_5gw_gbm >= active_5gw_gbm_no_odds - ODDS_PRIMARY_TOLERANCE
    odds_captain_gate_pass = captain_avg >= captain_avg_no_odds + ODDS_CAPTAIN_MIN_GAIN
    odds_top11_gate_pass = top11_avg >= top11_avg_no_odds - ODDS_TOP11_TOLERANCE
    odds_gate_pass = odds_primary_gate_pass and odds_captain_gate_pass and odds_top11_gate_pass

    if abs(active_5gw_gbm - active_5gw_gbm_no_odds) < 1e-9 and abs(captain_avg - captain_avg_no_odds) < 1e-9:
        liveness.append(
            'with-odds and without-odds numbers are identical on both the primary metric and the '
            'captain check -- the odds join is very likely producing no matches'
        )

    liveness_pass = len(liveness) == 0
    overall_pass = liveness_pass and primary_pass and secondary_pass and odds_gate_pass

    report = _render_report(
        folds1=folds1, folds5=folds5, folds1_no_odds=folds1_no_odds, liveness=liveness,
        active_5gw_gbm=active_5gw_gbm, active_5gw_ppm=active_5gw_ppm,
        active_5gw_minutes=active_5gw_minutes, by_position=by_position, n_active5=len(active5),
        primary_pass=primary_pass,
        featured_5gw_gbm1=featured_5gw_gbm1, featured_5gw_gbm5=featured_5gw_gbm5,
        featured_5gw_minutes=featured_5gw_minutes, n_featured5=len(featured5),
        secondary_pass=secondary_pass,
        featured_1gw_gbm=featured_1gw_gbm, n_featured=len(featured),
        captain_avg=captain_avg, top11_avg=top11_avg, mean_bias=mean_bias,
        odds_coverage=odds_coverage,
        active_5gw_gbm_no_odds=active_5gw_gbm_no_odds,
        odds_gw2_10_with=odds_gw2_10_with, odds_gw2_10_no_odds=odds_gw2_10_no_odds,
        odds_gw2_10_ppm=odds_gw2_10_ppm,
        odds_gkdef_with=odds_gkdef_with, odds_gkdef_no_odds=odds_gkdef_no_odds,
        odds_gkdef_ppm=odds_gkdef_ppm,
        captain_avg_no_odds=captain_avg_no_odds, captain_avg_ppm=captain_avg_ppm,
        top11_avg_no_odds=top11_avg_no_odds, top11_avg_ppm=top11_avg_ppm,
        odds_primary_gate_pass=odds_primary_gate_pass, odds_captain_gate_pass=odds_captain_gate_pass,
        odds_top11_gate_pass=odds_top11_gate_pass, odds_gate_pass=odds_gate_pass,
        overall_pass=overall_pass,
    )
    return report, overall_pass


def _render_report(**k) -> str:
    lines = []
    lines.append('# gbm-v1 offline evaluation')
    lines.append('')
    lines.append(f'Generated {dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")} '
                 f'· backend `{train_module.BACKEND}` · docs/model-diagnosis-2026-09-24.md §7/§8.')
    lines.append('')
    lines.append('## Liveness')
    lines.append('')
    lines.append('| Model | Fold from GW | Through GW | n_train | n_test | pred std |')
    lines.append('|---|---|---|---|---|---|')
    fold_groups = [('1-GW (points)', k['folds1']), ('5-GW (y5)', k['folds5'])]
    if k.get('folds1_no_odds'):
        fold_groups.append(('1-GW (points, no-odds ablation)', k['folds1_no_odds']))
    for label, folds in fold_groups:
        for f in folds:
            lines.append(f"| {label} | {f['cutoff']} | {f['through_gw']} | {f['n_train']} | "
                         f"{f['n_test']} | {f['pred_std']:.4f} |")
    if k['liveness']:
        lines.append('')
        lines.append('**LIVENESS FAILURES:**')
        for p in k['liveness']:
            lines.append(f'- {p}')
    else:
        lines.append('')
        lines.append('No liveness failures: every fold has test rows and non-constant predictions.')

    lines.append('')
    lines.append('## Primary gate — active population, 5-GW, pooled, g <= 34')
    lines.append('')
    lines.append(f"n = {k['n_active5']}. Reference (24 Sept 2026 run): "
                 f"GBM {REFERENCE['active_5gw_gbm']}, ppm {REFERENCE['active_5gw_ppm']}, "
                 f"minutes {REFERENCE['active_5gw_minutes']}.")
    lines.append('')
    lines.append(f"- GBM: **{k['active_5gw_gbm']:.3f}**")
    lines.append(f"- ppm baseline: {k['active_5gw_ppm']:.3f}")
    lines.append(f"- minutes baseline: {k['active_5gw_minutes']:.3f}")
    lines.append(f"- Gate: GBM >= 0.55 AND GBM >= ppm + 0.08 "
                 f"({k['active_5gw_ppm'] + 0.08:.3f}) AND every position >= its ppm + 0.05")
    lines.append('')
    lines.append('| Position | n | GBM | ppm baseline | ppm + 0.05 | reference ppm |')
    lines.append('|---|---|---|---|---|---|')
    for pos, d in k['by_position'].items():
        lines.append(f"| {pos} | {d['n']} | {d['gbm']:.3f} | {d['ppm']:.3f} | "
                     f"{d['ppm'] + 0.05:.3f} | {REFERENCE['ppm_by_position'][pos]} |")
    lines.append('')
    lines.append(f"**Primary gate: {'PASS' if k['primary_pass'] else 'FAIL'}**")

    lines.append('')
    lines.append('## Secondary gate — featured population, 5-GW')
    lines.append('')
    lines.append(f"n = {k['n_featured5']}. Reference: GBM (5-GW model) "
                 f"{REFERENCE['featured_5gw_gbm']}, minutes {REFERENCE['featured_5gw_minutes']}.")
    lines.append('')
    lines.append(f"- GBM (1-GW model, summed in production): {k['featured_5gw_gbm1']:.3f}")
    lines.append(f"- GBM (dedicated 5-GW model, evaluation reference only): {k['featured_5gw_gbm5']:.3f}")
    lines.append(f"- minutes baseline: {k['featured_5gw_minutes']:.3f}")
    lines.append(f"- Gate: GBM (1-GW model) >= minutes + 0.02 "
                 f"({k['featured_5gw_minutes'] + 0.02:.3f})")
    lines.append('')
    lines.append(f"**Secondary gate: {'PASS' if k['secondary_pass'] else 'FAIL'}**")

    lines.append('')
    lines.append('## Market-odds features (ticket #264)')
    lines.append('')
    lines.append(f"Odds coverage on single-fixture {TEST_SEASON} rows: "
                 f"**{k.get('odds_coverage', float('nan')):.1%}** "
                 f"(gate: >= {ODDS_COVERAGE_FLOOR:.0%}; reference {REFERENCE['odds_coverage']:.1%}).")
    lines.append('')
    lines.append('| Metric | without odds | with odds | ppm baseline | reference (without / with) |')
    lines.append('|---|---|---|---|---|')
    lines.append(f"| Primary: 5-GW Spearman, active (n={k['n_active5']}) | "
                 f"{k.get('active_5gw_gbm_no_odds', float('nan')):.4f} | {k['active_5gw_gbm']:.4f} | "
                 f"{k['active_5gw_ppm']:.4f} | "
                 f"{REFERENCE['odds_primary_no_odds']} / {REFERENCE['odds_primary_with_odds']} |")
    lines.append(f"| GW 2-10 slice, active 5-GW | "
                 f"{k.get('odds_gw2_10_no_odds', float('nan')):.4f} | "
                 f"{k.get('odds_gw2_10_with', float('nan')):.4f} | "
                 f"{k.get('odds_gw2_10_ppm', float('nan')):.4f} | "
                 f"{REFERENCE['odds_gw2_10_no_odds']} / {REFERENCE['odds_gw2_10_with_odds']} |")
    lines.append(f"| GK+DEF, active 5-GW | "
                 f"{k.get('odds_gkdef_no_odds', float('nan')):.4f} | "
                 f"{k.get('odds_gkdef_with', float('nan')):.4f} | "
                 f"{k.get('odds_gkdef_ppm', float('nan')):.4f} | "
                 f"{REFERENCE['odds_gkdef_no_odds']} / {REFERENCE['odds_gkdef_with_odds']} |")
    lines.append(f"| Captain avg pts (top 60 by `own_pct_rank`) | "
                 f"{k.get('captain_avg_no_odds', float('nan')):.2f} | {k['captain_avg']:.2f} | "
                 f"{k.get('captain_avg_ppm', float('nan')):.2f} | "
                 f"{REFERENCE['odds_captain_no_odds']} / {REFERENCE['odds_captain_with_odds']} |")
    lines.append(f"| Top-11 avg pts | "
                 f"{k.get('top11_avg_no_odds', float('nan')):.2f} | {k['top11_avg']:.2f} | "
                 f"{k.get('top11_avg_ppm', float('nan')):.2f} | "
                 f"{REFERENCE['odds_top11_no_odds']} / {REFERENCE['odds_top11_with_odds']} |")
    lines.append('')
    lines.append(f"- Gate 3 (primary, with >= without - {ODDS_PRIMARY_TOLERANCE}): "
                 f"{'PASS' if k.get('odds_primary_gate_pass', False) else 'FAIL'}")
    lines.append(f"- Gate 4 (captain, with >= without + {ODDS_CAPTAIN_MIN_GAIN}): "
                 f"{'PASS' if k.get('odds_captain_gate_pass', False) else 'FAIL'}")
    lines.append(f"- Gate 5 (top-11, with >= without - {ODDS_TOP11_TOLERANCE}): "
                 f"{'PASS' if k.get('odds_top11_gate_pass', False) else 'FAIL'}")
    lines.append('')
    lines.append(f"**Market-odds gate: {'PASS' if k.get('odds_gate_pass', False) else 'FAIL'}** "
                 f"(GW 2-10 and GK+DEF slices above are informational only — the ticket's own gate "
                 f"is the captain/top-11/primary checks, not those two slices).")

    lines.append('')
    lines.append('## Informational — never gated')
    lines.append('')
    lines.append(f"- 1-GW featured Spearman: {k['featured_1gw_gbm']:.3f} "
                 f"(n={k['n_featured']}, reference {REFERENCE['featured_1gw_gbm']})")
    lines.append(f"- Captain pick avg points (top 60 by `own_pct_rank` each GW, this model's "
                 f"top pick): {k['captain_avg']:.2f} (reference ~{REFERENCE['captain_avg']}) "
                 f"— ppm baseline's captain on the same rows: {k.get('captain_avg_ppm', float('nan')):.2f}")
    lines.append(f"- Top-11 avg points (best XI by this model's predictions, players with a "
                 f"fixture that GW): {k['top11_avg']:.2f} (reference ~{REFERENCE['top11_avg']}) "
                 f"— ppm baseline's top-11 on the same rows: {k.get('top11_avg_ppm', float('nan')):.2f}")
    lines.append(f"- Mean bias on active rows (pred - actual, 1-GW): {k['mean_bias']:+.3f} "
                 f"(should be under 0.10 in magnitude)")

    lines.append('')
    lines.append(f"## Overall: {'PASS' if k['overall_pass'] else 'FAIL'}")
    lines.append('')
    return '\n'.join(lines)


def main() -> int:
    report, ok = run()
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, 'w') as f:
        f.write(report)
    print(report)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
