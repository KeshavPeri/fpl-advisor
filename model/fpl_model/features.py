"""Point-in-time feature engineering — ONE function used by training and by live decisions
(docs/model-diagnosis-2026-09-24.md §6a, §8). Ported from model/reference/reference_gbm.py's
`add_features`, with two changes made by ticket #258:

  - ownership and net transfers arrive as within-gameweek percentile ranks (`own_pct_rank`,
    `transfers_rank`, computed by `sources.load_history`) instead of raw counts, so vaastav
    (integer counts) and the FPL API / Core Insights (percentages) agree on the same scale.
  - team and opponent rolling features are keyed on team `code`, never team name. The frozen
    `history` schema carries only `gf`/`ga` (no team-level xG aggregate), so the reference
    script's rolling team-xG features (`t_txg_k`, `o_txg_k`) are dropped — §4e's ablation found
    rolling team form worth <0.001 Spearman, so this is a deliberate, cheap simplification, not
    a silent loss (documented in model/README.md).

Every feature for a row is computed from rows strictly earlier than that row for the same
player (`shift(1)` before any `rolling`/`cumsum`), or from that row's own already-known context
(price, home flag, opponent, fixture count, ownership/transfer rank) — never from that row's own
performance. `build_decision_frame` reuses the exact same rolling code by appending synthetic
"decision" rows (context known, performance NaN) to `history` before computing features, which is
what makes the run-1 parity test (build_decision_frame == build_training_frame at GW20) hold by
construction rather than by coincidence.

Signatures below are FROZEN (docs/model-diagnosis-2026-09-24.md §8) — later tickets only import.

Ticket #264 (run 2): market-odds features. When `odds` (the `fpl_odds.history.load_odds_history()`
contract frame) is given and `USE_ODDS` is True, four columns are joined per row — `lambda_for`,
`lambda_against`, `p_win`, `p_cs = exp(-lambda_against)`, computed from the row's OWN side of its
own fixture. The join key is (season, home_code, away_code): each ordered pairing happens once a
season in the Premier League, so no dates are needed. Home/away are derived from the row's own
`team_code`/`opp_team_code`/`was_home` (>=0.5 counts as home), never read off the odds frame.
NaN when there is no matching fixture in `odds`, or when the row is not a single fixture
(`nfix != 1` — a blank or double gameweek row has no single (home_code, away_code) to join on).
When the same (season, home_code, away_code) pairing has rows from more than one odds source,
`football-data` wins (matches the priority `history.py`'s own docstring already assumes for the
live path). Same join, same code path, for `build_training_frame` and `build_decision_frame` —
no second implementation to drift.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

SEASON_ORDER = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27']
SEASON_INDEX = {s: i for i, s in enumerate(SEASON_ORDER)}

# Ticket #264: kept True after the offline gate passed (see model/reports/eval-latest.md and
# model/README.md) -- captain avg points, the gate that matters most for this feature, improved
# well past the +0.30 threshold. Flip to False (and re-run the gate) if a later run regresses it.
USE_ODDS = True

_ODDS_FEATURES = ['lambda_for', 'lambda_against', 'p_win', 'p_cs']
# Source priority when the same (season, home_code, away_code) pairing appears more than once in
# `odds` -- football-data (the historical CSVs, ticket #261) wins over the-odds-api (the live
# feed, a later ticket). Any other/unknown source sorts after both.
_ODDS_SOURCE_PRIORITY = {'football-data': 0, 'the-odds-api': 1}

# Base per-gameweek stats rolled over several windows (docs/model-diagnosis-2026-09-24.md §4a).
_STAT_COLS = [
    'minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists',
    'bps', 'bonus', 'ict_index', 'threat', 'creativity', 'saves', 'clean_sheets', 'goals_conceded',
    'starts', 'defensive_contribution', 'expected_goals_conceded',
]
_WINDOWS = [1, 3, 5, 10, 38]
_P90_WINDOWS = [10, 38]
_P90_STATS = ['expected_goals', 'expected_assists', 'total_points', 'bps', 'threat', 'creativity',
              'defensive_contribution', 'saves']
_TEAM_STATS = ['gf', 'ga']
_TEAM_WINDOWS = [5, 10, 20]

_CONTEXT = ['pos_i', 'value', 'was_home', 'nfix']
_MARKET = ['own_pct_rank', 'transfers_rank']

_POSITION_CODE = {'GK': 0, 'DEF': 1, 'MID': 2, 'FWD': 3}


def _prep(g: pd.DataFrame) -> pd.DataFrame:
    g = g.copy()
    g['si'] = g['season'].map(SEASON_INDEX)
    if g['si'].isna().any():
        unknown = sorted(g.loc[g['si'].isna(), 'season'].unique())
        raise ValueError(f'unknown season(s) {unknown}; extend SEASON_ORDER in features.py')
    g['m60'] = (g['minutes'] >= 60).astype(float)
    g['app'] = (g['minutes'] > 0).astype(float)
    return g.sort_values(['code', 'si', 'gw']).reset_index(drop=True)


def _team_rolling(g: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Rolling goals for/against, keyed on team `code`, joined onto each row by its own team and
    by its opponent. One row per (season, gw, team_code) drives the rolling table; every player
    on that team-fixture shares the same value, by construction."""
    tf = (
        g.groupby(['si', 'gw', 'team_code'], as_index=False)
        .agg(gf=('gf', 'first'), ga=('ga', 'first'), opp=('opp_team_code', 'first'))
        .sort_values(['team_code', 'si', 'gw'])
    )
    tcols = []
    for k in _TEAM_WINDOWS:
        for c in ['gf', 'ga']:
            n = f't_{c}_{k}'
            tf[n] = tf.groupby('team_code')[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            tcols.append(n)
    own = tf[['si', 'gw', 'team_code'] + tcols]
    opp_side = tf[['si', 'gw', 'team_code'] + tcols].rename(
        columns={'team_code': 'opp_team_code', **{c: 'o' + c for c in tcols}})
    g = g.merge(own, on=['si', 'gw', 'team_code'], how='left')
    g = g.merge(opp_side, on=['si', 'gw', 'opp_team_code'], how='left')
    return g, tcols + ['o' + c for c in tcols]


def _rolling_features(g: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    grp = g.groupby('code')
    cols: dict[str, pd.Series] = {}
    feats: list[str] = []

    base = _STAT_COLS + ['m60', 'app']
    for k in _WINDOWS:
        for c in base:
            name = f'r{k}_{c}'
            cols[name] = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            feats.append(name)

    for k in _P90_WINDOWS:
        mins = grp['minutes'].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
        for c in _P90_STATS:
            s = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
            name = f'p90_{k}_{c}'
            cols[name] = np.where(mins > 0, s / mins * 90, np.nan)
            feats.append(name)

    gs = g.groupby(['code', 'si'])
    cols['sd_minutes'] = gs['minutes'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_apps'] = gs['app'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_pts'] = gs['total_points'].transform(lambda x: x.shift(1).cumsum())
    cols['rows_hist'] = grp.cumcount()
    feats += ['sd_minutes', 'sd_apps', 'rows_hist']

    g = pd.concat([g, pd.DataFrame(cols, index=g.index)], axis=1)
    g, team_feats = _team_rolling(g)
    feats += team_feats

    g['pos_i'] = g['position'].map(_POSITION_CODE)
    g['value'] = pd.to_numeric(g['value'], errors='coerce')

    return g, feats + _CONTEXT + _MARKET


def _team_feature_names() -> list[str]:
    tcols = [f't_{c}_{k}' for k in _TEAM_WINDOWS for c in ['gf', 'ga']]
    return tcols + ['o' + c for c in tcols]


# The ordered model input columns (docs/model-diagnosis-2026-09-24.md §8). Computed statically —
# every window and column here is fixed, so this does not depend on ever having run on data.
FEATURES: list[str] = (
    [f'r{k}_{c}' for k in _WINDOWS for c in _STAT_COLS + ['m60', 'app']]
    + [f'p90_{k}_{c}' for k in _P90_WINDOWS for c in _P90_STATS]
    + ['sd_minutes', 'sd_apps', 'rows_hist']
    + _team_feature_names()
    + _CONTEXT
    + _MARKET
    + (_ODDS_FEATURES if USE_ODDS else [])
)


def _add_odds_features(g: pd.DataFrame, odds: pd.DataFrame | None) -> pd.DataFrame:
    """Join `lambda_for`, `lambda_against`, `p_win`, `p_cs` onto `g` from `odds` (the
    `fpl_odds.history.load_odds_history()` contract frame). See the module docstring for the
    join key and the home/away and NaN rules. `g` must already carry `season`, `team_code`,
    `opp_team_code`, `was_home`, `nfix` (i.e. this runs after `_prep`, before the assert against
    `FEATURES`)."""
    g = g.copy()
    if odds is None or odds.empty:
        for col in _ODDS_FEATURES:
            g[col] = np.nan
        return g

    odds_slim = odds[['season', 'home_code', 'away_code', 'p_home', 'p_away', 'lambda_home', 'lambda_away', 'source']].copy()
    odds_slim['_priority'] = odds_slim['source'].map(_ODDS_SOURCE_PRIORITY).fillna(99)
    odds_slim = (
        odds_slim.sort_values('_priority')
        .drop_duplicates(subset=['season', 'home_code', 'away_code'], keep='first')
        .drop(columns=['_priority', 'source'])
    )
    # Codes are small integers but may carry NaN on either side (blank-GW rows have no
    # opp_team_code); cast both sides to float so the merge key type always matches.
    for col in ('home_code', 'away_code'):
        odds_slim[col] = pd.to_numeric(odds_slim[col], errors='coerce')

    is_home = pd.to_numeric(g['was_home'], errors='coerce') >= 0.5
    team_code = pd.to_numeric(g['team_code'], errors='coerce')
    opp_team_code = pd.to_numeric(g['opp_team_code'], errors='coerce')
    join_home_code = np.where(is_home, team_code, opp_team_code)
    join_away_code = np.where(is_home, opp_team_code, team_code)

    key = pd.DataFrame({
        'season': g['season'].to_numpy(),
        'home_code': join_home_code,
        'away_code': join_away_code,
    }, index=g.index)
    merged = key.merge(odds_slim, on=['season', 'home_code', 'away_code'], how='left')
    merged.index = g.index

    lambda_for = np.where(is_home, merged['lambda_home'], merged['lambda_away'])
    lambda_against = np.where(is_home, merged['lambda_away'], merged['lambda_home'])
    p_win = np.where(is_home, merged['p_home'], merged['p_away'])

    single_fixture = pd.to_numeric(g['nfix'], errors='coerce') == 1
    g['lambda_for'] = np.where(single_fixture, lambda_for, np.nan)
    g['lambda_against'] = np.where(single_fixture, lambda_against, np.nan)
    g['p_win'] = np.where(single_fixture, p_win, np.nan)
    g['p_cs'] = np.exp(-g['lambda_against'].astype(float))  # NaN propagates when lambda_against is NaN
    return g


def _finalize(g: pd.DataFrame, odds: pd.DataFrame | None = None) -> tuple[pd.DataFrame, list[str]]:
    g, feats = _rolling_features(_prep(g))
    if USE_ODDS:
        g = _add_odds_features(g, odds)
        feats = feats + _ODDS_FEATURES
    assert feats == FEATURES, 'feature list drifted from the frozen FEATURES constant'
    return g, feats


def build_training_frame(history: pd.DataFrame,
                          odds: pd.DataFrame | None = None,
                          snapshots: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per (code, season, gw) already in `history`, with point-in-time features and the
    row's own actual `total_points`/`minutes` attached as training targets.

    `snapshots` is still accepted and ignored (per run 1 — docs/model-diagnosis-2026-09-24.md §8:
    the price/ownership/transfer-rank inputs it would carry are already on `history` per row for a
    completed gameweek). `odds` is used from run 2 (ticket #264) onwards — see the module
    docstring for the join.
    """
    g, _ = _finalize(history, odds)
    return g


def build_decision_frame(history: pd.DataFrame,
                          decision: tuple[str, int],
                          target_fixtures: pd.DataFrame,
                          odds: pd.DataFrame | None = None,
                          snapshot: pd.DataFrame | None = None) -> pd.DataFrame:
    """Features for the gameweek about to be decided (`decision = (season, gw)`), for every
    player named in `target_fixtures` (one row per player code x target GW x fixture; DGW players
    have two rows, aggregated below exactly as a historical double-gameweek row would be).

    `history` must already be filtered to rows strictly before `decision` (i.e. the output of
    `sources.load_history(decision)`). The rolling/point-in-time columns are computed by
    appending one synthetic row per player (context known from `target_fixtures`/`snapshot`,
    performance NaN) to `history` and running the identical rolling code as
    `build_training_frame` — never a separate implementation — which is what the run-1 parity
    test checks.
    """
    season, gw = decision
    tf = target_fixtures.copy()
    tf['season'] = season
    tf['gw'] = gw

    agg = {'was_home': 'mean'}
    if 'opp_team_code' in tf:
        agg['opp_team_code'] = 'last'
    if 'team_code' in tf:
        agg['team_code'] = 'first'
    dec = (
        tf.groupby('code', as_index=False)
        .agg(**{k: (k, v) for k, v in agg.items()}, nfix=('code', 'count'))
    )
    dec['season'] = season
    dec['gw'] = gw

    if snapshot is not None and not snapshot.empty:
        snap = snapshot.rename(columns={'now_cost': 'value'})
        cols = [c for c in ['code', 'value', 'own_pct_rank', 'transfers_rank', 'selected_by_percent',
                             'transfers_in_event', 'transfers_out_event'] if c in snap.columns]
        dec = dec.merge(snap[cols], on='code', how='left')
    for col in ('value', 'own_pct_rank', 'transfers_rank', 'position'):
        if col not in dec.columns:
            dec[col] = np.nan
    snapshot_cols = set(snapshot.columns) if snapshot is not None else set()
    if 'own_pct_rank' not in snapshot_cols and 'selected_by_percent' in dec.columns:
        dec['own_pct_rank'] = dec['selected_by_percent'].rank(pct=True, method='average').fillna(0.5)
    if 'transfers_rank' not in snapshot_cols and {'transfers_in_event', 'transfers_out_event'}.issubset(dec.columns):
        net = dec['transfers_in_event'] - dec['transfers_out_event']
        dec['transfers_rank'] = net.rank(pct=True, method='average').fillna(0.5)

    if 'position' in tf.columns:
        pos_by_code = tf.drop_duplicates('code').set_index('code')['position']
        dec['position'] = dec['code'].map(pos_by_code).combine_first(dec['position'])
    if dec['position'].isna().any():
        pos_by_code = history.drop_duplicates('code', keep='last').set_index('code')['position']
        dec['position'] = dec['position'].fillna(dec['code'].map(pos_by_code))

    for stat_col in _STAT_COLS + ['m60', 'app']:
        dec[stat_col] = np.nan

    combined = pd.concat([history, dec], ignore_index=True, sort=False)
    g, _ = _finalize(combined, odds)
    out = g[(g['season'] == season) & (g['gw'] == gw) & (g['code'].isin(dec['code']))]
    return out.reset_index(drop=True)
