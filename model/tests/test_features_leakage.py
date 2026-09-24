"""Leakage tests (docs/model-diagnosis-2026-09-24.md §7, §8), on a small synthetic `history`
frame conforming to the frozen schema — no network needed. All three cases:

  1. Changing gameweek g's actuals leaves gameweek g's own features unchanged (a row's features
     never depend on its own performance).
  2. A synthetic player whose points jump only at g+1 has no feature change at g (a row's
     features never depend on a later row's performance).
  3. Training rows for a fold never include the test season at or after the cutoff.
"""
import numpy as np
import pandas as pd

from fpl_model.features import FEATURES, build_training_frame
from fpl_model.sources import HISTORY_COLUMNS

_STAT_DEFAULTS = {
    'minutes': 0, 'total_points': 0, 'goals_scored': 0, 'assists': 0, 'expected_goals': 0.0,
    'expected_assists': 0.0, 'expected_goals_conceded': 0.0, 'bps': 0, 'bonus': 0, 'ict_index': 0.0,
    'threat': 0.0, 'creativity': 0.0, 'influence': 0.0, 'saves': 0, 'clean_sheets': 0,
    'goals_conceded': 0, 'starts': 0, 'defensive_contribution': 0,
}


def _row(code, season, gw, team_code=1, opp_team_code=2, **overrides):
    row = dict(
        code=code, season=season, gw=gw, team_code=team_code, position='MID',
        value=55, own_pct_rank=0.5, transfers_rank=0.5, nfix=1, was_home=1.0,
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


def _players_history(n_gws=6, code=101, minutes=90, points=4):
    return _make_history([
        _row(code, '2024-25', gw, minutes=minutes, total_points=points, goals_scored=1)
        for gw in range(1, n_gws + 1)
    ])


def test_changing_gw_g_actuals_leaves_gw_g_features_unchanged():
    base = _players_history()
    g = 4
    frame_a = build_training_frame(base)
    row_a = frame_a[frame_a['gw'] == g].iloc[0][FEATURES]

    changed = base.copy()
    mask = changed['gw'] == g
    changed.loc[mask, 'total_points'] = 99
    changed.loc[mask, 'minutes'] = 1
    changed.loc[mask, 'goals_scored'] = 7
    frame_b = build_training_frame(changed)
    row_b = frame_b[frame_b['gw'] == g].iloc[0][FEATURES]

    pd.testing.assert_series_equal(row_a, row_b, check_names=False)


def test_future_jump_does_not_change_earlier_features():
    """A synthetic player whose points jump only at g+1 has no feature change at g."""
    code = 202
    rows = [_row(code, '2024-25', gw, minutes=90, total_points=2, goals_scored=0) for gw in range(1, 8)]
    baseline = _make_history(rows)

    jumped = [dict(r) for r in rows]
    for r in jumped:
        if r['gw'] == 5:  # the jump happens at g+1 relative to g=4
            r['total_points'] = 20
            r['goals_scored'] = 3
            r['minutes'] = 90
    jumped = _make_history(jumped)

    g = 4
    frame_base = build_training_frame(baseline)
    frame_jump = build_training_frame(jumped)
    row_base = frame_base[frame_base['gw'] == g].iloc[0][FEATURES]
    row_jump = frame_jump[frame_jump['gw'] == g].iloc[0][FEATURES]

    pd.testing.assert_series_equal(row_base, row_jump, check_names=False)

    # sanity: gw 6 (the row right after the jump) DOES see it, so the test is meaningful.
    row_base_after = frame_base[frame_base['gw'] == 6].iloc[0][FEATURES]
    row_jump_after = frame_jump[frame_jump['gw'] == 6].iloc[0][FEATURES]
    assert not row_base_after.equals(row_jump_after)


def test_training_rows_never_include_test_season_at_or_after_cutoff():
    """Mirrors evaluate.py's own walk-forward filter: it must never admit a test-season row at or
    after the retrain cutoff into the training set."""
    rows = []
    for season in ['2022-23', '2023-24', '2025-26']:
        for gw in range(1, 11):
            rows.append(_row(303, season, gw))
    history = _make_history(rows)
    frame = build_training_frame(history)

    test_si = 3  # '2025-26' in SEASON_ORDER
    cutoff = 8
    train_rows = frame[(frame['si'] < test_si) | ((frame['si'] == test_si) & (frame['gw'] < cutoff))]

    leaked = train_rows[(train_rows['season'] == '2025-26') & (train_rows['gw'] >= cutoff)]
    assert leaked.empty
