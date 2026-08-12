# Solver notes — sertalpbilal/FPL-Optimization-Tools smoke test (ticket #29)

This is the written target for the future CSV-adapter ticket. It records what was actually
run, not a guess from reading the README.

## Pinned commit

`45131c5a41d7caadb5cb626c012bfa9111dca7a2` — resolved from upstream `main` on 2026-08-12 via
`git ls-remote https://github.com/sertalpbilal/FPL-Optimization-Tools.git HEAD`.

## Toolchain that actually worked

```
pip install uv                # in this session; the Action uses astral-sh/setup-uv instead
uv sync                        # installs Python 3.14.7 + all deps in ~5s, no manual Python install
cd run
uv run python solve.py
```

`uv sync` output confirmed: Python 3.14.7, `highspy==1.15.1` (bundles HiGHS 1.15.1), `pandas==3.0.5`.
No install failures, no manual dependency wrangling.

## Important deviation from the ticket's assumption — no bundled sample CSV

**The upstream repository at this pinned commit does not ship a sample projections CSV.**
`data/` contains only `user_settings.json`, `comprehensive_settings.json`, two `.md` docs, and
a `team.json.sample`. The historical sample data (`data/sample_outputs/optimal_plan_*.csv`,
which were solver *outputs*, not projection *inputs*, and no projections CSV either) was
deleted upstream in commit `374c36c` ("remove unnecessary files", Aug 2025) — confirmed via
`git log --all -- "*.csv"` against the upstream history.

So "run the solver against its own bundled sample data" could not be done literally. Instead,
this smoke test builds a minimal projections CSV from the **live public FPL bootstrap-static
endpoint** (`https://fantasy.premierleague.com/api/bootstrap-static/`) — the same endpoint the
solver's own `dev/solver.py:prep_data` calls at runtime regardless of what's in the CSV. This
is necessary, not optional: `prep_data` does `pd.merge(elements_team, data, left_on="id_x",
right_on="ID")`, an inner join against live FPL data on player ID. A CSV with synthetic/fake
IDs merges to zero rows and produces an infeasible/empty model — real current FPL player IDs
are required to prove anything.

This is **not** an app data adapter and not this app's data: it is the minimum viable input
the tool itself requires, built the same way for a one-off smoke run as an upstream sample
file would have been consumed. No CSV adapter is written here — that remains a distinct future
ticket's job, now with an accurate target instead of a guessed one.

## Header row actually used — quoted verbatim

```
ID,Pos,1_Pts,1_xMins
```

Derived by reading `dev/solver.py` (`prep_data`, lines ~136–210) rather than guessed:

- `ID` — required. Inner-merge key against live FPL `elements` (`id_x`). Must be a real,
  current FPL element id or the row is dropped before solving.
- `Pos` — required. Read directly as `merged_data["Pos"]` (there is no equivalent column in
  the live FPL data merged in, so the CSV must supply it). Values used elsewhere in the repo:
  `"G"`, `"D"`, `"M"`, `"F"`.
- `{gw}_Pts` — required, one column per gameweek in the horizon (e.g. `1_Pts` for a
  horizon of 1). `prep_data` raises `ValueError(f"{week}_Pts is not inside prediction
  data...")` if a horizon gameweek's column is missing.
- `{gw}_xMins` — required, paired with `{gw}_Pts` the same way, used for the minutes-based
  player-pool filter (`xmin_lb`) and for the randomisation noise term.

Columns present in the wider community "FPL Review" / "solio" format but **not** required by
the solver code path exercised here: `Name`, `Value`, `Team`. Those are only read by the
`mixed`/`mikkel` conversion helpers in `dev/data_parser.py`, not by the direct `solio`/
`fplreview` CSV readers used in this run. A future adapter can supply the fuller format for
compatibility with the community tooling, but the four columns above are the true minimum the
solver needs to run.

## Settings that had to change from the shipped defaults

`data/user_settings.json` ships with `"datasource": "solio"` and `"preseason": true` already —
no change needed there. Two values were changed, both purely to match a **1-gameweek** smoke
CSV instead of the shipped 8-gameweek default horizon:

- `"horizon": 8` → `"horizon": 1`
- `"xmin_lb": 300` → `"xmin_lb": 60` (300 expected minutes across an 8-GW horizon is
  unreachable within a single simulated gameweek of 90 minutes)

No other setting was touched.

## Invocation that produced a solution

```bash
curl -sS -o /tmp/bootstrap.json "https://fantasy.premierleague.com/api/bootstrap-static/"
uv run python data/build_smoke_csv.py   # writes data/solio.csv from /tmp/bootstrap.json
# (edit data/user_settings.json: horizon 8→1, xmin_lb 300→60)
cd run
uv run python solve.py
```

(The Action inlines the CSV-building step instead of a checked-in script — see
`.github/workflows/solver-smoke.yml`. `build_smoke_csv.py` itself was a throwaway file in the
local session, not committed anywhere.)

## Result

- Solver status: **Optimal**, gap 0%, proven — not a timeout/incumbent.
- HiGHS solve time (from HiGHS's own report): **0.25s** (0.05s presolve + 0.20s solve).
- Total wall clock for `uv run python solve.py` (includes live FPL API calls,
  `.venv` already warm from `uv sync`): **~5.2s**.
- A solution file was written automatically to
  `data/results/solio_<timestamp>_<runid>_0.csv` — no explicit `solutions_file` setting was
  needed for this to happen.

Solution output file header (also worth recording — this is the solver's *output* shape, not
its input shape):

```
id,week,name,pos,type,team,buy_price,sell_price,xP,xMin,squad,lineup,bench,captain,vicecaptain,transfer_in,transfer_out,multiplier,xp_cont,chip,iter,ft,transfer_count
```

## What this proves and doesn't prove

Proves: the toolchain (`uv` + `highspy`/HiGHS) installs and solves cleanly in a plain Linux
environment reachable from this session, and confirms the exact input columns the solver code
requires. Also proves it runs the same way under GitHub Actions' network policy — Keshav
should confirm via `workflow_dispatch` after merge, since this session cannot trigger a
GitHub Action directly (see ticket DoD and decisions/ticket-29.md).

Does not prove: solve time or feasibility at the shipped default horizon (8 gameweeks) or
with a non-preseason squad — this smoke test deliberately used the simplest configuration that
would exercise the full install → solve → output path. A later ticket depending on
multi-gameweek horizons or Plan A/B/C iteration should re-check timing at the real horizon
length, not assume this smoke test's ~5s wall clock scales linearly.
