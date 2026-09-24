## Why

`gbm-v1` (#263) passes its offline gate — 5-GW Spearman 0.589 vs points-per-appearance 0.453,
active players, 2025-26, 13,259 rows (`model/reports/eval-latest.md`) — but it writes nothing live.
This ticket runs it every night and writes its rows into `player_projections` next to
`baseline-v1`. **It does not change recommendations**: `config/projection-model.json` stays on
`baseline-v1` until the owner flips it after checking the first run.

## Build — `python -m fpl_model.live` (run from `model/`)

1. **Live state** from `https://fantasy.premierleague.com/api/bootstrap-static/` and `/api/fixtures/`.
   Next GW `g` = `events[].is_next`. Horizon = g..g+4 (stop at 38). Team id → `code` from `teams[]`.
   Snapshot from `elements[]`: `code, status, chance_of_playing_next_round, now_cost` (already
   tenths), `selected_by_percent` (a string — cast), `transfers_in_event, transfers_out_event,
   penalties_order`, plus `element_type` → position.
2. **History** = `sources.load_history(('2026-27', g), core_ref=<sha>)`. Resolve `<sha>` each run
   from `https://api.github.com/repos/olbauday/FPL-Core-Insights/commits/main`. **Never pass
   `'main'`** — `_fetch` caches by file name forever, so a `main` cache would go stale.
3. **Odds** = `fpl_odds.history.load_odds_history()` plus live rows: latest `fixture_odds` row per
   `fixture_id` with `fetched_at` within 48 h and `book_count >= 3`. Map `fixture_id` → event and
   team codes via the FPL fixtures response. λ via `fpl_odds.implied.goal_expectancy(p_home,
   p_draw, p_away)` — 1X2 only. Same contract columns, `season = '2026-27'`, `source = 'the-odds-api'`.
   Pass the combined frame as `odds=` everywhere; the current feature set ignores it, and that is fine.
4. **Train** `train.fit(build_training_frame(history, odds), 'total_points')` and the same for
   `'minutes'`, rows with a null target dropped.
5. **Predict** for each horizon GW `g+h`: one `target_fixtures` row per (player code, fixture) with
   `code, team_code, opp_team_code, was_home, position`. Always call
   `build_decision_frame(history, ('2026-27', g), <fixtures>, odds, snapshot)` — features frozen at
   `g`. **A double GW is two calls, one per fixture slot, each with one fixture per player; sum the
   two predictions.** A blank GW writes 0 points and 0 minutes. Then
   `availability.apply_availability(values, snapshot_rows)` on both points and minutes.
6. **Write** via PostgREST (`requests`): `POST {SUPABASE_URL}/rest/v1/player_projections` with headers
   `apikey` and `Authorization: Bearer` both set to `SUPABASE_SECRET_KEY`, and
   `Prefer: resolution=merge-duplicates`. Batches of 500. Row: `gameweek_id, player_id` (element
   id), `model_version='gbm-v1'`, `player_code, expected_points, expected_minutes, components`.
   `components` = `{"model":"gbm-v1","trained_through":"2026-27 GW<g-1>","availability":…,
   "raw_points":…,"raw_minutes":…,"has_odds":…,"lambda_for":…,"lambda_against":…,
   "drivers":[{"feature","value","contribution"}×5]}` (drivers from `train.contributions`, adding each
   feature's value). Skip and count players whose id is not in `public.players` (FK). Read that
   table paginated with `order=id` and `limit/offset`.
7. **Report**: one `job_runs` row (`job_name='project-points-gbm'`, counts in `details`), and print:
   rows written, players skipped, % of horizon fixtures with odds, top 10 by next-GW points with
   price and team.

Must not edit anything under `model/fpl_model/{features,sources,train,evaluate,availability}.py` or
`model/fpl_odds/` — another ticket edits `features.py` tonight. Import only.

## Workflow

In `.github/workflows/scheduled-jobs.yml`, a new step **"Project points (gbm-v1)"** after
"Project points" and before "Emit projections CSV": `actions/setup-python@v5` (3.12),
`pip install -r model/requirements.txt`, `python -m fpl_model.live`, `working-directory: model`,
env `SUPABASE_URL`/`SUPABASE_SECRET_KEY` from secrets (same names as the other steps),
`continue-on-error: true`, `timeout-minutes: 20`. `actions/cache` for `model/.cache` keyed on
`VAASTAV_SHA` plus the Core SHA. The solver runs at 18:20 UTC, so this step must finish well before.

## Definition of done — offline only

- `cd model && python -m pytest tests` passes. New `tests/test_live.py` uses the sample JSON in
  `tests/fixtures/` and a small synthetic history — **no network, no Supabase**. It shows: rows for
  every horizon GW with no NaN; 0 for a blank-GW team; a DGW player equal to the sum of two
  single-fixture predictions; an `i`-status player at 0; the upsert payload shape above.
- YAML is valid.

## Post-merge owner check (does not block this PR)

The orchestrator triggers one run, reads the summary, and checks the top 10 look like real picks.
**Not a gate.**

## Files

New: `model/fpl_model/live.py`, `model/fpl_model/supabase_io.py`, `model/fpl_model/fpl_api.py`,
`model/tests/test_live.py`, `model/tests/fixtures/{bootstrap-static-sample,fixtures-sample,fixture-odds-sample}.json`.
Edit: `.github/workflows/scheduled-jobs.yml`.
