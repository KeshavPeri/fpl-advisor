"""Data sources for gbm-v1: completed seasons from vaastav (pinned SHA), current season from
FPL-Core-Insights. Everything is cached under model/.cache/ (gitignored) so a second run of
tests or evaluate.py does not re-download.

Ported from model/reference/reference_gbm.py (docs/model-diagnosis-2026-09-24.md §4a/§8), split
out as its own module per the frozen `load_history` signature.

Public entry point: `load_history(through)`. Everything else is an implementation detail.
"""
from __future__ import annotations

import os
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Pinned sources
# ---------------------------------------------------------------------------

VAASTAV_SHA = '9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88'
VAASTAV_BASE = f'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/{VAASTAV_SHA}/data'
VAASTAV_SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']

CORE_REPO = 'olbauday/FPL-Core-Insights'
CORE_DEFAULT_REF = 'main'

# The order that defines "strictly before" across seasons, and the current live season served
# from Core once it stops appearing in vaastav's pinned snapshot.
SEASON_ORDER = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27']
SEASON_INDEX = {s: i for i, s in enumerate(SEASON_ORDER)}

# The frozen `load_history` output schema (docs/model-diagnosis-2026-09-24.md §8).
HISTORY_COLUMNS = [
    'code', 'season', 'gw', 'team_code', 'position', 'minutes', 'total_points', 'goals_scored',
    'assists', 'expected_goals', 'expected_assists', 'expected_goals_conceded', 'bps', 'bonus',
    'ict_index', 'threat', 'creativity', 'influence', 'saves', 'clean_sheets', 'goals_conceded',
    'starts', 'defensive_contribution', 'value', 'own_pct_rank', 'transfers_rank', 'nfix',
    'was_home', 'opp_team_code', 'gf', 'ga',
]

CACHE_DIR = os.environ.get('FPL_MODEL_CACHE', os.path.join(os.path.dirname(__file__), '..', '.cache'))

_NUM = [
    'minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists',
    'bps', 'bonus', 'ict_index', 'threat', 'creativity', 'influence', 'saves', 'clean_sheets',
    'goals_conceded', 'starts', 'defensive_contribution', 'expected_goals_conceded',
]

_POSITION_MAP_VAASTAV = {'GKP': 'GK', 'GK': 'GK', 'DEF': 'DEF', 'MID': 'MID', 'FWD': 'FWD'}
_POSITION_MAP_CORE = {
    'Goalkeeper': 'GK', 'Defender': 'DEF', 'Midfielder': 'MID', 'Forward': 'FWD',
    'GK': 'GK', 'DEF': 'DEF', 'MID': 'MID', 'FWD': 'FWD',
}


class SourceUnavailableError(RuntimeError):
    """Raised when a required public data source cannot be fetched. Never caught silently —
    the ticket's instruction is "if vaastav or Core can't be fetched, stop and report."."""


