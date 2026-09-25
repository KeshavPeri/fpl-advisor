"""I/O against the real, pinned `sertalpbilal/FPL-Optimization-Tools` solver (ticket #281 item 4).
Builds `team.json`, the projections CSV and the settings-override config the same way
`scripts/build-solver-input.ts` does for the live app, invokes `uv run python run/solve.py
--config <file>` and parses the picks CSV it writes back.

============================================================================
Why this module fakes two FPL API endpoints, and how.
============================================================================
`dev/solver.py`'s `prep_data` (at the pinned commit) unconditionally calls
`cached_request("https://fantasy.premierleague.com/api/bootstrap-static/")` and
`.../api/fixtures/` -- the LIVE, current-season endpoints, with no override. A season replay
must run this solver against 2025-26's own players, teams and prices, which the live endpoints
cannot provide (today's bootstrap-static is 2026-27; FPL element ids are NOT stable across a
season boundary -- see `model/fpl_model/sources.py`'s own header on this). `utils.cached_request`
caches its response to `<solver_root>/.cache/http_cache.json`, keyed by URL, for
`CACHE_EXPIRATION` (300) seconds. `write_solver_cache` below pre-seeds that exact file with a
bootstrap-static/fixtures payload reconstructed from vaastav's pinned 2025-26 snapshot, with a
fresh timestamp, so `cached_request` returns it and never makes the live call. This is there
own caching mechanism, used as designed -- not a monkeypatch of the solver's code.

============================================================================
The one-time GW1 build's hit-cost is a solver-internal artefact, ignored on purpose.
============================================================================
Building a 15-man squad from nothing (`preseason: true`, mirroring this codebase's own
`buildRebuildSolverConfig` / ticket #134 / #160) transfers in all 15 players against an initial 0
free transfers. The solver's own objective prices that as `15 * hit_cost` -- but that term is a
CONSTANT added to every feasible squad's objective value at gameweek 1 (every valid 15-man squad
requires exactly 15 "transfers in" from an empty starting XI, so it cannot change WHICH squad the
solver picks). `replay.py` never reads the solver's own objective/score for this reason; it reads
only the picks CSV's `squad`/`lineup`/`captain` columns, and separately (and correctly) treats a
GW1 build as free of hits in its own net-points accounting -- see replay.py's module docstring.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Pinned solver
# ---------------------------------------------------------------------------

SOLVER_REPO = 'https://github.com/sertalpbilal/FPL-Optimization-Tools.git'
SOLVER_COMMIT = '45131c5a41d7caadb5cb626c012bfa9111dca7a2'

# ---------------------------------------------------------------------------
# Standard FPL squad-shape constants -- the `element_types` table
# `dev/solver.py`'s `prep_data`/`solve_multi_period_fpl` reads off a live
# bootstrap-static response. Unchanged for years; see rules.py's own
# SQUAD_SELECT/LINEUP_MIN_MAX for the same numbers used on our own side.
# ---------------------------------------------------------------------------

FPL_ELEMENT_TYPES = [
    {'id': 1, 'singular_name_short': 'GKP', 'squad_select': 2, 'squad_min_play': 1, 'squad_max_play': 1},
    {'id': 2, 'singular_name_short': 'DEF', 'squad_select': 5, 'squad_min_play': 3, 'squad_max_play': 5},
    {'id': 3, 'singular_name_short': 'MID', 'squad_select': 5, 'squad_min_play': 2, 'squad_max_play': 5},
    {'id': 4, 'singular_name_short': 'FWD', 'squad_select': 3, 'squad_min_play': 1, 'squad_max_play': 3},
]

POSITION_TO_ELEMENT_TYPE = {'GK': 1, 'DEF': 2, 'MID': 3, 'FWD': 4}
# dev/solver.py's inert (for our config) Pos-based filters use single letters ("G", "D", ...);
# scripts/emit-projections-csv.ts's own CSV uses the same convention for the live app's CSV.
POSITION_TO_CSV_POS = {'GK': 'G', 'DEF': 'D', 'MID': 'M', 'FWD': 'F'}

# ---------------------------------------------------------------------------
# Mirrors scripts/build-solver-input.ts's buildSolverConfig -- see that file's own constants and
# comments for the "because" behind each one; ticket #281 item 4 says to mirror every setting
# except hit_cost/num_iterations/secs (this module's own three deliberate deviations, named below).
# ---------------------------------------------------------------------------

XMIN_LB = 150
KEEP_TOP_EV_PERCENT = 25
EV_PER_PRICE_CUTOFF = 10
NO_TRANSFER_LAST_GWS = 0
DECAY_BASE = 0.9
FT_VALUE_LIST = {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}
CHIP_LIMITS = {'bb': 0, 'wc': 0, 'fh': 0, 'tc': 0}  # No chips (ticket #281 item 3).

# Ticket #281 item 4's three deliberate deviations from buildSolverConfig:
SOLVER_TIME_LIMIT_SECS = 60          # buildSolverConfig uses 300.
NUM_ITERATIONS = 1                   # buildSolverConfig uses 3 (Plan A/B/C) -- one plan per GW here.
# hit_cost itself is the setting under test -- passed as a parameter to build_solver_config, never
# a module constant.

# "No hits" (FT-only) setting -- ticket #281 item 5. `hit_limit` is dev/solver.py's own SEASON-total
# hard cap on `penalized_transfers` (`prep_data`/`solve_multi_period_fpl`: `if "hit_limit" in
# options: ... <= int(options["hit_limit"])`) -- a hard constraint, not an economic deterrent, so
# "no hits" means EXACTLY zero hits over the horizon, never merely "hits priced so high they are
# never worth it". See this module's docstring for why GW1's own forced 15-transfer build is
# exempt from this (and from every hit_cost setting): it is never priced as a real hit by replay.py.
NO_HITS_SENTINEL = 'no-hits'


def build_solver_config(horizon: int, datasource: str, hit_cost: int | str, next_gw: int,
                         secs: int = SOLVER_TIME_LIMIT_SECS, preseason: bool = False) -> dict:
    """`hit_cost` is either an int (the setting under test: 4, 6 or 8) or the literal
    `NO_HITS_SENTINEL` ('no-hits'), which sets `hit_limit: 0` instead (see the module-level note
    above) and passes a nominal `hit_cost` of 4 in the JSON (present for shape parity with
    `buildTeamJson`'s own analogous note on `HIT_COST`; unused once `hit_limit` forbids every
    hit)."""
    if horizon <= 0:
        raise ValueError(f'horizon must be positive, got {horizon}')
    config: dict = {
        'horizon': horizon,
        'team_data': 'json',
        'preseason': preseason,
        'xmin_lb': XMIN_LB,
        'keep_top_ev_percent': KEEP_TOP_EV_PERCENT,
        'ev_per_price_cutoff': EV_PER_PRICE_CUTOFF,
        'no_transfer_last_gws': NO_TRANSFER_LAST_GWS,
        'decay_base': DECAY_BASE,
        'ft_value_list': FT_VALUE_LIST,
        'datasource': datasource,
        'chip_limits': dict(CHIP_LIMITS),
        'secs': secs,
        'solver': 'highs',
        'num_iterations': NUM_ITERATIONS,
        'verbose': True,
        'print_result_table': True,
        'print_squads': True,
        'print_transfer_chip_summary': True,
        'override_next_gw': next_gw,
    }
    if hit_cost == NO_HITS_SENTINEL:
        config['hit_cost'] = 4
        config['hit_limit'] = 0
    else:
        config['hit_cost'] = int(hit_cost)
    return config


# ---------------------------------------------------------------------------
# team.json
# ---------------------------------------------------------------------------

def build_team_json(picks: list[dict], bank_tenths: int, free_transfers: int) -> dict:
    """`picks`: one dict per squad player --
    `{element, squad_position, element_type, purchase_price, selling_price, is_captain,
    is_vice_captain, is_starting}` (tenths for the two prices). Mirrors
    `scripts/build-solver-input.ts`'s `buildTeamJson` shape exactly (`chips: []` -- no chips
    ever granted, ticket #281 item 3; `transfers.made: 0` -- this replay always hands the solver
    a gameweek's transfers fresh, never partially spent)."""
    if len(picks) != 15:
        raise ValueError(f'team.json needs exactly 15 picks, got {len(picks)}')
    squad_value = sum(p['purchase_price'] for p in picks)
    return {
        'picks': [
            {
                'element': p['element'],
                'position': p['squad_position'],
                'purchase_price': p['purchase_price'],
                'selling_price': p['selling_price'],
                'element_type': p['element_type'],
                'multiplier': 2 if p['is_captain'] else 1 if p.get('is_starting', True) else 0,
                'is_captain': p['is_captain'],
                'is_vice_captain': p['is_vice_captain'],
            }
            for p in picks
        ],
        'chips': [],
        'transfers': {
            'bank': bank_tenths,
            'value': squad_value,
            'cost': 4,
            'limit': free_transfers,
            'made': 0,
        },
    }


