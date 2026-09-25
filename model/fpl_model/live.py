"""`python -m fpl_model.live` -- the gbm-v1 nightly job (ticket #265 / R2-T2).

Runs `gbm-v1` every night and writes its rows into `player_projections` NEXT TO `baseline-v1`
(same table, same primary key `gameweek_id, player_id, model_version` -- a different
`model_version` value never collides). This does not change recommendations:
`config/projection-model.json` stays on `baseline-v1` until the owner flips it after checking
the first run (see the ticket's "Post-merge owner check").

Steps:
  1. Live state -- bootstrap-static + fixtures/ from the FPL API (`fpl_api`).
  2. History -- `sources.load_history`, Core resolved to the latest commit sha every run
     (`fpl_api.resolve_core_ref`; never the literal `'main'`, see that function's docstring).
  3. Odds -- `fpl_odds.history.load_odds_history()` (committed CSVs) plus live rows: the latest
     `fixture_odds` row per fixture, <=48h old, >=3 books (`supabase_io.select_latest_odds`),
     converted to (lambda_home, lambda_away) via `fpl_odds.implied.goal_expectancy`. The combined
     frame is passed as `odds=` to `build_training_frame`/`build_decision_frame` everywhere, even
     though gbm-v1's current feature set ignores it (R2-T1's job, on a different branch tonight).
  4. Train points + minutes models on everything strictly before the next gameweek.
  5. Predict for each horizon gameweek g..g+4 (stop at 38): one `build_decision_frame` call per
     fixture *slot* (`slot 0` = a team's only fixture, or a double gameweek's first leg;
     `slot 1` = its second leg), summed per player -- never one call with both fixtures
     aggregated, which would blend two different opponents'/venues' context into one prediction.
     A team with no fixture that gameweek contributes 0 to every one of its players for that row
     (a blank gameweek, by construction: no slot exists to sum). Availability is applied once per
     player (`apply_availability` -- never `availability_factor` directly, so a later
     learned-availability ticket can change the rule without touching this file) using the
     current snapshot's status, the same factor for every horizon row.
  6. Upsert `player_projections`; skip and count any player whose id is not (yet) in
     `public.players` (the table's FK).
  7. One `job_runs` row, and a printed summary (rows written, players skipped, % of horizon
     fixtures with usable odds, top 10 by next-gameweek expected points with price and team).

Only imports `fpl_model.sources`/`features`/`train`/`availability` and `fpl_odds` through their
frozen signatures -- never edits them (R2-T1 edits `features.py`/`sources.py` the same night, on
a different branch; see `docs/model-diagnosis-2026-09-24.md` §8).
"""
from __future__ import annotations

import datetime as dt
import sys
from typing import Any

import numpy as np
import pandas as pd

from fpl_model import fpl_api, supabase_io
from fpl_model.availability import apply_availability
from fpl_model.features import build_decision_frame, build_training_frame
from fpl_model.sources import load_history
from fpl_model.train import contributions, fit, predict
from fpl_odds.history import load_odds_history
from fpl_odds.implied import goal_expectancy

MODEL_VERSION = 'gbm-v1'
JOB_NAME = 'project-points-gbm'
SEASON = '2026-27'
HORIZON = 5  # g .. g+4
LAST_GW = 38
ODDS_FRESHNESS_HOURS = 48
MIN_BOOK_COUNT = 3
TOP_N_SUMMARY = 10

ODDS_CONTRACT_COLUMNS = [
    'season', 'gw', 'kickoff_date', 'home_code', 'away_code',
    'p_home', 'p_draw', 'p_away', 'lambda_home', 'lambda_away', 'source',
]


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def horizon_gameweeks(next_gw: int, horizon: int = HORIZON, last_gw: int = LAST_GW) -> list[int]:
    return [g for g in range(next_gw, next_gw + horizon) if g <= last_gw]


# ---------------------------------------------------------------------------
# Odds shaping -- combines Supabase's live fixture_odds rows with the FPL fixtures response.
# ---------------------------------------------------------------------------

