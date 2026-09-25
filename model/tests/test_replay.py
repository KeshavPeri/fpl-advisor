"""DoD tests for ticket #281 (`model/fpl_replay/`). No network, no solver, no Supabase --
`rules.py` and `solver_io.py`'s pure functions are exercised directly; `live.project_horizon`'s
new `season` parameter is exercised against a small synthetic season, the same style
`tests/test_live.py` already uses for the (unmodified) default-season path.

Covers, per the ticket's own DoD list: the selling-price rule, FT banking capped at 5, a hit
costing exactly 4 in net points, budget and 3-per-club checks, captain x2 scoring, and horizon
projections for a blank and a double GW on a small synthetic season.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fpl_model import live
from fpl_model.features import build_training_frame
from fpl_model.sources import HISTORY_COLUMNS
from fpl_model.train import fit
from fpl_replay import replay, rules, solver_io

# ---------------------------------------------------------------------------
# rules.py -- selling price
# ---------------------------------------------------------------------------

def test_selling_price_risen_player_keeps_half_the_profit():
    # Bought at 8.0m (80), now 9.0m (90): profit is 10 tenths, half (rounded down) is 5.
    assert rules.selling_price(purchase_price=80, current_price=90) == 85


def test_selling_price_rounds_the_profit_down():
    # A 3-tenths rise (0.3m) floors to +1, not +1.5 -- FPL never rounds a sell price up.
    assert rules.selling_price(purchase_price=80, current_price=83) == 81


def test_selling_price_fallen_player_sells_at_current():
    assert rules.selling_price(purchase_price=80, current_price=70) == 70


def test_selling_price_unchanged_player_sells_at_current():
    assert rules.selling_price(purchase_price=80, current_price=80) == 80


# ---------------------------------------------------------------------------
# rules.py -- FT banking, capped at 5
# ---------------------------------------------------------------------------

def test_next_free_transfers_earns_one_when_all_used():
    assert rules.next_free_transfers(available_ft=1, transfers_made=1) == 1


def test_next_free_transfers_banks_when_unused():
    assert rules.next_free_transfers(available_ft=1, transfers_made=0) == 2


def test_next_free_transfers_capped_at_five():
    assert rules.next_free_transfers(available_ft=5, transfers_made=0) == 5
    assert rules.next_free_transfers(available_ft=4, transfers_made=0) == 5


def test_next_free_transfers_never_goes_below_one():
    # Taking a hit (transfers_made > available_ft) still earns the weekly +1, never less than 1.
    assert rules.next_free_transfers(available_ft=1, transfers_made=3) == 1


# ---------------------------------------------------------------------------
# rules.py -- a hit costs exactly 4 (or whatever hit_cost is under test) in net points
# ---------------------------------------------------------------------------

def test_hit_count_and_cost_at_default_hit_cost():
    assert rules.hit_count(transfers_made=2, available_ft=1) == 1
    assert rules.hit_points_cost(transfers_made=2, available_ft=1, hit_cost=4) == 4


def test_hit_cost_scales_with_extra_transfers():
    assert rules.hit_points_cost(transfers_made=3, available_ft=1, hit_cost=4) == 8


def test_hit_cost_tracks_the_setting_under_test():
    assert rules.hit_points_cost(transfers_made=2, available_ft=1, hit_cost=6) == 6
    assert rules.hit_points_cost(transfers_made=2, available_ft=1, hit_cost=8) == 8


def test_no_hit_when_transfers_within_free_allowance():
    assert rules.hit_count(transfers_made=1, available_ft=2) == 0
    assert rules.hit_points_cost(transfers_made=1, available_ft=2, hit_cost=4) == 0


# ---------------------------------------------------------------------------
# rules.py -- budget and 3-per-club checks
# ---------------------------------------------------------------------------

def test_check_budget_within_and_over():
    assert rules.check_budget(total_squad_value_tenths=995, bank_tenths=5) is True
    assert rules.check_budget(total_squad_value_tenths=996, bank_tenths=5) is False


def test_check_club_limit():
    assert rules.check_club_limit([1, 1, 1, 2, 3]) is True
    assert rules.check_club_limit([1, 1, 1, 1, 2]) is False


def test_validate_squad_composition_valid_squad():
    positions = ['GK'] * 2 + ['DEF'] * 5 + ['MID'] * 5 + ['FWD'] * 3
    team_codes = list(range(1, 16))  # one per club -- trivially within the 3-per-club limit
    assert rules.validate_squad_composition(positions, team_codes, 950, 50) == []


def test_validate_squad_composition_catches_wrong_position_counts_and_club_overload():
    positions = ['GK'] * 3 + ['DEF'] * 4 + ['MID'] * 5 + ['FWD'] * 3  # 3 GK, 4 DEF -- both wrong
    team_codes = [1, 1, 1, 1] + list(range(2, 13))  # club 1 has 4 players
    problems = rules.validate_squad_composition(positions, team_codes, 950, 50)
    assert any('GK' in p for p in problems)
    assert any('DEF' in p for p in problems)
    assert any('3 players in the squad' in p for p in problems)


def test_validate_squad_composition_catches_wrong_squad_size():
    positions = ['GK'] * 2 + ['DEF'] * 5 + ['MID'] * 5 + ['FWD'] * 2  # 14 players
    team_codes = list(range(1, 15))
    problems = rules.validate_squad_composition(positions, team_codes, 900, 50)
    assert any('expected 15' in p for p in problems)


def test_validate_squad_composition_catches_over_budget():
    positions = ['GK'] * 2 + ['DEF'] * 5 + ['MID'] * 5 + ['FWD'] * 3
    team_codes = list(range(1, 16))
    problems = rules.validate_squad_composition(positions, team_codes, 1200, 0)
    assert any('exceeds budget' in p for p in problems)


# ---------------------------------------------------------------------------
# rules.py -- captain x2 scoring, no auto-subs
# ---------------------------------------------------------------------------

def _lineup(points_by_code: dict[int, float], positions: dict[int, str] | None = None) -> list[rules.LineupPlayer]:
    positions = positions or {}
    return [
        rules.LineupPlayer(code=code, position=positions.get(code, 'MID'), points=pts)
        for code, pts in points_by_code.items()
    ]


def test_score_lineup_doubles_the_captain():
    lineup = _lineup({1: 5.0, 2: 3.0, 3: 0.0})
    # Captain (code 2) counted twice: 5 + 3 + 0 + 3 (the extra captain add) = 11.
    assert rules.score_lineup(lineup, captain_code=2) == 11.0


def test_score_lineup_no_auto_subs_zero_scorer_stays_zero():
    lineup = _lineup({1: 5.0, 2: 0.0, 3: 4.0})
    # Player 2 blanked (blank gameweek / dnp) and is NOT replaced from the bench.
    assert rules.score_lineup(lineup, captain_code=1) == 5.0 + 5.0 + 0.0 + 4.0


def test_score_lineup_raises_if_captain_not_in_lineup():
    lineup = _lineup({1: 5.0, 2: 3.0})
    with pytest.raises(ValueError):
        rules.score_lineup(lineup, captain_code=999)


# ---------------------------------------------------------------------------
# rules.py -- never-transfer baseline's best-XI selector
# ---------------------------------------------------------------------------

def _squad_15(points: dict[int, float]) -> list[rules.LineupPlayer]:
    positions = {}
    codes = list(points)
    for i, code in enumerate(codes):
        if i < 2:
            positions[code] = 'GK'
        elif i < 7:
            positions[code] = 'DEF'
        elif i < 12:
            positions[code] = 'MID'
        else:
            positions[code] = 'FWD'
    return _lineup(points, positions)


def test_pick_best_lineup_picks_top_scorers_within_formation():
    points = {i: float(i) for i in range(1, 16)}  # code i scores i points
    squad = _squad_15(points)
    lineup, captain_code = rules.pick_best_lineup(squad)
    assert len(lineup) == rules.LINEUP_SIZE
    # The single highest scorer overall (code 15, a FWD) must be captain.
    assert captain_code == 15
    # Exactly one GK in the lineup, the better of the two (code 2 > code 1).
    gks = [p for p in lineup if p.position == 'GK']
    assert len(gks) == 1
    assert gks[0].code == 2


def test_pick_best_lineup_rejects_wrong_squad_size():
    with pytest.raises(ValueError):
        rules.pick_best_lineup(_lineup({1: 1.0, 2: 2.0}))


# ---------------------------------------------------------------------------
# solver_io.py -- pure config/shape builders
# ---------------------------------------------------------------------------

def test_build_solver_config_mirrors_build_solver_input_ts_settings():
    config = solver_io.build_solver_config(horizon=5, datasource='replay', hit_cost=4, next_gw=10)
    assert config['xmin_lb'] == 150
    assert config['keep_top_ev_percent'] == 25
    assert config['ev_per_price_cutoff'] == 10
    assert config['no_transfer_last_gws'] == 0
    assert config['decay_base'] == 0.9
    assert config['ft_value_list'] == {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}
    assert config['chip_limits'] == {'bb': 0, 'wc': 0, 'fh': 0, 'tc': 0}
    assert config['preseason'] is False
    assert config['hit_cost'] == 4
    assert 'hit_limit' not in config


def test_build_solver_config_deliberate_deviations():
    config = solver_io.build_solver_config(horizon=5, datasource='replay', hit_cost=8, next_gw=10)
    assert config['num_iterations'] == 1          # buildSolverConfig uses 3
    assert config['secs'] == 60                    # buildSolverConfig uses 300
    assert config['hit_cost'] == 8                  # the setting under test


def test_build_solver_config_no_hits_sets_hard_hit_limit():
    config = solver_io.build_solver_config(
        horizon=5, datasource='replay', hit_cost=solver_io.NO_HITS_SENTINEL, next_gw=10,
    )
    assert config['hit_limit'] == 0


def test_build_solver_config_preseason_for_gw1_build():
    config = solver_io.build_solver_config(
        horizon=5, datasource='replay', hit_cost=4, next_gw=1, preseason=True,
    )
    assert config['preseason'] is True
    assert config['chip_limits'] == {'bb': 0, 'wc': 0, 'fh': 0, 'tc': 0}  # never a free rebuild via wc


def test_build_solver_config_rejects_non_positive_horizon():
    with pytest.raises(ValueError):
        solver_io.build_solver_config(horizon=0, datasource='replay', hit_cost=4, next_gw=1)


def test_build_team_json_shape_and_multiplier():
    picks = [
        {
            'element': 100 + i, 'squad_position': i + 1, 'element_type': 1 if i == 0 else 2,
            'purchase_price': 50 + i, 'selling_price': 50 + i,
            'is_captain': i == 1, 'is_vice_captain': i == 2, 'is_starting': i < 11,
        }
        for i in range(15)
    ]
    team_json = solver_io.build_team_json(picks, bank_tenths=15, free_transfers=2)
    assert len(team_json['picks']) == 15
    assert team_json['chips'] == []
    assert team_json['transfers'] == {
        'bank': 15, 'value': sum(50 + i for i in range(15)), 'cost': 4, 'limit': 2, 'made': 0,
    }
    captain_pick = team_json['picks'][1]
    assert captain_pick['is_captain'] is True
    assert captain_pick['multiplier'] == 2
    bench_pick = team_json['picks'][12]
    assert bench_pick['multiplier'] == 0


def test_build_team_json_rejects_wrong_pick_count():
    with pytest.raises(ValueError):
        solver_io.build_team_json([], bank_tenths=0, free_transfers=1)


def test_build_projections_csv_rows_zero_fills_missing_gameweeks():
    players = [{
        'id': 55, 'position': 'MID', 'name': 'Tester', 'team': 'Testville',
        'points_by_gw': {10: 5.5}, 'minutes_by_gw': {10: 90.0},
    }]
    rows = solver_io.build_projections_csv_rows(players, horizon_gws=[10, 11])
    assert rows[0]['ID'] == 55
    assert rows[0]['Pos'] == 'M'
    assert rows[0]['10_Pts'] == 5.5
    assert rows[0]['11_Pts'] == 0.0
    assert rows[0]['11_xMins'] == 0.0


def test_build_fake_bootstrap_and_fixtures_shape():
    elements = [{'id': 1, 'team': 1, 'element_type': 1, 'now_cost': 45, 'web_name': 'Keeper'}]
    teams = [{'id': 1, 'name': 'Test Town'}]
    bootstrap = solver_io.build_fake_bootstrap(elements, teams)
    assert bootstrap['elements'] == elements
    assert bootstrap['teams'] == teams
    assert {t['id'] for t in bootstrap['element_types']} == {1, 2, 3, 4}

    fixtures = solver_io.build_fake_fixtures([{'event': 1, 'team_h': 1, 'team_a': 2}])
    assert fixtures == [{'event': 1, 'team_h': 1, 'team_a': 2}]


# ---------------------------------------------------------------------------
# replay.py -- fold selection (pure)
# ---------------------------------------------------------------------------

def test_fold_for_gw_picks_the_latest_cutoff_not_exceeding_g():
    assert replay.fold_for_gw(1) == 1
    assert replay.fold_for_gw(7) == 1
    assert replay.fold_for_gw(8) == 8
    assert replay.fold_for_gw(21) == 15
    assert replay.fold_for_gw(38) == 36


def test_build_team_fixtures_marks_double_and_blank_gameweeks():
    fixtures = pd.DataFrame([
        {'event': 1, 'id': 900, 'team_h': 1, 'team_a': 2, 'kickoff_time': '2025-08-15T14:00:00Z'},
        {'event': 2, 'id': 901, 'team_h': 1, 'team_a': 3, 'kickoff_time': '2025-08-22T14:00:00Z'},
        {'event': 2, 'id': 902, 'team_h': 4, 'team_a': 1, 'kickoff_time': '2025-08-25T18:00:00Z'},
    ])
    teams = pd.DataFrame([
        {'id': 1, 'code': 11}, {'id': 2, 'code': 12}, {'id': 3, 'code': 13}, {'id': 4, 'code': 14},
    ])
    team_fixtures = replay.build_team_fixtures(fixtures, teams)

    team1_gw2 = team_fixtures[(team_fixtures['team_code'] == 11) & (team_fixtures['gw'] == 2)]
    assert sorted(team1_gw2['slot']) == [0, 1]  # double gameweek

    team2_gw2 = team_fixtures[(team_fixtures['team_code'] == 12) & (team_fixtures['gw'] == 2)]
    assert team2_gw2.empty  # blank gameweek for team 2 (code 12) at gw2


# ---------------------------------------------------------------------------
# live.project_horizon -- the new `season` parameter, small synthetic 2025-26 season.
# Same style tests/test_live.py already uses for the (unmodified) default-season path.
# ---------------------------------------------------------------------------

_PLAYERS = [
    # code, team_code, opp_team_code, position, minutes, points, value
    (2001, 3, 7, 'MID', 85, 5, 80),
    (2002, 7, 11, 'FWD', 88, 7, 95),
    (2003, 90, 13, 'DEF', 90, 3, 50),
]

_STAT_DEFAULTS = {
    'goals_scored': 0, 'assists': 0, 'expected_goals': 0.0, 'expected_assists': 0.0,
    'expected_goals_conceded': 0.0, 'bps': 20, 'bonus': 0, 'ict_index': 5.0, 'threat': 10.0,
    'creativity': 10.0, 'influence': 10.0, 'saves': 0, 'clean_sheets': 0, 'goals_conceded': 1,
    'starts': 1, 'defensive_contribution': 2,
}


def _row(code, season, gw, team_code, opp_team_code, position, minutes, total_points, value):
    return dict(
        code=code, season=season, gw=gw, team_code=team_code, position=position,
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


@pytest.fixture(scope='module')
def replay_season_history():
    rows = []
    for code, team_code, opp_team_code, position, minutes, points, value in _PLAYERS:
        for gw in range(5, 10):
            rows.append(_row(code, '2025-26', gw, team_code, opp_team_code, position, minutes, points, value))
    return _make_history(rows)


@pytest.fixture(scope='module')
def replay_snapshot():
    return pd.DataFrame([
        {'code': 2001, 'position': 'MID', 'team_code': 3},
        {'code': 2002, 'position': 'FWD', 'team_code': 7},
        {'code': 2003, 'position': 'DEF', 'team_code': 90},
    ])


@pytest.fixture(scope='module')
def replay_team_fixtures():
    # team 3 (Arsenal-analogue): single fixture at gw10.
    # team 7 (Aston-Villa-analogue): DOUBLE gameweek at gw11 -- two slots.
    # team 90 (Chelsea-analogue): only fixture at gw15, outside the gw10-14 horizon -- BLANK.
    rows = [
        {'gw': 10, 'slot': 0, 'team_code': 3, 'opp_team_code': 11, 'was_home': True, 'fixture_id': 1},
        {'gw': 11, 'slot': 0, 'team_code': 7, 'opp_team_code': 11, 'was_home': True, 'fixture_id': 2},
        {'gw': 11, 'slot': 1, 'team_code': 7, 'opp_team_code': 12, 'was_home': False, 'fixture_id': 3},
        {'gw': 15, 'slot': 0, 'team_code': 90, 'opp_team_code': 13, 'was_home': True, 'fixture_id': 4},
    ]
    return pd.DataFrame(rows)


@pytest.fixture(scope='module')
def replay_models(replay_season_history):
    training_frame = build_training_frame(replay_season_history)
    return fit(training_frame, 'total_points', seed=0), fit(training_frame, 'minutes', seed=0)


def test_project_horizon_season_param_runs_a_different_season(
        replay_season_history, replay_snapshot, replay_team_fixtures, replay_models):
    points_model, minutes_model = replay_models
    raw = live.project_horizon(
        replay_season_history, replay_snapshot, replay_team_fixtures, fixture_lambda={},
        next_gw=10, points_model=points_model, minutes_model=minutes_model,
        horizon=5, last_gw=38, season='2025-26',
    )
    assert set(raw['gw']) == {10, 11, 12, 13, 14}
    for code, *_rest in _PLAYERS:
        sub = raw[raw['code'] == code]
        assert len(sub) == 5
        assert not sub['raw_points'].isna().any()
        assert not sub['raw_minutes'].isna().any()


def test_project_horizon_season_param_blank_gw_is_zero(
        replay_season_history, replay_snapshot, replay_team_fixtures, replay_models):
    points_model, minutes_model = replay_models
    raw = live.project_horizon(
        replay_season_history, replay_snapshot, replay_team_fixtures, fixture_lambda={},
        next_gw=10, points_model=points_model, minutes_model=minutes_model,
        horizon=5, last_gw=38, season='2025-26',
    )
    che = raw[raw['code'] == 2003]  # Chelsea-analogue: only fixture (gw15) is outside gw10-14
    assert (che['raw_points'] == 0.0).all()
    assert (che['raw_minutes'] == 0.0).all()


def test_project_horizon_season_param_dgw_sums_two_fixtures(
        replay_season_history, replay_snapshot, replay_team_fixtures, replay_models):
    points_model, minutes_model = replay_models
    from fpl_model.features import build_decision_frame
    from fpl_model.train import predict

    avl = replay_snapshot[replay_snapshot['code'] == 2002][['code', 'position', 'team_code']].copy()

    slot0 = avl.assign(opp_team_code=11, was_home=True, fixture_id=2)
    dec0 = build_decision_frame(replay_season_history, ('2025-26', 11),
                                 slot0[['code', 'team_code', 'opp_team_code', 'was_home', 'position']])
    slot1 = avl.assign(opp_team_code=12, was_home=False, fixture_id=3)
    dec1 = build_decision_frame(replay_season_history, ('2025-26', 11),
                                 slot1[['code', 'team_code', 'opp_team_code', 'was_home', 'position']])
    expected = float(predict(points_model, dec0)[0]) + float(predict(points_model, dec1)[0])

    raw = live.project_horizon(
        replay_season_history, replay_snapshot, replay_team_fixtures, fixture_lambda={},
        next_gw=10, points_model=points_model, minutes_model=minutes_model,
        horizon=5, last_gw=38, season='2025-26',
    )
    actual = raw[(raw['code'] == 2002) & (raw['gw'] == 11)]['raw_points'].iloc[0]
    assert actual == pytest.approx(expected)


def test_project_horizon_default_season_is_the_live_modules_own_season(
        replay_season_history, replay_snapshot, replay_team_fixtures, replay_models, monkeypatch):
    """Every existing caller (`live.run`) omits `season` -- confirms the default still resolves
    to the live module's own `SEASON` ('2026-27'), by capturing the `decision` tuple
    `build_decision_frame` is actually called with, rather than inferring it from numeric output
    (which two single-season history fixtures can coincidentally agree on -- rolling features
    sort by `(code, season_index, gw)`, so a decision row with no history in ITS OWN season still
    sorts after every row of an earlier season regardless of which later season it is tagged
    with, and produces the same prediction either way; the `decision` tuple itself is the real,
    unambiguous signal that `season` was threaded through)."""
    seen_decisions: list[tuple[str, int]] = []
    real_build_decision_frame = live.build_decision_frame

    def _spy(history, decision, *args, **kwargs):
        seen_decisions.append(decision)
        return real_build_decision_frame(history, decision, *args, **kwargs)

    monkeypatch.setattr(live, 'build_decision_frame', _spy)
    points_model, minutes_model = replay_models

    live.project_horizon(
        replay_season_history, replay_snapshot, replay_team_fixtures, fixture_lambda={},
        next_gw=10, points_model=points_model, minutes_model=minutes_model, horizon=1, last_gw=38,
    )
    assert seen_decisions and all(season == live.SEASON for season, _gw in seen_decisions)

    seen_decisions.clear()
    live.project_horizon(
        replay_season_history, replay_snapshot, replay_team_fixtures, fixture_lambda={},
        next_gw=10, points_model=points_model, minutes_model=minutes_model, horizon=1, last_gw=38,
        season='2025-26',
    )
    assert seen_decisions and all(season == '2025-26' for season, _gw in seen_decisions)
