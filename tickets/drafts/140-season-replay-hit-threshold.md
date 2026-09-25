## Why

Product brief §9 Q2: "the exact threshold at which a −4 hit becomes recommendable — the number should
come from the backtest rather than from taste." Today the solver runs with `hit_cost = 4`
(`scripts/build-solver-input.ts` `HIT_COST`), a default nobody measured, and hits are rare.
This ticket replays **2025-26** with `gbm-v1` and the real solver, and measures net points for several
hit costs. **It changes nothing live.** The winning value becomes a one-line change next run.
Replaces draft 125, which replayed `baseline-v1`, read Supabase, and stated the wrong transfer rule.

## Build — Python, `model/fpl_replay/`, public data only

1. **Projections per decision GW g (2..38)**, horizon g..g+4 frozen at g. Use `gbm-v1` exactly as live
   does. Reuse `fpl_model.live.project_horizon`. You may add a `season` parameter to it (default
   unchanged) so it can run on `'2025-26'`. Models: retrain at the same cutoffs as `evaluate.py`
   (GW 1, 8, 15, 22, 29, 36) on data strictly before each cutoff, and use the latest fold ≤ g.
   Fixtures: vaastav `data/2025-26/fixtures.csv` at the pinned SHA (team ids → `code` via `teams.csv`).
   Odds: `fpl_odds.history.load_odds_history()`. No historical availability → factor 1 (state it).
2. **Prices** per player per GW = vaastav `value` (tenths). Selling price follows the FPL rule:
   purchase + floor((current − purchase) / 2) when it has risen, else current.
3. **Rules:** 15-man squad, £100.0m start, max 3 per club, 1 FT a week, **banking up to 5**, −4 per extra
   transfer. No chips (state it). No auto-subs; score the solver's starting XI with captain ×2 (state it).
4. **Solver:** `sertalpbilal/FPL-Optimization-Tools` at the pinned commit
   `45131c5a41d7caadb5cb626c012bfa9111dca7a2`, installed with `uv sync`, run as
   `uv run python run/solve.py --config <file>`. Build `team.json`, the CSV and the config the way
   `scripts/build-solver-input.ts` does. **Mirror every setting in `buildSolverConfig`** (horizon 5,
   `decay_base 0.9`, `FT_VALUE_LIST`, `XMIN_LB 150`, etc.) except: `hit_cost` = the setting under test,
   `num_iterations 1`, solver time limit 60 s. GW1 squad: a from-scratch solve with the £100.0m budget.
5. **Settings compared:** `hit_cost` 4 (today), 6, 8, and "no hits" (FT-only). Plus a
   **never-transfer** baseline (hold the GW1 squad all season).
6. **Report** `model/reports/season-replay.md`: per setting, season net points, points lost to hits,
   hits taken, transfers made, and the per-GW net. Plus the difference vs `hit_cost 4` and vs
   never-transfer. Also print it to stdout.
7. **Workflow** `.github/workflows/season-replay.yml` (`workflow_dispatch`): a matrix job per setting,
   `actions/setup-python` + `astral-sh/setup-uv`, checkout of the pinned solver, run the replay,
   upload the report as an artifact, **and repeat the summary table as a `::notice title=season-replay::`
   annotation** (run logs and artifacts aren't reachable by the orchestrator, annotations are).
   `timeout-minutes: 120`.

## Definition of done — offline only

- `cd model && python -m pytest tests` passes. New `tests/test_replay.py` covers: selling-price rule,
  FT banking capped at 5, a hit costs exactly 4 in net points, budget and 3-per-club checks, captain ×2
  scoring, and horizon projections for a blank and a double GW on a small synthetic season.
- **Smoke run inside your sandbox:** the replay for GW 1–4 with `hit_cost 4` finishes and writes a
  report with non-zero points for every GW. **Liveness:** identical results for two different
  `hit_cost` values over the smoke slice are fine (few hits early), but the code path must run.
  If the solver can't be installed in your sandbox, deliver code + unit tests, say so plainly, and stop.
  The full run happens in Actions after merge.
- `npm run build` and `npm run lint` still clean. YAML valid.

## Post-merge owner check (does not block this PR)

The orchestrator dispatches `season-replay.yml` and reads the annotations. If a `hit_cost` other than
4 beats 4 by a clear margin, the next run carries the one-line `HIT_COST` change. **Not a gate.**

## Files

New: `model/fpl_replay/__init__.py`, `model/fpl_replay/replay.py`, `model/fpl_replay/solver_io.py`,
`model/fpl_replay/rules.py`, `model/tests/test_replay.py`, `model/reports/season-replay.md`
(smoke-slice version), `.github/workflows/season-replay.yml`. Edit: `model/fpl_model/live.py` (optional
`season` parameter only), `feature-list.md` (item 32 → in progress), `.gitignore` (`solver/` checkout
dir if placed in the repo tree). No `src/`, no `scripts/`, no Supabase.
