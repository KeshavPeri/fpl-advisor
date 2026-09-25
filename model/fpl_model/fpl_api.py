"""Live FPL API state for the gbm-v1 nightly job (ticket #265 / R2-T2).

Splits network fetch (`fetch_bootstrap_static`, `fetch_fixtures`, `resolve_core_ref`) from pure
parsing (`parse_teams`, `next_gameweek`, `parse_snapshot`, `parse_team_fixtures`,
`parse_fixture_lookup`) so `model/tests/test_live.py` exercises every parsing rule against the
committed sample JSON with no network call at all -- only `model/fpl_model/live.py`'s `run()`
calls the fetch functions.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import requests

BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/'
FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/'

# Ticket #265 step 2: resolve FPL-Core-Insights' `main` to a commit sha fresh every run and pass
# THAT to sources.load_history -- never the literal 'main'. sources._fetch caches by file name
# forever, so a 'main' cache would go stale the moment the upstream repo moves (see
# model/fpl_model/sources.py's own header).
CORE_COMMITS_URL = 'https://api.github.com/repos/olbauday/FPL-Core-Insights/commits/main'

_REQUEST_TIMEOUT = 30

_POSITION_BY_ELEMENT_TYPE = {1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD'}


class FplApiError(RuntimeError):
    """Raised when the live FPL API (or the GitHub commits API used to resolve the Core sha)
    cannot be fetched or does not parse as expected. Never caught silently -- `live.py` stops and
    reports, same convention as `sources.SourceUnavailableError`."""


def fetch_bootstrap_static() -> dict:
    try:
        resp = requests.get(BOOTSTRAP_URL, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise FplApiError(f'could not fetch {BOOTSTRAP_URL}: {exc}') from exc


def fetch_fixtures() -> list[dict]:
    try:
        resp = requests.get(FIXTURES_URL, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise FplApiError(f'could not fetch {FIXTURES_URL}: {exc}') from exc


def resolve_core_ref() -> str:
    """The current HEAD commit sha of FPL-Core-Insights' `main` branch."""
    try:
        resp = requests.get(
            CORE_COMMITS_URL, headers={'Accept': 'application/vnd.github+json'},
            timeout=_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        sha = resp.json()['sha']
    except (requests.RequestException, ValueError, KeyError) as exc:
        raise FplApiError(f'could not resolve FPL-Core-Insights main sha: {exc}') from exc
    if not isinstance(sha, str) or not sha:
        raise FplApiError(f'unexpected response resolving FPL-Core-Insights main sha: {sha!r}')
    return sha


# ---------------------------------------------------------------------------
# Pure parsing -- no I/O below this line.
# ---------------------------------------------------------------------------

def parse_teams(bootstrap: dict) -> dict[int, int]:
    """FPL team id -> team `code` (bootstrap-static's `teams`)."""
    return {t['id']: t['code'] for t in bootstrap['teams']}


def parse_team_short_names(bootstrap: dict) -> dict[int, str]:
    """FPL team id -> `short_name`, for the printed summary only."""
    return {t['id']: t['short_name'] for t in bootstrap['teams']}


def next_gameweek(bootstrap: dict) -> int:
    """The FPL event id with `is_next = true`. This is also `player_projections.gameweek_id`
    (public.gameweeks.id IS the FPL event id -- see the #9 reference-schema migration)."""
    for e in bootstrap['events']:
        if e.get('is_next'):
            return int(e['id'])
    raise FplApiError('no event with is_next=true in bootstrap-static events')


def _cast_float(value: Any) -> float | None:
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_snapshot(bootstrap: dict) -> pd.DataFrame:
    """One row per `elements[]` entry: `id` (FPL element id = player_id), `code`, `team_code`,
    `team_short_name` (for the summary only), `position`, `status`,
    `chance_of_playing_next_round`, `now_cost` (already tenths), `selected_by_percent` (cast from
    the string FPL returns), `transfers_in_event`, `transfers_out_event`, `penalties_order`,
    `web_name`, plus `own_pct_rank`/`transfers_rank` -- the within-snapshot percentile ranks
    `build_decision_frame` reads when `own_pct_rank`/`transfers_rank` are not already present
    (see `features.build_decision_frame`'s fallback)."""
    team_codes = parse_teams(bootstrap)
    team_names = parse_team_short_names(bootstrap)
    rows = []
    for el in bootstrap['elements']:
        rows.append({
            'id': int(el['id']),
            'code': int(el['code']),
            'team_code': team_codes.get(el['team']),
            'team_short_name': team_names.get(el['team']),
            'position': _POSITION_BY_ELEMENT_TYPE.get(el['element_type']),
            'status': el.get('status') or 'a',
            'chance_of_playing_next_round': _cast_float(el.get('chance_of_playing_next_round')),
            'now_cost': el.get('now_cost'),
            'selected_by_percent': _cast_float(el.get('selected_by_percent')),
            'transfers_in_event': el.get('transfers_in_event') or 0,
            'transfers_out_event': el.get('transfers_out_event') or 0,
            'penalties_order': el.get('penalties_order'),
            'web_name': el.get('web_name', ''),
        })
    snap = pd.DataFrame(rows)
    if snap.empty:
        return snap
    snap['own_pct_rank'] = snap['selected_by_percent'].rank(pct=True, method='average').fillna(0.5)
    net = snap['transfers_in_event'] - snap['transfers_out_event']
    snap['transfers_rank'] = net.rank(pct=True, method='average').fillna(0.5)
    return snap


def parse_team_fixtures(fixtures: list[dict], teams: dict[int, int]) -> pd.DataFrame:
    """One row per (fixture, side): `fixture_id`, `gw`, `team_code`, `opp_team_code`,
    `was_home`, plus `slot` -- the 0-based index of this fixture among the team's fixtures in
    that gw, in fixture-id order. `slot == 0` is a team's only fixture in a normal gameweek, or
    the first leg of a double gameweek; `slot == 1` is a double gameweek's second leg. A fixture
    not yet assigned to a gameweek (`event` is null) is dropped -- it has no gw to project into
    yet."""
    rows = []
    for fx in fixtures:
        event = fx.get('event')
        if event is None:
            continue
        home_code = teams.get(fx.get('team_h'))
        away_code = teams.get(fx.get('team_a'))
        if home_code is None or away_code is None:
            continue
        rows.append({'fixture_id': fx['id'], 'gw': int(event), 'team_code': home_code,
                      'opp_team_code': away_code, 'was_home': True})
        rows.append({'fixture_id': fx['id'], 'gw': int(event), 'team_code': away_code,
                      'opp_team_code': home_code, 'was_home': False})
    df = pd.DataFrame(rows, columns=['fixture_id', 'gw', 'team_code', 'opp_team_code', 'was_home'])
    if df.empty:
        df['slot'] = pd.Series(dtype=int)
        return df
    df = df.sort_values(['gw', 'team_code', 'fixture_id']).reset_index(drop=True)
    df['slot'] = df.groupby(['gw', 'team_code']).cumcount()
    return df


def parse_fixture_lookup(fixtures: list[dict], teams: dict[int, int]) -> pd.DataFrame:
    """One row per fixture (wide, not per-side): `fixture_id`, `gw`, `home_code`, `away_code`,
    `kickoff_date` -- used to map Supabase `fixture_odds` rows (keyed on `fixture_id`) to
    gameweek and team codes for both the training-frame odds contract columns and the per-row
    `lambda_for`/`lambda_against` lookup."""
    rows = []
    for fx in fixtures:
        home_code = teams.get(fx.get('team_h'))
        away_code = teams.get(fx.get('team_a'))
        if home_code is None or away_code is None:
            continue
        event = fx.get('event')
        rows.append({
            'fixture_id': fx['id'],
            'gw': int(event) if event is not None else None,
            'home_code': home_code,
            'away_code': away_code,
            'kickoff_date': fx.get('kickoff_time'),
        })
    return pd.DataFrame(rows, columns=['fixture_id', 'gw', 'home_code', 'away_code', 'kickoff_date'])
