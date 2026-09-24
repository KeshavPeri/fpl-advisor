"""Coverage for the FPL-Core-Insights (current season) ingestion path in sources.py — QA
revision round 1 on ticket #258: this path had zero test coverage and an unpinned ref.

Synthetic fixtures shaped like Core's `players.csv` / `player_gameweek_stats.csv` /
`fixtures.csv`, in the same spirit as test_features_leakage.py's synthetic history rows — no
network needed. `sources._read_csv` is monkeypatched so `_load_core_season` runs its real
position-mapping, now_cost x10, ownership/transfer-rank and fixture-aggregation logic end to end,
including the `tournament == 'prem'` cup-game filter.
"""
import pandas as pd
import pytest

from fpl_model import sources

# Two Premier League teams (3, 7) play each other; a third "team" (99) only appears in a cup
# fixture that must be filtered out entirely.
PLAYERS_CSV = pd.DataFrame({
    'player_code': [1001, 1002, 1003, 1004],
    'player_id': [1, 2, 3, 4],
    'first_name': ['A', 'B', 'C', 'D'],
    'second_name': ['One', 'Two', 'Three', 'Four'],
    'web_name': ['A.One', 'B.Two', 'C.Three', 'D.Four'],
    'team_code': [3, 3, 7, 99],
    'position': ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
})

GW1_STATS = pd.DataFrame({
    'id': [1, 2, 3, 4],
    'status': ['a', 'a', 'a', 'a'],
    'now_cost': [4.5, 5.0, 6.5, 7.0],       # decimal millions -> x10 tenths
    'selected_by_percent': [10.0, 20.0, 30.0, 5.0],
    'transfers_in_event': [100, 200, 300, 10],
    'transfers_out_event': [10, 20, 30, 100],
    'minutes': [90, 90, 90, 0],
    'total_points': [6, 2, 8, 0],
    'goals_scored': [0, 0, 1, 0],
    'assists': [0, 0, 1, 0],
    'expected_goals': [0.0, 0.0, 0.4, 0.0],
    'expected_assists': [0.0, 0.0, 0.3, 0.0],
    'expected_goals_conceded': [1.0, 1.0, 2.0, 0.0],
    'bps': [30, 15, 40, 0],
    'bonus': [3, 0, 2, 0],
    'ict_index': [5.0, 3.0, 8.0, 0.0],
    'threat': [0.0, 0.0, 20.0, 0.0],
    'creativity': [0.0, 5.0, 15.0, 0.0],
    'influence': [20.0, 10.0, 15.0, 0.0],
    'saves': [3, 0, 0, 0],
    'clean_sheets': [0, 0, 0, 0],
    'goals_conceded': [1, 1, 2, 0],
    'starts': [1, 1, 1, 0],
    'defensive_contribution': [0, 6, 1, 0],
})

# team_code 3 (home) beats team_code 7 (away) 2-1 in the Premier League; team_code 3 separately
# thrashes a cup opponent 9-0 in a competition that must never reach the model.
GW1_FIXTURES = pd.DataFrame({
    'gameweek': [1, 1],
    'home_team': [3, 3],
    'away_team': [7, 99],
    'home_score': [2, 9],
    'away_score': [1, 0],
    'tournament': ['prem', 'cup'],
})


def _fake_read_csv(url: str, cache_name: str) -> pd.DataFrame:
    if 'players.csv' in cache_name:
        return PLAYERS_CSV.copy()
    if 'gw1_stats.csv' in cache_name:
        return GW1_STATS.copy()
    if 'gw1_fixtures.csv' in cache_name:
        return GW1_FIXTURES.copy()
    raise AssertionError(f'unexpected fetch in test: {cache_name} ({url})')


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(sources, '_read_csv', _fake_read_csv)


def test_load_core_season_maps_positions_and_scales_price():
    df = sources._load_core_season('2026-27', through_gw=2, ref='test-ref')
    by_id = df.set_index('code')
    assert set(df['position']) == {'GK', 'DEF', 'MID', 'FWD'}
    assert by_id.loc[1001, 'position'] == 'GK'
    # now_cost 4.5 (decimal millions) -> 45 tenths
    assert by_id.loc[1001, 'value'] == pytest.approx(45.0)
    assert by_id.loc[1003, 'value'] == pytest.approx(65.0)


def test_load_core_season_ownership_and_transfers_are_source_independent_inputs():
    df = sources._load_core_season('2026-27', through_gw=2, ref='test-ref')
    by_id = df.set_index('code')
    assert by_id.loc[1002, 'own_raw'] == pytest.approx(20.0)
    # net transfers = in - out
    assert by_id.loc[1003, 'transfers_raw'] == pytest.approx(300 - 30)
    assert by_id.loc[1004, 'transfers_raw'] == pytest.approx(10 - 100)


def test_cup_fixture_is_excluded_from_team_gf_ga_and_nfix():
    df = sources._load_core_season('2026-27', through_gw=2, ref='test-ref')
    by_id = df.set_index('code')

    # Team 3's players (the goalkeeper and defender) must reflect ONLY the prem fixture
    # (2-1 for, nfix=1) — if the cup game (9-0) leaked in, gf would be 11 and/or nfix would be 2.
    for code in (1001, 1002):
        assert by_id.loc[code, 'nfix'] == 1
        assert by_id.loc[code, 'gf'] == pytest.approx(2.0)
        assert by_id.loc[code, 'ga'] == pytest.approx(1.0)
        assert by_id.loc[code, 'was_home'] == pytest.approx(1.0)
        assert by_id.loc[code, 'opp_team_code'] == 7

    # Team 7 (away in the prem fixture) sees the mirrored result.
    assert by_id.loc[1003, 'nfix'] == 1
    assert by_id.loc[1003, 'gf'] == pytest.approx(1.0)
    assert by_id.loc[1003, 'ga'] == pytest.approx(2.0)
    assert by_id.loc[1003, 'was_home'] == pytest.approx(0.0)
    assert by_id.loc[1003, 'opp_team_code'] == 3


def test_team_with_only_a_cup_fixture_gets_the_no_fixture_default():
    """Team 99 only appears in the filtered-out cup game, so after the `tournament == 'prem'`
    filter it has no Premier League fixture that GW at all — the left-merge default, not a crash
    or a leaked cup result."""
    df = sources._load_core_season('2026-27', through_gw=2, ref='test-ref')
    row = df.set_index('code').loc[1004]
    assert row['nfix'] == 0
    assert row['gf'] == 0.0
    assert row['ga'] == 0.0
    assert row['was_home'] == pytest.approx(0.5)


def test_returns_history_shaped_columns():
    df = sources._load_core_season('2026-27', through_gw=2, ref='test-ref')
    expected = set(sources.HISTORY_COLUMNS) - {'own_pct_rank', 'transfers_rank'} | {
        'own_raw', 'transfers_raw',
    }
    assert expected.issubset(set(df.columns))
    assert len(df) == 4


def test_load_core_season_empty_range_returns_no_rows():
    df = sources._load_core_season('2026-27', through_gw=1, ref='test-ref')
    assert len(df) == 0


def test_core_default_ref_is_pinned_not_moving():
    """QA revision round 1: CORE_DEFAULT_REF must be a fixed commit, matching the pin in
    docs/model-diagnosis-2026-09-24.md §8, never a moving branch name like 'main'."""
    assert sources.CORE_DEFAULT_REF == '392f79ad85fcbe5c47b8f1e33d6c3dc787dcfd53'
    assert sources.CORE_DEFAULT_REF != 'main'
