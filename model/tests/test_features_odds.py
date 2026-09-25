"""Ticket #264 DoD tests for the market-odds join in `fpl_model.features`.

  1. A single-fixture row gets its own fixture's lambda (home side).
  2. A double-gameweek row (`nfix != 1`) gets NaN for all four odds features, even though odds
     data for its fixtures exists.
  3. Home/away sides are not swapped: the away side of the SAME fixture gets the away lambda, not
     a copy of the home side's numbers.
  4. The run-1 parity test (`test_parity.py`) still passes when odds are supplied to both
     `build_training_frame` and `build_decision_frame` — same real 2025-26 GW20 data as
     `test_parity.py`, this time with `fpl_odds.history.load_odds_history()` passed through, so
     the newly-added `lambda_for`/`lambda_against`/`p_win`/`p_cs` columns are exercised too.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from fpl_model.features import FEATURES, build_decision_frame, build_training_frame
from fpl_model.sources import HISTORY_COLUMNS, load_history
from fpl_odds.history import load_odds_history

_ODDS_COLS = ['lambda_for', 'lambda_against', 'p_win', 'p_cs']

_STAT_DEFAULTS = {
    'minutes': 0, 'total_points': 0, 'goals_scored': 0, 'assists': 0, 'expected_goals': 0.0,
    'expected_assists': 0.0, 'expected_goals_conceded': 0.0, 'bps': 0, 'bonus': 0, 'ict_index': 0.0,
    'threat': 0.0, 'creativity': 0.0, 'influence': 0.0, 'saves': 0, 'clean_sheets': 0,
    'goals_conceded': 0, 'starts': 0, 'defensive_contribution': 0,
}

# The single fixture every synthetic row below refers to: 2022-23 GW5, Arsenal (code 3) at home
# to Aston Villa (code 7). Values are arbitrary but distinct so a swapped join is caught.
_SEASON = '2022-23'
_GW = 5
_HOME_CODE, _AWAY_CODE = 3, 7
_LAMBDA_HOME, _LAMBDA_AWAY = 1.5, 0.9
_P_HOME, _P_DRAW, _P_AWAY = 0.5, 0.3, 0.2


def _row(code, team_code, opp_team_code, was_home, nfix, **overrides):
    row = dict(
        code=code, season=_SEASON, gw=_GW, team_code=team_code, position='MID',
        value=55, own_pct_rank=0.5, transfers_rank=0.5, nfix=nfix, was_home=was_home,
        opp_team_code=opp_team_code, gf=1, ga=1, **_STAT_DEFAULTS,
    )
    row.update(overrides)
    return row


def _make_history(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for c in HISTORY_COLUMNS:
        if c not in df.columns:
            df[c] = np.nan
    return df[HISTORY_COLUMNS]


def _odds_frame() -> pd.DataFrame:
    return pd.DataFrame.from_records([{
        'season': _SEASON, 'gw': None, 'kickoff_date': pd.Timestamp('2022-09-17'),
        'home_code': _HOME_CODE, 'away_code': _AWAY_CODE,
        'p_home': _P_HOME, 'p_draw': _P_DRAW, 'p_away': _P_AWAY,
        'lambda_home': _LAMBDA_HOME, 'lambda_away': _LAMBDA_AWAY, 'source': 'football-data',
    }])


def test_single_fixture_row_gets_its_fixtures_lambda():
    """The home side of a single-fixture row gets lambda_home/lambda_away/p_home from ITS
    fixture's own odds row."""
    history = _make_history([
        _row(code=201, team_code=_HOME_CODE, opp_team_code=_AWAY_CODE, was_home=1.0, nfix=1),
    ])
    frame = build_training_frame(history, odds=_odds_frame())
    row = frame[frame['code'] == 201].iloc[0]

    assert row['lambda_for'] == pytest.approx(_LAMBDA_HOME)
    assert row['lambda_against'] == pytest.approx(_LAMBDA_AWAY)
    assert row['p_win'] == pytest.approx(_P_HOME)
    assert row['p_cs'] == pytest.approx(math.exp(-_LAMBDA_AWAY))


def test_dgw_row_gets_nan_even_though_odds_exist_for_its_fixtures():
    """nfix != 1 -> all four odds features are NaN, regardless of whether the team involved has
    odds data available (it does here — same home/away codes as the single-fixture case)."""
    history = _make_history([
        _row(code=202, team_code=_HOME_CODE, opp_team_code=_AWAY_CODE, was_home=0.5, nfix=2),
    ])
    frame = build_training_frame(history, odds=_odds_frame())
    row = frame[frame['code'] == 202].iloc[0]

    for col in _ODDS_COLS:
        assert pd.isna(row[col]), f'{col} should be NaN for a DGW (nfix=2) row, got {row[col]}'