def build_live_odds(live_fixture_odds: pd.DataFrame, fixture_lookup: pd.DataFrame) -> pd.DataFrame:
    """Join the (already freshness/book-count-filtered) live `fixture_odds` rows to the FPL
    fixtures response (`fixture_id` -> gw, home_code, away_code) and fit
    `lambda_home`/`lambda_away` (1X2 only) via `goal_expectancy`. Same contract columns as
    `fpl_odds.history.load_odds_history`, `season='2026-27'`, `source='the-odds-api'` -- this is
    the frame passed as `odds=` to the feature builders (which ignore it in gbm-v1 today)."""
    if live_fixture_odds.empty or fixture_lookup.empty:
        return pd.DataFrame(columns=ODDS_CONTRACT_COLUMNS)
    merged = live_fixture_odds.merge(fixture_lookup, on='fixture_id', how='inner')
    records = []
    for row in merged.itertuples(index=False):
        lambda_home, lambda_away = goal_expectancy(row.p_home, row.p_draw, row.p_away)
        records.append({
            'season': SEASON, 'gw': row.gw, 'kickoff_date': row.kickoff_date,
            'home_code': row.home_code, 'away_code': row.away_code,
            'p_home': row.p_home, 'p_draw': row.p_draw, 'p_away': row.p_away,
            'lambda_home': lambda_home, 'lambda_away': lambda_away, 'source': 'the-odds-api',
        })
    return pd.DataFrame.from_records(records, columns=ODDS_CONTRACT_COLUMNS)


def build_fixture_lambda_lookup(live_fixture_odds: pd.DataFrame,
                                 fixture_lookup: pd.DataFrame) -> dict[int, tuple[float, float]]:
    """`fixture_id -> (lambda_home, lambda_away)` -- for the per-row `has_odds`/`lambda_for`/
    `lambda_against` components fields, keyed on `fixture_id` (unlike `build_live_odds`'s
    contract-columns frame, which drops it)."""
    if live_fixture_odds.empty or fixture_lookup.empty:
        return {}
    merged = live_fixture_odds.merge(
        fixture_lookup[['fixture_id', 'home_code', 'away_code']], on='fixture_id', how='inner',
    )
    out: dict[int, tuple[float, float]] = {}
    for row in merged.itertuples(index=False):
        out[int(row.fixture_id)] = goal_expectancy(row.p_home, row.p_draw, row.p_away)
    return out


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------

def project_horizon(history: pd.DataFrame, snapshot: pd.DataFrame, team_fixtures: pd.DataFrame,
                     fixture_lambda: dict[int, tuple[float, float]], next_gw: int,
                     points_model: Any, minutes_model: Any, combined_odds: pd.DataFrame | None = None,
                     horizon: int = HORIZON, last_gw: int = LAST_GW) -> pd.DataFrame:
    """One row per (code, target gw) for every gw in `horizon_gameweeks(next_gw)`:
    `raw_points`/`raw_minutes` (pre-availability, summed across fixture slots; 0 for a blank
    gameweek team), `has_odds`, `lambda_for`, `lambda_against` and `drivers` (from the slot-0
    fixture only -- the ticket does not say how to combine two fixtures' SHAP drivers into one
    row for a double gameweek, and slot 0 is that player's primary fixture that gw)."""
    codes = snapshot[['code', 'position', 'team_code']].dropna(subset=['code', 'team_code'])
    target_gws = horizon_gameweeks(next_gw, horizon, last_gw)
    rows: list[dict] = []

    for gw in target_gws:
        totals: dict[int, dict[str, Any]] = {
            int(code): {'raw_points': 0.0, 'raw_minutes': 0.0, 'has_odds': False,
                        'lambda_for': None, 'lambda_against': None, 'drivers': []}
            for code in codes['code']
        }
        gw_fixtures = team_fixtures[team_fixtures['gw'] == gw]
        max_slot = int(gw_fixtures['slot'].max()) if not gw_fixtures.empty else -1

        for slot in range(max_slot + 1):
            slot_fixtures = gw_fixtures[gw_fixtures['slot'] == slot]
            if slot_fixtures.empty:
                continue
            target = codes.merge(
                slot_fixtures[['team_code', 'opp_team_code', 'was_home', 'fixture_id']],
                on='team_code', how='inner',
            )
            if target.empty:
                continue
            fixture_id_by_code = dict(zip(target['code'], target['fixture_id']))
            target_fixtures = target[['code', 'team_code', 'opp_team_code', 'was_home', 'position']]

            dec = build_decision_frame(history, (SEASON, gw), target_fixtures,
                                        odds=combined_odds, snapshot=snapshot)
            pts = predict(points_model, dec)
            mins = predict(minutes_model, dec)
            drv = contributions(points_model, dec, top=5) if slot == 0 else None

            for i in range(len(dec)):
                code = int(dec['code'].iloc[i])
                agg = totals[code]
                agg['raw_points'] += float(pts[i])
                agg['raw_minutes'] += float(mins[i])
                if slot == 0:
                    fixture_id = fixture_id_by_code.get(code)
                    lam = fixture_lambda.get(fixture_id)
                    if lam is not None:
                        lambda_home, lambda_away = lam
                        was_home = bool(dec['was_home'].iloc[i])
                        agg['has_odds'] = True
                        agg['lambda_for'] = lambda_home if was_home else lambda_away
                        agg['lambda_against'] = lambda_away if was_home else lambda_home
                    if drv is not None:
                        feats_row = dec.iloc[i]
                        agg['drivers'] = [
                            {'feature': d['feature'], 'value': float(feats_row[d['feature']]),
                             'contribution': d['contribution']}
                            for d in drv[i]
                        ]

        for code, agg in totals.items():
            rows.append({'code': code, 'gw': gw, **agg})

    return pd.DataFrame(rows)


