# FPL Advisor — model diagnosis, research and finishing plan

Written 24 Sept 2026 by an independent Claude session (Cowork), at Keshav's request. Inputs read:
`app-factory/HANDOFF-2026-09-24.md`, `LEARNINGS-first-build-wave.md`, `LEARNINGS-second-build-wave.md`,
`deltas.md`; in `fpl-advisor`: `src/lib/projection/*`, `scripts/run-backtest.ts` (headers),
`scripts/train-and-evaluate-learned-model.ts` (header), `scripts/emit-projections-csv.ts`,
`docs/model-review-2026-09-02.md`, `docs/projection-model-backlog.md` (G-entries, close-out),
`docs/reports/backtest-report-7.md`, `out/*.md`, `product-brief.md`, `feature-list.md` (v3.0),
`tickets/drafts/100,125`, `git log` (427 commits).

**Supabase could not be queried from this session** — both the cloud sandbox and the device VM proxy
return 403 on `vguwmrtcsmkkzrocdqgn.supabase.co`. Instead I rebuilt the key questions on public data
(vaastav/Fantasy-Premier-League and FPL-Core-Insights on GitHub) and ran real experiments. Every
figure marked **[exp]** below comes from those experiments; every figure marked **[repo]** is quoted
from a repo report. They are different populations — never subtract one from the other directly.

This file is meant to be consumed by the next orchestrator session to write tickets. Section 8 is
the run plan; section 9 the owner commands; **section 16 is binding standing rules for every future
orchestrator session — read it before writing any ticket**; Appendix A the reference code.

---

## 0. The answer in ten lines

1. **Replace, don't tune.** The hand-built combiner (`baseline-v1`) is at its ceiling on its inputs.
   Put a standard learned model (LightGBM, trained on four seasons of public FPL data) behind the
   existing CSV seam as `gbm-v1`. Keep `baseline-v1` running unchanged as fallback and explainer.
2. **The in-house learned model failed for one reason: one season of data.** Same features, same
   model, same held-out gameweeks: trained on one season it loses to the naive minutes ranker at 5 GW
   (0.416 vs 0.423); trained on 3 prior seasons + in-season it wins clearly (0.465) **[exp]**.
3. **Two headline numbers in the handoff are wrong.** "0.354 vs naive 0.345" compares two versions of
   the model, not model vs naive (naive 1-GW is ~0.30). "Captaincy −21 is the largest defect" is the
   normal value of that metric: a good model scores about −5 per gameweek on it **[exp]**.
4. **The metric steered the work wrong.** 1-GW Spearman on players who featured is saturated near 0.35
   for every sensible model, and it drops the rows where a player doesn't play — the most predictable
   and most decision-relevant signal. Switch to 5-GW Spearman on *active* players, zeros included.
5. **The work loop was the bigger problem.** Each hypothesis cost a night, the Builder could not
   measure its own change (no DB), and the gate ran after merge. Model development must happen on
   public CSVs the Builder can download, so the gate is computed *inside* the PR.
6. **Plan: 4 required runs (model in runs 1–3, product features in runs 3–4), 1 optional, 2 slack =
   7.** `gbm-v1` makes the recommendations after run 2 plus one owner switch.

---

## 1. Corrections to the handoff (§6c, §7) — say these plainly

