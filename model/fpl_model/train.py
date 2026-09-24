"""Fit and predict with the gbm-v1 points/minutes models (docs/model-diagnosis-2026-09-24.md §4a,
§8). Uses LightGBM when it is installed (it is — see model/README.md); falls back to scikit-learn's
`HistGradientBoostingRegressor` otherwise, per the ticket's instruction ("if LightGBM won't
install, use scikit-learn ... and say so").

Signatures below are FROZEN (docs/model-diagnosis-2026-09-24.md §8) — later tickets only import.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from fpl_model.features import FEATURES

PARAMS = dict(
    objective='regression', learning_rate=0.03, num_leaves=31, min_data_in_leaf=100,
    feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1,
)
NUM_BOOST_ROUND = 600

try:
    import lightgbm as lgb
    BACKEND = 'lightgbm'
except ImportError:  # pragma: no cover - exercised only when lightgbm cannot install
    lgb = None
    BACKEND = 'sklearn'
    print('WARNING: lightgbm is not installed; falling back to '
          'sklearn.ensemble.HistGradientBoostingRegressor (docs/model-diagnosis-2026-09-24.md §8).')


class Model:
    """Thin wrapper so `fit`/`predict`/`contributions` work identically over either backend."""

    def __init__(self, booster: Any, feats: list[str]):
        self.booster = booster
        self.feats = feats


def fit(frame: pd.DataFrame, target: str, seed: int = 0) -> Model:
    """target: 'total_points' | 'minutes'."""
    train = frame.dropna(subset=[target])
    x = train[FEATURES]
    y = train[target]
    if BACKEND == 'lightgbm':
        params = dict(PARAMS, seed=seed)
        booster = lgb.train(params, lgb.Dataset(x, y), num_boost_round=NUM_BOOST_ROUND)
    else:
        from sklearn.ensemble import HistGradientBoostingRegressor
        booster = HistGradientBoostingRegressor(
            learning_rate=0.03, max_leaf_nodes=31, min_samples_leaf=100,
            l2_regularization=1.0, max_iter=NUM_BOOST_ROUND, random_state=seed,
        )
        booster.fit(x, y)
    return Model(booster, FEATURES)


def predict(model: Model, frame: pd.DataFrame) -> np.ndarray:
    x = frame[model.feats]
    if BACKEND == 'lightgbm':
        return model.booster.predict(x)
    return model.booster.predict(x)


def contributions(model: Model, frame: pd.DataFrame, top: int = 5) -> list[list[dict]]:
    """Top `top` features by |contribution| per row, for the `components.drivers` shape
    (docs/model-diagnosis-2026-09-24.md §6b). LightGBM's `pred_contrib=True` gives one column per
    feature plus a trailing bias column; sklearn has no equivalent, so contributions there fall
    back to |value - training mean| x nothing meaningful is claimed — an empty list per row, since
    a wrong "driver" is worse than none (the reasoning screen already treats a missing gbm-v1
    breakdown as falling back to baseline-v1, per R2-T3)."""
    if BACKEND != 'lightgbm':
        return [[] for _ in range(len(frame))]
    x = frame[model.feats]
    raw = model.booster.predict(x, pred_contrib=True)
    feats = model.feats
    out: list[list[dict]] = []
    for row in raw:
        pairs = list(zip(feats, row[:-1]))  # drop the trailing bias/expected-value column
        pairs.sort(key=lambda p: abs(p[1]), reverse=True)
        out.append([{'feature': f, 'contribution': float(v)} for f, v in pairs[:top]])
    return out