def build_payload(raw: pd.DataFrame, snapshot: pd.DataFrame, trained_through: str,
                   known_player_ids: set[int], computed_at: str) -> tuple[list[dict], int]:
    """The `player_projections` upsert payload: one dict per row, shaped exactly as the table's
    columns (`gameweek_id, player_id, model_version, player_code, expected_points,
    expected_minutes, components`), plus `computed_at`. Skips and counts any row whose player id
    is not in `known_player_ids` (the `public.players` FK)."""
    if raw.empty:
        return [], 0

    snap = snapshot.set_index('code')
    ordered = raw.reset_index(drop=True)
    snap_rows = snap.reindex(ordered['code'].astype(int))[['status', 'chance_of_playing_next_round', 'id']]
    snap_rows = snap_rows.reset_index(drop=True)

    raw_points = ordered['raw_points'].to_numpy(dtype=float)
    raw_minutes = ordered['raw_minutes'].to_numpy(dtype=float)
    # apply_availability, never availability_factor directly (see this module's header) -- the
    # factor itself is recovered by applying it to an array of ones.
    factor = apply_availability(np.ones(len(snap_rows)), snap_rows)
    expected_points = apply_availability(raw_points, snap_rows)
    expected_minutes = apply_availability(raw_minutes, snap_rows)

    payload: list[dict] = []
    skipped = 0
    for i, row in ordered.iterrows():
        player_id = snap_rows.loc[i, 'id']
        if pd.isna(player_id) or int(player_id) not in known_player_ids:
            skipped += 1
            continue
        # `raw_projections`'s lambda_for/lambda_against columns come back from pandas as NaN
        # (float64), never a real Python None, once the column also holds real float values
        # elsewhere -- but jsonb has no NaN literal (bare `NaN` is not valid JSON, and PostgREST
        # rejects it), so this must serialize as JSON null, not a NaN token.
        lambda_for = row['lambda_for']
        lambda_against = row['lambda_against']
        components = {
            'model': MODEL_VERSION,
            'trained_through': trained_through,
            'availability': float(factor[i]),
            'raw_points': float(raw_points[i]),
            'raw_minutes': float(raw_minutes[i]),
            'has_odds': bool(row['has_odds']),
            'lambda_for': None if pd.isna(lambda_for) else float(lambda_for),
            'lambda_against': None if pd.isna(lambda_against) else float(lambda_against),
            'drivers': row['drivers'],
        }
        payload.append({
            'gameweek_id': int(row['gw']),  # public.gameweeks.id IS the FPL event id
            'player_id': int(player_id),
            'model_version': MODEL_VERSION,
            'player_code': int(row['code']),
            'expected_points': float(expected_points[i]),
            'expected_minutes': float(expected_minutes[i]),
            'components': components,
            'computed_at': computed_at,
        })
    return payload, skipped


def render_summary(payload: list[dict], skipped: int, next_gw: int, pct_fixtures_with_odds: float,
                    now_cost_by_code: dict[int, int], team_by_code: dict[int, str]) -> str:
    lines = [
        f'live: wrote {len(payload)} row(s) to player_projections (model_version={MODEL_VERSION!r})',
        f'live: skipped {skipped} player row(s) not (yet) in public.players',
        f'live: {pct_fixtures_with_odds:.1f}% of horizon fixtures had usable odds '
        f'(<= {ODDS_FRESHNESS_HOURS}h old, >= {MIN_BOOK_COUNT} books)',
    ]
    top = sorted(
        (r for r in payload if r['gameweek_id'] == next_gw),
        key=lambda r: r['expected_points'], reverse=True,
    )[:TOP_N_SUMMARY]
    lines.append(f'live: top {len(top)} by GW{next_gw} expected points:')
    for r in top:
        code = r['player_code']
        team = team_by_code.get(code, '?')
        price = now_cost_by_code.get(code)
        price_str = f'£{price / 10:.1f}m' if price is not None else '?'
        lines.append(f'  {r["expected_points"]:.2f} pts  {team:<4} {price_str:>6}  code {code}')
    return '\n'.join(lines)


