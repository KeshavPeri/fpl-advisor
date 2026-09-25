"""Four seasons of historical 1X2 odds, converted to expected goals. Ticket #259.

Reads every `model/data/odds/E0_*.csv` (football-data.co.uk), maps team names to FPL team
`code` via the explicit dict in `team_names.py`, and outputs one row per match with the
contract columns below.

Decision already made (not this ticket's to revisit): the live `fixture_odds` table carries
1X2 prices only, so `lambda_home`/`lambda_away` here are computed from 1X2 only, for parity
with what the live path will see at serve time. Over/under 2.5 is not read for the output
columns (it is exercised only in tests, to validate that the 1X2-only ranking is close enough
to the 1X2+O/U fit).
"""

from __future__ import annotations

import glob
import os

import numpy as np
import pandas as pd

from fpl_odds.implied import goal_expectancy, remove_overround
from fpl_odds.team_names import TEAM_CODES

_ODDS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "odds")

CONTRACT_COLUMNS = [
    "season",
    "gw",
    "kickoff_date",
    "home_code",
    "away_code",
    "p_home",
    "p_draw",
    "p_away",
    "lambda_home",
    "lambda_away",
    "source",
]

_PRIMARY_1X2 = ("AvgH", "AvgD", "AvgA")
_FALLBACK_1X2 = ("B365H", "B365D", "B365A")


def _season_label(path: str) -> str:
    """`E0_2223.csv` -> `'2022-23'` -- the format `fpl_model.sources`/`fpl_model.features` use
    for `season` (`SEASON_ORDER`), not the raw `'2223'` file-name label. Ticket #264: this was a
    contract bug in #261 -- nothing joins to `history` without it (the orchestrator's first join
    attempt matched 0 rows)."""
    base = os.path.basename(path)
    raw = base[len("E0_") : -len(".csv")]
    return f"20{raw[:2]}-{raw[2:]}"


def _row_1x2_odds(row: pd.Series) -> dict:
    """`AvgH/AvgD/AvgA`, falling back to `B365H/B365D/B365A` per row if the Avg price is
    missing."""
    odds = {}
    for outcome, primary, fallback in zip(("home", "draw", "away"), _PRIMARY_1X2, _FALLBACK_1X2):
        value = row.get(primary)
        if value is None or (isinstance(value, float) and np.isnan(value)):
            value = row.get(fallback)
        odds[outcome] = value
    return odds


def load_odds_history() -> pd.DataFrame:
    """Read every `model/data/odds/E0_*.csv`, convert 1X2 prices to expected goals, and return
    the contract-columns DataFrame. `gw` is left null here — ticket #264 (`fpl_model.features`)
    joins on `(season, home_code, away_code)` instead: each ordered pairing happens once a
    season, so neither `gw` nor `kickoff_date` is needed for the join."""
    paths = sorted(glob.glob(os.path.join(_ODDS_DIR, "E0_*.csv")))
    records = []
    unmapped_count = 0

    for path in paths:
        season = _season_label(path)
        df = pd.read_csv(path, encoding="latin-1")

        for _, row in df.iterrows():
            home_name = row.get("HomeTeam")
            away_name = row.get("AwayTeam")
            home_code = TEAM_CODES.get(home_name)
            away_code = TEAM_CODES.get(away_name)
            if home_code is None or away_code is None:
                unmapped_count += 1
                continue

            odds = _row_1x2_odds(row)
            if any(value is None or (isinstance(value, float) and np.isnan(value)) for value in odds.values()):
                # No usable 1X2 price on this row at all (neither Avg nor B365) -- skip rather
                # than fabricate a probability.
                unmapped_count += 1
                continue

            probs = remove_overround(odds)
            lambda_home, lambda_away = goal_expectancy(probs["home"], probs["draw"], probs["away"])

            records.append(
                {
                    "season": season,
                    "gw": None,
                    "kickoff_date": pd.to_datetime(row.get("Date"), format="%d/%m/%Y"),
                    "home_code": home_code,
                    "away_code": away_code,
                    "p_home": probs["home"],
                    "p_draw": probs["draw"],
                    "p_away": probs["away"],
                    "lambda_home": lambda_home,
                    "lambda_away": lambda_away,
                    "source": "football-data",
                }
            )

    if unmapped_count:
        print(f"fpl_odds.history: skipped {unmapped_count} row(s) with an unmapped team name or no usable 1X2 price")

    return pd.DataFrame.from_records(records, columns=CONTRACT_COLUMNS)
