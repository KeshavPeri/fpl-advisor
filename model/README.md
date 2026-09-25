# model/ — gbm-v1

A learned projection model (LightGBM, trained on four seasons of public FPL data) behind the
existing CSV seam described in `docs/model-diagnosis-2026-09-24.md`. Nothing under `src/` or
`scripts/` changes: this ticket (#258) builds and gates the model offline only. Wiring it into the
nightly job and `player_projections` is run 2's ticket, not this one.

Full reasoning: `docs/model-diagnosis-2026-09-24.md` (§4 experiments, §6 architecture, §7 gates,
§8 the run plan and the frozen contracts reproduced below).

## Setup

```
cd model
pip install -r requirements.txt
python -m pytest tests
python -m fpl_model.evaluate     # ~3-5 min: downloads and caches four seasons, runs the gate
```

Downloads are cached under `model/.cache/` (gitignored). `python -m fpl_model.evaluate` writes
`model/reports/eval-latest.md` and exits non-zero if a gate fails — it never tunes the model to
pass; a missed gate is reported, not chased.

**Backend:** LightGBM when it installs (the normal case — `pip install lightgbm` succeeds on a
plain Linux CPU box); `sklearn.ensemble.HistGradientBoostingRegressor` otherwise, with a printed
warning. `model/fpl_model/train.py`'s `BACKEND` constant says which one ran; `eval-latest.md`
records it too.

## Frozen contracts (docs/model-diagnosis-2026-09-24.md §8)

**Do not change these signatures or column names without also updating every ticket that imports
them.** They are the seam between this ticket's data/feature/model code and every later one
(odds features, the nightly live job, learned availability).

```python
# model/fpl_model/sources.py
def load_history(through: tuple[str, int]) -> pd.DataFrame: ...
# through = (season, gw). Completed player-gameweeks strictly before it: full vaastav seasons
# strictly before `through`'s season, plus `through`'s own vaastav season for gw < through[1] when
# that season is one of the four pinned ones, else the current/live season from
# FPL-Core-Insights for gw < through[1]. Key is always player `code`, never element id.
#
# history columns: code, season, gw, team_code, position, minutes, total_points, goals_scored,
#   assists, expected_goals, expected_assists, expected_goals_conceded, bps, bonus, ict_index,
#   threat, creativity, influence, saves, clean_sheets, goals_conceded, starts,
#   defensive_contribution, value (tenths), own_pct_rank, transfers_rank, nfix, was_home,
#   opp_team_code, gf, ga
#
# odds columns (fpl_odds output, run 2, joined by ticket #264): season, gw, kickoff_date,
#   home_code, away_code, p_home, p_draw, p_away, lambda_home, lambda_away, source
#
# snapshot columns: code, status, chance_of_playing_next_round, now_cost (tenths),
#   selected_by_percent, transfers_in_event, transfers_out_event, penalties_order

# model/fpl_model/features.py
def build_training_frame(history: pd.DataFrame,
                         odds: pd.DataFrame | None = None,
                         snapshots: pd.DataFrame | None = None) -> pd.DataFrame: ...
def build_decision_frame(history: pd.DataFrame,
                         decision: tuple[str, int],          # (season "2026-27", next gameweek)
                         target_fixtures: pd.DataFrame,      # one row per player-code x target GW x fixture
                         odds: pd.DataFrame | None = None,
                         snapshot: pd.DataFrame | None = None) -> pd.DataFrame: ...
FEATURES: list[str]      # the ordered model input columns

# model/fpl_model/train.py
def fit(frame: pd.DataFrame, target: str, seed: int = 0) -> Model: ...   # target: 'total_points' | 'minutes'
def predict(model, frame: pd.DataFrame) -> np.ndarray: ...
def contributions(model, frame: pd.DataFrame, top: int = 5) -> list[list[dict]]:  # for components.drivers

# model/fpl_model/availability.py
def availability_factor(status: str, chance_next: float | None) -> float: ...           # parity with minutes.ts
def apply_availability(values: np.ndarray, snapshot_rows: pd.DataFrame) -> np.ndarray: ...
#   live.py must call apply_availability (never availability_factor directly), so run 3's
#   learned-availability ticket can change the rule inside it without touching live.py
```

Run 1 accepted and ignored `odds`; it used from `snapshot`/`snapshots` only price and
ownership/transfer ranks (both already present per-row in `history`'s own schema for a completed
gameweek; a live decision reads them from the current bootstrap snapshot instead — see
`build_decision_frame`). **Run 2's ticket #264 joins `odds` in** — see "Market-odds features
(ticket #264)" below.

**Parity, proved in `model/tests/test_parity.py`:** for 2025-26 GW 20, `build_decision_frame`
rows equal `build_training_frame` rows for the same players, column for column. This holds by
construction, not by coincidence: `build_decision_frame` appends one synthetic row per player
(context known, performance unknown) to `history` and runs the *same* rolling feature code as
`build_training_frame` — there is no second implementation of the rolling logic to drift.

## Deliberate differences from `model/reference/reference_gbm.py`

Per the ticket, two changes were required and are implemented in `features.py`:

- **Ownership and net transfers are within-gameweek percentile ranks** (`own_pct_rank`,
  `transfers_rank`), computed by `sources.py` at load time, not raw counts (`sel_log`/`tb`/`tb_rel`
  in the reference script). This makes vaastav (raw ownership counts) and the FPL API / Core
  Insights (`selected_by_percent`, a 0-100 float) agree on the same scale — a rank is unaffected by
  which unit produced it.
- **Team and opponent rolling features are keyed on team `code`**, never team name (the reference
  script joined fixtures by name).

One further, undirected simplification, flagged here because it is a real deviation from the
reference script's feature set, not just a rename: the frozen `history` schema carries only `gf`
and `ga` (actual goals for/against) as team-level facts, not a team-level expected-goals aggregate.
The reference script also rolled team/opponent *expected* goals (`t_txg_k`, `o_txg_k`). Since the
contract's `history` table has no such column to roll, gbm-v1's team-rolling features are goals
for/against only (`t_gf_k`, `t_ga_k`, `o_gf_k`, `o_ga_k` for k in 5/10/20) — §4e's own ablation
found rolling team form worth <0.001 Spearman either way, so this is a cheap simplification, not a
silent loss of signal. If a later ticket wants team xG rolling back, it needs a per-team-fixture
xG column added to the `history` contract first.

## Market-odds features (ticket #264)

`features.py` joins four columns onto every single-fixture row from `fpl_odds.history`:
`lambda_for`, `lambda_against`, `p_win`, `p_cs = exp(-lambda_against)`, computed from the row's
own side of its own fixture. Join key: `(season, home_code, away_code)` — each ordered pairing
happens once a season, so no dates are needed; home/away are derived from the row's own
`team_code`/`opp_team_code`/`was_home` (>=0.5 counts as home), never read off the odds frame.
NaN when there is no matching odds row, or when `nfix != 1` (a blank/double gameweek has no
single fixture to join on). Same join, same code path, for `build_training_frame` and
`build_decision_frame`. Controlled by `features.USE_ODDS` (default `True`).

**Kept: odds barely move season-wide ranking, as diagnosed, but they measurably pick a better
captain.** `python -m fpl_model.evaluate` trains a same-data ablation (the four columns excluded
from the feature list, otherwise identical) and prints with/without odds side by side. On the
25 Sept 2026 run: primary 5-GW Spearman 0.589 with odds vs 0.589 without (within the −0.005
tolerance); captain avg points 6.65 with odds vs 5.65 without (**+1.00**, gate requires ≥ +0.30);
top-11 avg 4.77 with odds vs 4.86 without (within the −0.15 tolerance). Odds coverage on
single-fixture 2025-26 rows: 99.9% (floor 95%). All three offline gates pass — see
`model/reports/eval-latest.md` for the full with/without table, including the GW 2-10 and
GK+DEF slices (informational only; odds do not clear those two, as the ticket's own diagnosis
predicted).

## Offline gate result

See `model/reports/eval-latest.md`, generated by `python -m fpl_model.evaluate` and committed.
The gate (docs/model-diagnosis-2026-09-24.md §7, plus the ticket #264 odds gate below):

- **Liveness** — every retrain fold has test rows and non-constant predictions; odds coverage on
  single-fixture test-season rows is >= 95%; the with/without-odds numbers are not identical.
  Hard fail if not.
- **Primary** — active population (>=1 appearance in the player's previous 5 GW rows), 5-GW total
  with zeros, g <= 34, pooled Spearman. Pass if >= 0.55 AND >= this run's own ppm baseline + 0.08
  AND every position >= its own ppm baseline + 0.05.
- **Secondary** — featured population, 5-GW. Pass if >= this run's own minutes baseline + 0.02.
- **Market-odds (ticket #264)** — same-data with/without-odds ablation. Pass if primary-with >=
  primary-without − 0.005, captain-with >= captain-without + 0.30, and top11-with >=
  top11-without − 0.15.
- **Informational, never gated** — 1-GW featured Spearman; captain/top-11 average points from a
  most-owned pool each GW (GBM and ppm baseline); mean bias on active rows; the GW 2-10 and
  GK+DEF odds slices.

Gates compare against baselines computed on **this run's own walk-forward**, not the hardcoded
reference figures from the 24 Sept diagnosis run (which are printed in the report for comparison
only) — the two should be close, but the gate is never allowed to depend on numbers this code
didn't itself produce.