def test_home_and_away_sides_are_not_swapped():
    """Two single-fixture rows on opposite sides of the SAME match must get different, correctly
    assigned lambdas -- this is the check a home/away swap bug would fail."""
    history = _make_history([
        _row(code=201, team_code=_HOME_CODE, opp_team_code=_AWAY_CODE, was_home=1.0, nfix=1),
        _row(code=211, team_code=_AWAY_CODE, opp_team_code=_HOME_CODE, was_home=0.0, nfix=1),
    ])
    frame = build_training_frame(history, odds=_odds_frame())
    home_row = frame[frame['code'] == 201].iloc[0]
    away_row = frame[frame['code'] == 211].iloc[0]

    assert home_row['lambda_for'] == pytest.approx(_LAMBDA_HOME)
    assert home_row['lambda_against'] == pytest.approx(_LAMBDA_AWAY)
    assert home_row['p_win'] == pytest.approx(_P_HOME)

    assert away_row['lambda_for'] == pytest.approx(_LAMBDA_AWAY)
    assert away_row['lambda_against'] == pytest.approx(_LAMBDA_HOME)
    assert away_row['p_win'] == pytest.approx(_P_AWAY)

    # The two sides must not carry identical numbers -- the swap bug this test guards against
    # would make lambda_for identical on both sides.
    assert home_row['lambda_for'] != pytest.approx(away_row['lambda_for'])


def test_missing_odds_gives_nan_not_a_crash():
    """A single-fixture row whose fixture has no matching odds row gets NaN, not a KeyError/merge
    crash, and NaN, not some fabricated fallback value."""
    history = _make_history([
        _row(code=201, team_code=999, opp_team_code=998, was_home=1.0, nfix=1),
    ])
    frame = build_training_frame(history, odds=_odds_frame())
    row = frame[frame['code'] == 201].iloc[0]

    for col in _ODDS_COLS:
        assert pd.isna(row[col])


def test_football_data_wins_over_other_sources_on_the_same_fixture():
    """When the same (season, home_code, away_code) pairing has rows from more than one odds
    source, football-data wins (the ticket's own dedup rule)."""
    history = _make_history([
        _row(code=201, team_code=_HOME_CODE, opp_team_code=_AWAY_CODE, was_home=1.0, nfix=1),
    ])
    odds = pd.concat([
        _odds_frame(),  # football-data, lambda_home=1.5
        pd.DataFrame.from_records([{
            'season': _SEASON, 'gw': None, 'kickoff_date': pd.Timestamp('2022-09-17'),
            'home_code': _HOME_CODE, 'away_code': _AWAY_CODE,
            'p_home': 0.9, 'p_draw': 0.05, 'p_away': 0.05,
            'lambda_home': 9.9, 'lambda_away': 9.9, 'source': 'the-odds-api',
        }]),
    ], ignore_index=True)
    frame = build_training_frame(history, odds=odds)
    row = frame[frame['code'] == 201].iloc[0]

    assert row['lambda_for'] == pytest.approx(_LAMBDA_HOME)
    assert row['p_win'] == pytest.approx(_P_HOME)


def test_no_odds_frame_gives_nan_columns_not_a_crash():
    """`odds=None` (run 1's default) still produces the four columns, all NaN -- this is what
    keeps `FEATURES` satisfied when a caller has no odds to pass."""
    history = _make_history([
        _row(code=201, team_code=_HOME_CODE, opp_team_code=_AWAY_CODE, was_home=1.0, nfix=1),
    ])
    frame = build_training_frame(history, odds=None)
    row = frame[frame['code'] == 201].iloc[0]

    for col in _ODDS_COLS:
        assert col in frame.columns
        assert pd.isna(row[col])


# --- DoD test 4: the run-1 parity test still passes with odds given -----------------------------

DECISION_GW = 20
CONTEXT_COLS = ['position', 'value', 'was_home', 'nfix']


@pytest.fixture(scope='module')
def parity_frames_with_odds():
    odds = load_odds_history()

    full = load_history(('2025-26', DECISION_GW + 1))
    train_full = build_training_frame(full, odds=odds)
    gw20_train = (
        train_full[(train_full['season'] == '2025-26') & (train_full['gw'] == DECISION_GW)]
        .set_index('code')
    )

    history_before = load_history(('2025-26', DECISION_GW))
    gw20_actual = full[(full['season'] == '2025-26') & (full['gw'] == DECISION_GW)].copy()

    target_fixtures = gw20_actual[['code', 'team_code', 'opp_team_code', 'was_home', 'position']].copy()
    snapshot = gw20_actual[['code', 'value', 'own_pct_rank', 'transfers_rank']].rename(
        columns={'value': 'now_cost'})
    decision = build_decision_frame(
        history_before, ('2025-26', DECISION_GW), target_fixtures, odds=odds, snapshot=snapshot,
    ).set_index('code')
    return gw20_train, decision


def test_parity_same_players_with_odds(parity_frames_with_odds):
    gw20_train, decision = parity_frames_with_odds
    assert len(decision) > 500
    assert set(decision.index) == set(gw20_train.index)


@pytest.mark.parametrize('col', FEATURES + CONTEXT_COLS)
def test_parity_column_matches_with_odds(parity_frames_with_odds, col):
    gw20_train, decision = parity_frames_with_odds
    a = decision[col]
    b = gw20_train.loc[decision.index, col]
    if a.dtype == object or b.dtype == object:
        assert (a.astype(str) == b.astype(str)).all(), f'{col} differs for at least one player'
    else:
        close = ((a - b).abs() < 1e-9) | (a.isna() & b.isna())
        assert close.all(), f'{col} differs for at least one player'


def test_parity_odds_columns_are_actually_populated(parity_frames_with_odds):
    """Sanity check that this parity run is exercising real odds, not two frames that both
    happen to be all-NaN on the four odds columns (which would make the column-match test above
    pass trivially)."""
    _, decision = parity_frames_with_odds
    for col in _ODDS_COLS:
        assert decision[col].notna().any(), f'{col} is all-NaN in the GW20 parity decision frame'
