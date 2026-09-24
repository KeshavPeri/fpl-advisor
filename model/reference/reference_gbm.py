"""Reference implementation used for MODEL-DIAGNOSIS-2026-09-24.md §4.

Downloads vaastav/Fantasy-Premier-League (pinned), builds point-in-time features, runs a
2025-26 walk-forward with LightGBM, and prints the §4b/§4c tables.

    pip install lightgbm pandas numpy scipy pyarrow
    python reference_gbm.py            # ~4-5 min on a laptop CPU
"""
import os
import urllib.request

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

SHA = '9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88'
BASE = f'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/{SHA}/data'
SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']
TEST_SI = 3
CACHE = os.environ.get('DATA_DIR', 'cache')
os.makedirs(CACHE, exist_ok=True)


def fetch(season, name):
    path = os.path.join(CACHE, f'{season}_{name.replace("/", "_")}')
    if not os.path.exists(path):
        urllib.request.urlretrieve(f'{BASE}/{season}/{name}', path)
    return pd.read_csv(path, low_memory=False)


NUM = ['minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists', 'bps',
       'bonus', 'ict_index', 'threat', 'creativity', 'influence', 'saves', 'clean_sheets', 'goals_conceded',
       'starts', 'defensive_contribution', 'expected_goals_conceded', 'yellow_cards']


