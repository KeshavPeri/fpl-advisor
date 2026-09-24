"""Market odds -> implied probabilities -> independent-Poisson expected goals.

Ticket #259. Source: penaltyblog `goal_expectancy` and opisthokonta.net "Expected goals from
bookmaker odds" — an independent-Poisson least-squares fit to the 1X2 (and optionally
over/under 2.5) market prices.

Pure computation only: no I/O, no database, no network. Mirrors `removeOverround` in
`src/lib/projection/marketOdds.ts` (lines 75-86) for the overround-removal step, generalised
here to any number of outcomes so the same function serves both the three-way 1X2 market and
the two-way over/under 2.5 market.
"""

from __future__ import annotations

from typing import Mapping, Optional, Tuple

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

# ============================================================================
# Overround removal — proportional, same construction as removeOverround in marketOdds.ts:
#   raw_i     = 1 / decimal_odds_i
#   overround = sum(raw_i)
#   p_i       = raw_i / overround
# Generalised from the TS version's fixed three keys (home/draw/away) to an arbitrary mapping
# of outcome name -> decimal odds, so it also serves the two-way over/under 2.5 market.
# ============================================================================


def remove_overround(odds: Mapping[str, float]) -> dict:
    """Proportional overround removal. `odds` maps each outcome name to its decimal price.

    Returns a dict with the same keys mapped to normalised probabilities that sum to 1.
    """
    raw = {key: 1.0 / value for key, value in odds.items()}
    overround = sum(raw.values())
    return {key: value / overround for key, value in raw.items()}


# ============================================================================
# goal_expectancy — independent-Poisson least-squares fit
# ============================================================================

_MAX_GOALS = 10
_GOALS = np.arange(0, _MAX_GOALS + 1)
_HOME_GOALS, _AWAY_GOALS = np.meshgrid(_GOALS, _GOALS, indexing="ij")
_HOME_WIN_MASK = _HOME_GOALS > _AWAY_GOALS
_DRAW_MASK = _HOME_GOALS == _AWAY_GOALS
_AWAY_WIN_MASK = _HOME_GOALS < _AWAY_GOALS
_OVER25_MASK = (_HOME_GOALS + _AWAY_GOALS) >= 3

_START = (1.3, 1.1)
_BOUNDS = [(0.05, 5.0), (0.05, 5.0)]


def _match_probabilities(lambda_home: float, lambda_away: float) -> Tuple[float, float, float, float]:
    """Model-implied P(home win), P(draw), P(away win), P(over 2.5) for a given (lambda_home,
    lambda_away) under independent Poisson scoring, goals 0-10."""
    home_pmf = poisson.pmf(_GOALS, lambda_home)
    away_pmf = poisson.pmf(_GOALS, lambda_away)
    joint = np.outer(home_pmf, away_pmf)
    p_home = joint[_HOME_WIN_MASK].sum()
    p_draw = joint[_DRAW_MASK].sum()
    p_away = joint[_AWAY_WIN_MASK].sum()
    p_over25 = joint[_OVER25_MASK].sum()
    return p_home, p_draw, p_away, p_over25


def _objective(
    params: np.ndarray,
    p_home: float,
    p_draw: float,
    p_away: float,
    p_over25: Optional[float],
) -> float:
    lambda_home, lambda_away = params
    model_home, model_draw, model_away, model_over25 = _match_probabilities(lambda_home, lambda_away)
    error = (model_home - p_home) ** 2 + (model_draw - p_draw) ** 2 + (model_away - p_away) ** 2
    if p_over25 is not None:
        error += (model_over25 - p_over25) ** 2
    return error


def goal_expectancy(
    p_home: float,
    p_draw: float,
    p_away: float,
    p_over25: Optional[float] = None,
) -> Tuple[float, float]:
    """Fit independent-Poisson (lambda_home, lambda_away) to the 1X2 probabilities (and
    optionally the over/under 2.5 probability) by least squares, `scipy.optimize.minimize`
    L-BFGS-B, bounds [0.05, 5.0], start (1.3, 1.1).
    """
    result = minimize(
        _objective,
        x0=np.array(_START, dtype=float),
        args=(p_home, p_draw, p_away, p_over25),
        method="L-BFGS-B",
        bounds=_BOUNDS,
    )
    lambda_home, lambda_away = result.x
    return float(lambda_home), float(lambda_away)
