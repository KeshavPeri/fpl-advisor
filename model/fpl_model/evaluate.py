"""`python -m fpl_model.evaluate` — the offline gate (docs/model-diagnosis-2026-09-24.md §7, §8).

2025-26 walk-forward: retrain at GW 1, 8, 15, 22, 29, 36, evaluate each fold on the gameweeks up
to the next retrain (or GW38 after the last one). Writes `model/reports/eval-latest.md` and exits
non-zero if any gate fails. This module never tunes: a missed gate is reported, not chased.

Points model target: `total_points` (1-GW). Minutes model target: `minutes`. A separate `y5`
target (sum of the next 5 gameweeks' actual points, computed once on the full frame — never a
leakage risk, since it is the evaluation *label*, not a model input) is used only to score the
5-GW horizon: production sums five 1-GW predictions rather than training a dedicated 5-GW model
(docs/model-diagnosis-2026-09-24.md §6b: "the solver needs a number per gameweek anyway").
"""
from __future__ import annotations

import datetime as dt
import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from fpl_model import train as train_module
from fpl_model.features import SEASON_INDEX, build_training_frame
from fpl_model.sources import load_history

TEST_SEASON = '2025-26'
TEST_SI = SEASON_INDEX[TEST_SEASON]
CUTOFFS = (1, 8, 15, 22, 29, 36)
LAST_GW_5GW = 34  # primary/secondary 5-GW metrics: g <= 34 (docs/model-diagnosis-2026-09-24.md §7)

# Reference figures from the 24 Sept 2026 run (docs/model-diagnosis-2026-09-24.md §4b/§4c/§4g),
# printed for comparison only. Gates below use THIS run's own baselines, never these constants.
REFERENCE = {
    'active_5gw_gbm': 0.595, 'active_5gw_ppm': 0.452, 'active_5gw_minutes': 0.442,
    'featured_5gw_gbm': 0.411, 'featured_5gw_minutes': 0.376,
    'featured_1gw_gbm': 0.346,
    'ppm_by_position': {'GK': 0.318, 'DEF': 0.409, 'MID': 0.480, 'FWD': 0.500},
    'captain_avg': 6.5, 'top11_avg': 4.7,
}

REPORT_PATH = os.path.join(os.path.dirname(__file__), '..', 'reports', 'eval-latest.md')


def _sp(df: pd.DataFrame, a: str, b: str) -> float:
    ok = df[[a, b]].dropna()
    if len(ok) < 2:
        return float('nan')
    return float(spearmanr(ok[a], ok[b]).statistic)


def _load_full_frame() -> pd.DataFrame:
    """All completed rows across the four vaastav seasons, with point-in-time features. Passing
    ('2026-27', 1) to `load_history` returns every vaastav season in full and no Core rows
    (range(1, 1) is empty) — i.e. exactly the pinned 2022-23..2025-26 dataset in one call."""
    history = load_history(('2026-27', 1))
    return build_training_frame(history)


def _add_y5(full: pd.DataFrame) -> pd.DataFrame:
    full = full.copy()
    full['y5'] = (
        full.groupby(['code', 'si'])['total_points']
        .transform(lambda x: x[::-1].rolling(5, min_periods=5).sum()[::-1])
    )
    return full


def _walk_forward(full: pd.DataFrame, target: str) -> tuple[pd.Series, list[dict]]:
    out = pd.Series(np.nan, index=full.index)
    lag = 4 if target == 'y5' else 0
    folds = []
    for i, c in enumerate(CUTOFFS):
        hi = CUTOFFS[i + 1] if i + 1 < len(CUTOFFS) else 39
        train_rows = full[
            (full['si'] < TEST_SI) | ((full['si'] == TEST_SI) & (full['gw'] < c - lag))
        ].dropna(subset=[target])
        test_rows = full[(full['si'] == TEST_SI) & (full['gw'] >= c) & (full['gw'] < hi)]
        model = train_module.fit(train_rows, target)
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
    full = _load_full_frame()
    full = _add_y5(full)

    full['pred1'], folds1 = _walk_forward(full, 'total_points')
    full['pred5'], folds5 = _walk_forward(full, 'y5')

    t = full[(full['si'] == TEST_SI) & (full['gw'] >= 2)].copy()
    t['ppm'] = (t['sd_pts'] / t['sd_apps']).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    t['mpm'] = (t['sd_minutes'] / t['sd_apps']).replace([np.inf, -np.inf], np.nan).fillna(0.0)

    featured = t[(t['minutes'] > 0) & (t['sd_apps'] > 0)]
    active = t[t['r5_app'] > 0]
    featured5 = featured[(featured['gw'] <= LAST_GW_5GW) & featured['y5'].notna()]
    active5 = active[(active['gw'] <= LAST_GW_5GW) & active['y5'].notna()]

    liveness = _liveness_failures(folds1, '1-GW model') + _liveness_failures(folds5, '5-GW model')

    # --- Primary gate: active population, 5-GW, pooled -------------------------------------
    active_5gw_gbm = _sp(active5, 'pred1', 'y5')
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
    mean_bias = float((active['pred1'] - active['total_points']).dropna().mean())

    liveness_pass = len(liveness) == 0
    overall_pass = liveness_pass and primary_pass and secondary_pass

    report = _render_report(
        folds1=folds1, folds5=folds5, liveness=liveness,
        active_5gw_gbm=active_5gw_gbm, active_5gw_ppm=active_5gw_ppm,
        active_5gw_minutes=active_5gw_minutes, by_position=by_position, n_active5=len(active5),
        primary_pass=primary_pass,
        featured_5gw_gbm1=featured_5gw_gbm1, featured_5gw_gbm5=featured_5gw_gbm5,
        featured_5gw_minutes=featured_5gw_minutes, n_featured5=len(featured5),
        secondary_pass=secondary_pass,
        featured_1gw_gbm=featured_1gw_gbm, n_featured=len(featured),
        captain_avg=captain_avg, top11_avg=top11_avg, mean_bias=mean_bias,
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
    for label, folds in [('1-GW (points)', k['folds1']), ('5-GW (y5)', k['folds5'])]:
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
    lines.append('## Informational — never gated')
    lines.append('')
    lines.append(f"- 1-GW featured Spearman: {k['featured_1gw_gbm']:.3f} "
                 f"(n={k['n_featured']}, reference {REFERENCE['featured_1gw_gbm']})")
    lines.append(f"- Captain pick avg points (top 60 by `own_pct_rank` each GW, this model's "
                 f"top pick): {k['captain_avg']:.2f} (reference ~{REFERENCE['captain_avg']})")
    lines.append(f"- Top-11 avg points (best XI by this model's predictions, players with a "
                 f"fixture that GW): {k['top11_avg']:.2f} (reference ~{REFERENCE['top11_avg']})")
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
