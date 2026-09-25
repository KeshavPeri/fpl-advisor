"""Season replay (ticket #281, feature-list item 32's recommendation-level slice). Replays
2025-26 with `gbm-v1` (`fpl_model.live.project_horizon`) and the real, pinned solver
(`solver_io.py`) to measure net points at several transfer-hit costs. **Reads public data only,
writes nothing to Supabase, and changes nothing live** -- see product-brief.md §9 Q2 and this
ticket's own "Why" section.

============================================================================
The weekly loop, once per decision gameweek g (2..38), plus a from-scratch GW1 build.
============================================================================
1. `project_for_gw` -- `fpl_model.live.project_horizon` over horizon g..g+4, frozen at g:
   the model is the fold trained at the latest cutoff <= g (same six cutoffs as
   `fpl_model.evaluate`: GW 1, 8, 15, 22, 29, 36), but the FEATURE history fed into it is
   `sources.load_history(('2025-26', g))` -- strictly before g, always fresh. This is the exact
   shape `fpl_model.evaluate`'s own walk-forward already validates: a model frozen at a fold,
   scored on rolling features computed up to the row being predicted.
2. `build_solver_inputs` -- the projections CSV, `team.json` and the settings-override config
   (`solver_io.py`, mirroring `scripts/build-solver-input.ts`'s `buildSolverConfig`).
3. `solver_io.run_solver` -- the real solve, `num_iterations: 1` (one plan per gameweek; ticket
   #281 item 4's own deliberate deviation from the live app's 3).
4. Apply the result with `rules.py`: selling price, hit cost, FT banking, budget/club checks --
   then score the chosen starting XI against 2025-26's own actual points (captain doubled, no
   auto-subs).

============================================================================
The never-transfer baseline does not call the solver.
============================================================================
Holding one fixed squad all season is a pure best-XI-and-captain selection problem, not a
transfer-planning one -- `rules.pick_best_lineup` solves it exactly by enumeration (8 valid
formations from a 15-man squad) with no ILP needed. This is a deliberate simplification: it
still uses the SAME GW1 squad-build (one preseason solve) and the SAME per-gameweek projections
and actual-points scoring as every hit-cost setting, so the comparison ("net points vs
never-transfer") isolates exactly the thing item 5 asks to measure -- whether transferring (at
some hit cost) beats not transferring -- without spending 37 more solver calls on a squad that,
by definition, never changes.

============================================================================
No historical availability -- factor 1 (ticket #281 item 1, stated as required).
============================================================================
`project_horizon`'s raw points/minutes are used directly, with no `apply_availability` call:
2025-26's `players.status`/`chance_of_playing_next_round` history is not retained by any source
this replay reads, and today's status says nothing about a gameweek two seasons ago (the same
reasoning `docs/model-review-2026-09-02.md`'s backtest slices already use for this exact gap --
see G9 in `docs/projection-model-backlog.md`).
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from fpl_model import live as live_module
from fpl_model.features import build_training_frame
from fpl_model.sources import CACHE_DIR, VAASTAV_BASE, VAASTAV_SHA, load_history
from fpl_model.train import fit
from fpl_odds.history import load_odds_history

from fpl_replay import rules, solver_io

SEASON = '2025-26'
CUTOFFS = (1, 8, 15, 22, 29, 36)
HORIZON = 5
LAST_GW = 38
FIRST_DECISION_GW = 2  # GW1 is the from-scratch build, not a "decision" (ticket item 1: g in 2..38).

ELEMENT_TYPE_TO_POSITION = {1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD'}

HIT_COST_SETTINGS = (4, 6, 8, solver_io.NO_HITS_SENTINEL)


def fold_for_gw(g: int, cutoffs: tuple[int, ...] = CUTOFFS) -> int:
    """The latest retrain cutoff <= g (ticket item 1: "use the latest fold <= g"). g is always
    >= 1, and cutoffs[0] == 1, so this always has an answer."""
    fold = cutoffs[0]
    for c in cutoffs:
        if c <= g:
            fold = c
        else:
            break
    return fold


# ---------------------------------------------------------------------------
# Vaastav season data -- players_raw.csv / teams.csv / fixtures.csv, at the SAME pinned SHA
# fpl_model.sources uses (never a second, independently-drifting pin).
# ---------------------------------------------------------------------------

def _cached_csv(url: str, cache_name: str) -> pd.DataFrame:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except OSError as exc:
            raise RuntimeError(f'fpl_replay: could not fetch {url}: {exc}') from exc
    return pd.read_csv(path, low_memory=False)


def load_vaastav_players(season: str = SEASON) -> pd.DataFrame:
    """id, code, team (team id), element_type (1-4), web_name, now_cost (season-start-ish
    fallback price -- see `SeasonData.fallback_price_by_code`)."""
    return _cached_csv(f'{VAASTAV_BASE}/{season}/players_raw.csv', f'replay_{season}_players_raw.csv')


def load_vaastav_teams(season: str = SEASON) -> pd.DataFrame:
    """id (team id), code (team code -- matches `history`'s `team_code`), name."""
    return _cached_csv(f'{VAASTAV_BASE}/{season}/teams.csv', f'replay_{season}_teams.csv')


def load_vaastav_fixtures(season: str = SEASON) -> pd.DataFrame:
    """event (gw), team_h/team_a (team ids), id (fixture id), kickoff_time."""
    return _cached_csv(f'{VAASTAV_BASE}/{season}/fixtures.csv', f'replay_{season}_fixtures.csv')


def build_team_fixtures(fixtures: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (team_code, gw, slot) -- `fpl_model.live.project_horizon`'s own required
    shape. `slot` orders a team's fixtures within a gameweek by kickoff time (0 for a single
    fixture or a double gameweek's first leg, 1 for its second leg); a team with no row for a
    gameweek is a blank gameweek, by construction (project_horizon sums zero fixture slots)."""
    team_code_by_id = dict(zip(teams['id'], teams['code']))
    f = fixtures.dropna(subset=['event']).copy()
    f['event'] = f['event'].astype(int)

    home = f[['event', 'id', 'team_h', 'team_a', 'kickoff_time']].rename(
        columns={'team_h': 'team_id', 'team_a': 'opp_team_id'})
    home['was_home'] = True
    away = f[['event', 'id', 'team_a', 'team_h', 'kickoff_time']].rename(
        columns={'team_a': 'team_id', 'team_h': 'opp_team_id'})
    away['was_home'] = False
    both = pd.concat([home, away], ignore_index=True)
    both['team_code'] = both['team_id'].map(team_code_by_id)
    both['opp_team_code'] = both['opp_team_id'].map(team_code_by_id)
    both = both.dropna(subset=['team_code', 'opp_team_code']).copy()
    both['team_code'] = both['team_code'].astype(int)
    both['opp_team_code'] = both['opp_team_code'].astype(int)
    both = both.rename(columns={'event': 'gw', 'id': 'fixture_id'})
    both = both.sort_values(['team_code', 'gw', 'kickoff_time'])
    both['slot'] = both.groupby(['team_code', 'gw']).cumcount()
    return both[['gw', 'slot', 'team_code', 'opp_team_code', 'was_home', 'fixture_id']].reset_index(drop=True)


@dataclass
class SeasonData:
    snapshot: pd.DataFrame               # code, position, team_code -- for project_horizon
    team_fixtures: pd.DataFrame          # gw, slot, team_code, opp_team_code, was_home, fixture_id
    odds_history: pd.DataFrame           # fpl_odds.history.load_odds_history()'s own contract columns
    element_by_code: dict[int, dict]     # code -> {element_id, team_id, element_type, web_name}
    team_name_by_code: dict[int, str]
    team_id_by_code: dict[int, int]
    actual_points: dict[tuple[int, int], float] = field(default_factory=dict)   # (code, gw) -> total_points
    actual_price: dict[tuple[int, int], int] = field(default_factory=dict)      # (code, gw) -> value (tenths)
    fallback_price_by_code: dict[int, int] = field(default_factory=dict)        # players_raw.csv now_cost


def load_season_data(season: str = SEASON) -> SeasonData:
    players = load_vaastav_players(season)
    teams = load_vaastav_teams(season)
    fixtures = load_vaastav_fixtures(season)
    team_fixtures = build_team_fixtures(fixtures, teams)

    players = players.dropna(subset=['code', 'team', 'element_type']).copy()
    players['code'] = players['code'].astype(int)
    players['team'] = players['team'].astype(int)
    players['element_type'] = players['element_type'].astype(int)
    team_code_by_id = dict(zip(teams['id'], teams['code']))
    players['team_code'] = players['team'].map(team_code_by_id)
    players = players.dropna(subset=['team_code']).copy()
    players['team_code'] = players['team_code'].astype(int)
    players['position'] = players['element_type'].map(ELEMENT_TYPE_TO_POSITION)

    snapshot = players[['code', 'position', 'team_code']].drop_duplicates('code').reset_index(drop=True)

    element_by_code = {
        int(r.code): {
            'element_id': int(r.id), 'team_id': int(r.team), 'team_code': int(r.team_code),
            'element_type': int(r.element_type), 'web_name': str(r.web_name),
        }
        for r in players.itertuples()
    }
    team_name_by_code = dict(zip(teams['code'], teams['name']))
    team_id_by_code = dict(zip(teams['code'], teams['id']))
    fallback_price_by_code = dict(zip(players['code'], players['now_cost'].astype(int)))

    # Full-season actuals (points + per-gw price) -- one call, `('2026-27', 1)` returns every
    # vaastav season strictly before 2026-27 in full, i.e. exactly the pinned 2025-26 season
    # (same trick `fpl_model.evaluate._load_full_frame` uses).
    full = load_history(('2026-27', 1))
    full = full[full['season'] == season]
    actual_points = {(int(r.code), int(r.gw)): float(r.total_points) for r in full.itertuples()}
    actual_price = {(int(r.code), int(r.gw)): int(r.value) for r in full.itertuples() if pd.notna(r.value)}

    return SeasonData(
        snapshot=snapshot, team_fixtures=team_fixtures, odds_history=load_odds_history(),
        element_by_code=element_by_code, team_name_by_code=team_name_by_code,
        team_id_by_code=team_id_by_code, actual_points=actual_points, actual_price=actual_price,
        fallback_price_by_code=fallback_price_by_code,
    )


def current_price(data: SeasonData, code: int, before_gw: int) -> int:
    """The latest known vaastav `value` strictly before `before_gw`, falling back to
    players_raw.csv's own `now_cost` when no gameweek has been played yet (ticket item 2: "Prices
    per player per GW = vaastav value" -- value does not exist until a gameweek has a row)."""
    latest = None
    for gw in range(before_gw - 1, 0, -1):
        if (code, gw) in data.actual_price:
            latest = data.actual_price[(code, gw)]
            break
    if latest is not None:
        return latest
    return data.fallback_price_by_code.get(code, 0)


# ---------------------------------------------------------------------------
# Projections -- the fold-trained model, fresh feature history each decision gw.
# ---------------------------------------------------------------------------

@dataclass
class Fold:
    points_model: object
    minutes_model: object


def train_fold(cutoff: int) -> Fold:
    history = load_history((SEASON, cutoff))
    training_frame = build_training_frame(history)
    return Fold(points_model=fit(training_frame, 'total_points'), minutes_model=fit(training_frame, 'minutes'))


def project_for_gw(data: SeasonData, folds: dict[int, Fold], g: int,
                    horizon: int = HORIZON, last_gw: int = LAST_GW) -> pd.DataFrame:
    """One row per (code, target gw) for gw in g..min(g+horizon-1, last_gw) -- raw_points/
    raw_minutes, pre-availability (see this module's docstring: availability factor is always 1
    here). `fixture_lambda={}` is deliberate: it only affects `project_horizon`'s own
    `has_odds`/`lambda_for`/`lambda_against` OUTPUT metadata, which this replay never reads --
    the model's own odds INPUT features still come from `combined_odds` below, unaffected."""
    fold_cutoff = fold_for_gw(g)
    fold = folds.setdefault(fold_cutoff, train_fold(fold_cutoff))
    history = load_history((SEASON, g))
    raw = live_module.project_horizon(
        history, data.snapshot, data.team_fixtures, fixture_lambda={}, next_gw=g,
        points_model=fold.points_model, minutes_model=fold.minutes_model,
        combined_odds=data.odds_history, horizon=horizon, last_gw=last_gw,
    )
    return raw


def build_projections_players(data: SeasonData, raw: pd.DataFrame, horizon_gws: list[int]) -> list[dict]:
    """`raw` (code, gw, raw_points, raw_minutes, ...) pivoted into the per-player shape
    `solver_io.build_projections_csv_rows` needs, restricted to codes with a known FPL element id
    (`data.element_by_code`) -- a player who is not in this season's own player list cannot be
    transferred in or out regardless, so is correctly left out of the solver's own pool."""
    players: list[dict] = []
    for code, group in raw.groupby('code'):
        info = data.element_by_code.get(int(code))
        if info is None:
            continue
        position = ELEMENT_TYPE_TO_POSITION[info['element_type']]
        players.append({
            'id': info['element_id'],
            'position': position,
            'name': info['web_name'],
            'team': data.team_name_by_code.get(info['team_code'], ''),
            'points_by_gw': dict(zip(group['gw'].astype(int), group['raw_points'])),
            'minutes_by_gw': dict(zip(group['gw'].astype(int), group['raw_minutes'])),
        })
    return players


def _element_to_code(data: SeasonData) -> dict[int, int]:
    return {info['element_id']: code for code, info in data.element_by_code.items()}


def _bootstrap_elements(data: SeasonData, g: int) -> list[dict]:
    """Ticket #281 item 2: "Prices per player per GW = vaastav value" -- `current_price` below
    is the latest vaastav `value` strictly before `g`, falling back to players_raw.csv's own
    `now_cost` before any gameweek has been played."""
    return [
        {
            'id': info['element_id'], 'team': info['team_id'], 'element_type': info['element_type'],
            'now_cost': current_price(data, code, before_gw=g), 'web_name': info['web_name'],
        }
        for code, info in data.element_by_code.items()
    ]


def _bootstrap_teams(data: SeasonData) -> list[dict]:
    return [{'id': team_id, 'name': data.team_name_by_code[code]} for code, team_id in data.team_id_by_code.items()]


def _bootstrap_fixtures(data: SeasonData) -> list[dict]:
    home = data.team_fixtures[data.team_fixtures['was_home']]
    return [
        {
            'event': int(r.gw), 'team_h': data.team_id_by_code[int(r.team_code)],
            'team_a': data.team_id_by_code[int(r.opp_team_code)],
        }
        for r in home.itertuples()
    ]


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


# ---------------------------------------------------------------------------
# Replay state
# ---------------------------------------------------------------------------

@dataclass
class GameweekResult:
    gw: int
    transfers_made: int
    hits: int
    hit_points: float
    actual_score: float
    net_points: float
    bank_tenths: int
    free_transfers_next: int

    def to_dict(self) -> dict:
        return dict(
            gw=self.gw, transfers_made=self.transfers_made, hits=self.hits,
            hit_points=self.hit_points, actual_score=self.actual_score,
            net_points=self.net_points, bank_tenths=self.bank_tenths,
            free_transfers_next=self.free_transfers_next,
        )


@dataclass
class SquadState:
    purchase_price: dict[int, int]   # code -> purchase price (tenths)
    bank_tenths: int
    free_transfers: int
    captain_code: int
    vice_code: int


def _lineup_from_rows(data: SeasonData, rows: pd.DataFrame, g: int, element_to_code: dict[int, int]) -> list[rules.LineupPlayer]:
    lineup = []
    for r in rows.itertuples():
        code = element_to_code[int(r.id)]
        position = ELEMENT_TYPE_TO_POSITION[data.element_by_code[code]['element_type']]
        points = data.actual_points.get((code, g), 0.0)
        lineup.append(rules.LineupPlayer(code=code, position=position, points=points))
    return lineup


# ---------------------------------------------------------------------------
# GW1 -- from-scratch build (solver_io.py's own module docstring: hits are never priced here).
# ---------------------------------------------------------------------------

def build_gw1_squad(data: SeasonData, folds: dict[int, Fold], solver_dir: Path, work_dir: Path) -> tuple[SquadState, GameweekResult]:
    g = 1
    horizon_gws = list(range(g, min(g + HORIZON, LAST_GW + 1)))
    raw = project_for_gw(data, folds, g)
    players = build_projections_players(data, raw, horizon_gws)
    rows = solver_io.build_projections_csv_rows(players, horizon_gws)
    datasource = 'replay_gw1'
    solver_io.write_projections_csv(solver_dir / 'data' / f'{datasource}.csv', rows, horizon_gws)
    (solver_dir / 'data' / 'team.json').write_text(json.dumps(solver_io.build_empty_team_json()))

    config = solver_io.build_solver_config(
        horizon=len(horizon_gws), datasource=datasource, hit_cost=4, next_gw=g, preseason=True,
    )
    config_path = work_dir / 'solver-config-gw1.json'
    _write_json(config_path, config)

    bootstrap = solver_io.build_fake_bootstrap(_bootstrap_elements(data, g), _bootstrap_teams(data))
    fixtures = solver_io.build_fake_fixtures(_bootstrap_fixtures(data))
    solver_io.write_solver_cache(solver_dir, bootstrap, fixtures)

    results_dir = solver_dir / 'data' / 'results'
    before = {p.name for p in results_dir.glob('*.csv')} if results_dir.exists() else set()
    solver_io.run_solver(solver_dir, config_path)
    result = solver_io.read_latest_result(results_dir, before)

    element_to_code = _element_to_code(data)
    squad_rows = result[(result['week'] == g) & (result['squad'] == 1)]
    lineup_rows = result[(result['week'] == g) & (result['lineup'] == 1)]
    captain_rows = result[(result['week'] == g) & (result['captain'] == 1)]
    vice_rows = result[(result['week'] == g) & (result['vicecaptain'] == 1)]
    if len(squad_rows) != rules.SQUAD_SIZE:
        raise RuntimeError(f'GW1 solve returned {len(squad_rows)} squad players, expected {rules.SQUAD_SIZE}')
    if len(captain_rows) != 1:
        raise RuntimeError(f'GW1 solve returned {len(captain_rows)} captain(s), expected 1')

    purchase_price = {}
    for r in squad_rows.itertuples():
        code = element_to_code[int(r.id)]
        # Same price source the solver's own fake bootstrap used to build this squad
        # (`_bootstrap_elements(data, g)` below) -- before ANY gameweek has been played every
        # player falls back to players_raw.csv's own `now_cost` uniformly, so this is exactly
        # what the £100.0m budget constraint was computed against.
        purchase_price[code] = current_price(data, code, before_gw=g)
    total_cost = sum(purchase_price.values())
    if total_cost > rules.STARTING_BUDGET_TENTHS:
        raise RuntimeError(
            f'GW1 squad cost {total_cost} tenths, over the {rules.STARTING_BUDGET_TENTHS} budget '
            '-- the solver\'s own budget constraint should make this impossible'
        )
    bank_tenths = rules.STARTING_BUDGET_TENTHS - total_cost

    positions = [ELEMENT_TYPE_TO_POSITION[data.element_by_code[c]['element_type']] for c in purchase_price]
    team_codes = [data.element_by_code[c]['team_code'] for c in purchase_price]
    violations = rules.validate_squad_composition(positions, team_codes, total_cost, bank_tenths)
    if violations:
        raise RuntimeError(f'GW1 squad failed validation: {violations}')

    lineup = _lineup_from_rows(data, lineup_rows, g, element_to_code)
    captain_code = element_to_code[int(captain_rows.iloc[0]['id'])]
    vice_code = element_to_code[int(vice_rows.iloc[0]['id'])] if len(vice_rows) else captain_code
    score = rules.score_lineup(lineup, captain_code)

    state = SquadState(
        purchase_price=purchase_price, bank_tenths=bank_tenths, free_transfers=1,
        captain_code=captain_code, vice_code=vice_code,
    )
    gw1_result = GameweekResult(
        gw=1, transfers_made=0, hits=0, hit_points=0.0, actual_score=score, net_points=score,
        bank_tenths=bank_tenths, free_transfers_next=1,
    )
    return state, gw1_result


# ---------------------------------------------------------------------------
# GW2..end_gw -- one decision per gameweek, via the real solver.
# ---------------------------------------------------------------------------

def play_gameweek(data: SeasonData, folds: dict[int, Fold], solver_dir: Path, work_dir: Path,
                   g: int, state: SquadState, hit_cost_setting) -> tuple[SquadState, GameweekResult]:
    horizon_gws = list(range(g, min(g + HORIZON, LAST_GW + 1)))
    raw = project_for_gw(data, folds, g, horizon=len(horizon_gws))
    players = build_projections_players(data, raw, horizon_gws)
    rows = solver_io.build_projections_csv_rows(players, horizon_gws)
    datasource = f'replay_gw{g}'
    solver_io.write_projections_csv(solver_dir / 'data' / f'{datasource}.csv', rows, horizon_gws)

    picks = []
    for i, (code, purchase) in enumerate(state.purchase_price.items(), start=1):
        info = data.element_by_code[code]
        sell = rules.selling_price(purchase, current_price(data, code, before_gw=g))
        picks.append({
            'element': info['element_id'], 'squad_position': i, 'element_type': info['element_type'],
            'purchase_price': purchase, 'selling_price': sell,
            'is_captain': code == state.captain_code, 'is_vice_captain': code == state.vice_code,
            'is_starting': True,
        })
    team_json = solver_io.build_team_json(picks, state.bank_tenths, state.free_transfers)
    (solver_dir / 'data' / 'team.json').write_text(json.dumps(team_json))

    config = solver_io.build_solver_config(
        horizon=len(horizon_gws), datasource=datasource, hit_cost=hit_cost_setting, next_gw=g, preseason=False,
    )
    config_path = work_dir / f'solver-config-gw{g}.json'
    _write_json(config_path, config)

    bootstrap = solver_io.build_fake_bootstrap(_bootstrap_elements(data, g), _bootstrap_teams(data))
    fixtures = solver_io.build_fake_fixtures(_bootstrap_fixtures(data))
    solver_io.write_solver_cache(solver_dir, bootstrap, fixtures)

    results_dir = solver_dir / 'data' / 'results'
    before = {p.name for p in results_dir.glob('*.csv')} if results_dir.exists() else set()
    solver_io.run_solver(solver_dir, config_path)
    result = solver_io.read_latest_result(results_dir, before)

    element_to_code = _element_to_code(data)
    squad_rows = result[(result['week'] == g) & (result['squad'] == 1)]
    lineup_rows = result[(result['week'] == g) & (result['lineup'] == 1)]
    captain_rows = result[(result['week'] == g) & (result['captain'] == 1)]
    vice_rows = result[(result['week'] == g) & (result['vicecaptain'] == 1)]
    transfer_in_rows = result[(result['week'] == g) & (result['transfer_in'] == 1)]
    transfer_out_rows = result[(result['week'] == g) & (result['transfer_out'] == 1)]
    if len(squad_rows) != rules.SQUAD_SIZE:
        raise RuntimeError(f'GW{g} solve returned {len(squad_rows)} squad players, expected {rules.SQUAD_SIZE}')
    if len(captain_rows) != 1:
        raise RuntimeError(f'GW{g} solve returned {len(captain_rows)} captain(s), expected 1')

    new_codes = {element_to_code[int(r.id)] for r in squad_rows.itertuples()}
    old_codes = set(state.purchase_price)
    sold_codes = old_codes - new_codes
    bought_codes = new_codes - old_codes
    transfers_made = len(transfer_out_rows)
    if transfers_made != len(sold_codes) or len(transfer_in_rows) != len(bought_codes):
        raise RuntimeError(
            f'GW{g}: solver transfer rows ({len(transfer_out_rows)} out, {len(transfer_in_rows)} in) '
            f'disagree with the squad diff ({len(sold_codes)} sold, {len(bought_codes)} bought)'
        )

    new_purchase_price = {}
    proceeds = 0
    for code in sold_codes:
        proceeds += rules.selling_price(state.purchase_price[code], current_price(data, code, before_gw=g))
    spend = 0
    for code in bought_codes:
        buy_price = current_price(data, code, before_gw=g)
        new_purchase_price[code] = buy_price
        spend += buy_price
    for code in (old_codes & new_codes):
        new_purchase_price[code] = state.purchase_price[code]
    bank_tenths = state.bank_tenths + proceeds - spend

    positions = [ELEMENT_TYPE_TO_POSITION[data.element_by_code[c]['element_type']] for c in new_codes]
    team_codes = [data.element_by_code[c]['team_code'] for c in new_codes]
    if not rules.check_club_limit(team_codes):
        raise RuntimeError(f'GW{g}: new squad violates the max-3-per-club rule')
    if len(new_codes) != rules.SQUAD_SIZE:
        raise RuntimeError(f'GW{g}: new squad has {len(new_codes)} players, expected {rules.SQUAD_SIZE}')
    if bank_tenths < 0:
        raise RuntimeError(f'GW{g}: bank went negative ({bank_tenths})')

    hit_cost_numeric = 0 if hit_cost_setting == solver_io.NO_HITS_SENTINEL else int(hit_cost_setting)
    hits = rules.hit_count(transfers_made, state.free_transfers)
    hit_points = rules.hit_points_cost(transfers_made, state.free_transfers, hit_cost_numeric)
    free_transfers_next = rules.next_free_transfers(state.free_transfers, transfers_made)

    lineup = _lineup_from_rows(data, lineup_rows, g, element_to_code)
    captain_code = element_to_code[int(captain_rows.iloc[0]['id'])]
    vice_code = element_to_code[int(vice_rows.iloc[0]['id'])] if len(vice_rows) else captain_code
    score = rules.score_lineup(lineup, captain_code)
    net = score - hit_points

    new_state = SquadState(
        purchase_price=new_purchase_price, bank_tenths=bank_tenths, free_transfers=free_transfers_next,
        captain_code=captain_code, vice_code=vice_code,
    )
    gw_result = GameweekResult(
        gw=g, transfers_made=transfers_made, hits=hits, hit_points=hit_points,
        actual_score=score, net_points=net, bank_tenths=bank_tenths,
        free_transfers_next=free_transfers_next,
    )
    return new_state, gw_result


# ---------------------------------------------------------------------------
# Never-transfer baseline -- no solver (see this module's docstring).
# ---------------------------------------------------------------------------

def run_never_transfer_baseline(data: SeasonData, gw1_state: SquadState, gw1_result: GameweekResult,
                                 end_gw: int) -> list[GameweekResult]:
    squad_codes = list(gw1_state.purchase_price)
    results = [gw1_result]
    for g in range(FIRST_DECISION_GW, end_gw + 1):
        squad = [
            rules.LineupPlayer(
                code=c, position=ELEMENT_TYPE_TO_POSITION[data.element_by_code[c]['element_type']],
                points=data.actual_points.get((c, g), 0.0),
            )
            for c in squad_codes
        ]
        lineup, captain_code = rules.pick_best_lineup(squad)
        score = rules.score_lineup(lineup, captain_code)
        results.append(GameweekResult(
            gw=g, transfers_made=0, hits=0, hit_points=0.0, actual_score=score, net_points=score,
            bank_tenths=gw1_state.bank_tenths, free_transfers_next=gw1_state.free_transfers,
        ))
    return results


# ---------------------------------------------------------------------------
# One setting, start to finish.
# ---------------------------------------------------------------------------

def run_setting(data: SeasonData, folds: dict[int, Fold], solver_dir: Path, work_dir: Path,
                 hit_cost_setting, gw1_state: SquadState, gw1_result: GameweekResult,
                 end_gw: int) -> list[GameweekResult]:
    if hit_cost_setting == 'never-transfer':
        return run_never_transfer_baseline(data, gw1_state, gw1_result, end_gw)
    results = [gw1_result]
    state = gw1_state
    for g in range(FIRST_DECISION_GW, end_gw + 1):
        state, gw_result = play_gameweek(data, folds, solver_dir, work_dir, g, state, hit_cost_setting)
        results.append(gw_result)
    return results


def setting_label(setting) -> str:
    if setting == 'never-transfer':
        return 'never-transfer'
    if setting == solver_io.NO_HITS_SENTINEL:
        return 'no-hits'
    return f'hit_cost={setting}'


def summarize(results: list[GameweekResult]) -> dict:
    return {
        'season_net_points': sum(r.net_points for r in results),
        'points_lost_to_hits': sum(r.hit_points for r in results),
        'hits_taken': sum(r.hits for r in results),
        'transfers_made': sum(r.transfers_made for r in results),
        'per_gw_net': [{'gw': r.gw, 'net_points': r.net_points} for r in results],
    }


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def render_summary_table(summaries: dict[str, dict]) -> str:
    """Just the per-setting comparison table (ticket #281 item 6's main table, no per-gw
    breakdown) -- short enough to repeat verbatim as a GitHub Actions annotation (item 7: "repeat
    the summary table as a `::notice title=season-replay::` annotation -- run logs and artifacts
    aren't reachable by the orchestrator, annotations are"). `summaries`: setting label ->
    `summarize(...)`'s own dict, for every setting present in this run (a smoke run may carry
    only `hit_cost=4`). The two diff columns are blank ('-') when that comparison setting is not
    present in `summaries`."""
    lines = [
        '| Setting | Season net points | Points lost to hits | Hits taken | Transfers made | '
        'Diff vs hit_cost=4 | Diff vs never-transfer |',
        '|---|---|---|---|---|---|---|',
    ]
    base = summaries.get('hit_cost=4')
    never = summaries.get('never-transfer')
    for label, s in summaries.items():
        diff_base = f"{s['season_net_points'] - base['season_net_points']:+.1f}" if base else '-'
        diff_never = f"{s['season_net_points'] - never['season_net_points']:+.1f}" if never else '-'
        lines.append(
            f"| {label} | {s['season_net_points']:.1f} | {s['points_lost_to_hits']:.1f} | "
            f"{s['hits_taken']} | {s['transfers_made']} | {diff_base} | {diff_never} |"
        )
    return '\n'.join(lines)


def render_report(summaries: dict[str, dict], smoke_slice: bool = False) -> str:
    """`summaries`: setting label -> `summarize(...)`'s own dict, for every setting present in
    this run (a smoke run may carry only `hit_cost=4`). Ticket #281 item 6: per-setting season
    net points, points lost to hits, hits taken, transfers made, and the per-GW net, plus the
    difference vs `hit_cost=4` and vs `never-transfer` -- both diff columns are blank when that
    setting is not present in `summaries` (a smoke run, or a single-setting matrix job's own
    artifact before aggregation)."""
    lines = ['# Season replay: transfer-hit threshold (2025-26, gbm-v1)', '']
    if smoke_slice:
        lines.append(
            '**Smoke-slice version** -- produced by the Builder sandbox for ticket #281\'s DoD '
            '(GW1-4 only, `hit_cost=4`), not the full-season result. The full 37-decision-gameweek, '
            'five-setting run happens in `.github/workflows/season-replay.yml` after merge.'
        )
        lines.append('')
    lines.append(
        'Replays 2025-26 with `gbm-v1` and the real, pinned solver '
        '(`sertalpbilal/FPL-Optimization-Tools` @ `' + solver_io.SOLVER_COMMIT + '`). '
        'Changes nothing live -- product-brief.md §9 Q2.'
    )
    lines.append('')
    lines.append(render_summary_table(summaries))
    lines.append('')
    lines.append('## Per-gameweek net points')
    lines.append('')
    all_gws = sorted({g['gw'] for s in summaries.values() for g in s['per_gw_net']})
    header = '| GW | ' + ' | '.join(summaries.keys()) + ' |'
    lines.append(header)
    lines.append('|---|' + '---|' * len(summaries))
    for gw in all_gws:
        row = [f'{gw}']
        for s in summaries.values():
            match = next((g['net_points'] for g in s['per_gw_net'] if g['gw'] == gw), None)
            row.append(f'{match:.1f}' if match is not None else '-')
        lines.append('| ' + ' | '.join(row) + ' |')
    lines.append('')
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# CLI -- one setting per invocation (matches the workflow's matrix-job-per-setting shape,
# ticket #281 item 7), or `--mode aggregate` to combine several settings' JSON summaries into
# the final report.
# ---------------------------------------------------------------------------

def _save_checkpoint(path: Path, state: SquadState, results: list[GameweekResult]) -> None:
    """Persists progress after GW1 and after every subsequent gameweek, so a long `--mode run`
    invocation (up to 37 solver calls for a full season) can resume instead of repeating already-
    solved gameweeks after an interruption -- not required by the ticket's DoD, but the smoke run
    itself is proof this matters: a single sandboxed process can be interrupted well before 37
    gameweeks finish. `folds` (the trained models) are NOT checkpointed -- retraining a fold from
    `load_history` is deterministic and reasonably cheap next to a solver call, and pickling a
    LightGBM/sklearn model across a resume is more moving parts than this ticket needs."""
    _write_json(path, {
        'state': {
            'purchase_price': state.purchase_price, 'bank_tenths': state.bank_tenths,
            'free_transfers': state.free_transfers, 'captain_code': state.captain_code,
            'vice_code': state.vice_code,
        },
        'results': [r.to_dict() for r in results],
    })


def _load_checkpoint(path: Path) -> tuple[SquadState, list[GameweekResult]] | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text())
    s = payload['state']
    state = SquadState(
        purchase_price={int(k): int(v) for k, v in s['purchase_price'].items()},
        bank_tenths=s['bank_tenths'], free_transfers=s['free_transfers'],
        captain_code=s['captain_code'], vice_code=s['vice_code'],
    )
    results = [GameweekResult(**r) for r in payload['results']]
    return state, results


def _annotate(title: str, text: str) -> None:
    """Repeats `text` as a GitHub Actions annotation (mirrors `fpl_model.live`'s own
    `_annotate`) -- readable through the check-runs API with no artifact download, which is what
    ticket #281 item 7 asks for (the orchestrator cannot reach a run's logs or artifacts)."""
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        body = text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::notice title={title}::{body}')


def _parse_setting(raw: str):
    if raw == 'never-transfer':
        return 'never-transfer'
    if raw == solver_io.NO_HITS_SENTINEL:
        return solver_io.NO_HITS_SENTINEL
    return int(raw)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['run', 'aggregate'], default='run')
    parser.add_argument('--setting', help='4 | 6 | 8 | no-hits | never-transfer')
    parser.add_argument('--start-gw', type=int, default=FIRST_DECISION_GW)
    parser.add_argument('--end-gw', type=int, default=LAST_GW)
    parser.add_argument('--solver-dir', type=Path, default=Path('solver'))
    parser.add_argument('--work-dir', type=Path, default=Path('.replay-work'))
    parser.add_argument('--out-json', type=Path, default=None)
    parser.add_argument('--inputs', nargs='*', type=Path, default=None)
    parser.add_argument('--out-md', type=Path, default=None)
    parser.add_argument('--smoke-slice', action='store_true')
    parser.add_argument('--checkpoint-path', type=Path, default=None,
                         help='resume from / save progress to this JSON file after every gameweek')
    args = parser.parse_args(argv)

    if args.mode == 'aggregate':
        summaries = {}
        for path in args.inputs or []:
            payload = json.loads(path.read_text())
            summaries[payload['label']] = payload['summary']
        report = render_report(summaries, smoke_slice=args.smoke_slice)
        print(report)
        if args.out_md:
            args.out_md.parent.mkdir(parents=True, exist_ok=True)
            args.out_md.write_text(report)
        _annotate('season-replay', render_summary_table(summaries))
        return 0

    setting = _parse_setting(args.setting)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    data = load_season_data()
    folds: dict[int, Fold] = {}

    checkpoint = _load_checkpoint(args.checkpoint_path) if args.checkpoint_path else None
    if checkpoint is not None:
        state, results = checkpoint
        resume_from_gw = results[-1].gw + 1
        print(f'resuming {setting_label(setting)} from GW{resume_from_gw} '
              f'({len(results)} gameweek(s) already checkpointed)')
    else:
        state, gw1_result = build_gw1_squad(data, folds, args.solver_dir, args.work_dir)
        results = [gw1_result]
        resume_from_gw = FIRST_DECISION_GW
        if args.checkpoint_path:
            _save_checkpoint(args.checkpoint_path, state, results)

    if setting == 'never-transfer':
        if resume_from_gw <= args.end_gw:
            results = results + run_never_transfer_baseline(data, state, results[0], args.end_gw)[len(results):]
        if args.checkpoint_path:
            _save_checkpoint(args.checkpoint_path, state, results)
    else:
        for g in range(resume_from_gw, args.end_gw + 1):
            state, gw_result = play_gameweek(data, folds, args.solver_dir, args.work_dir, g, state, setting)
            results.append(gw_result)
            if args.checkpoint_path:
                _save_checkpoint(args.checkpoint_path, state, results)

    summary = summarize(results)
    label = setting_label(setting)
    print(f'{label}: season net points = {summary["season_net_points"]:.1f}, '
          f'hits = {summary["hits_taken"]}, transfers = {summary["transfers_made"]}')
    if args.out_json:
        _write_json(args.out_json, {'label': label, 'summary': summary})

    report = render_report({label: summary}, smoke_slice=args.smoke_slice)
    print(report)
    if args.out_md:
        args.out_md.parent.mkdir(parents=True, exist_ok=True)
        args.out_md.write_text(report)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
