"""DoD tests for ticket #265 / R2-T2 (`model/fpl_model/live.py`), against the committed sample
JSON in `model/tests/fixtures/` and a small synthetic `history` frame -- no network, no
Supabase. Proves:
  - rows for every horizon gameweek with no NaN;
  - 0 for a blank-gameweek team (Chelsea has no sample fixture inside the horizon window);
  - a double-gameweek player's value equals the sum of two independent single-fixture
    predictions (Aston Villa, gw11);
  - an `i`-status player is 0 after availability (Arsenal's GK);
  - the `player_projections` upsert payload shape, including the FK-skip count.

The sample data: 5 teams (ARS/AVL/BOU/BRE/CHE), next gw = 10. Arsenal have a single fixture at
gw10 (vs Bournemouth); Aston Villa have a double gameweek at gw11 (vs Bournemouth, then away at
Brentford); Chelsea's only sample fixture (gw15) falls outside the 5-gameweek horizon
(10..14) -- a blank gameweek for every Chelsea player throughout it.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest

from fpl_model import fpl_api, live, supabase_io
from fpl_model.features import build_decision_frame, build_training_frame
from fpl_model.sources import HISTORY_COLUMNS
from fpl_model.train import fit, predict
from fpl_odds.implied import goal_expectancy

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')
SEASON = '2026-27'
NEXT_GW = 10
NOW = pd.Timestamp('2026-09-24T12:00:00+00:00')

_ODDS_COLUMNS = ['fixture_id', 'fetched_at', 'book_count', 'p_home', 'p_draw', 'p_away']

# code, team_code, opp_team_code (in the synthetic history), position, minutes, points, value
_PLAYERS = [
    (1001, 3, 7, 'MID', 85, 5, 80),
    (1002, 7, 11, 'FWD', 88, 7, 95),
    (1003, 90, 13, 'DEF', 90, 3, 50),
    (1004, 3, 7, 'GK', 90, 2, 45),
]

_STAT_DEFAULTS = {
    'goals_scored': 0, 'assists': 0, 'expected_goals': 0.0, 'expected_assists': 0.0,
    'expected_goals_conceded': 0.0, 'bps': 20, 'bonus': 0, 'ict_index': 5.0, 'threat': 10.0,
    'creativity': 10.0, 'influence': 10.0, 'saves': 0, 'clean_sheets': 0, 'goals_conceded': 1,
    'starts': 1, 'defensive_contribution': 2,
}


def _load_json(name: str):
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return json.load(f)


def _row(code, gw, team_code, opp_team_code, position, minutes, total_points, value):
    return dict(
        code=code, season=SEASON, gw=gw, team_code=team_code, position=position,
        minutes=minutes, total_points=total_points, value=value,
        own_pct_rank=0.5, transfers_rank=0.5, nfix=1, was_home=float(gw % 2 == 0),
        opp_team_code=opp_team_code, gf=1, ga=1, **_STAT_DEFAULTS,
    )


def _make_history(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for c in HISTORY_COLUMNS:
        if c not in df.columns:
            df[c] = np.nan
    return df[HISTORY_COLUMNS]


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def bootstrap():
    return _load_json('bootstrap-static-sample.json')


@pytest.fixture(scope='module')
def fixtures_json():
    return _load_json('fixtures-sample.json')


@pytest.fixture(scope='module')
def odds_rows():
    return _load_json('fixture-odds-sample.json')


@pytest.fixture(scope='module')
def history():
    rows = []
    for code, team_code, opp_team_code, position, minutes, points, value in _PLAYERS:
        for gw in range(5, 10):
            rows.append(_row(code, gw, team_code, opp_team_code, position, minutes, points, value))
    return _make_history(rows)


@pytest.fixture(scope='module')
def teams(bootstrap):
    return fpl_api.parse_teams(bootstrap)


@pytest.fixture(scope='module')
def snapshot(bootstrap):
    return fpl_api.parse_snapshot(bootstrap)


@pytest.fixture(scope='module')
def team_fixtures(fixtures_json, teams):
    return fpl_api.parse_team_fixtures(fixtures_json, teams)


@pytest.fixture(scope='module')
def fixture_lookup(fixtures_json, teams):
    return fpl_api.parse_fixture_lookup(fixtures_json, teams)


@pytest.fixture(scope='module')
def selected_odds(odds_rows):
    df = pd.DataFrame(odds_rows, columns=_ODDS_COLUMNS)
    return supabase_io.select_latest_odds(df, NOW, freshness_hours=48, min_book_count=3)


@pytest.fixture(scope='module')
def fixture_lambda(selected_odds, fixture_lookup):
    return live.build_fixture_lambda_lookup(selected_odds, fixture_lookup)


@pytest.fixture(scope='module')
def models(history):
    training_frame = build_training_frame(history)
    points_model = fit(training_frame, 'total_points', seed=0)
    minutes_model = fit(training_frame, 'minutes', seed=0)
    return points_model, minutes_model


@pytest.fixture(scope='module')
def raw_projections(history, snapshot, team_fixtures, fixture_lambda, models):
    points_model, minutes_model = models
    return live.project_horizon(history, snapshot, team_fixtures, fixture_lambda, NEXT_GW,
                                 points_model, minutes_model)


# ---------------------------------------------------------------------------
# fpl_api parsing (pure, no network)
# ---------------------------------------------------------------------------

def test_next_gameweek_from_sample(bootstrap):
    assert fpl_api.next_gameweek(bootstrap) == NEXT_GW


def test_snapshot_has_one_row_per_player(snapshot):
    assert len(snapshot) == 4
    assert set(snapshot['code']) == {1001, 1002, 1003, 1004}
    assert set(snapshot['position']) == {'MID', 'FWD', 'DEF', 'GK'}
    assert snapshot.set_index('code').loc[1001, 'selected_by_percent'] == pytest.approx(15.5)


def test_team_fixtures_slots_mark_the_double_gameweek(team_fixtures):
    avl_gw11 = team_fixtures[(team_fixtures['team_code'] == 7) & (team_fixtures['gw'] == 11)]
    assert sorted(avl_gw11['slot']) == [0, 1]

    ars_gw10 = team_fixtures[(team_fixtures['team_code'] == 3) & (team_fixtures['gw'] == 10)]
    assert list(ars_gw10['slot']) == [0]

    che_in_horizon = team_fixtures[(team_fixtures['team_code'] == 90) & (team_fixtures['gw'].between(10, 14))]
    assert che_in_horizon.empty  # Chelsea's only sample fixture (gw15) is outside the horizon


def test_horizon_gameweeks_stops_at_38():
    assert live.horizon_gameweeks(36) == [36, 37, 38]
    assert live.horizon_gameweeks(38) == [38]


# ---------------------------------------------------------------------------
# select_latest_odds -- freshness, book-count, and latest-wins dedup
# ---------------------------------------------------------------------------

def test_select_latest_odds_keeps_only_fresh_well_booked_latest_row(odds_rows):
    df = pd.DataFrame(odds_rows, columns=_ODDS_COLUMNS)
    selected = supabase_io.select_latest_odds(df, NOW, freshness_hours=48, min_book_count=3)

    # fixture 502 (book_count=2) and 503 (fetched well over 48h before NOW) are both dropped;
    # only fixture 501 survives, and as the NEWER of its two rows (p_home=0.55, not 0.10).
    assert set(selected['fixture_id']) == {501}
    row = selected.iloc[0]
    assert row['p_home'] == pytest.approx(0.55)
    assert row['p_draw'] == pytest.approx(0.25)
    assert row['p_away'] == pytest.approx(0.20)


# ---------------------------------------------------------------------------
# project_horizon
# ---------------------------------------------------------------------------

def test_rows_for_every_horizon_gw_with_no_nan(raw_projections):
    assert set(raw_projections['gw']) == {10, 11, 12, 13, 14}
    for code, *_rest in _PLAYERS:
        sub = raw_projections[raw_projections['code'] == code]
        assert len(sub) == 5
        assert not sub['raw_points'].isna().any()
        assert not sub['raw_minutes'].isna().any()


def test_blank_gw_team_is_zero(raw_projections):
    che = raw_projections[raw_projections['code'] == 1003]
    assert (che['raw_points'] == 0.0).all()
    assert (che['raw_minutes'] == 0.0).all()


def test_dgw_player_equals_sum_of_two_single_fixture_predictions(history, snapshot, models, raw_projections):
    points_model, minutes_model = models
    avl = snapshot[snapshot['code'] == 1002][['code', 'position', 'team_code']].copy()

    slot0 = avl.assign(opp_team_code=11, was_home=True)[['code', 'team_code', 'opp_team_code', 'was_home', 'position']]
    slot1 = avl.assign(opp_team_code=13, was_home=False)[['code', 'team_code', 'opp_team_code', 'was_home', 'position']]

    dec0 = build_decision_frame(history, (SEASON, 11), slot0, snapshot=snapshot)
    dec1 = build_decision_frame(history, (SEASON, 11), slot1, snapshot=snapshot)
    expected_points = float(predict(points_model, dec0)[0]) + float(predict(points_model, dec1)[0])
    expected_minutes = float(predict(minutes_model, dec0)[0]) + float(predict(minutes_model, dec1)[0])

    row = raw_projections[(raw_projections['code'] == 1002) & (raw_projections['gw'] == 11)].iloc[0]
    assert row['raw_points'] == pytest.approx(expected_points, abs=1e-6)
    assert row['raw_minutes'] == pytest.approx(expected_minutes, abs=1e-6)


def test_has_odds_and_lambda_for_ars_next_gw(raw_projections):
    row = raw_projections[(raw_projections['code'] == 1001) & (raw_projections['gw'] == 10)].iloc[0]
    assert bool(row['has_odds'])
    # Arsenal are home in fixture 501 -- lambda_for is lambda_home for the selected (newer) row.
    lambda_home, lambda_away = goal_expectancy(0.55, 0.25, 0.20)
    assert row['lambda_for'] == pytest.approx(lambda_home, abs=1e-9)
    assert row['lambda_against'] == pytest.approx(lambda_away, abs=1e-9)


def test_no_odds_for_team_with_no_lambda_lookup_entry(raw_projections):
    che = raw_projections[raw_projections['code'] == 1003]
    assert che['has_odds'].eq(False).all()
    assert che['lambda_for'].isna().all()


# ---------------------------------------------------------------------------
# build_payload -- availability, the i-status player, and the upsert payload shape
# ---------------------------------------------------------------------------

def test_i_status_player_is_zero_after_availability(raw_projections, snapshot):
    payload, _skipped = live.build_payload(
        raw_projections, snapshot, trained_through=f'{SEASON} GW9',
        known_player_ids={101, 102, 103, 104}, computed_at='2026-09-24T18:00:00+00:00',
    )
    ars_gk_rows = [r for r in payload if r['player_code'] == 1004]
    assert len(ars_gk_rows) == 5
    for row in ars_gk_rows:
        assert row['expected_points'] == 0.0
        assert row['expected_minutes'] == 0.0
        assert row['components']['availability'] == 0.0


def test_upsert_payload_shape(raw_projections, snapshot):
    payload, skipped = live.build_payload(
        raw_projections, snapshot, trained_through=f'{SEASON} GW9',
        known_player_ids={101, 102, 103, 104}, computed_at='2026-09-24T18:00:00+00:00',
    )
    assert skipped == 0
    assert len(payload) == len(_PLAYERS) * 5  # 4 players x 5 horizon gameweeks

    row = payload[0]
    assert set(row.keys()) == {
        'gameweek_id', 'player_id', 'model_version', 'player_code',
        'expected_points', 'expected_minutes', 'components', 'computed_at',
    }
    assert row['model_version'] == 'gbm-v1'
    assert isinstance(row['gameweek_id'], int)
    assert isinstance(row['player_id'], int)
    assert isinstance(row['player_code'], int)
    assert isinstance(row['expected_points'], float)
    assert isinstance(row['expected_minutes'], float)

    components = row['components']
    assert set(components.keys()) == {
        'model', 'trained_through', 'availability', 'raw_points', 'raw_minutes',
        'has_odds', 'lambda_for', 'lambda_against', 'drivers',
    }
    assert components['model'] == 'gbm-v1'
    assert components['trained_through'] == f'{SEASON} GW9'
    for driver in components['drivers']:
        assert set(driver.keys()) == {'feature', 'value', 'contribution'}


def test_missing_odds_serialize_as_json_null_not_nan(raw_projections, snapshot):
    """jsonb has no NaN literal -- a missing lambda must be a real Python None (json.dumps ->
    `null`), never a bare float NaN (json.dumps -> the invalid-JSON token `NaN`)."""
    payload, _skipped = live.build_payload(
        raw_projections, snapshot, trained_through=f'{SEASON} GW9',
        known_player_ids={101, 102, 103, 104}, computed_at='2026-09-24T18:00:00+00:00',
    )
    che_rows = [r for r in payload if r['player_code'] == 1003]
    assert len(che_rows) == 5
    for row in che_rows:
        assert row['components']['lambda_for'] is None
        assert row['components']['lambda_against'] is None
    # json.dumps allows a bare NaN token by default (allow_nan=True) -- assert directly that the
    # serialized payload contains no such token, since PostgREST would reject it as invalid JSON.
    assert 'NaN' not in json.dumps(payload)


def test_fk_skip_counts_and_drops_unknown_player(raw_projections, snapshot):
    payload, skipped = live.build_payload(
        raw_projections, snapshot, trained_through=f'{SEASON} GW9',
        known_player_ids={101, 102, 104},  # 103 (Chelsea DEF) missing from "public.players"
        computed_at='2026-09-24T18:00:00+00:00',
    )
    assert skipped == 5  # one row per horizon gw for the one missing player
    assert all(r['player_code'] != 1003 for r in payload)


def test_json_safe_turns_nan_and_inf_into_null():
    import json
    import numpy as np
    out = live._json_safe({'a': float('nan'), 'b': [np.float64('inf'), 1.5, np.int64(3)],
                           'drivers': [{'feature': 'p90_10_saves', 'value': np.nan, 'contribution': 0.1}]})
    assert out == {'a': None, 'b': [None, 1.5, 3], 'drivers': [{'feature': 'p90_10_saves', 'value': None, 'contribution': 0.1}]}
    json.dumps(out, allow_nan=False)