def build_empty_team_json() -> dict:
    """`my_data` for the GW1 from-scratch build (`preseason: true` reads `itb`/`initial_ft` from
    its own hardcoded 100/0, not from this file -- see `dev/solver.py`'s `solve_multi_period_fpl`
    -- so the transfers block here is never actually read; `limit: 1` is a defensible placeholder
    kept for shape parity only)."""
    return {'picks': [], 'chips': [], 'transfers': {'bank': 0, 'value': 0, 'cost': 4, 'limit': 1, 'made': 0}}


# ---------------------------------------------------------------------------
# Fake bootstrap-static / fixtures -- see module docstring.
# ---------------------------------------------------------------------------

def build_fake_bootstrap(elements: list[dict], teams: list[dict]) -> dict:
    """`elements`: one dict per player -- `{id, team, element_type, now_cost, web_name}` (FPL's
    own live element id, team id, 1-4 position, tenths price, display name). `teams`: one dict
    per club -- `{id, name}`. Every field is exactly what `dev/solver.py`'s `prep_data` /
    `solve_multi_period_fpl` reads off a real bootstrap-static payload -- verified directly
    against the pinned commit's source, not assumed."""
    return {'elements': elements, 'teams': teams, 'element_types': FPL_ELEMENT_TYPES}


def build_fake_fixtures(fixtures: list[dict]) -> list[dict]:
    """`fixtures`: one dict per match -- `{event, team_h, team_a}` (gameweek id, home/away team
    ids). Matches the shape `prep_data` reads off `.../api/fixtures/` (`f["event"]`,
    `f["team_h"]`, `f["team_a"]`)."""
    return fixtures


