"""Ticket #259 DoD tests 4-6 for `fpl_odds.history`, plus a basic contract-shape check."""

from __future__ import annotations

import glob
import os

import numpy as np
import pandas as pd
import pytest
from scipy.stats import spearmanr

from fpl_odds.history import CONTRACT_COLUMNS, load_odds_history
from fpl_odds.implied import goal_expectancy, remove_overround
from fpl_odds.team_names import TEAM_CODES

_ODDS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "odds")

# The 2026-27 season (E0_2627.csv) is only partway through (50 of 380 matches at the time this
# ticket was written) -- the "every row of a finished season maps to two codes" and
# clean-sheet / Spearman checks below are scoped to the four finished seasons.
_FINISHED_SEASONS = ["2223", "2324", "2425", "2526"]
_MATCHES_PER_FINISHED_SEASON = 380


def _read_season(season: str) -> pd.DataFrame:
    return pd.read_csv(os.path.join(_ODDS_DIR, f"E0_{season}.csv"), encoding="latin-1")


def _lambdas_for_season(df: pd.DataFrame, *, use_over_under: bool):
    """Returns two parallel lists of (lambda_home, lambda_away) and the raw FTHG/FTAG, one
    entry per match, computed straight from the CSV's Avg 1X2 (and optionally Avg O/U 2.5)
    columns."""
    lambda_homes = []
    lambda_aways = []
    for _, row in df.iterrows():
        probs_1x2 = remove_overround({"home": row["AvgH"], "draw": row["AvgD"], "away": row["AvgA"]})
        p_over25 = None
        if use_over_under:
            probs_ou = remove_overround({"over": row["Avg>2.5"], "under": row["Avg<2.5"]})
            p_over25 = probs_ou["over"]
        lambda_home, lambda_away = goal_expectancy(probs_1x2["home"], probs_1x2["draw"], probs_1x2["away"], p_over25)
        lambda_homes.append(lambda_home)
        lambda_aways.append(lambda_away)
    return lambda_homes, lambda_aways


def test_all_odds_csvs_present():
    paths = sorted(glob.glob(os.path.join(_ODDS_DIR, "E0_*.csv")))
    seasons = {os.path.basename(p)[len("E0_") : -len(".csv")] for p in paths}
    assert seasons == {"2223", "2324", "2425", "2526", "2627"}


@pytest.mark.parametrize("season", _FINISHED_SEASONS)
def test_every_finished_season_row_maps_to_two_team_codes(season):
    df = _read_season(season)
    assert len(df) == _MATCHES_PER_FINISHED_SEASON

    unmapped = set()
    for _, row in df.iterrows():
        home_name, away_name = row["HomeTeam"], row["AwayTeam"]
        if home_name not in TEAM_CODES:
            unmapped.add(home_name)
        if away_name not in TEAM_CODES:
            unmapped.add(away_name)

    assert unmapped == set(), f"unmapped team name(s) in {season}: {sorted(unmapped)}"


def test_load_odds_history_contract_shape():
    df = load_odds_history()

    assert list(df.columns) == CONTRACT_COLUMNS
    assert (df["source"] == "football-data").all()
    assert df["gw"].isna().all()
    # Ticket #264: `season` must be '2022-23' style (matching `fpl_model.features.SEASON_ORDER`),
    # not the raw '2223' file-name label -- otherwise nothing joins to `history`. The orchestrator's
    # first join attempt against the un-fixed '2223' style matched 0 rows.
    assert set(df["season"].unique()) == {"2022-23", "2023-24", "2024-25", "2025-26", "2026-27"}
    # Every finished season contributes exactly 380 rows; 2026-27 contributes whatever is
    # committed so far (50 at the time of writing) -- assert only the lower bound so this test
    # does not need updating every time more of the current season is committed.
    assert len(df) >= 4 * _MATCHES_PER_FINISHED_SEASON
    for col in ("p_home", "p_draw", "p_away"):
        assert df[col].between(0, 1).all()
    probs_sum = df["p_home"] + df["p_draw"] + df["p_away"]
    assert np.allclose(probs_sum, 1.0, atol=1e-6)
    for col in ("lambda_home", "lambda_away"):
        assert df[col].between(0.05, 5.0).all()


@pytest.mark.parametrize("season", _FINISHED_SEASONS)
def test_clean_sheet_rate_within_tolerance_using_1x2_plus_over_under(season):
    df = _read_season(season)
    lambda_homes, lambda_aways = _lambdas_for_season(df, use_over_under=True)

    # Each match gives two team-fixture entries: the home team's clean-sheet chance depends on
    # the away team's expected goals, and vice versa.
    predicted = []
    actual = []
    for lambda_home, lambda_away, fthg, ftag in zip(lambda_homes, lambda_aways, df["FTHG"], df["FTAG"]):
        predicted.append(np.exp(-lambda_away))
        actual.append(1.0 if ftag == 0 else 0.0)
        predicted.append(np.exp(-lambda_home))
        actual.append(1.0 if fthg == 0 else 0.0)

    mean_predicted = float(np.mean(predicted))
    actual_rate = float(np.mean(actual))

    assert abs(mean_predicted - actual_rate) < 0.05, (
        f"{season}: predicted mean clean-sheet {mean_predicted:.3f} vs actual {actual_rate:.3f}"
    )


@pytest.mark.parametrize("season", _FINISHED_SEASONS)
def test_1x2_only_ranks_like_1x2_plus_over_under(season):
    df = _read_season(season)
    lambda_homes_1x2, lambda_aways_1x2 = _lambdas_for_season(df, use_over_under=False)
    lambda_homes_ou, lambda_aways_ou = _lambdas_for_season(df, use_over_under=True)

    # lambda_against for the home side is lambda_away, and for the away side is lambda_home --
    # pool both team-fixture entries per match, same as the clean-sheet test above.
    against_1x2 = lambda_aways_1x2 + lambda_homes_1x2
    against_ou = lambda_aways_ou + lambda_homes_ou

    correlation, _ = spearmanr(against_1x2, against_ou)

    assert correlation >= 0.98, f"{season}: Spearman {correlation:.4f}"
