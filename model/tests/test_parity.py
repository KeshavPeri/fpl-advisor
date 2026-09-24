"""Parity test (docs/model-diagnosis-2026-09-24.md §8): for 2025-26 GW 20, `build_decision_frame`
rows equal `build_training_frame` rows for the same players, column for column.

Uses real vaastav data (cached under model/.cache/) because the parity guarantee is about the
real pipeline, not a hand-built fixture. `build_decision_frame` is fed the *same* context
(team/opponent/home flag, price, ownership and transfer ranks) that GW20's own historical row
already carries, extracted from a later `load_history` cutoff before it drops out of view."""
import pandas as pd
import pytest

from fpl_model.features import FEATURES, build_decision_frame, build_training_frame
from fpl_model.sources import load_history

DECISION_GW = 20
CONTEXT_COLS = ['position', 'value', 'was_home', 'nfix']


@pytest.fixture(scope='module')
def frames():
    full = load_history(('2025-26', DECISION_GW + 1))
    train_full = build_training_frame(full)
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
        history_before, ('2025-26', DECISION_GW), target_fixtures, snapshot=snapshot,
    ).set_index('code')
    return gw20_train, decision


def test_same_players(frames):
    gw20_train, decision = frames
    assert len(decision) > 500  # a real gameweek's worth of players, not an empty frame
    assert set(decision.index) == set(gw20_train.index)


@pytest.mark.parametrize('col', FEATURES + CONTEXT_COLS)
def test_column_matches(frames, col):
    gw20_train, decision = frames
    a = decision[col]
    b = gw20_train.loc[decision.index, col]
    if a.dtype == object or b.dtype == object:
        assert (a.astype(str) == b.astype(str)).all(), f'{col} differs for at least one player'
    else:
        close = ((a - b).abs() < 1e-9) | (a.isna() & b.isna())
        assert close.all(), f'{col} differs for at least one player'