def write_solver_cache(solver_dir: Path, bootstrap: dict, fixtures: list[dict]) -> None:
    """Pre-seeds `<solver_dir>/.cache/http_cache.json` (see module docstring) so
    `utils.cached_request` returns our historical payload instead of calling the live FPL API.
    Overwrites the whole cache file every call -- CACHE_EXPIRATION is only 300 seconds, and this
    replay calls the solver dozens of times across a season, so a fresh write before every solve
    is simpler and safer than trying to keep a shared cache valid across gameweeks."""
    cache_dir = solver_dir / '.cache'
    cache_dir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    cache = {
        'https://fantasy.premierleague.com/api/bootstrap-static/': {'timestamp': now, 'data': bootstrap},
        'https://fantasy.premierleague.com/api/fixtures/': {'timestamp': now, 'data': fixtures},
    }
    with open(cache_dir / 'http_cache.json', 'w') as f:
        json.dump(cache, f)


# ---------------------------------------------------------------------------
# Projections CSV -- shape from scripts/emit-projections-csv.ts's own header:
# ID,Pos,Name,Team,{gw}_Pts,{gw}_xMins,... (one {gw}_Pts/{gw}_xMins pair per horizon gameweek).
# ---------------------------------------------------------------------------

def build_projections_csv_rows(players: list[dict], horizon_gws: list[int]) -> list[dict]:
    """`players`: one dict per player -- `{id, position, name, team, points_by_gw, minutes_by_gw}`
    (`position` one of 'GK'/'DEF'/'MID'/'FWD'; `points_by_gw`/`minutes_by_gw` map gw -> float,
    missing gw treated as 0 -- zero-fill, never omission, matching
    scripts/emit-projections-csv.ts's own rule so a player with no fixture in the horizon still
    enters the solver's pool)."""
    rows = []
    for p in players:
        row = {'ID': p['id'], 'Pos': POSITION_TO_CSV_POS[p['position']], 'Name': p['name'], 'Team': p['team']}
        for gw in horizon_gws:
            row[f'{gw}_Pts'] = round(float(p['points_by_gw'].get(gw, 0.0)), 2)
            row[f'{gw}_xMins'] = round(float(p['minutes_by_gw'].get(gw, 0.0)), 1)
        rows.append(row)
    return rows


def write_projections_csv(path: Path, rows: list[dict], horizon_gws: list[int]) -> None:
    columns = ['ID', 'Pos', 'Name', 'Team'] + [c for gw in horizon_gws for c in (f'{gw}_Pts', f'{gw}_xMins')]
    df = pd.DataFrame(rows, columns=columns)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


# ---------------------------------------------------------------------------
# Running the solver and reading its output back.
# ---------------------------------------------------------------------------

class SolverError(RuntimeError):
    """The solver process exited non-zero, or produced no results CSV."""


def run_solver(solver_dir: Path, config_path: Path, timeout_secs: int = 180) -> str:
    """`uv run python run/solve.py --config <config_path>`, cwd=solver_dir (matches every solver-
    invoking workflow already in this repo -- solver-run.yml, squad-rebuild-probe.yml). Returns
    combined stdout/stderr; raises SolverError on a non-zero exit or a timeout."""
    try:
        result = subprocess.run(
            ['uv', 'run', 'python', 'run/solve.py', '--config', str(config_path)],
            cwd=solver_dir, capture_output=True, text=True, timeout=timeout_secs,
        )
    except subprocess.TimeoutExpired as exc:
        raise SolverError(f'solver timed out after {timeout_secs}s: {exc}') from exc
    output = (result.stdout or '') + (result.stderr or '')
    if result.returncode != 0:
        raise SolverError(f'solver exited {result.returncode}:\n{output[-4000:]}')
    return output


def read_latest_result(results_dir: Path, before: set[str]) -> pd.DataFrame:
    """The picks CSV `run/solve.py` just wrote (`data/results/{datasource}_{stamp}_{run_id}_{iter}.csv`
    -- see this module's docstring): whichever file under `results_dir` was not in `before` (a
    directory listing taken immediately before `run_solver`). Exactly one is expected, since this
    module always sets `num_iterations: 1` (ticket #281 item 4)."""
    if not results_dir.exists():
        raise SolverError(f'solver produced no results directory at {results_dir}')
    after = {p.name for p in results_dir.glob('*.csv')}
    new_files = sorted(after - before)
    if not new_files:
        raise SolverError(f'solver produced no new results CSV under {results_dir}')
    return pd.read_csv(results_dir / new_files[-1])