**1a. "One-gameweek Spearman ~0.354 against a naive minutes baseline of ~0.345" — wrong.**
`docs/projection-model-backlog.md` lines ~1630–1651 (ticket #201/#207, backtest report 11): 0.354 is
the pre-#191 minutes model and 0.345 is the shipped #191 model. The naive "prior minutes per match"
ranker scored **0.299** on the same population in report 7 [repo] (0.304 in the model review's
reconstruction). So at 1 GW the model beats naive by ~0.055. The handoff's five-gameweek claim is
right: **model 0.409 vs naive 0.407, hindsight oracle 0.506** [repo, backlog close-out #220/#222].
The real weakness is the 5-GW horizon — which is exactly what the solver optimises.

**1b. "Captaincy is the largest measured defect (1/4 hits, −21 vs best alternative starter)" — not a
defect.** The metric compares the captain with the *hindsight-best* of the other ten starters. Its
expected value is strongly negative for any model. Tested on 2025-26 with a template XI (the most-owned
GK + 10 most-owned outfielders each GW, 37 GWs) [exp]:

| Captain chosen by | Mean (captain − best other starter) per GW | First 4 GWs cumulative | Hit rate | Captain avg pts |
|---|---|---|---|---|
| GBM (this doc) | **−5.30** | −31 | 14% | 6.38 |
| Season points per appearance | −5.89 | −27 | 14% | 5.81 |
| Price | −6.54 | −25 | 14% | 5.35 |

Keshav's −21 over 4 GWs (−5.25/GW) with 1 hit in 4 is exactly what a competent model produces.
**Do not write a captaincy-fix ticket from this number.** The right captain metric is
"captain points vs the captain a naive rule would have picked" (#249's regret-vs-naive section does
this — use only that).

**1c. "Market odds were the single biggest win" — unmeasured.** It was the right call and it fixed
visibly wrong fixture readings (Brighton v Arsenal 0.6122 → 0.3163 [repo]). But nothing measured its
effect on accuracy: the backtest has no historical odds. In my experiments, removing all fixture
features from the learned model changed 5-GW Spearman by ≤0.001 and 1-GW by ≤0.006 [exp, §4e].
Fixture strength matters for close calls (which premium to captain, which defender), not for the
season-wide ranking metric.

---

## 2. Diagnosis — causes in the model

**M1. Not enough history to know who is good.** Every player-quality input is one season of the
player's own shrunk xG/xA per 90 (`rates.ts`, `SHRINKAGE_K = 3`, two-stage toward last season), and
the point-in-time substrate (`feature_history`, `training_features`) covers 2025-26 only. The model
review already found the gap ("player-quality resolution"; 5-GW oracle 0.485 vs model 0.425). The
ablation in §4d shows it is a data-volume problem, not an algorithm problem: 3 prior seasons lift
5-GW Spearman from 0.416 to 0.465 on identical features and folds.

**M2. The minutes model is the weakest part and carries most of the signal.** The review measured
~85% of the model's ranking signal comes from minutes. `minutes.ts` is a 5-match mean shrunk toward the
season mean, times availability. Two concrete defects:
- `pAppears = clamp01(availability)` (`minutes.ts` `estimateMinutes`). Any fit player gets
  `pAppears = 1.0`, so `expectedAppearancePoints` (`pointValues.ts`) gives him ≥1 point even if he
  has been an unused sub for five weeks. Backup keepers and bench fodder are over-projected.
- The backtest never saw this: it **excludes every row where the player did not feature**
  (6,913 of 18,588 rows in report 7). Predicting *who plays* — the biggest real error — was never
  measured.

**M3. The model ignores cheap signals that good models use.** In the learned model the top features
by gain were: last-match minutes, last-match ICT index, ownership, net transfers, last-3 minutes,
38-match points average, fixture count, price [exp]. `baseline-v1` uses none of ICT/threat/creativity,
price (except a zero-history prior), ownership or transfers. On the active-player population the
ownership/transfer features alone are worth +0.02–0.03 Spearman [exp, §4c].

**M4. A lot of engineering went into the lowest-leverage term.** The fixture term went through
ClubElo → stale Elo → FDR → point-in-time team strength → shrinkage → market odds, and two slope
dampings (#184 attack, #244 defence) — roughly 8 PRs. Its measured effect on ranking is <0.01 (§4e).
Also: #184 and #244 fitted their slopes against point-in-time goal-difference strength, a noisy
predictor. Fitting a slope against a noisy predictor biases it toward zero (errors-in-variables). Those
damped slopes are now applied to market odds, which are far less noisy, so live projections probably
under-react to fixtures. Moot if `gbm-v1` replaces the combiner; note it if `baseline-v1` stays primary.

**M5. Level constants were fitted one ticket at a time and do not change rankings.** Assist conversion
(#148), goal conversion (#162), bonus exponent (#241, #122) are per-position multipliers. The review
measured removing both conversion tables changes season Spearman by −0.001. Legitimate level fixes,
but they cannot move the metric that was used to judge progress.

**M6. Half the model changes were invisible to the instrument.** The backtest excludes bonus from both
sides (#127, permanent), has no historical odds, and drops non-featuring rows. So the bonus work
(#78, #241, #122), the odds work (#238) and every availability effect could not show up in the number
used to judge the model.

## 3. Diagnosis — causes in how the work was organised

**O1. The experiment loop was the overnight pipeline.** One hypothesis per ticket per night, built by
a Builder with no database, merged, then measured days later by a hand-dispatched Action
(`backtest.yml` is `workflow_dispatch` only). LEARNINGS §20 documents a correct gate (#217: needed
MID +0.043, got +0.005) that could not stop the merge. #191 shipped and was reverted by #207. An
analyst on a laptop runs dozens of these experiments per hour. The two most productive artefacts on the
project — the 2 Sept model review and this document — were both interactive analysis on public CSVs.

**O2. The measuring stick was saturated and kept changing.** MAE → calibration ratios → 1-GW
Spearman → baselines → 5-GW Spearman → oracle → per-position oracle. Each change needed instrument
tickets, and instrument defects outnumbered model defects three waves running (LEARNINGS §18). The
1-GW featured-player Spearman sits at ~0.35 for baseline-v1 (0.354 [repo]), for a multi-season GBM
(0.346 [exp]) and near the hindsight blend ceiling (0.375 [repo]). Its resolution (~±0.01) is the
size of most changes that were tested against it.

**O3. No external benchmark and no research first.** The standard approaches (§5) were never tried.
The public multi-season dataset (vaastav, 2016-17 onward, every player every fixture including zero
minutes) was never used. Building and evaluating the GBM in §4 took about an hour.

**O4. The data architecture forced substrate tickets.** Point-in-time history was rebuilt inside
Supabase one season at a time (`feature_history` #121/#125/#146/#185, `training_features` #203,
`player_gameweek_history` #248). Every consumer then needed its own ticket (LEARNINGS §15), and every
evaluation needed live credentials the Builder never has.

**O5. Wrong premises flowed through unchecked.** The pipeline checks implementation, not diagnosis
(LEARNINGS §17). This handoff itself carried two wrong headlines (§1a, §1b). A captaincy "fix" ticket
written from §6c would have been a wasted night.

**O6. Process weight.** Source files are mostly prose (e.g. `minutes.ts`: 220 lines around a
~25-line function; `run-backtest.ts`: 5,148 lines; backlog: 2,539 lines). Every ticket paid to write
it and every next session paid to read it.

Rough PR tally since 26 Aug from `git log` (my classification, approximate): ~15 PRs changed live
projections (#113, #119, #148, #162, #184, #191→reverted #207/#210, #213/#217, #229/#234 (never
executed), #235/#239, #238/#245, #241, #242/#243, #244/#246, #122/#257, #109); ~25 were measurement
(#127, #132, #133, #140, #147, #155, #158, #159, #161, #175, #186, #192, #193, #197, #198, #201, #209,
#214/#216, #223, #224, #232, #240, #249, #255, #256); ~12 were data substrate (#121, #125, #146, #154,
#167, #176, #177, #185, #203, #208/#212, #219/#221, #248/#251).

---

## 4. What I tested (public data, reproducible)

### 4a. Setup
- **Data:** `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88/data/{season}/gws/merged_gw.csv`
  for 2022-23, 2023-24, 2024-25, 2025-26 (2021-22 lacks `starts` and xG), joined to
  `.../data/{season}/players_raw.csv` (`id` → `code`, the stable key). 109,956 player-gameweek rows
  after aggregating double gameweeks (24,957 / 28,742 / 26,919 / 29,338 by season). Every player has a
  row for every team fixture while registered, **including 0-minute rows**.
- **Features (145), all strictly before the target gameweek:** rolling means over the last 1, 3, 5,
  10 and 38 player-gameweeks (across season boundaries, keyed on `code`) of minutes, points, goals,
  assists, xG, xA, BPS, bonus, ICT, threat, creativity, saves, clean sheets, goals conceded, starts,
  60+ indicator, appeared indicator, defensive contribution, xGC; per-90 rates over the last 10 and 38
  (xG, xA, points, BPS, threat, creativity, defcon, saves); season-to-date minutes and appearances;
  team and opponent rolling goals for/against and xG for/against (5/10/20 fixtures); position, price
  (`value`), home flag, fixture count; ownership (`log1p(selected)`), transfer balance and balance
  relative to ownership.
- **Model:** LightGBM 4.7 regression, `learning_rate 0.03, num_leaves 31, min_data_in_leaf 100,
  feature_fraction 0.7, bagging 0.8/1, lambda_l2 1.0, 600 rounds`, target `total_points`
  (and a separate model for the 5-GW sum).
- **Test:** 2025-26 walk-forward. Retrain at GW 1, 8, 15, 22, 29, 36 on all prior seasons plus
  2025-26 rows strictly before the cutoff (5-GW model: before cutoff − 4). No row ever sees its target.
- **Populations:** *featured* = played in the target GW and ≥1 prior appearance this season (the
  repo's population, 10,824 rows vs the repo's 10,460); *active* = ≥1 appearance in the player's
  previous 5 gameweek rows, zeros included in the target (14,882 rows at 1 GW, 13,259 at 5 GW).
- **Baselines:** season-to-date minutes per appearance ("minutes"), points per appearance ("ppm"),
  xG+xA per appearance, last-5 points ("form"), price. My minutes baseline is built from vaastav, so
  it scores lower (0.264) than the repo's (0.299) — compare lifts over the baseline, not raw levels.

### 4b. Results — featured population (the repo's population)

| Ranker | 1-GW Spearman | 5-GW Spearman |
|---|---|---|
| GBM (all features) | **0.346** | **0.431** (5-GW model) / 0.411 (1-GW model) |
| GBM without ownership/transfers | 0.341 | 0.417 |
| Minutes per appearance | 0.264 | 0.376 |
| Points per appearance | 0.258 | 0.388 |
| xG+xA per appearance | 0.129 | 0.218 |
| Last-5 points | 0.255 | — |
| Price | 0.121 | 0.201 |

By position, featured, GBM vs minutes baseline — 1 GW: GK 0.161/−0.007, DEF 0.278/0.179,
MID 0.392/0.354, FWD 0.445/0.358. 5 GW: GK 0.272/0.089, DEF 0.402/0.314, MID 0.447/**0.455**,
FWD 0.481/0.432. (Midfield at 5 GW is the one place the minutes ranker still edges it on this
population.)

**Reading:** lift over the minutes baseline at 5 GW — GBM **+0.055** [exp]; baseline-v1 **+0.002**
[repo, 0.409 vs 0.407]. Different constructions, so this is indicative, not a head-to-head; run 1's
gate settles it offline.

### 4c. Results — active population (recommended primary metric)

| Ranker | 1-GW Spearman | 5-GW Spearman |
|---|---|---|
| GBM (1-GW model) | **0.571** | **0.595** |
| GBM (5-GW model) | — | 0.590 |
| GBM without ownership/transfers | 0.543 | 0.570 |
| Points per appearance | 0.350 | 0.452 |
| Minutes per appearance | 0.351 | 0.442 |

5-GW by position, GBM-1 vs ppm vs minutes: GK 0.569/0.318/0.300 · DEF 0.566/0.409/0.418 ·
MID 0.605/0.480/0.522 · FWD 0.620/0.500/0.516. Calibration: mean predicted 2.220 vs actual 2.198
points per player-GW. On the active population the 1-GW model ranks 5-GW totals as well as a
dedicated 5-GW model (0.595 vs 0.590); on the featured population the dedicated model is better
(0.431 vs 0.411). The solver needs a number per gameweek anyway, so production uses one per-GW model
applied to each future gameweek (§6), and the 5-GW model is kept only as an evaluation reference.

Every listed player (28,497 rows, 1 GW): GBM Spearman 0.735, MAE 0.975. Starters only (8,056):
MAE 2.34, RMSE 3.30 — worse than published figures (FPL Review MD RMSE 2.803, FPL Pulse starters
MAE 1.95), partly because the model is trained on all rows and conditioning on "started" is a
lookahead population. Expect a gap to commercial models; the goal is to beat our own baselines.

### 4d. The one-season ablation (why learned-v1 failed)

Same features, same LightGBM settings, same held-out GWs as #214 (cutoffs 23/26/29/32, evaluated on
GW 23–38), featured population:

| Training data | 1-GW Spearman | 5-GW Spearman |
|---|---|---|
| 3 prior seasons + in-season | **0.378** | **0.465** |
| In-season (2025-26) only | 0.326 | 0.416 |
| Minutes baseline, same rows | 0.272 | 0.423 |
| (no ownership/transfers) multi / single | 0.376 / 0.310 | 0.454 / 0.410 |

Single-season training loses to the naive minutes ranker at 5 GW — exactly what #214/#216 found for
learned-v1. With history it wins by 0.04. **learned-v1 was parked on the wrong conclusion.**

### 4e. Fixture features ablation (GW 2–38, retrains at 2/9/16/23/30)

| | 1-GW active | 1-GW featured | 5-GW active | 5-GW featured | GK+DEF featured 1-GW |
|---|---|---|---|---|---|
| With team/opponent rolling features | 0.570 | 0.347 | 0.590 | 0.427 | 0.276 |
| Without | 0.571 | 0.341 | 0.589 | 0.426 | 0.267 |

Rolling team form adds almost nothing to rankings. Market odds are a sharper fixture signal than
rolling form, so they may do better — but expect +0.00 to +0.02, not a step change.

### 4f. FPL's own expected points as a benchmark

FPL-Core-Insights `By Gameweek/GW{g}/player_gameweek_stats.csv` (2025-26) carries `ep_next`,
`ep_this`, `status`, `chance_of_playing_next_round`, `penalties_order`, `selected_by_percent`. The
GW-g file is an end-of-gameweek snapshot (its `ep_this` and `form` already include GW g — leaky).
Using `ep_next` from the GW g−1 file as the pre-deadline forecast: Spearman **0.279** on the featured
population (11,057 rows). baseline-v1's 0.354 [repo] clearly beats FPL's own number. Useful as a
free sanity floor; not a target.

### 4g. Decision metrics (pool = the 60 most-owned players with a fixture, each GW)

| Ranker | Captain pick avg pts | Season total (37 GWs) | Top-11 avg pts |
|---|---|---|---|
| GBM | 6.54 | 242 | 4.73 |
| GBM without ownership/transfers | 6.78 | 251 | 4.77 |
| Points per appearance | 5.73 | 212 | 4.20 |
| Price | 5.30 | 196 | 4.01 |
| Minutes per appearance | 4.84 | 179 | 3.95 |
| Last-5 points | 3.84 | 142 | 4.30 |
| Hindsight best | 15.32 | — | — |

Roughly +0.8 points per gameweek from the captain alone over the best naive rule, ~+30 team points
over a season. That is the size of prize to expect.

### 4h. Reproduce
Scripts are saved beside this file in `app-factory/experiments/2026-09-24-gbm/`:
`reference_gbm.py` (§4b/§4c, ~3 min), `ablations.py` (§1b, §4d, §4e, §4g, ~6 min),
`fpl_ep_benchmark.py` (§4f), `README.md` (one paste-ready command and the expected output). All
downloads are pinned by commit SHA; a clean re-run on 24 Sept reproduced every figure above exactly.
`reference_gbm.py` is reproduced in full in Appendix A — R1-T1 should port it.

---
## 5. Research — how people who build good FPL models do it

### 5a. Two standard families

**Component ("indirect") models** — FPL Review, AIrsenal, most hobby models. Predict expected minutes
(xMins), team goal expectation for the fixture, the player's share of team chances, then turn event
probabilities into points and simulate bonus.
- FPL Review's Massive Data model: inputs are "historical performance data, market odds, tactical
  analysis"; hourly updates of "market data, news feeds, xMins"; accounts for "team strength & style,
  player roles, tactical changes, and temporary factors like penalty takers/rotation"; projects up to
  14 GWs. (docs.fplreview.com, massive-data-model)
- AIrsenal (Alan Turing Institute): "a team-level model to predict match scorelines, and a player
  level model to predict player goal involvements, as well as several heuristics based on historical
  averages".
- cnetterf/fpl-predictor (open source, 2025): xMins = `P(start) × minutes when starting +
  P(sub) × minutes as sub` from the last six team fixtures; xG/xA = 75% long-term + 25% recent six;
  clean sheets from opponent expected goals; defcon from empirical threshold frequency; bonus
  75% season / 25% recent from GW7.
- Marcus Leadboot (Medium): minutes from the last 5 non-zero games' mean and SD → P(1+), P(60+);
  xG/xA per 90 from FBref, adjusted ~1% per 10 points of strength difference.

**Direct ML models** — predict points from lagged features with gradient-boosted trees.
- **OpenFPL** (arXiv 2508.09992, Aug 2025, MIT licence, `github.com/daniegr/OpenFPL`): trained on
  **four seasons (2020-21 to 2023-24)** of FPL API + Understat data; position-specific ensembles of
  Random Forest and XGBoost ("median forecasted FPL points of the 50 individual models"); features
  aggregated over **1, 3, 5, 10 and 38-match horizons** — FPL points, minutes, ICT, goals, assists,
  saves, BPS, bonus, Understat shots/xG/xGChain/xGBuildup/key passes/xA, plus team and opponent
  xG/xGA/PPDA and availability (0–100%). 196–206 features. Evaluated on GW32–38 of 2024-25 against
  FPL Review: better on 3–4 and 5+ point returns ("Tickers" RMSE 1.517 vs 1.594; "Haulers" 5.142 vs
  5.172 at 1 GW), worse on zeros/blanks, which the authors attribute to missing expected-minutes
  information: the FPL API "does not indicate whether a player is expected to start a match, come on
  as a substitute, or be rested".
- **FPL Pulse** (2025-26 blog): gradient boosting on **five seasons**; features = rolling points,
  minutes, xG, xA, ICT, BPS; home/away; team goal differentials; **bookmaker win/draw/loss and
  over-2.5 probabilities**; injury flags and chance of playing; ownership and transfer momentum; FPL's
  own xP as a feature. Test GW20–38 2025-26, 15,572 player-fixtures: MAE 0.81 all players (FPL xP 1.05);
  starters MAE 1.95 (FPL xP 2.75); top captain pick 7.79 vs 4.95 pts/GW.
- Ramezani & Dinh (arXiv 2505.02170, v3 Jan 2026): single-season (2023-24) time-series methods; ARIMA
  with a rolling window "most consistent"; a one-season setup, weaker evidence.

What this project built is a component model — but with one season of inputs, a win-probability
scalar instead of team goal expectations, and a minutes model without starts. The fastest route to the
standard is the direct ML family, which is also what the product brief intended ("OpenFPL, retrained
on post-defcon data, is the intended destination", §6d).

### 5b. Which signals matter most in practice
1. **Minutes / availability first.** OpenFPL's main loss to FPL Review is on zeros and blanks — i.e.
   xMins. In my GBM, last-match minutes is by far the top feature by gain (≈3× the next); on the
   active population, ownership and transfer momentum (crowd signals of team news) add +0.02–0.03.
2. **Long-window quality beats recent form.** FPL Review's goalscoring study (2,021 samples, GW9–26
   2019/20): R² for goals — Massive Data 0.129, spread markets 0.114, bookmakers 0.112, recent 5-game
   xG 0.098, a basic position model 0.096, recent 5-game goals −0.01: "the amount of goals a player has
   scored in his last 450 minutes is rendered almost worthless". OpenFPL and FPL Pulse both use windows
   out to 38 matches. Our 5-match windows and one-season shrinkage throw this away.
3. **Market odds are the best public fixture signal.** Štrumbelj & Šikonja (2010), 10,699 matches, six
   European leagues: "both lay and expert predictions are outperformed by statistical models, which
   are in turn usually worse than bookmaker odds". Standard use in FPL: convert 1X2 (and over/under
   2.5 if available) to Poisson team goal expectations λ_for, λ_against (penaltyblog
   `goal_expectancy` / `goal_expectancy_extended`; opisthokonta.net method), then clean-sheet
   probability ≈ exp(−λ_against) and attacking returns scale with λ_for. Player anytime-scorer odds are
   strong for goals but only US bookmakers carry EPL player props on The Odds API, one event per call,
   and historical odds are paid-only — not worth it here.
4. **Price and ownership are cheap, honest priors** (FPL Pulse uses both; they encode the market's
   and FPL's own view of quality and minutes).
5. **Penalties/set pieces** — FPL Review names penalty-taker changes as a key input. This repo's
   diagnostics (#215, #219, #225) found no gain inside baseline-v1; in a learned model it is one cheap
   feature from Core's `penalties_order` snapshot (2025-26 onward).

### 5c. What accuracy to expect
- **The ceiling is low and known.** FPL Review "Ultimate Truth": a *perfect* model (true EV from
  1,000 simulations per player-GW) scored against real outcomes on 3,730 player-samples (GW1–21):
  RMSE ~2.7–2.9, MAE ~1.9–2.0, **R² ~0.12–0.17**. Best real models: FPL Review MD RMSE 2.803, MAE 1.973,
  R² 0.151; "Model B" 2.816/2.020/0.143. "The best current models are performing at levels within the
  realm of what we might see from a perfect model."
- R² 0.15 is a Pearson r of ~0.39. That is why 1-GW Spearman on featured players sits near 0.35 for
  everything sensible (baseline-v1 0.354 [repo], GBM 0.346 [exp], hindsight blend 0.375 [repo]).
  **Single-GW accuracy cannot show large wins. Horizon totals and decision metrics can.**
- Realistic targets for this app: 5-GW active-population Spearman ~0.57–0.60 (vs ~0.45 naive);
  captain pick ~+0.8 pt/GW over the best naive rule; well-calibrated means (bias < 0.05 pts/player-GW).

### 5d. Where our approach differed from what works

| What works | What we did |
|---|---|
| 4–5 seasons of history, windows out to 38 matches | One season of point-in-time substrate; 5-match windows; shrinkage toward last season for xG/xA only |
| Learned model with ~100–200 lagged features | Hand-built combiner with hand-fitted constants; a hand-written TS GBM with 15 features on one season |
| xMins with starts, rotation and crowd/team-news signals | 5-match minutes mean × FPL availability; `pAppears = availability` |
| Odds → team goal expectations (λ) | Odds → one win-probability scalar → linear multipliers with slopes fitted on a noisier predictor |
| Evaluate on RMSE/MAE and on decisions, over everyone who might play | 1-GW Spearman on players who featured; non-featuring rows excluded |
| Build and evaluate offline in a notebook, ship the result | Each hypothesis a night's ticket; measurement by hand-run Action after merge |

---

## 6. Recommended model approach

**Decision: replace `baseline-v1` as the decision model with `gbm-v1`. Do not tune baseline-v1
further.** Keep it running unchanged (it already writes `player_projections` every night) as the
fallback and as the component breakdown on the reasoning screen.

**Why replace, not tune:** (1) every remaining lever in baseline-v1 was measured at ≤0.01 (backlog
close-out #220/#222); (2) the gap to the oracle at 5 GW is player quality and minutes, which a learned
model with history closes (§4d); (3) the standard in the field is a learned model or a component model
with learned xMins — both need multi-season data, which we can now use for free; (4) it moves model
work to public CSVs the Builder can download, which fixes the gate problem (O1) structurally.

### 6a. Architecture (Python behind the existing CSV seam)
```
public CSVs (vaastav pinned SHA, FPL-Core-Insights current season, model/data/odds/*.csv)
        │
        ▼
model/fpl_model/  (Python 3.11+, LightGBM)
  sources.py   download + cache (./.cache/, gitignored), pinned URLs
  features.py  point-in-time features — ONE function used by training AND live
  train.py     fit points model + minutes model
  evaluate.py  walk-forward on 2025-26 → model/reports/eval-latest.md (the gate)
  live.py      decision-time features + FPL API live state + fixture_odds → player_projections
model/fpl_odds/ (separate package, no import from fpl_model)
  implied.py   1X2 (+optional O/U 2.5) → overround removed → Poisson λ_home, λ_away
  history.py   football-data.co.uk CSVs → per-fixture odds frame keyed on FPL team codes
        │
        ▼ writes player_projections (model_version 'gbm-v1')  ← same table, same PK
scripts/emit-projections-csv.ts  reads the ACTIVE model version from config/projection-model.json,
                                 falls back per player to 'baseline-v1'
        ▼
solver (unchanged) → recommendations → app / Telegram (unchanged)
```
Why Python: LightGBM, pandas and scipy are standard; the solver workflow already runs Python (`uv`
in `solver-run.yml`); the seam is a CSV, so nothing in `src/` needs to know. Do **not** port trees to
TypeScript and do not revive `scripts/train-and-evaluate-learned-model.ts`.

### 6b. Model spec for `gbm-v1`
- **Rows:** one per (player `code`, season, gameweek) — vaastav per-fixture rows aggregated per GW for
  2022-23…2025-26; FPL-Core-Insights `data/2026-2027/By Gameweek/GW{n}/player_gameweek_stats.csv` for
  the current season (map `event_points→total_points`; `now_cost` decimal millions → ×10 to match
  vaastav `value` tenths; per-GW rows exist for every listed player including 0 minutes). Stable key is
  FPL `code` (vaastav `players_raw.csv` `id→code`; Core `players.csv` `player_id→player_code`).
- **Features:** as §4a. Ownership and transfers must be made source-independent: use the **percentile
  rank within the gameweek** of ownership and of net transfers (vaastav `selected`,
  `transfers_balance`; Core/FPL API `selected_by_percent`, `transfers_in_event − transfers_out_event`).
  Price in tenths. Position one-hot/int. Team/opponent features keyed on FPL team `code`.
- **Targets:** `total_points` (points model) and `minutes` (minutes model, for the solver's `xMins`).
- **Training:** all rows strictly before the decision gameweek. Seeds fixed. Params as §4a.
- **Horizon:** for decision gameweek g and each h = 0..4, predict with player features frozen at g and
  the fixture features of gameweek g+h (home flag, opponent, odds when available). Blank GW → 0.
  Double GW → sum of two single-fixture predictions (`nfix = 1` each).
- **Availability (v1):** multiply every horizon GW's points and minutes by the existing rule
  (`src/lib/projection/minutes.ts` `availabilityFactor`: chance/100 if set; `a`→1; `i`/`s`/`u`→0;
  else 0.5). Re-implement the same 6 lines in Python and pin with a test using the TS test cases.
  (Run 3 replaces this with learned availability features.)
- **Output row** in `player_projections`: `gameweek_id`, `player_id` (= FPL element id),
  `model_version='gbm-v1'`, `player_code`, `expected_points`, `expected_minutes`, `components` jsonb:
  ```json
  {"model":"gbm-v1","trained_through":"2026-27 GW5","availability":1.0,
   "raw_points":4.12,"raw_minutes":78.0,"has_odds":true,"lambda_for":1.62,"lambda_against":0.94,
   "drivers":[{"feature":"r5_minutes","value":88.2,"contribution":0.41}, ... top 5 by |SHAP| ...]}
  ```
  (`drivers` from LightGBM `predict(..., pred_contrib=True)`.) This shape is a contract between run 2's
  tickets — freeze it in run 1's `model/README.md`.

### 6c. Odds features (run 2)
- Historical: football-data.co.uk `E0.csv` per season (owner commits them — §9). Use pre-match average
  1X2 `AvgH/AvgD/AvgA` (fallback `B365H/B365D/B365A`); if `Avg>2.5`/`Avg<2.5` exist use
  `goal_expectancy_extended`-style fit, else 1X2 only. Verify exact column names against the committed
  files before coding. Map team names with an explicit committed dict (no fuzzy matching — same rule
  as `scripts/lib/oddsClubNames.ts`), join to FPL fixtures on (date ±1 day, home code, away code).
- Live: latest `fixture_odds` row per fixture (`p_home, p_draw, p_away` already overround-free, 48 h
  freshness, ≥3 books — same rule as `marketOdds.ts`). h2h only is enough: two unknowns (λ_home,
  λ_away), two independent equations. Do **not** add a totals ingest or migration.
- Features per target fixture: `lambda_for`, `lambda_against`, `p_win`, `p_cs = exp(-lambda_against)`;
  NaN when no odds (LightGBM handles missing — no fallback chain needed).

### 6d. Why not the alternatives
- *Keep tuning baseline-v1:* measured ceiling (§2, backlog close-out).
- *OpenFPL as-is:* needs Understat (scraped; rejected in the brief §6b) and pre-defcon weights; the
  retrain is what §6b above already is, with vaastav's xG/xA instead of Understat's.
- *Component model with learned xMins:* more pieces, more tickets, same data need. Could come later as
  `gbm-v2` if explainability demands it.

---

## 7. Metrics and gates (pre-registered, computed OFFLINE by the Builder)

All gates run inside the Builder's sandbox from public CSVs, before the PR is marked done.
`model/fpl_model/evaluate.py` writes `model/reports/eval-latest.md` and exits non-zero if a gate fails.

**Primary — 5-GW active Spearman.** 2025-26 walk-forward (retrain at GW 1, 8, 15, 22, 29, 36),
active population (≥1 appearance in the player's previous 5 GW rows), target = sum of actual points
over GW g..g+4 with zeros, g ≤ 34, pooled Spearman.
- Reference [exp]: GBM 0.590–0.595; ppm baseline 0.452; minutes baseline 0.442.
- **Gate: ≥ 0.55 and ≥ ppm baseline + 0.08, and every position ≥ its ppm baseline + 0.05.**

**Secondary — continuity with the repo's numbers.** Featured population, 5-GW: reference 0.431 (5-GW
model) / 0.411 (1-GW model) vs minutes baseline 0.376. **Gate: ≥ minutes baseline + 0.02.** Also print
1-GW featured (reference 0.346) — informational only, never gated.

**Decision check (informational).** Captain avg points from the 60 most-owned pool (reference GBM
6.5–6.8 vs ppm 5.73) and top-11 avg (4.7 vs 4.20). Calibration: |mean(pred − actual)| on active
population < 0.10.

**Liveness (LEARNINGS §21).** The report must print row counts per population and per retrain, and
fail if any retrain fold has zero test rows or if predictions are constant.

**Leakage tests (pytest).** (1) Changing any value in gameweek g's actuals leaves features for rows at
g unchanged. (2) A synthetic player whose points jump only at g+1 gets no feature change at g.
(3) Training rows for a fold never include the test season at or after the cutoff.

Any later model change (odds, availability) is kept only if the primary metric does not drop by more
than 0.005 and its stated target slice improves. Otherwise leave the feature switched off
(`USE_ODDS=False` etc.) and record the numbers — no revert ticket needed.

---
## 8. Run-by-run plan

Rules applied to every ticket below:
- **"## Definition of done — offline only"** holds only what the Builder can do with no credentials:
  install, tests, build, lint, and the offline evaluation report. Everything live goes under
  **"## Post-merge owner check (does not block this PR)"** (handoff §4b).
- Files sections are exact and disjoint within a run. **Only one ticket per run may edit
  `feature-list.md`** (named below); no ticket appends to `docs/projection-model-backlog.md` — model
  notes go in `model/README.md`.
- Python lives under `model/`. Nothing under `src/lib/projection/` changes in this plan.
- The Builder must never edit `model/fpl_model/features.py` in the same run as another ticket that
  imports it — the functions' **signatures are frozen in run 1** (below) so later tickets only import.
- Gates are the §7 numbers. A ticket that misses its gate stops and reports; it does not tune.

### Contracts frozen in run 1 (write them into `model/README.md`)
```python
# model/fpl_model/features.py
def build_training_frame(history: pd.DataFrame,
                         odds: pd.DataFrame | None = None,
                         snapshots: pd.DataFrame | None = None) -> pd.DataFrame: ...
def build_decision_frame(history: pd.DataFrame,
                         decision: tuple[str, int],          # (season "2026-27", next gameweek)
                         target_fixtures: pd.DataFrame,      # one row per player-code × target GW × fixture
                         odds: pd.DataFrame | None = None,
                         snapshot: pd.DataFrame | None = None) -> pd.DataFrame: ...
FEATURES: list[str]      # the ordered model input columns

# model/fpl_model/train.py
def fit(frame: pd.DataFrame, target: str, seed: int = 0) -> "lightgbm.Booster": ...   # target: 'total_points' | 'minutes'
def predict(model, frame: pd.DataFrame) -> np.ndarray: ...
def contributions(model, frame: pd.DataFrame, top: int = 5) -> list[list[dict]]: ...  # for components.drivers

# model/fpl_model/availability.py
def availability_factor(status: str, chance_next: float | None) -> float: ...           # parity with minutes.ts
def apply_availability(values: np.ndarray, snapshot_rows: pd.DataFrame) -> np.ndarray: ...
#   live.py must call apply_availability (never availability_factor directly), so R3-T1 can change
#   the rule inside it without touching live.py

# model/fpl_model/sources.py
def load_history(through: tuple[str, int]) -> pd.DataFrame: ...   # vaastav (pinned) + Core current season,
                                                                  # completed GWs strictly before `through`
# history columns: code, season, gw, team_code, position, minutes, total_points, goals_scored, assists,
#   expected_goals, expected_assists, expected_goals_conceded, bps, bonus, ict_index, threat, creativity,
#   influence, saves, clean_sheets, goals_conceded, starts, defensive_contribution, value (tenths),
#   own_pct_rank, transfers_rank, nfix, was_home, opp_team_code, gf, ga
# odds columns (fpl_odds output): season, gw, kickoff_date, home_code, away_code,
#   p_home, p_draw, p_away, lambda_home, lambda_away, source
# snapshot columns: code, status, chance_of_playing_next_round, now_cost (tenths),
#   selected_by_percent, transfers_in_event, transfers_out_event, penalties_order
```
Run 1 accepts and ignores `odds`; uses from `snapshot` only price and ownership/transfer ranks.
Parity test (run 1): for 2025-26 GW 20, `build_decision_frame` rows equal `build_training_frame`
rows at GW 20 for the same players, column for column.

---

### Run 1 — build the learned model offline, and the switch

**R1-T1 · `gbm-v1`: learned projection model, trained on four seasons, with an offline gate**
- *Files (all new unless noted):* `model/requirements.txt` (lightgbm>=4.3, pandas>=2.2, numpy,
  scipy, pyarrow, requests, pytest), `model/README.md`, `model/fpl_model/__init__.py`,
  `model/fpl_model/sources.py`, `model/fpl_model/features.py`, `model/fpl_model/train.py`,
  `model/fpl_model/evaluate.py`, `model/fpl_model/availability.py`,
  `model/tests/test_features_leakage.py`, `model/tests/test_parity.py`,
  `model/tests/test_availability.py`, `model/tests/test_evaluate_smoke.py`,
  `model/reports/eval-latest.md` (generated, committed), `.gitignore` (add `model/.cache/`,
  `.venv/`, `__pycache__/`), `feature-list.md` (items 30/31 → in progress).
- *Build:* port Appendix A. Sources pinned: vaastav
  `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88/data/{2022-23|2023-24|2024-25|2025-26}/gws/merged_gw.csv`
  and `.../players_raw.csv`, `.../teams.csv`; FPL-Core-Insights current season from
  `https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/By%20Gameweek/GW{n}/player_gameweek_stats.csv`
  and `.../data/2026-2027/players.csv` (tests pin Core to commit `392f79ad85fcbe5c47b8f1e33d6c3dc787dcfd53`).
  Ownership/transfers as within-GW percentile ranks (§6b). Points model + minutes model.
  `availability.py` = Python copy of `availabilityFactor` with the TS test cases.
  `python -m fpl_model.evaluate` runs the §7 walk-forward and writes the report.
- *DoD offline:* `python -m pytest model/tests` passes; `python -m fpl_model.evaluate` exits 0 and the
  committed report shows the §7 primary gate (≥0.55 and ≥ ppm + 0.08, each position ≥ ppm + 0.05) and
  secondary gate (featured 5-GW ≥ minutes baseline + 0.02) passing, with row counts. If LightGBM
  cannot be installed, use `sklearn.ensemble.HistGradientBoostingRegressor` with the same features and
  say so; if vaastav or Core cannot be fetched, stop and report.
- *Post-merge owner check:* none. Nothing live changes.

**R1-T2 · Odds → goal expectations, and historical odds for training**
- *Precondition:* owner step §9.1 done (odds CSVs committed under `model/data/odds/`).
- *Files (all new):* `model/fpl_odds/__init__.py`, `model/fpl_odds/implied.py`,
  `model/fpl_odds/history.py`, `model/fpl_odds/team_names.py`, `model/tests/test_fpl_odds_implied.py`,
  `model/tests/test_fpl_odds_history.py`. Must not import `fpl_model`, must not edit
  `model/requirements.txt`.
- *Build:* `implied.py`: `remove_overround(odds) -> probs` (proportional, matching
  `src/lib/projection/marketOdds.ts` `removeOverround`); `goal_expectancy(p_home, p_draw, p_away,
  p_over25=None) -> (lambda_home, lambda_away)` by least squares on independent-Poisson 1X2 (and
  O/U 2.5 when given), bounds [0.05, 5.0], `scipy.optimize.minimize` L-BFGS-B. `history.py`: read
  `model/data/odds/E0_*.csv`, take `AvgH/AvgD/AvgA` (fallback `B365H/B365D/B365A`) and
  `Avg>2.5/Avg<2.5` if present (verify column names in the committed files first), map names via an
  explicit dict in `team_names.py` to FPL team `code` using vaastav `data/{season}/teams.csv`, output
  the odds columns in the contract above.
- *DoD offline:* tests: symmetric input gives equal λ; (0.45, 0.28, 0.29 normalised) gives λ_home in
  [1.25, 1.45] and λ_away in [0.90, 1.10] (penaltyblog reference 1.342/1.019); λ round-trips (compute
  1X2 from λ, solve back, |Δ| < 0.01); every row of each complete season's CSV maps to two FPL codes
  (380 rows per season) or the test lists the unmapped names; `exp(-lambda)` mean over a season is
  within 0.05 of the actual clean-sheet rate computed from the CSV's `FTHG/FTAG`.
- *Post-merge owner check:* none.

**R1-T3 · One switch for which projection model the solver and the app use (no behaviour change)**
- *Files:* `config/projection-model.json` (new: `{"active": "baseline-v1", "fallback": "baseline-v1"}`),
  `scripts/lib/activeModelVersion.ts` + `.test.ts` (new), `scripts/emit-projections-csv.ts` +
  `.test.ts`, `scripts/snapshot-predictions.ts` + `.test.ts`, `scripts/settle-predictions.ts` +
  `.test.ts`, `scripts/send-telegram.ts` + `.test.ts`, `scripts/preflight-check.ts` + `.test.ts`,
  `src/lib/reasoning/api.ts`.
- *Build:* replace each duplicated `MODEL_VERSION = 'baseline-v1'` in those five scripts with the
  shared reader. `emit-projections-csv.ts`: read `active`; for any (player, horizon GW) with no
  `active` row use the `fallback` row; count fallbacks in `job_runs.details` and print the count.
  `snapshot-predictions.ts`: snapshot both `active` and `baseline-v1` (dedupe when equal) — the
  `prediction_log` PK already includes `model_version`. `settle-predictions.ts`: settle every
  version with unsettled rows. `send-telegram.ts`: read `active`. `preflight-check.ts`: fail if
  neither active nor fallback has rows for the next GW; warn if active is missing.
  `src/lib/reasoning/api.ts`: filter the components map to `model_version = 'baseline-v1'` explicitly
  (today it keeps whichever row arrives last). Leave `bonus-validation-report.ts`,
  `penalty-duty-diagnostic.ts`, `calibration-report.ts` on `baseline-v1`.
- *DoD offline:* build, lint, tests pass; a test proves the emitted CSV is byte-identical to today's
  for a fixture set when the config is unchanged; a test proves per-player fallback when `active` has
  a gap.
- *Post-merge owner check:* none needed; next nightly runs identically.

---

### Run 2 — odds into the model, and the model into production

**R2-T1 · Market-odds features in `gbm-v1`**
- *Files:* `model/fpl_model/features.py`, `model/fpl_model/sources.py`, `model/fpl_model/evaluate.py`,
  `model/tests/test_features_odds.py` (new), `model/reports/eval-latest.md`, `model/README.md`.
- *Build:* join `fpl_odds.history` output to target fixtures; add `lambda_for`, `lambda_against`,
  `p_win`, `p_cs`; NaN when missing; flag `USE_ODDS` (default decided by the gate).
  `evaluate.py` prints with/without odds, plus an early-season slice (GW 2–10) and a GK+DEF slice.
- *Gate:* keep `USE_ODDS=True` only if the primary metric does not fall by >0.005 **and** either the
  GW 2–10 slice or the GK+DEF slice improves by ≥0.01. Otherwise ship with `USE_ODDS=False` and the
  numbers recorded.
- *DoD offline:* tests; report committed; signatures unchanged (the parity test still passes).

**R2-T2 · Run `gbm-v1` every night and write `player_projections`**
- *Files (new unless noted):* `model/fpl_model/live.py`, `model/fpl_model/supabase_io.py`,
  `model/fpl_model/fpl_api.py`, `model/tests/test_live.py`,
  `model/tests/fixtures/bootstrap-static-sample.json`, `model/tests/fixtures/fixtures-sample.json`,
  `model/tests/fixtures/fixture-odds-sample.json`, `.github/workflows/scheduled-jobs.yml`.
  Must only import from `fpl_model.sources` / `features` / `train` / `availability` and `fpl_odds`
  through the frozen signatures; must not edit those files (R2-T1 edits `features.py`/`sources.py`
  the same night).
- *Build:* `python -m fpl_model.live`:
  1. Live state from `https://fantasy.premierleague.com/api/bootstrap-static/` and `/api/fixtures/`
     (next GW = `events[].is_next`; snapshot columns from `elements[]`).
  2. History = vaastav (pinned) + Core current season, completed GWs only.
  3. Odds: latest `fixture_odds` row per fixture from Supabase (48 h freshness, ≥3 books), converted
     with `fpl_odds.implied`; plus historical odds (committed CSVs; download the current season's
     `E0.csv` fresh when reachable, else the committed copy).
  4. Train points + minutes models on everything before the next GW; predict h = 0..4 per §6b;
     multiply by availability; sum DGW fixtures; blank GW = 0.
  5. Upsert `player_projections` (`model_version='gbm-v1'`, `components` per §6b) via PostgREST
     (`requests`, `Prefer: resolution=merge-duplicates`), paginated reads with explicit ordering; skip
     and count players not yet in `public.players` (FK); one `job_runs` row
     (`job_name='project-points-gbm'`) with counts.
  6. Print a summary: rows written, players with odds (%), flagged players, top 10 by next-GW points
     with price and team (LEARNINGS §21: the job must report what it did).
  Workflow: new step "Project points (gbm-v1)" after "Project points" and before "Emit projections
  CSV": `actions/setup-python@v5` (3.12), `pip install -r model/requirements.txt`, `python -m
  fpl_model.live` with `SUPABASE_URL`/`SUPABASE_SECRET_KEY` secrets, `working-directory: model`,
  `continue-on-error: true` (the baseline path must still run); `actions/cache` for `model/.cache`
  keyed on the vaastav SHA.
- *DoD offline:* tests against the sample JSON produce rows for every horizon GW with no NaN, zero for
  a blank-GW team, a DGW player's value equal to the sum of two single-fixture predictions, and an
  `i`-status player at 0; YAML lints.
- *Post-merge owner check (does not block):* §9.3 — dispatch once, read the summary, flip the switch.

**R2-T3 · Reasoning screen: say which model decided, and why, in words**
- *Files:* `src/lib/reasoning/api.ts`, `src/lib/reasoning/types.ts`, `src/lib/reasoning/derive.ts`,
  `src/lib/reasoning/derive.test.ts`, `src/screens/ReasoningScreen.tsx`,
  `src/screens/ReasoningScreen.css`, `feature-list.md`.
- *Build:* for each recommended player, read the `gbm-v1` row when present: show the model name and
  the top 3 `drivers` translated to plain words via a fixed map (e.g. `r5_minutes` → "minutes over the
  last five", `lambda_for` → "expected team goals this fixture", `own_pct_rank` → "popular with
  managers"); keep the `baseline-v1` component table below it, labelled "Breakdown (explainable
  model)". Numbers only on this screen (brief §8). No change to the home screen.
- *DoD offline:* build, lint, tests with fixture rows for both versions and for a player with only
  `baseline-v1`.

---

### Run 3 — learned availability, and two product features

**R3-T1 · Learned availability, ownership and penalty-order features (gated)**
- *Files:* `model/fpl_model/features.py`, `model/fpl_model/sources.py`,
  `model/fpl_model/availability.py`, `model/fpl_model/evaluate.py`, `model/tests/test_features_snapshot.py`
  (new), `model/reports/eval-latest.md`, `model/README.md`.
- *Build:* from Core `data/2025-2026/By Gameweek/GW{g-1}/player_gameweek_stats.csv` (and 2026-27)
  take `status`, `chance_of_playing_next_round`, `penalties_order` as of the end of GW g−1 (the
  snapshot is end-of-gameweek, §4f — never use the GW-g file for GW g). NaN for seasons without them.
  Live uses the bootstrap snapshot (already passed to `build_decision_frame` by `live.py`). When
  enabled, change `apply_availability` so the rule is only a floor (`i`/`s`/`u` → 0); `live.py` is
  not edited.
- *Gate:* primary metric +≥0.005, or on active rows where actual minutes = 0 the mean prediction
  falls by ≥10% with the primary metric not worse than −0.005. Else leave it off.

**R3-T2 · Tell me when the recommendation changes mid-week (brief §9 question 3)**
- *Files:* `scripts/notification-schedule.ts` + `.test.ts`, `scripts/send-telegram.ts` + `.test.ts`,
  `supabase/migrations/<timestamp>_notifications_changed_trigger.sql` (new), `supabase/README.md`.
- *Build:* after the nightly solve, if Plan A's transfer or captain differs from the last sent
  `plan_snapshot` for the same GW and the deadline is more than 10 h away, send one "Changed:" message,
  at most once per GW. Reuse the existing duplicate-prevention constraint with a new trigger value.
- *Post-merge owner check:* apply the migration (§9.4).

**R3-T3 · Either "Run now" or mini-league standings — Keshav picks one before run 3**
- *Option A — "Run now" (feature item 22):* `supabase/functions/run-now/index.ts` (new Edge Function
  that calls GitHub `POST /repos/KeshavPeri/fpl-advisor/actions/workflows/solver-run.yml/dispatches`
  with a token held only as a Supabase secret, and refuses if the last run is under 30 min old),
  `src/components/RunNowButton.tsx` + `.css` (new), `src/screens/HomeScreen.tsx`. Owner steps are
  Tier 1: create the token, set the secret, deploy the function (§9.5). No credential in the browser.
- *Option B — mini-league standings (item 33, display only):* ingest `leagues-classic/{id}/standings/`
  (script + migration) and a small section on the home screen. Never enters the optimiser (brief §1).
- Only R3-T2 edits `supabase/README.md` in this run; if Option B ships a migration, the owner adds
  its row after merge. Only R3-T3 edits `src/screens/HomeScreen.tsx`.
- If neither is wanted, drop R3-T3.

---

### Run 4 — UI polish round four (needs fresh screenshots first)
Two or three polish tickets split by screen (`HomeScreen`, `ReasoningScreen`, `ChipsScreen` and their
`.css`), only one of them allowed to touch `src/index.css`. Impeccable only inside these tickets
(CLAUDE.md). The old notes in `docs/my-ui-problems.md` are stale since #194/#202 — write from new
screenshots.

### Run 5 — optional: season replay to set the hit threshold (item 32, brief §9 question 2)
Offline and Builder-runnable now: vaastav has each player's price (`value`) every GW, and
`evaluate.py` produces walk-forward `gbm-v1` predictions for 2025-26. Replay the season with the
pinned solver (free transfers roll to 5; −4 per extra), compare against a naive-projection replay, and
report net points for hit thresholds 0 / 2 / 4 / 6. Only worth it if Keshav wants evidence for hits;
otherwise keep the solver defaults. Replaces draft 125.

### Slack: runs 6–7
Held for one failed gate or a live issue after the switch. Budget: **4 required runs (1–4), 1 optional
(5), 2 slack = 7 total.**

---

## 9. Owner steps — exact commands

Run these in the Mac's own Terminal (not inside a Claude session — the Claude sandboxes block
football-data.co.uk and Supabase).

**9.1 Before run 1 — commit the historical odds (2 min)**
```
cd ~/Projects/fpl-advisor && git checkout main && git pull && mkdir -p model/data/odds && for s in 2223 2324 2425 2526 2627; do curl -sSf -o model/data/odds/E0_$s.csv https://www.football-data.co.uk/mmz4281/$s/E0.csv; done && wc -l model/data/odds/*.csv
```
Expect about 381 lines for each complete season and fewer for 2627. Then:
```
cd ~/Projects/fpl-advisor && git add model/data/odds && git commit -m "Add football-data.co.uk Premier League odds, 2022-23 to 2026-27" && git push
```

**9.2 After run 1** — merge the three PRs. Nothing to run.

**9.3 After run 2 — first live run and the switch**
```
gh workflow run scheduled-jobs.yml -R KeshavPeri/fpl-advisor
```
Wait ~10 minutes, then open the run's "Project points (gbm-v1)" step log and check the top 10 look like
real picks (nailed premium attackers, nobody injured). Then flip the solver to the new model:
```
cd ~/Projects/fpl-advisor && git checkout main && git pull && sed -i '' 's/"active": "baseline-v1"/"active": "gbm-v1"/' config/projection-model.json && git commit -am "Use gbm-v1 projections for recommendations" && git push
```
To undo, run the same command with the two names swapped.

**9.4 After run 3 (R3-T2)** — apply the new migration the same way as previous ones (paste the file's
SQL into the Supabase SQL editor), then:
```
cd ~/Projects/fpl-advisor && npx tsx --env-file=.env scripts/preflight-check.ts
```

**9.5 Only if "Run now" is chosen** — create a fine-grained GitHub token (repository
`KeshavPeri/fpl-advisor`, permission Actions: read and write), then:
```
cd ~/Projects/fpl-advisor && supabase secrets set GITHUB_DISPATCH_TOKEN=paste-token-here && supabase functions deploy run-now
```

**9.6 Any time — the never-dispatched wildcard/free-hit probe (feature item 28)**
```
gh workflow run squad-rebuild-probe.yml -R KeshavPeri/fpl-advisor
```
Read its log once. If it builds a legal 15 from scratch, item 28 is done with no ticket.

---

## 10. What to stop doing

1. **Stop tuning `baseline-v1`.** Freeze it; it is the fallback and the explainer.
2. **Stop using 1-GW Spearman on featured players as the scoreboard.** It is saturated (~0.35 for
   every sensible model) and hides who doesn't play. Use §7.
3. **Stop quoting "captain vs best other starter".** Its normal value is about −5 per GW (§1b).
4. **Stop writing gates the Builder can't compute before merge.** Model gates come from public CSVs
   inside the PR. Live checks are owner checks and never gates.
5. **Stop rebuilding history in Supabase.** No more `feature_history`/`training_features`-style
   substrate tickets; history comes from vaastav + Core.
6. **Stop one-constant-per-ticket calibration** (conversion factors, shrinkage K, slopes, bonus
   exponents).
7. **Stop instrument-only tickets** — new report sections, preflight checks, coverage reports — unless
   the next run's model change needs them. Drafts 126 and 127 are dropped (§11c).
8. **Stop running experiments as tickets.** Test ideas interactively on public CSVs first (as §4 did in
   about an hour); ticket only what has already been shown to work.
9. **Stop maintaining `backtest.yml`, `calibration-report.yml`, `team-strength-diagnostic.ts` and
   `train-and-evaluate-learned-model.ts`.** Leave the files; don't extend them.
10. **Stop the prose.** New code: short headers, comments only where the why isn't obvious. New
    decisions go in `decisions/ticket-NN.md` in a few lines.

---

## 11. Remaining feature work

### 11a. Status against `feature-list.md` v3.0 (29 Aug) and later merges
| Item | Status | What's left | Runs |
|---|---|---|---|
| 1–21, 23–27 | done | — | 0 |
| 22 Daily run + "Run now" | daily run done; button blocked on a mechanism | Option A in R3-T3, or drop | 0–1 ticket |
| 28 Wildcard/free-hit full-squad solve | built, never dispatched | owner dispatch §9.6 | 0 |
| 29 Point-in-time pipeline | done (for baseline-v1) | superseded by `model/` | 0 |
| 30 Learned-model retrain | parked on wrong conclusion | runs 1–3 | 3 |
| 31 Swap projection behind the seam | not started | R1-T3 + §9.3 | (in runs 1–2) |
| 32 Season simulation, recommendation level | projection slice only | optional run 5 | 0–1 |
| 33 Mini-league comparison | not started | Option B in R3-T3 (display only), or drop | 0–1 ticket |
| Brief §9 Q2: hit threshold | open | optional run 5, else solver default | 0–1 |
| Brief §9 Q3: notify on change | open | R3-T2 | 1 ticket |
| UI polish round four | parked | run 4, needs screenshots | 1 |

### 11b. Total
Required: runs 1–4. Optional: run 5. Slack: 2. **7 runs to done**, within the 7–15 window, with
`gbm-v1` making recommendations after run 2.

### 11c. The three unposted drafts
- `tickets/drafts/125-season-replay.md` — **replace** with run 5 if wanted. As written it replays
  `baseline-v1`, reads Supabase (Builder can't run it), and states the wrong transfer rule ("rolling to
  a maximum of two" — 2026/27 allows five).
- `tickets/drafts/126-scorecard-stale-claims.md` — **drop.** A stale sentence and the misleading −21
  figure; fix the sentence in passing if the file is touched, and don't surface −21 anywhere.
- `tickets/drafts/127-odds-horizon-coverage.md` — **drop.** `gbm-v1` treats missing odds as missing;
  R2-T2's summary prints odds coverage.

---

## 12. Risks and fallbacks

- **Builder sandbox can't install LightGBM** → `HistGradientBoostingRegressor` (scikit-learn); expect
  similar results. If pip is blocked entirely, R1-T1 stops; then run evaluation as an owner step on the
  Mac and have the Builder write code + tests only.
- **vaastav lags the current season** (2026-27 had GW1 only on 24 Sept) → current season always from
  FPL-Core-Insights; vaastav only for completed seasons, pinned by SHA.
- **Core schema drift** → tests pin Core to a commit; live reads `main` and fails loudly on missing
  columns (the baseline path still runs because the step is `continue-on-error`).
- **Train/serve skew** → one feature module, parity test (§8 contracts).
- **Compressed projections change solver behaviour** → the GBM regresses to the mean more than
  `baseline-v1`, so Plan A/B gaps shrink and more weeks may read "coin-flip"
  (`src/lib/recommendation/confidence.ts` thresholds 2.0/0.5) and fewer hits get recommended. Watch
  the first two weeks after the switch; don't pre-emptively retune.
- **Availability double count in v1** (transfer signal + rule multiplier) slightly under-projects
  doubtful (75%) players. Acceptable until R3-T1.
- **Odds totals** are thin for EPL on The Odds API ("spreads and totals markets are mainly available
  for US sports") → the plan uses h2h only; no ingest change.
- **A wrong premise in this document** → every model ticket carries its own offline gate with the
  reference numbers above, so a wrong claim fails inside the PR, not after merge.

---

## 13. Sources

- OpenFPL paper — https://arxiv.org/abs/2508.09992 (HTML: https://arxiv.org/html/2508.09992v1); code — https://github.com/daniegr/OpenFPL
- FPL Review, "Ultimate Truth: How FPL Models Perform Relative to a 'Perfect' Model" — https://docs.fplreview.com/articles/ultimate-truth/
- FPL Review, "Massive Data: A Goalscoring Model More Predictive Than Bookmakers Odds" — https://docs.fplreview.com/articles/massive-data/
- FPL Review model docs — https://docs.fplreview.com/the-model/projections/massive-data-model/ · https://docs.fplreview.com/the-model/projections/free-model/
- FPL Pulse, "FPL Predicted Points: How Our Model Works & How Accurate It Is" — https://www.fplpulse.com/blog/fpl-predicted-points-model
- AIrsenal (Alan Turing Institute) — https://github.com/alan-turing-institute/AIrsenal
- cnetterf/fpl-predictor — https://github.com/cnetterf/fpl-predictor
- Marcus Leadboot, "Modelling xPts in FPL (Version 1)" — https://medium.com/@marcusleadboot/modelling-xpts-in-fpl-gameweek-1-01fd2179eac6
- FPL Watchmen, GW1 2025 prediction-site comparison — https://fplwatchmen.substack.com/p/fpl-2025-gw1-analysis-of-prediction
- Ramezani & Dinh, "A data-driven framework for team selection in Fantasy Premier League" — https://arxiv.org/abs/2505.02170
- Štrumbelj & Robnik Šikonja (2010), "Online bookmakers' odds as forecasts: The case of European soccer leagues" — https://www.sciencedirect.com/science/article/abs/pii/S0169207009001733
- Štrumbelj (2014), "On determining probability forecasts from betting odds" — https://www.sciencedirect.com/science/article/abs/pii/S0169207014000533
- Dixon & Coles model (penaltyblog docs) — https://docs.pena.lt/y/models/dixon_coles.html
- penaltyblog, inferring goal expectancies from bookmaker odds — https://penaltyblog.readthedocs.io/en/latest/models/goal_expectancy.html
- opisthokonta, "Expected goals from bookmaker odds" — https://opisthokonta.net/?p=1760
- The Odds API markets — https://the-odds-api.com/sports-odds-data/betting-markets.html · quota and historical access — https://the-odds-api.com/liveapi/guides/v4/
- vaastav/Fantasy-Premier-League (data used in §4) — https://github.com/vaastav/Fantasy-Premier-League
- olbauday/FPL-Core-Insights — https://github.com/olbauday/FPL-Core-Insights
- football-data.co.uk (historical match odds, `mmz4281/{season}/E0.csv`) — https://www.football-data.co.uk/englandm.php

---
## 14. Decisions Keshav needs to make (none block run 1)

1. Approve the plan (replace, don't tune; `gbm-v1` behind the seam).
2. Do §9.1 before run 1 is labelled `status:ready`.
3. Before run 3: R3-T3 = "Run now" (A), mini-league standings (B), or nothing.
4. After run 2 is live for two weeks: run 5 (season replay for the hit threshold) — yes or no.

## 15. Notes for the session that writes the tickets

- Lint every ticket against the real files before handing it over (handoff §1). File names above were
  checked on 24 Sept; `src/lib/reasoning/types.ts`, `derive.ts`, `api.ts`, `scripts/lib/`,
  `.github/workflows/scheduled-jobs.yml` (has `workflow_dispatch`), `prediction_log` PK
  `(gameweek_id, player_id, model_version)`, `player_projections` PK `(gameweek_id, player_id,
  model_version)` and `players` columns (`status`, `chance_of_playing_next_round`, `now_cost` in tenths,
  `selected_by_percent`; no transfer columns — hence the live job reads bootstrap-static itself).
- Put the §7 reference numbers into each model ticket's gate so a wrong premise fails inside the PR.
- Tickets are body-only drafts in `fpl-advisor/tickets/drafts/NN-slug.md`; hand over the
  `gh issue create` command; never apply `status:ready`.
- Record §1 (the two wrong headlines) and §3 O1 (experiments belong in interactive sessions, not
  tickets) as LEARNINGS §22 in `app-factory/LEARNINGS-second-build-wave.md`, together with the §4b
  ticket-format rule the handoff asked for.

---

## 16. Standing rules for the orchestrator — binding from 24 Sept 2026

These exist because the project spent ~50 PRs going in circles (§2, §3). They apply to every future
orchestrator session on this app and on the next one. Copy them into `app-factory/CLAUDE.md` so they
survive beyond this file. If a rule gets in the way, say so to Keshav in one line and ask — do not
quietly work around it.

### A. Before writing any ticket
1. **Research before you design.** For any modelling or data question, first spend up to 30 minutes
   finding how others already solve it (FPL Review docs, OpenFPL, public repos, papers). Name the
   source in the ticket. If nobody does it this way, treat that as a warning, not an opportunity.
2. **Test the idea before you ticket it.** Run it yourself in an interactive session on public CSVs
   (template: `experiments/2026-09-24-gbm/`). Only ticket changes that already showed their gain
   offline, and put that measured gain in the ticket. An untested idea is not a ticket.
3. **Check the premise at its source.** Before a number goes into a ticket or a message, open the report
   it came from and confirm exactly what is compared with what, on which rows. Quote file and line.
   (§1a: "0.354 vs 0.345" was two model versions, not model vs naive.)
4. **Ask the one question.** "Will this change what Keshav sees, or what gets recommended to him, within
   two runs?" If the answer is no, don't write the ticket.
5. **Know a metric's normal value before calling it a defect.** Compute what a decent model scores on it
   (§1b: captain vs best-other-starter is about −5 per GW for any good model).

### B. Ticket shape
6. **Every model ticket carries an offline gate** the Builder computes itself from public data before
   marking the PR done: the metric, the reference number, the threshold, and "if missed: stop and
   report, do not tune". No gate may depend on Supabase, a GitHub Action, or a human.
7. **Liveness before comparison.** Every gate first checks the new code path actually ran (row count
   > 0). Identical before/after numbers are a FAIL.
8. **Definition of done is offline only.** Anything live goes in "Post-merge owner check (does not
   block this PR)".
9. **One scoreboard.** The §7 primary metric (5-GW Spearman, active players, zeros included) and the
   captain/top-11 decision checks. Do not add, swap or redefine metrics without Keshav's explicit
   approval. Never gate on 1-GW Spearman of players who featured.
10. **File-disjoint and contract-disjoint.** Tickets in one batch must not edit the same file or change a
    function another ticket in the batch imports. Freeze shared signatures in an earlier run.
11. **Short tickets, short code.** Ticket bodies under ~80 lines. Code comments only where the reason
    isn't obvious; decision logs under ~15 lines. No essays in source files.

### C. What not to write
12. **No instrument-only tickets.** A report section, preflight check, diagnostic or coverage counter is
    allowed only if it names the model or product ticket in the *next* run that it unblocks.
13. **No data-substrate tickets for modelling.** History comes from vaastav + FPL-Core-Insights. No new
    Supabase history tables.
14. **No one-constant tickets.** Never a ticket whose whole change is one fitted constant, slope,
    shrinkage K or multiplier.
15. **Settled questions stay closed** unless there is new evidence from a *different* data source or a
    *different* population: fixture-term tuning, conversion factors, shrinkage K, the minutes window,
    the bonus exponent, the TypeScript learned model, penalty-duty treatments in baseline-v1.

### D. Budget and stop signals
16. **Two strikes per idea.** An idea gets at most two runs. If it misses its gate twice, park it, write
    two lines in `model/README.md`, and move on. No third attempt, no "instrument to find out why".
17. **Run budget is 7** (§8). Any ticket not in the plan must say which planned item it replaces.
    Adding runs beyond 7 needs Keshav's explicit yes.
18. **Something visible every run from run 3 on.** At least one ticket per run must change what
    Keshav sees or what gets recommended.
19. **Progress check every 3 runs.** Send Keshav five lines: what he can do now that he couldn't before;
    the primary metric now vs last check; runs used vs budget; what's next; anything blocked.
    **If two runs in a row produced no user-visible change and no metric gain, stop writing tickets and
    tell him plainly before doing anything else.**
20. **Time-box surprises.** When a number moves unexpectedly, suspect the measurement first, but spend
    at most one interactive hour on it. Never write a ticket just to investigate.
21. **Scope is frozen to §11.** New feature ideas go on a parking list at the bottom of
    `feature-list.md`, not into tickets, until the budget is spent.

### E. Reading results
22. Compare baselines only on the same rows in the same run — never across reports.
23. Fewer than ~10 settled gameweeks of live results is noise (the scorecard, captaincy). Don't act on
    it unless the effect is huge and the cause is obvious.
24. A metric that jumps after an unrelated change is a leak until proven otherwise (LEARNINGS §18).

### F. Talking to Keshav
25. Lead with the answer. Plain, short English. Exact paste-ready commands, no trailing `#` comments.
26. Every headline number states the comparison, the rows and the sample size ("model 0.59 vs naive
    0.45, active players, 2025-26, 13,259 rows"). If unsure, say unsure.
27. When a previous answer or a handoff was wrong, say so in one line and move on.
28. Handoffs separate **measured** (with file and line) from **opinion**. Never pass on a headline you
    haven't re-checked at its source.

### G. Checklist to answer in every ticket hand-over message (yes/no, one line each)
- Researched how others do this, with a named source?
- Tested offline, and the measured gain is written in the ticket?
- Offline gate with reference number, threshold and stop rule?
- Changes something Keshav sees or gets recommended within two runs?
- File- and contract-disjoint from the rest of the batch?
- Inside the 7-run budget, or replacing a named planned item?

Any "no" means the ticket is not ready. Say which one, and why it should still go ahead, or drop it.

---

## Appendix A — `reference_gbm.py` (verified, reproduces §4b/§4c exactly)

```python
"""Reference implementation used for MODEL-DIAGNOSIS-2026-09-24.md §4.

Downloads vaastav/Fantasy-Premier-League (pinned), builds point-in-time features, runs a
2025-26 walk-forward with LightGBM, and prints the §4b/§4c tables.

    pip install lightgbm pandas numpy scipy pyarrow
    python reference_gbm.py            # ~4-5 min on a laptop CPU
"""
import os
import urllib.request

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

SHA = '9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88'
BASE = f'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/{SHA}/data'
SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']
TEST_SI = 3
CACHE = os.environ.get('DATA_DIR', 'cache')
os.makedirs(CACHE, exist_ok=True)


def fetch(season, name):
    path = os.path.join(CACHE, f'{season}_{name.replace("/", "_")}')
    if not os.path.exists(path):
        urllib.request.urlretrieve(f'{BASE}/{season}/{name}', path)
    return pd.read_csv(path, low_memory=False)


NUM = ['minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists', 'bps',
       'bonus', 'ict_index', 'threat', 'creativity', 'influence', 'saves', 'clean_sheets', 'goals_conceded',
       'starts', 'defensive_contribution', 'expected_goals_conceded', 'yellow_cards']


def load_player_gameweeks():
    frames = []
    for si, s in enumerate(SEASONS):
        d = fetch(s, 'gws/merged_gw.csv')
        raw = fetch(s, 'players_raw.csv')[['id', 'code']]
        d = d.merge(raw, left_on='element', right_on='id', how='left')
        d['si'] = si
        frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    d['position'] = d['position'].replace({'GKP': 'GK'})
    d = d[d['position'].isin(['GK', 'DEF', 'MID', 'FWD'])].copy()
    if 'defensive_contribution' not in d:
        d['defensive_contribution'] = 0.0
    for c in NUM:
        d[c] = pd.to_numeric(d[c], errors='coerce').fillna(0.0)
    d['kickoff_time'] = pd.to_datetime(d['kickoff_time'], utc=True)
    d['gf'] = np.where(d['was_home'], d['team_h_score'], d['team_a_score'])
    d['ga'] = np.where(d['was_home'], d['team_a_score'], d['team_h_score'])

    # team-level rolling form per fixture (strictly earlier fixtures only)
    tf = d.groupby(['si', 'fixture', 'team'], as_index=False).agg(
        kickoff=('kickoff_time', 'first'), gf=('gf', 'first'), ga=('ga', 'first'), txg=('expected_goals', 'sum'))
    pair = tf[['si', 'fixture', 'team', 'txg']].rename(columns={'team': 'opp_name', 'txg': 'txga'})
    tf = tf.merge(pair, on=['si', 'fixture'])
    tf = tf[tf['team'] != tf['opp_name']].sort_values(['team', 'kickoff'])
    tcols = []
    for k in [5, 10, 20]:
        for c in ['gf', 'ga', 'txg', 'txga']:
            n = f't_{c}_{k}'
            tf[n] = tf.groupby('team')[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            tcols.append(n)
    opp = tf[['si', 'fixture', 'team'] + tcols].rename(columns={'team': 'opp_name', **{c: 'o' + c for c in tcols}})
    tf = tf.merge(opp, on=['si', 'fixture', 'opp_name'], how='left')
    fx = tcols + ['o' + c for c in tcols]
    d = d.merge(tf[['si', 'fixture', 'team'] + fx], on=['si', 'fixture', 'team'], how='left')

    # one row per player-gameweek (double gameweeks summed)
    d['m60'] = (d['minutes'] >= 60).astype(float)
    d['app'] = (d['minutes'] > 0).astype(float)
    agg = {c: 'sum' for c in NUM + ['m60', 'app']}
    agg.update({'position': 'first', 'team': 'first', 'value': 'first', 'selected': 'first',
                'transfers_balance': 'first', 'was_home': 'mean', 'fixture': 'count'})
    agg.update({c: 'mean' for c in fx})
    g = d.groupby(['code', 'si', 'GW'], as_index=False).agg(agg).rename(columns={'fixture': 'nfix'})
    return g.sort_values(['code', 'si', 'GW']).reset_index(drop=True), fx


def add_features(g, fx):
    base = ['minutes', 'total_points', 'goals_scored', 'assists', 'expected_goals', 'expected_assists', 'bps',
            'bonus', 'ict_index', 'threat', 'creativity', 'saves', 'clean_sheets', 'goals_conceded', 'starts',
            'm60', 'app', 'defensive_contribution', 'expected_goals_conceded']
    grp = g.groupby('code')
    cols, feats = {}, []
    for k in [1, 3, 5, 10, 38]:          # rolling windows cross season boundaries, keyed on code
        for c in base:
            cols[f'r{k}_{c}'] = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).mean())
            feats.append(f'r{k}_{c}')
    for k in [10, 38]:
        mins = grp['minutes'].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
        for c in ['expected_goals', 'expected_assists', 'total_points', 'bps', 'threat', 'creativity',
                  'defensive_contribution', 'saves']:
            s = grp[c].transform(lambda x: x.shift(1).rolling(k, min_periods=1).sum())
            cols[f'p90_{k}_{c}'] = np.where(mins > 0, s / mins * 90, np.nan)
            feats.append(f'p90_{k}_{c}')
    gs = g.groupby(['code', 'si'])
    cols['sd_minutes'] = gs['minutes'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_apps'] = gs['app'].transform(lambda x: x.shift(1).cumsum())
    cols['sd_pts'] = gs['total_points'].transform(lambda x: x.shift(1).cumsum())
    cols['rows_hist'] = grp.cumcount()
    feats += ['sd_minutes', 'sd_apps', 'rows_hist']
    cols['pos_i'] = g['position'].map({'GK': 0, 'DEF': 1, 'MID': 2, 'FWD': 3})
    cols['value'] = pd.to_numeric(g['value'], errors='coerce')                # tenths of a million
    sel = pd.to_numeric(g['selected'], errors='coerce')
    tb = pd.to_numeric(g['transfers_balance'], errors='coerce')
    # production version: use within-gameweek percentile ranks so vaastav and FPL API units agree
    cols['sel_log'] = np.log1p(sel)
    cols['tb'] = tb
    cols['tb_rel'] = tb / (sel + 1000)
    cols['y5'] = gs['total_points'].transform(lambda x: x[::-1].rolling(5, min_periods=5).sum()[::-1])
    g = pd.concat([g.drop(columns=['value']), pd.DataFrame(cols, index=g.index)], axis=1)
    market = ['sel_log', 'tb', 'tb_rel']
    ctx = ['pos_i', 'value', 'was_home', 'nfix']
    return g, feats + fx + ctx + market, feats + fx + ctx


PARAMS = dict(objective='regression', learning_rate=0.03, num_leaves=31, min_data_in_leaf=100,
              feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=0)


def walk_forward(g, feats, target, cutoffs=(1, 8, 15, 22, 29, 36)):
    out = pd.Series(np.nan, index=g.index)
    lag = 4 if target == 'y5' else 0
    for i, c in enumerate(cutoffs):
        hi = cutoffs[i + 1] if i + 1 < len(cutoffs) else 39
        tr = g[(g.si < TEST_SI) | ((g.si == TEST_SI) & (g.GW < c - lag))].dropna(subset=[target])
        te = g[(g.si == TEST_SI) & (g.GW >= c) & (g.GW < hi)]
        m = lgb.train(PARAMS, lgb.Dataset(tr[feats], tr[target]), num_boost_round=600)
        out.loc[te.index] = m.predict(te[feats])
    return out


def sp(df, a, b):
    ok = df[[a, b]].dropna()
    return spearmanr(ok[a], ok[b]).statistic


if __name__ == '__main__':
    g, fx = load_player_gameweeks()
    g, FEATS, FEATS_NOMKT = add_features(g, fx)
    g['pred1'] = walk_forward(g, FEATS, 'total_points')
    g['pred5'] = walk_forward(g, FEATS, 'y5')
    t = g[(g.si == TEST_SI) & (g.GW >= 2)].copy()
    t['ppm'] = (t.sd_pts / t.sd_apps).fillna(0)
    t['mpm'] = (t.sd_minutes / t.sd_apps).fillna(0)
    feat = t[(t.minutes > 0) & (t.sd_apps > 0)]
    act = t[t.r5_app > 0]
    f5 = feat[(feat.GW <= 34) & feat.y5.notna()]
    a5 = act[(act.GW <= 34) & act.y5.notna()]
    print('featured 1-GW  gbm %.3f  minutes %.3f  ppm %.3f  n=%d' % (sp(feat, 'pred1', 'total_points'), sp(feat, 'mpm', 'total_points'), sp(feat, 'ppm', 'total_points'), len(feat)))
    print('featured 5-GW  gbm5 %.3f gbm1 %.3f minutes %.3f ppm %.3f n=%d' % (sp(f5, 'pred5', 'y5'), sp(f5, 'pred1', 'y5'), sp(f5, 'mpm', 'y5'), sp(f5, 'ppm', 'y5'), len(f5)))
    print('active   1-GW  gbm %.3f  minutes %.3f  ppm %.3f  n=%d' % (sp(act, 'pred1', 'total_points'), sp(act, 'mpm', 'total_points'), sp(act, 'ppm', 'total_points'), len(act)))
    print('active   5-GW  gbm1 %.3f gbm5 %.3f minutes %.3f ppm %.3f n=%d' % (sp(a5, 'pred1', 'y5'), sp(a5, 'pred5', 'y5'), sp(a5, 'mpm', 'y5'), sp(a5, 'ppm', 'y5'), len(a5)))
    for pos in ['GK', 'DEF', 'MID', 'FWD']:
        q = a5[a5.position == pos]
        print('  active 5-GW %-3s gbm1 %.3f ppm %.3f minutes %.3f' % (pos, sp(q, 'pred1', 'y5'), sp(q, 'ppm', 'y5'), sp(q, 'mpm', 'y5')))
```

Differences the production version (R1-T1) must make: ownership and transfers as within-gameweek
percentile ranks; team features keyed on FPL team `code` (vaastav `teams.csv`) not team name; current
season from FPL-Core-Insights; split into `sources.py` / `features.py` / `train.py` / `evaluate.py`
with the frozen signatures in §8; a minutes model beside the points model; the §7 populations and
gates.
