"""Ticket #259 DoD tests 1-3 for `fpl_odds.implied`."""

from __future__ import annotations

import numpy as np
from scipy.stats import poisson

from fpl_odds.implied import goal_expectancy, remove_overround


def test_symmetric_input_gives_equal_lambda():
    # p_home == p_away -> the fitted lambda_home and lambda_away should match.
    p_home = 0.35
    p_away = 0.35
    p_draw = 1.0 - p_home - p_away

    lambda_home, lambda_away = goal_expectancy(p_home, p_draw, p_away)

    assert abs(lambda_home - lambda_away) < 0.01


def test_penaltyblog_reference_case():
    # (0.45, 0.28, 0.29) normalised to sum to 1 -- penaltyblog reference 1.342 / 1.019;
    # measured 1.343 / 1.021.
    raw_home, raw_draw, raw_away = 0.45, 0.28, 0.29
    total = raw_home + raw_draw + raw_away
    p_home, p_draw, p_away = raw_home / total, raw_draw / total, raw_away / total

    lambda_home, lambda_away = goal_expectancy(p_home, p_draw, p_away)

    assert 1.25 <= lambda_home <= 1.45
    assert 0.90 <= lambda_away <= 1.10


def test_round_trip_recovers_known_lambda():
    known_lambda_home = 1.6
    known_lambda_away = 1.2

    goals = np.arange(0, 11)
    home_pmf = poisson.pmf(goals, known_lambda_home)
    away_pmf = poisson.pmf(goals, known_lambda_away)
    joint = np.outer(home_pmf, away_pmf)
    home_idx, away_idx = np.meshgrid(goals, goals, indexing="ij")

    p_home = joint[home_idx > away_idx].sum()
    p_draw = joint[home_idx == away_idx].sum()
    p_away = joint[home_idx < away_idx].sum()

    fitted_home, fitted_away = goal_expectancy(p_home, p_draw, p_away)

    assert abs(fitted_home - known_lambda_home) < 0.01
    assert abs(fitted_away - known_lambda_away) < 0.01


def test_remove_overround_matches_marketodds_ts_construction():
    # Mirrors src/lib/projection/marketOdds.ts removeOverround (lines 75-86): proportional
    # normalisation of 1/decimal_odds across outcomes.
    odds = {"home": 2.0, "draw": 3.5, "away": 4.0}

    probs = remove_overround(odds)

    raw = {key: 1.0 / value for key, value in odds.items()}
    overround = sum(raw.values())
    expected = {key: value / overround for key, value in raw.items()}

    assert probs.keys() == expected.keys()
    for key in expected:
        assert abs(probs[key] - expected[key]) < 1e-9
    assert abs(sum(probs.values()) - 1.0) < 1e-9
    assert overround > 1.0  # a real book always overrounds


def test_remove_overround_generalises_to_two_way_market():
    # The over/under 2.5 market has only two outcomes; the same function must serve it.
    odds = {"over": 1.9, "under": 1.95}

    probs = remove_overround(odds)

    assert set(probs.keys()) == {"over", "under"}
    assert abs(sum(probs.values()) - 1.0) < 1e-9
