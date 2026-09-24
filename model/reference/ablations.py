"""Ablations and decision checks for MODEL-DIAGNOSIS-2026-09-24.md §1b, §4d, §4e, §4g.

    python ablations.py      # ~6-8 min; reuses reference_gbm.py and its download cache
"""
import lightgbm as lgb
import numpy as np
import pandas as pd

from reference_gbm import PARAMS, TEST_SI, add_features, load_player_gameweeks, sp, walk_forward


def folds(g, feats, target, cuts, single_season=False):
    out = pd.Series(np.nan, index=g.index)
    lag = 4 if target == 'y5' else 0
    for i, c in enumerate(cuts):
        hi = cuts[i + 1] if i + 1 < len(cuts) else 39
        cur = (g.si == TEST_SI) & (g.GW < c - lag)
        tr = g[cur if single_season else ((g.si < TEST_SI) | cur)].dropna(subset=[target])
        te = g[(g.si == TEST_SI) & (g.GW >= c) & (g.GW < hi)]
        m = lgb.train(PARAMS, lgb.Dataset(tr[feats], tr[target]), num_boost_round=600)
        out.loc[te.index] = m.predict(te[feats])
    return out


g, fx = load_player_gameweeks()
g, FEATS, FEATS_NOMKT = add_features(g, fx)

print('§4d one season vs four (cutoffs 23/26/29/32 as in ticket #214), featured population, GW 23-38')
for single in [False, True]:
    for target in ['total_points', 'y5']:
        p = folds(g, FEATS, target, (23, 26, 29, 32), single_season=single)
        t = g[(g.si == TEST_SI) & (g.GW >= 23) & (g.minutes > 0) & (g.sd_apps > 0)].copy()
        t['p'] = p
        t['mpm'] = t.sd_minutes / t.sd_apps
        if target == 'y5':
            t = t[(t.GW <= 34) & t.y5.notna()]
        print('  %-12s %-12s gbm %.3f  minutes baseline %.3f  n=%d' % (
            'single-season' if single else 'multi-season', target, sp(t, 'p', target), sp(t, 'mpm', target), len(t)))

print('§4e fixture features on/off (cutoffs 2/9/16/23/30)')
nofix = [f for f in FEATS if f not in fx]
for name, feats in [('with fixture features', FEATS), ('without', nofix)]:
    for target in ['total_points', 'y5']:
        t = g[(g.si == TEST_SI) & (g.GW >= 2)].copy()
        t['p'] = folds(g, feats, target, (2, 9, 16, 23, 30))
        act, fe = t[t.r5_app > 0], t[(t.minutes > 0) & (t.sd_apps > 0)]
        if target == 'y5':
            act, fe = act[(act.GW <= 34) & act.y5.notna()], fe[(fe.GW <= 34) & fe.y5.notna()]
        print('  %-22s %-12s active %.3f featured %.3f' % (name, target, sp(act, 'p', target), sp(fe, 'p', target)))

print('§1b and §4g captain checks (2025-26 walk-forward predictions)')
g['pred1'] = walk_forward(g, FEATS, 'total_points')
t = g[(g.si == TEST_SI) & (g.GW >= 2)].copy()
t['sel'] = pd.to_numeric(t['selected'], errors='coerce')
t['ppm'] = t.sd_pts / t.sd_apps
for r in ['pred1', 'ppm', 'value']:
    gaps, hits, caps, pool_caps = [], [], [], []
    for gw, x in t.groupby('GW'):
        xi = pd.concat([x[x.position == 'GK'].nlargest(1, 'sel'), x[x.position != 'GK'].nlargest(10, 'sel')]).dropna(subset=[r])
        if len(xi) == 11:
            cap = xi[r].idxmax()
            best_other = xi.drop(cap).total_points.max()
            gaps.append(xi.loc[cap, 'total_points'] - best_other)
            hits.append(xi.loc[cap, 'total_points'] > best_other)
            caps.append(xi.loc[cap, 'total_points'])
        pool = x.dropna(subset=['sel']).nlargest(60, 'sel').dropna(subset=[r])
        pool_caps.append(pool.nlargest(1, r).total_points.iloc[0])
    print('  %-6s XI: mean(captain - best other) %.2f/GW, first 4 GWs %d, hit rate %.0f%%, captain avg %.2f | '
          'top-60 pool captain avg %.2f' % (r, np.mean(gaps), np.sum(gaps[:4]), 100 * np.mean(hits), np.mean(caps), np.mean(pool_caps)))