def _fetch(url: str, cache_name: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        return path
    try:
        urllib.request.urlretrieve(url, path)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        if os.path.exists(path):
            os.remove(path)
        raise SourceUnavailableError(f'could not fetch {url}: {exc}') from exc
    return path


def _read_csv(url: str, cache_name: str) -> pd.DataFrame:
    return pd.read_csv(_fetch(url, cache_name), low_memory=False)


# ---------------------------------------------------------------------------
# vaastav (completed seasons)
# ---------------------------------------------------------------------------

def _load_vaastav_season(season: str) -> pd.DataFrame:
    base = f'{VAASTAV_BASE}/{season}'
    d = _read_csv(f'{base}/gws/merged_gw.csv', f'vaastav_{season}_merged_gw.csv')
    raw = _read_csv(f'{base}/players_raw.csv', f'vaastav_{season}_players_raw.csv')[
        ['id', 'code', 'team', 'element_type']
    ].rename(columns={'team': 'player_team_id'})
    teams = _read_csv(f'{base}/teams.csv', f'vaastav_{season}_teams.csv')[['id', 'code']]
    team_code_by_id = dict(zip(teams['id'], teams['code']))

    d = d.merge(raw, left_on='element', right_on='id', how='left')
    d = d.dropna(subset=['code']).copy()
    d['code'] = d['code'].astype(int)
    d['position'] = d['position'].replace(_POSITION_MAP_VAASTAV)
    d = d[d['position'].isin(['GK', 'DEF', 'MID', 'FWD'])].copy()
    if 'defensive_contribution' not in d:
        d['defensive_contribution'] = 0.0
    for c in _NUM:
        d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0.0)

    d['team_code'] = d['player_team_id'].map(team_code_by_id)
    d['opp_team_code_row'] = d['opponent_team'].map(team_code_by_id)
    d['gf_row'] = np.where(d['was_home'], d['team_h_score'], d['team_a_score'])
    d['ga_row'] = np.where(d['was_home'], d['team_a_score'], d['team_h_score'])

    agg = {c: 'sum' for c in _NUM}
    agg.update({
        'position': 'first', 'team_code': 'first', 'value': 'first', 'selected': 'first',
        'transfers_balance': 'first', 'was_home': 'mean', 'fixture': 'count',
        'opp_team_code_row': 'last', 'gf_row': 'sum', 'ga_row': 'sum',
    })
    g = (
        d.groupby(['code', 'GW'], as_index=False)
        .agg(agg)
        .rename(columns={
            'fixture': 'nfix', 'opp_team_code_row': 'opp_team_code', 'gf_row': 'gf', 'ga_row': 'ga',
        })
    )
    g['season'] = season
    g['gw'] = g['GW'].astype(int)
    g['own_raw'] = pd.to_numeric(g['selected'], errors='coerce')
    g['transfers_raw'] = pd.to_numeric(g['transfers_balance'], errors='coerce')
    return g


# ---------------------------------------------------------------------------
# FPL-Core-Insights (current season)
# ---------------------------------------------------------------------------

def _core_folder(season: str) -> str:
    a, b = season.split('-')
    return f'20{a[-2:]}-20{b}' if len(a) == 4 else f'{a}-20{b}'


def _core_base(ref: str) -> str:
    return f'https://raw.githubusercontent.com/{CORE_REPO}/{ref}/data'


def _load_core_players(season: str, ref: str) -> pd.DataFrame:
    folder = _core_folder(season)
    return _read_csv(f'{_core_base(ref)}/{folder}/players.csv', f'core_{season}_{ref}_players.csv')