def _pct_horizon_fixtures_with_odds(team_fixtures: pd.DataFrame, fixture_lambda: dict[int, tuple[float, float]],
                                     next_gw: int, horizon: int = HORIZON, last_gw: int = LAST_GW) -> float:
    gws = horizon_gameweeks(next_gw, horizon, last_gw)
    horizon_fixture_ids = set(team_fixtures.loc[team_fixtures['gw'].isin(gws), 'fixture_id'])
    if not horizon_fixture_ids:
        return 0.0
    with_odds = sum(1 for fid in horizon_fixture_ids if fid in fixture_lambda)
    return with_odds / len(horizon_fixture_ids) * 100


# ---------------------------------------------------------------------------
# Orchestration -- the only functions in this module that touch the network or Supabase.
# ---------------------------------------------------------------------------

def run(url: str, secret_key: str, started_at: str) -> tuple[str, dict]:
    bootstrap = fpl_api.fetch_bootstrap_static()
    fixtures_json = fpl_api.fetch_fixtures()
    teams = fpl_api.parse_teams(bootstrap)
    next_gw = fpl_api.next_gameweek(bootstrap)
    snapshot = fpl_api.parse_snapshot(bootstrap)
    team_fixtures = fpl_api.parse_team_fixtures(fixtures_json, teams)
    fixture_lookup = fpl_api.parse_fixture_lookup(fixtures_json, teams)

    core_ref = fpl_api.resolve_core_ref()
    history = load_history((SEASON, next_gw), core_ref=core_ref)

    since_iso = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()
    raw_odds = supabase_io.fetch_fixture_odds_since(url, secret_key, since_iso)
    live_fixture_odds = supabase_io.select_latest_odds(
        raw_odds, dt.datetime.now(dt.timezone.utc), ODDS_FRESHNESS_HOURS, MIN_BOOK_COUNT,
    )
    live_odds = build_live_odds(live_fixture_odds, fixture_lookup)
    fixture_lambda = build_fixture_lambda_lookup(live_fixture_odds, fixture_lookup)
    combined_odds = pd.concat([load_odds_history(), live_odds], ignore_index=True, sort=False)

    training_frame = build_training_frame(history, odds=combined_odds)
    points_model = fit(training_frame, 'total_points')
    minutes_model = fit(training_frame, 'minutes')

    raw = project_horizon(history, snapshot, team_fixtures, fixture_lambda, next_gw,
                           points_model, minutes_model, combined_odds=combined_odds)

    known_player_ids = supabase_io.fetch_all_player_ids(url, secret_key)
    trained_through = f'{SEASON} GW{next_gw - 1}'
    computed_at = _now_iso()
    payload, skipped = build_payload(raw, snapshot, trained_through, known_player_ids, computed_at)

    supabase_io.upsert_player_projections(url, secret_key, payload)

    pct_with_odds = _pct_horizon_fixtures_with_odds(team_fixtures, fixture_lambda, next_gw)
    now_cost_by_code = dict(zip(snapshot['code'], snapshot['now_cost']))
    team_by_code = dict(zip(snapshot['code'], snapshot['team_short_name']))
    summary = render_summary(payload, skipped, next_gw, pct_with_odds, now_cost_by_code, team_by_code)

    finished_at = _now_iso()
    with_odds_rows = sum(1 for r in payload if r['components']['has_odds'])
    details = {
        'ticket': 265,
        'model_version': MODEL_VERSION,
        'next_gw': next_gw,
        'rows_written': len(payload),
        'players_skipped': skipped,
        'rows_with_odds': with_odds_rows,
        'pct_horizon_fixtures_with_odds': round(pct_with_odds, 1),
        'core_ref': core_ref,
    }
    message = f'wrote {len(payload)} row(s), skipped {skipped} player row(s)'
    supabase_io.insert_job_run(url, secret_key, JOB_NAME, 'success', message, details, started_at, finished_at)

    return summary, details


def main() -> int:
    try:
        url, secret_key = supabase_io.read_supabase_env()
    except supabase_io.SupabaseEnvError as exc:
        print(f'live: {exc}. Making no network call.')
        return 1

    started_at = _now_iso()
    try:
        summary, _details = run(url, secret_key, started_at)
    except Exception as exc:  # noqa: BLE001 -- top-level job boundary (LEARNINGS §21: the job
        # must report what it did, even when what it did is fail). Mirrors heartbeat.ts's
        # main().catch(...): leave a job_runs row when we can, print a clear message either way.
        finished_at = _now_iso()
        message = f'live: failed: {exc}'
        print(message)
        try:
            supabase_io.insert_job_run(
                url, secret_key, JOB_NAME, 'failure', message, {'error': str(exc)}, started_at, finished_at,
            )
        except Exception as inner_exc:  # noqa: BLE001
            print(f'live: could not write the failure job_runs row either: {inner_exc}')
        return 1

    print(summary)
    return 0


if __name__ == '__main__':
    sys.exit(main())
