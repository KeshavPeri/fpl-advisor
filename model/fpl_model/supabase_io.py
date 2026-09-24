"""Supabase I/O for the gbm-v1 nightly job (ticket #265 / R2-T2), over PostgREST via `requests`
-- this repo's Python jobs have no `supabase-py` precedent, and PostgREST keeps this file a
single small, testable surface (matching `scripts/heartbeat.ts`'s two-env-var convention on the
TypeScript side).

`SUPABASE_URL`/`SUPABASE_SECRET_KEY` are read once by `read_supabase_env`; every request sets
both `apikey` and `Authorization: Bearer <secret>` to the secret key, exactly as the ticket
specifies -- this key bypasses RLS, matching the `service_role` grants in the
`player_projections` (SELECT, INSERT, UPDATE) and `fixture_odds` (SELECT, INSERT only --
append-only) migrations. This module never issues a DELETE anywhere.

`select_latest_odds` is the one function here with no I/O -- the live-odds freshness/book-count
policy, pulled out so `model/tests/test_live.py` can prove it against the committed
`fixture-odds-sample.json` with no network or Supabase.
"""
from __future__ import annotations

import os
from typing import Any

import pandas as pd
import requests

PAGE_SIZE = 1000
WRITE_BATCH_SIZE = 500
_REQUEST_TIMEOUT = 30

_FIXTURE_ODDS_COLUMNS = ['fixture_id', 'fetched_at', 'book_count', 'p_home', 'p_draw', 'p_away']


class SupabaseEnvError(RuntimeError):
    """Raised when SUPABASE_URL/SUPABASE_SECRET_KEY are not both set. Mirrors
    `scripts/heartbeat.ts`'s `readSupabaseEnv`: the caller prints the message and makes no
    network call at all, rather than failing partway through one."""


class SupabaseWriteError(RuntimeError):
    """Raised when a PostgREST write (upsert or insert) fails."""


class SupabaseReadError(RuntimeError):
    """Raised when a PostgREST read fails."""


def read_supabase_env() -> tuple[str, str]:
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SECRET_KEY')
    missing = [name for name, value in (('SUPABASE_URL', url), ('SUPABASE_SECRET_KEY', key)) if not value]
    if missing:
        raise SupabaseEnvError(
            'required environment variable(s) not set: ' + ', '.join(missing)
        )
    return url, key  # type: ignore[return-value]


def _headers(secret_key: str) -> dict[str, str]:
    return {'apikey': secret_key, 'Authorization': f'Bearer {secret_key}'}


def fetch_all_player_ids(url: str, secret_key: str) -> set[int]:
    """Every `id` in `public.players`, paginated (`order=id`, `limit`/`offset`) -- the FK-skip
    check: a projection row whose `player_id` is not in this set is skipped and counted rather
    than written (the FK on `player_projections.player_id` would reject it anyway)."""
    ids: set[int] = set()
    offset = 0
    while True:
        resp = requests.get(
            f'{url}/rest/v1/players',
            headers=_headers(secret_key),
            params={'select': 'id', 'order': 'id', 'limit': PAGE_SIZE, 'offset': offset},
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code >= 300:
            raise SupabaseReadError(f'read of "players" failed ({resp.status_code}): {resp.text[:500]}')
        page = resp.json()
        if not page:
            break
        ids.update(int(row['id']) for row in page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return ids


def fetch_fixture_odds_since(url: str, secret_key: str, since_iso: str) -> pd.DataFrame:
    """Every `fixture_odds` row fetched at or after `since_iso` (a generous server-side filter --
    the real freshness/book-count policy is `select_latest_odds`, applied after this read).
    Paginated (`limit`/`offset`)."""
    rows: list[dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f'{url}/rest/v1/fixture_odds',
            headers=_headers(secret_key),
            params={
                'select': 'fixture_id,fetched_at,book_count,p_home,p_draw,p_away',
                'fetched_at': f'gte.{since_iso}',
                'order': 'fixture_id.asc,fetched_at.desc',
                'limit': PAGE_SIZE,
                'offset': offset,
            },
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code >= 300:
            raise SupabaseReadError(f'read of "fixture_odds" failed ({resp.status_code}): {resp.text[:500]}')
        page = resp.json()
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return pd.DataFrame(rows, columns=_FIXTURE_ODDS_COLUMNS)


def select_latest_odds(df: pd.DataFrame, now: Any, freshness_hours: int = 48,
                        min_book_count: int = 3) -> pd.DataFrame:
    """The live-odds selection policy (ticket #265): keep only rows with `book_count >=
    min_book_count` and `fetched_at` within `freshness_hours` of `now`, then keep the single
    latest (`fetched_at` desc) row per `fixture_id`. Pure -- no I/O -- so it is provable directly
    against a hand-built or sample-JSON frame."""
    if df.empty:
        return df
    d = df.copy()
    d['fetched_at'] = pd.to_datetime(d['fetched_at'], utc=True)
    now_ts = pd.Timestamp(now)
    if now_ts.tzinfo is None:
        now_ts = now_ts.tz_localize('UTC')
    cutoff = now_ts - pd.Timedelta(hours=freshness_hours)
    d = d[(d['fetched_at'] >= cutoff) & (d['book_count'] >= min_book_count)]
    if d.empty:
        return d.reset_index(drop=True)
    return (
        d.sort_values(['fixture_id', 'fetched_at'], ascending=[True, False])
        .drop_duplicates(subset='fixture_id', keep='first')
        .reset_index(drop=True)
    )


def upsert_player_projections(url: str, secret_key: str, rows: list[dict]) -> None:
    """POST batches of `WRITE_BATCH_SIZE` with `Prefer: resolution=merge-duplicates` -- an
    upsert on the table's own primary key (`gameweek_id, player_id, model_version`). Never a
    delete."""
    headers = {
        **_headers(secret_key),
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    }
    for i in range(0, len(rows), WRITE_BATCH_SIZE):
        batch = rows[i : i + WRITE_BATCH_SIZE]
        resp = requests.post(
            f'{url}/rest/v1/player_projections', headers=headers, json=batch, timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code >= 300:
            raise SupabaseWriteError(
                f'upsert into "player_projections" failed ({resp.status_code}): {resp.text[:500]}'
            )


def insert_job_run(url: str, secret_key: str, job_name: str, status: str, message: str,
                    details: dict[str, Any], started_at: str, finished_at: str) -> None:
    headers = {**_headers(secret_key), 'Content-Type': 'application/json'}
    payload = {
        'job_name': job_name, 'status': status, 'message': message, 'details': details,
        'started_at': started_at, 'finished_at': finished_at,
    }
    resp = requests.post(
        f'{url}/rest/v1/job_runs', headers=headers, json=payload, timeout=_REQUEST_TIMEOUT,
    )
    if resp.status_code >= 300:
        raise SupabaseWriteError(f'insert into "job_runs" failed ({resp.status_code}): {resp.text[:500]}')
