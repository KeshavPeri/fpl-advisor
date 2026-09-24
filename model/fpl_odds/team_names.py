"""football-data.co.uk team name -> FPL team `code` mapping. Ticket #259.

Exact dict, no fuzzy matching. These are the only 27 team names that appear anywhere across
the five committed `model/data/odds/E0_*.csv` files (2022-23 .. 2026-27, the last partial).
Checked by hand against vaastav `Fantasy-Premier-League` `data/{season}/teams.csv` at SHA
`9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88` for all five seasons.

A name not in this dict is not guessed at — the caller (`history.py`) skips that row and
counts it rather than mapping it approximately.
"""

from __future__ import annotations

TEAM_CODES: dict[str, int] = {
    "Arsenal": 3,
    "Aston Villa": 7,
    "Bournemouth": 91,
    "Brentford": 94,
    "Brighton": 36,
    "Burnley": 90,
    "Chelsea": 8,
    "Coventry": 9,
    "Crystal Palace": 31,
    "Everton": 11,
    "Fulham": 54,
    "Hull": 88,
    "Ipswich": 40,
    "Leeds": 2,
    "Leicester": 13,
    "Liverpool": 14,
    "Luton": 102,
    "Man City": 43,
    "Man United": 1,
    "Newcastle": 4,
    "Nott'm Forest": 17,
    "Sheffield United": 49,
    "Southampton": 20,
    "Sunderland": 56,
    "Tottenham": 6,
    "West Ham": 21,
    "Wolves": 39,
}