def _load_core_gw(season: str, gw: int, ref: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    folder = _core_folder(season)
    stats = _read_csv(
        f'{_core_base(ref)}/{folder}/By%20Gameweek/GW{gw}/player_gameweek_stats.csv',
        f'core_{season}_{ref}_gw{gw}_stats.csv',
    )
    fixtures = _read_csv(
        f'{_core_base(ref)}/{folder}/By%20Gameweek/GW{gw}/fixtures.csv',
        f'core_{season}_{ref}_gw{gw}_fixtures.csv',
    )
    return stats, fixtures


def _load_core_season(season: str, through_gw: int, ref: str = CORE_DEFAULT_REF) -> pd.DataFrame:
    """Completed gameweeks 1..through_gw-1 of the current season from FPL-Core-Insights."""
    players = _load_core_players(season, ref)
    players = players.rename(columns={'player_id': 'id'})[['id', 'player_code', 'team_code', 'position']]
    players['position'] = players['position'].map(_POSITION_MAP_CORE)

    rows = []
    for gw in range(1, through_gw):
        stats, fixtures = _load_core_gw(season, gw, ref)
        stats = stats.merge(players, on='id', how='left')
        stats = stats.dropna(subset=['player_code']).copy()
        stats = stats[stats['position'].isin(['GK', 'DEF', 'MID', 'FWD'])].copy()
        for c in _NUM:
            if c not in stats:
                stats[c] = 0.0
            stats[c] = pd.to_numeric(stats[c], errors='coerce').fillna(0.0)

        prem = fixtures[fixtures['tournament'] == 'prem'].copy()
        home = prem[['home_team', 'away_team', 'home_score', 'away_score']].rename(
            columns={'home_team': 'team_code', 'away_team': 'opp_team_code',
                     'home_score': 'gf_f', 'away_score': 'ga_f'})
        home['was_home_f'] = 1.0
        away = prem[['away_team', 'home_team', 'away_score', 'home_score']].rename(
            columns={'away_team': 'team_code', 'home_team': 'opp_team_code',
                     'away_score': 'gf_f', 'home_score': 'ga_f'})
        away['was_home_f'] = 0.0
        by_team = pd.concat([home, away], ignore_index=True)
        team_gw = by_team.groupby('team_code', as_index=False).agg(
            nfix=('opp_team_code', 'count'), gf=('gf_f', 'sum'), ga=('ga_f', 'sum'),
            was_home=('was_home_f', 'mean'), opp_team_code=('opp_team_code', 'last'),
        )

        stats = stats.merge(team_gw, on='team_code', how='left')
        stats['nfix'] = stats['nfix'].fillna(0).astype(int)
        stats['was_home'] = stats['was_home'].fillna(0.5)
        stats['gf'] = stats['gf'].fillna(0.0)
        stats['ga'] = stats['ga'].fillna(0.0)

        stats['value'] = pd.to_numeric(stats['now_cost'], errors='coerce') * 10
        stats['own_raw'] = pd.to_numeric(stats['selected_by_percent'], errors='coerce')
        tin = pd.to_numeric(stats['transfers_in_event'], errors='coerce').fillna(0.0)
        tout = pd.to_numeric(stats['transfers_out_event'], errors='coerce').fillna(0.0)
        stats['transfers_raw'] = tin - tout
        stats['gw'] = gw
        stats['season'] = season
        stats = stats.rename(columns={'player_code': 'code'})
        rows.append(stats[['code', 'season', 'gw', 'team_code', 'position', 'value', 'own_raw',
                            'transfers_raw', 'nfix', 'was_home', 'opp_team_code', 'gf', 'ga'] + _NUM])
    if not rows:
        return pd.DataFrame(columns=HISTORY_COLUMNS[:-2] + ['own_raw', 'transfers_raw'])
    return pd.concat(rows, ignore_index=True)


# ---------------------------------------------------------------------------
# Percentile ranks (source-independent ownership/transfers, §6b)
# ---------------------------------------------------------------------------

def _add_percentile_ranks(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['own_pct_rank'] = df.groupby(['season', 'gw'])['own_raw'].rank(pct=True, method='average')
    df['transfers_rank'] = df.groupby(['season', 'gw'])['transfers_raw'].rank(pct=True, method='average')
    df['own_pct_rank'] = df['own_pct_rank'].fillna(0.5)
    df['transfers_rank'] = df['transfers_rank'].fillna(0.5)
    return df


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def load_history(through: tuple[str, int], core_ref: str = CORE_DEFAULT_REF) -> pd.DataFrame:
    """All completed player-gameweeks strictly before `through = (season, gw)`.

    Key is always player `code`, never element id. Rows for a season strictly before `through`'s
    season are included in full; rows for `through`'s own season are included for gw < through[1].
    A season not covered by the vaastav pinned snapshot (the live/current season) is read from
    FPL-Core-Insights instead.
    """
    season, gw = through
    if season not in SEASON_INDEX:
        raise ValueError(f'unknown season {season!r}; extend SEASON_ORDER in sources.py')
    cutoff_idx = SEASON_INDEX[season]

    frames = []
    for s in VAASTAV_SEASONS:
        idx = SEASON_INDEX[s]
        if idx < cutoff_idx:
            frames.append(_load_vaastav_season(s))
        elif s == season:
            full = _load_vaastav_season(s)
            frames.append(full[full['gw'] < gw])

    if season not in VAASTAV_SEASONS:
        # Current/live season: not yet in the pinned vaastav snapshot.
        frames.append(_load_core_season(season, through_gw=gw, ref=core_ref))

    # An empty frame (e.g. the current season with no completed gameweeks yet) has no real dtypes
    # to offer; concatenating it in would upcast otherwise-numeric columns to object. Drop it.
    frames = [f for f in frames if len(f) > 0]

    if not frames:
        history = pd.DataFrame(columns=HISTORY_COLUMNS)
    else:
        history = pd.concat(frames, ignore_index=True)
        history = _add_percentile_ranks(history)
    for col in HISTORY_COLUMNS:
        if col not in history.columns:
            history[col] = np.nan
    return history[HISTORY_COLUMNS].reset_index(drop=True)