def load_player_gameweeks():
    frames = []
    for si, s in enumerate(SEASONS):
        d = fetch(s, 'gws/merged_gw.csv')
        raw = fetch(s, 'players_raw.csv')[['id', 'code']]
        d = d.merge(raw, left_on='element', right_on='id', how='left')
        d['si'] = si
        frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    d['position'] = d['position'].replace({'GKP': 'GK'})
    d = d[d['position'].isin(['GK', 'DEF', 'MID', 'FWD'])].copy()
    if 'defensive_contribution' not in d:
        d['defensive_contribution'] = 0.0
    for c in NUM:
        d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0.0)
    d['kickoff_time'] = pd.to_datetime(d['kickoff_time'], utc=True)
    d['gf'] = np.where(d['was_home'], d['team_h_score'], d['team_a_score'])
    d['ga'] = np.where(d['was_home'], d['team_a_score'], d['team_h_score'])

    # team-level rolling form per fixture (strictly earlier fixtures only)
    tf = d.groupby(['si', 'fixture', 'team'], as_index=False).agg(
        kickoff=('kickoff_time', 'first'), gf=('gf', 'first'), ga=('ga', 'first'), txg=('expected_goals', 'sum'))
    pair = tf[['si', 'fixture', 'team', 'txg']].rename(columns={'team': 'opp_name', 'txg': 'txga'})
    tf = tf.merge(pair, on=['si', 'fixture'])
    tf = tf[tf['team'] != tf['opp_name']].sort_values(['team', 'kickoff'])
    tcols = []
    for k in [5, 10, 20]:
        for c in ['gf', 'ga', 'txg', 'txga']:
            n = f't_{c}_{k}'
            tf[n] = tf.groupby('team')[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            tcols.append(n)
    opp = tf[['si', 'fixture', 'team'] + tcols].rename(columns={'team': 'opp_name', **{c: 'o' + c for c in tcols}})
    tf = tf.merge(opp, on=['si', 'fixture', 'opp_name'], how='left')
    fx = tcols + ['o' + c for c in tcols]
    d = d.merge(tf[['si', 'fixture', 'team'] + fx], on=['si', 'fixture', 'team'], how='left')

    # one row per player-gameweek (double gameweeks summed)
    d['m60'] = (d['minutes'] >= 60).astype(float)
    d['app'] = (d['minutes'] > 0).astype(float)
    agg = {c: 'sum' for c in NUM + ['m60', 'app']}
    agg.update({'position': 'first', 'team': 'first', 'value': 'first', 'selected': 'first',
                'transfers_balance': 'first', 'was_home': 'mean', 'fixture': 'count'})
    agg.update({c: 'mean' for c in fx})
    g = d.groupby(['code', 'si', 'GW'], as_index=False).agg(agg).rename(columns={'fixture': 'nfix'})
    return g.sort_values(['code', 'si', 'GW']).reset_index(drop=True), fx


def add_features(g, fx):
    base = ['minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists', 'bps',
            'bonus', 'ict_index', 'threat', 'creativity', 'saves', 'clean_sheets', 'goals_conceded', 'starts',
            'm60', 'app', 'defensive_contribution', 'expected_goals_conceded']
    grp = g.groupby('code')
    cols, feats = {}, []
    for k in [1, 3, 5, 10, 38]:          # rolling windows cross season boundaries, keyed on code
        for c in base:
            cols[f'r{k}_{c}'] = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            feats.append(f'r{k}_{c}')
    for k in [10, 38]:
        mins = grp['minutes'].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
        for c in ['expected_goals', 'expected_assists', 'total_points', 'bps', 'threat', 'creativity',
                  'defensive_contribution', 'saves']:
            s = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
            cols[f'p90_{k}_{c}'] = np.where(mins > 0, s / mins * 90, np.nan)
            feats.append(f'p90_{k}_{c}')
    gs = g.groupby(['code', 'si'])
    cols['sd_minutes'] = gs['minutes'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_apps'] = gs['app'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_pts'] = gs['total_points'].transform(lambda x: x.shift(1).cumsum())
    cols['rows_hist'] = grp.cumcount()
    feats += ['sd_minutes', 'sd_apps', 'rows_hist']
    cols['pos_i'] = g['position'].map({'GK': 0, 'DEF': 1, 'MID': 2, 'FWD': 3})
    cols['value'] = pd.to_numeric(g['value'], errors='coerce')                # tenths of a million
    sel = pd.to_numeric(g['selected'], errors='coerce')
    tb = pd.to_numeric(g['transfers_balance'], errors='coerce')
    # production version: use within-gameweek percentile ranks so vaastav and FPL API units agree
    cols['sel_log'] = np.log1p(sel)
    cols['tb'] = tb
    cols['tb_rel'] = tb / (sel + 1000)
    cols['y5'] = gs['total_points'].transform(lambda x: x[::-1].rolling(5, min_periods=5).sum()[::-1])
    g = pd.concat([g.drop(columns=['value']), pd.DataFrame(cols, index=g.index)], axis=1)
    market = ['sel_log', 'tb', 'tb_rel']
    ctx = ['pos_i', 'value', 'was_home', 'nfix']
    return g, feats + fx + ctx + market, feats + fx + ctx


PARAMS = dict(objective='regression', learning_rate=0.03, num_leaves=31, min_data_in_leaf=100,
              feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=0)


def walk_forward(g, feats, target, cutoffs=(1, 8, 15, 22, 29, 36)):
    out = pd.Series(np.nan, index=g.index)
    lag = 4 if target == 'y5' else 0
    for i, c in enumerate(cutoffs):
        hi = cutoffs[i + 1] if i + 1 < len(cutoffs) else 39
        tr = g[(g.si < TEST_SI) | ((g.si == TEST_SI) & (g.GW < c - lag))].dropna(subset=[target])
        te = g[(g.si == TEST_SI) & (g.GW >= c) & (g.GW < hi)]
        m = lgb.train(PARAMS, lgb.Dataset(tr[feats], tr[target]), num_boost_round=600)
        out.loc[te.index] = m.predict(te[feats])
    return out


def sp(df, a, b):
    ok = df[[a, b]].dropna()
    return spearmanr(ok[a], ok[b]).statistic


if __name__ == '__main__':
    g, fx = load_player_gameweeks()
    g, FEATS, FEATS_NOMKT = add_features(g, fx)
    g['pred1'] = walk_forward(g, FEATS, 'total_points')
    g['pred5'] = walk_forward(g, FEATS, 'y5')
    t = g[(g.si == TEST_SI) & (g.GW >= 2)].copy()
    t['ppm'] = (t.sd_pts / t.sd_apps).fillna(0)
    t['mpm'] = (t.sd_minutes / t.sd_apps).fillna(0)
    feat = t[(t.minutes > 0) & (t.sd_apps > 0)]
    act = t[t.r5_app > 0]
    f5 = feat[(feat.GW <= 34) & feat.y5.notna()]
    a5 = act[(act.GW <= 34) & act.y5.notna()]
    print('featured 1-GW  gbm %.3f  minutes %.3f  ppm %.3f  n=%d' % (sp(feat, 'pred1', 'total_points'), sp(feat, 'mpm', 'total_points'), sp(feat, 'ppm', 'total_points'), len(feat)))
    print('featured 5-GW  gbm5 %.3f gbm1 %.3f minutes %.3f ppm %.3f n=%d' % (sp(f5, 'pred5', 'y5'), sp(f5, 'pred1', 'y5'), sp(f5, 'mpm', 'y5'), sp(f5, 'ppm', 'y5'), len(f5)))
    print('active   1-GW  gbm %.3f  minutes %.3f  ppm %.3f  n=%d' % (sp(act, 'pred1', 'total_points'), sp(act, 'mpm', 'total_points'), sp(act, 'ppm', 'total_points'), len(act)))
    print('active   5-GW  gbm1 %.3f gbm5 %.3f minutes %.3f ppm %.3f n=%d' % (sp(a5, 'pred1', 'y5'), sp(a5, 'pred5', 'y5'), sp(a5, 'mpm', 'y5'), sp(a5, 'ppm', 'y5'), len(a5)))
    for pos in ['GK', 'DEF', 'MID', 'FWD']:
        q = a5[a5.position == pos]
        print('  active 5-GW %-3s gbm1 %.3f ppm %.3f minutes %.3f' % (pos, sp(q, 'pred1', 'y5'), sp(q, 'ppm', 'y5'), sp(q, 'mpm', 'y5')))
