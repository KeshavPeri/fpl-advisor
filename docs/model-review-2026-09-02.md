# Projection model review — 2 September 2026

Commissioned after backtest report 7 showed the model beating a naive minutes-ranking only for
goalkeepers and defenders (season Spearman 0.323 vs 0.299; MID 0.382 vs 0.388; FWD 0.361 vs 0.402).
Analysis only — no code changed. Every number in this review is either quoted from a repo report or
computed from a reconstruction of the backtest built directly from FPL-Core-Insights' public
2025-2026 CSVs (the same source and method tickets #148, #162 and #168 used), validated against
report 7 before any variant was trusted — see "The instrument used here" below.

## Summary — the question 4 answer first

**Baseline-v1 should be repaired in exactly two measured places and otherwise frozen; the effort
should then go to the model behind the CSV seam — but as a small learned model on the columns this
repo already ingests, judged by a new 5-gameweek ranking metric, not as the OpenFPL 196-feature
reconstruction.** The reason is quantitative: single-gameweek ranking is nearly saturated — a
quality oracle that knows every player's true season-long scoring rate from every *other* gameweek
only reaches Spearman 0.332 on this population, so baseline-v1's 0.323 has almost no headroom on
the metric the backtest currently reports — while on the 5-gameweek totals the solver actually
optimises, the same oracle reaches 0.485 against the model's 0.425, with per-position gaps up to
0.13 for forwards, and that headroom is player-quality resolution that shrunk in-season xG/xA
cannot provide. Before any of that, the headline finding itself needs correcting: **most of the
measured MID/FWD deficit against the minutes baseline is the instrument, not the model** — the
harness feeds the model a single averaged match instead of the last-five-minutes window the live
model actually uses, and restoring that fidelity in reconstruction flips the verdict at every
position (MID 0.410 vs baseline 0.394; FWD 0.423 vs 0.396).

---

## The instrument used here, and its validation

`scripts/run-backtest.ts` was reconstructed independently in Python from the published per-gameweek
`playermatchstats.csv` files (15,340 rows fetched — exactly the count ticket #175's reconciliation
records), including the #175 point-in-time team-strength fixture (SCALE 5.6225, min 3 prior
matches), single-averaged-match minutes, K=3/K=5 shrinkage, per-gameweek position priors, both
conversion-factor tables, and the Poisson step-function expectations. Validation against report 7:

| Figure | Report 7 | Reconstruction |
|---|---|---|
| Measured rows | 10,460 | 10,580 (lacks the blank-gameweek and unresolved-fixture exclusions) |
| MAE / signed error | 1.800 / −0.196 | 1.797 / −0.194 |
| Model Spearman (season) | 0.323 | 0.326 |
| Model by position GK/DEF/MID/FWD | .168/.272/.382/.361 | .168/.274/.387/.358 |
| Minutes baseline (season) | 0.299 | 0.304 |
| xG+xA baseline (season) | 0.139 | 0.140 |

Every headline agrees to within ~0.005 and the goalkeeper figure is exact. Variant numbers below
therefore carry roughly ±0.01–0.02 of reconstruction uncertainty; each one is a **prediction of
what the real harness will show** once the corresponding change lands, and the recommendations
name the in-harness measurement that confirms or refutes it. Nothing below required a live
database read.

---

## 1. Does the model make sense from first principles?

### 1a. The decomposition itself — right, and keep it

Composing points from seven components is the correct architecture for *this* app, and not only
because §6d demands it. Every substantive finding this project has made — the assist conversion
gap (#148), the defcon harness defect (#154), the survivorship bias (#168/#177), the bonus
double-count in the calibration report (#127) — was found by reading a *component* table. A model
that predicted points directly would have shown the same 0.323 with no way to localise why. The
measurable accuracy cost of decomposition is the independence seams audited below, and they total
well under 0.1 points per row. The real cost is different: seven explainable terms cap how much
signal the model can extract, and that cap is now measured (question 3). Verdict: the
decomposition is not the problem; keep it as the fallback/explainable layer permanently, and put
capability gains behind the seam.

### 1b. Functional forms, term by term

**`attackingMultiplier = 2 × expectedScore` is twice too steep — the one measured shape error.**
Bucketing every resolvable 2025-26 team-match by point-in-time expectedScore and comparing actual
goals to the model's implied `1.45 × 2 × es`:

| es bucket | n | mean es | actual goals scored | model | actual conceded | model | actual CS% | model CS% |
|---|---|---|---|---|---|---|---|---|
| 0.00–0.35 | 123 | 0.251 | 1.04 | 0.73 | 1.75 | 2.17 | 9% | 11% |
| 0.35–0.45 | 138 | 0.401 | 1.23 | 1.16 | 1.61 | 1.74 | 20% | 18% |
| 0.45–0.55 | 176 | 0.500 | 1.35 | 1.45 | 1.35 | 1.45 | 24% | 23% |
| 0.55–0.65 | 138 | 0.599 | 1.61 | 1.74 | 1.23 | 1.16 | 30% | 31% |
| 0.65–1.01 | 123 | 0.749 | 1.75 | 2.17 | 1.04 | 0.73 | 39% | 48% |

The actual goals-vs-es slope is ≈1.43 goals per unit of expectedScore; the model's is 2.9. A
damped multiplier `0.5 + es` (half the current slope, still 1.0 at a neutral fixture) reproduces
the bucket means almost exactly (1.09 and 1.81 at the extreme buckets). In ranking terms the
current steepness costs forwards: with the fixture term removed entirely, forward Spearman *rises*
from 0.358 to 0.381; with the damped multiplier it rises to 0.371 single-gameweek and from 0.416
to 0.437 on the 5-GW target. This also answers **G8 in reverse**: fixture sensitivity is not too
narrow — for goals it is too wide, and the model's clean-sheet response (11%→48%) is already wider
than reality (9%→39%). Caveat, stated per the discipline rules: this is measured on the backtest's
GD-based expectedScore, whose spread was calibrated to match the live elo-derived spread (#175),
so the conclusion should transfer, but the live elo mapping itself has not been directly measured
— that check needs fixture results joined to elo, i.e. **a live database read**.

The same bucket table shows `expectedGoalsConceded`'s linear mirror overshoots symmetrically, but
damping the *defensive* side is not recommended yet: goalkeeper and defender ranking is the
model's clearest win and depends on that spread (neutral-fixture variant: GK collapses from 0.168
to −0.017), and the empirical clean-sheet curve is steeper than Poisson-with-damped-λ. Damp the
attack side now (measured win, no downside found); measure the defensive side in-harness before
touching it.

**`pCleanSheet = exp(−λ)`** is the right shape mid-range (bucket 0.45–0.55: 23% vs 24% actual) and
inherits the top-end overshoot from λ's slope. Fine once read alongside the above.

**Save points as a Poisson expectation over `floor(saves/3)`** — correct construction, calibrated
0.94x, keep. G1's saves/GC shared-multiplier caveat stands and is small at these magnitudes.

**Defcon as a shrunk per-match hit rate** — the form is fine, and report 7's own
by-`prior_matches` table settles G10's open question, though the backlog has not recorded the
verdict yet: signed error −0.057 / −0.059 / −0.045 / **+0.006** across the 1–4 / 5–9 / 10–19 /
20+ buckets. A gap that closes to zero as evidence accumulates is the **cold-start** explanation;
the estimator is correctly cautious early and converges. Do not tune `k = 5`.

### 1c. Independence assumptions — measured, small

`cleanSheetPoints = pCleanSheet × pSixtyPlus × points` treats reaching 60 minutes and the team's
clean sheet as independent. Measured on defender rows: corr(played 60+, team CS) = **−0.113**;
P(CS | 60+) = 0.263 vs unconditional 0.290. Independence therefore *overstates* the joint by ~10%
relative — about 0.08 points on a typical defender's clean-sheet term — and the real FPL rule
(clean sheet judged while on the pitch, so a player subbed off before a late goal still collects)
gives back part of that. Net effect well under 0.1 points and shared by `src/lib/scoring/`'s
actual-side reconstruction, so the backtest sees almost none of it. Not worth a ticket. The
structurally larger correlation issue is not any single pair but that one expectedScore error
moves six components in the same direction, and one minutes error moves all seven plus bonus —
which is section 1f.

### 1d. Double-counting — the full inventory

1. **Saves and goals conceded share one fixture multiplier** (G1, known, accepted).
2. **Team strength is counted in both the per-90 rates and the multiplier's normalisation.** A
   player's historical per-90 already embeds his team's average fixture (a title-team attacker's
   average es is ~0.65, not the 0.5 the multiplier normalises to), so strong-team attackers are
   scaled above their own base rates in merely average fixtures. Measured: normalising the
   multiplier by the team's own mean es lifts forward Spearman 0.358→0.373. The damped multiplier
   (1b) absorbs most of the same distortion (0.371) while also fixing levels, so ship that one,
   not both.
3. **`pSixtyPlus` is one estimate worn four ways** — appearance's second point, the clean-sheet
   gate, the defcon gate, and the bonus allocator's appearance-BPS baseline. By design, but it
   concentrates minutes error (1f).
4. **The bonus allocator re-consumes every expected event**, so a fixture or minutes error
   propagates into bonus a second time — an eighth hat for the minutes model, and the one
   component no instrument can currently check (1h).
5. The price prior multiplies a prior that is then shrunk toward — but only for zero-history
   players, clamped, and honest. Not a double-count in practice.

### 1e. The conversion factors — a smell correctly diagnosed, a program to now stop

Measured: removing both factor tables changes season Spearman by −0.001 (0.326→0.325). This is
close to definitional — a constant per-position multiplier cannot reorder players within a
position; it only shifts component mix and cross-position levels. So #148/#162 were **level
calibrations, not ranking improvements**, and they are legitimate as exactly that: the 2.12 is not
"forwards convert double their xA" but a bridge between this source's xA definition and FPL's
generous assist-crediting rule (penalties won, deflected chains, rebounds), which xA structurally
undercounts and forwards' assist types skew toward. The tested alternative — predicting assists
from shrunk *actual* assist rates instead of xA (and goals from goals) — gains nothing (season
0.325), so the xA+factor construction stands.

What should stop is the residual chase. Forward assists still read 0.70x on calibration report 6
*after* #148, #168 and #177 because that instrument compares the 2026/27 roster's projections
against the 2025/26 population's actuals, and #168 measured that the difference between those
populations is precisely assist-shaped (departed forwards: xA/90 0.073; retained: 0.055). A
cross-population distributional comparison cannot resolve a within-position component level below
roster-churn size, and the backtest — the better instrument — puts the whole assist component's
signed error at **−0.020 points per row**. Declare the assist workstream done and record in the
backlog that 0.70x on that report is expected, not actionable.

### 1f. Minutes — one model wearing seven (now eight) hats, and it is the main event

Quantified three ways on the measured population:

- The model's ranking correlates with the raw minutes baseline's at Spearman **0.83 (MID)** and
  **0.88 (FWD)** — for the positions that matter, baseline-v1 *is* substantially a minutes-ranker
  with an attacking overlay.
- A minutes-only variant (appearance + CS + defcon + GC + saves, no goals/assists) retains 85% of
  the full model's season Spearman (0.278 of 0.326).
- Appearance is the largest single component of projected spread for midfielders (SD 0.54 of a
  1.32-point total) and joint-largest for forwards, and its −0.092 signed error is 47% of the
  entire model bias.

That concentration is not itself wrong — minutes genuinely are the most predictable dimension of
FPL points — but it means `minutes.ts` (an average of five numbers times an availability factor)
carries more of the model than everything in `rates.ts` combined, and two concrete upgrades exist:
the harness-fidelity fix in question 2, and a live-model minutes v2 (recommendation R4) using the
`start_min`/`finish_min` columns the source publishes but the ingest currently drops — a
starts-based three-state model (start / bench / out) rather than a raw 5-match average. One
horizon subtlety the measurements exposed: at the 5-GW target the plain season-average-minutes
baseline *beats* the 5-match-window model for midfielders (0.473 vs 0.444) — the window is too
reactive for a long horizon — so minutes v2 should shrink the recent window toward the season
share, exactly the two-stage pattern rates already use.

### 1g. What is missing entirely — and mostly should stay missing

Cards, own goals and penalty misses (G4): right call, keep them out; their per-row magnitude is
small and near-unrankable. Penalty *duty* is the one absence with concentrated cost — it inflates
a handful of exactly the players captaincy turns on, and it is cheaply measurable (the source
carries `penalties_scored`; a persistent positive per-player goals-minus-xG residual identifies
takers) — worth one diagnostic, not a build. Team attacking strength as a distinct input is
already embedded in per-90 rates plus the fixture term (see 1d-2 for the interaction). The
biggest true absence is not a scoring event at all: it is **player-quality resolution beyond
shrunk in-season xG/xA**, which is question 3's headroom and the learned model's case.

### 1h. Over-engineering audit

- **Two-stage shrinkage**: zero new parameters, collapses to single-stage exactly when a season is
  empty — principled, cheap, keep. Note it is currently *unmeasurable*: the backtest is
  single-season, so the live model's cross-season rates are strictly better-informed than anything
  the harness scores (another way the instrument understates the live model).
- **Price prior**: bounded, tiny population (only zero-history-at-every-level players), honest.
  Keep; never worth measuring until a GW1-era backtest exists.
- **Poisson step-function sums**: exactly right, six lines. Keep.
- **Bonus allocator**: the one component with *no validating instrument anywhere* —
  `player_match_stats` can never carry bonus (#127, permanent), the backtest excludes it from both
  sides, the calibration report subtracts it out. It adds ~0.08–0.3 points concentrated at the top
  of rankings, i.e. it moves captaincy decisions while being unfalsifiable in-repo. Do not remove
  it (that reopens G3's known bias), but flag it: validation would need actual per-player bonus
  from the FPL API for settled 2026/27 gameweeks — a **live DB/API read** and possibly a new
  ingest field — and until then no ticket should tune it.
- **Conversion factors**: keep the shipped constants, close the program (1e).
- The genuinely over-engineered thing is none of these — it is continued **constant-tuning
  against a single-gameweek instrument whose resolution is ~±0.01 Spearman**. The next three
  tickets should change what is measured, not another constant.

## 2. Why does the model lose to a minutes-ranking for midfielders and forwards?

Because the backtest hands the model a degraded minutes signal, and the fixture term adds
mis-scaled noise on top; the shrinkage and conversion-factor hypotheses are refuted by direct
test. In order of measured effect:

**(i) The instrument's minutes approximation is the largest cause — it flips the verdict.** The
harness (G9 approximation 1) collapses a player's history to one averaged match, so `pSixtyPlus`
is binary (1 if average ≥ 60, else 0) and the appearance term becomes `1 + 1[avg ≥ 60]` — a
coarsened copy of the very quantity the minutes baseline ranks on continuously. 22% of measured
rows sit in the 50–70-minute cliff zone. Replacing that input with the true last-five-match window
— exactly what the live model consumes — moves the reconstruction to season **0.354**, and by
position MID **0.410 vs baseline 0.394**, FWD **0.423 vs 0.396**: the model beats the minutes
baseline everywhere. The measured MID/FWD deficit (−0.006/−0.041 in report 7) is smaller than the
harness-induced degradation (+0.023/+0.065), so the published finding is, on this evidence,
**an instrument artefact for MID and at least half of one for FWD** — the live model is very
likely better-ranked than the backtest can currently see. This is the fourth instance of the
repo's "instrument, not model" pattern (#154, #127, #140 GW33 before it).

**(ii) The attacking fixture multiplier is twice too steep** (1b): removing or damping it is worth
+0.013 to +0.023 forward Spearman single-GW and +0.021 at the 5-GW target. Unlike (i) this is a
real model defect, present in live projections too.

**(iii) Refuted: shrinkage compression.** Shrinkage compresses between-player xG+xA/90 spread
hard (SD ×0.20 for MID, ×0.39 for FWD) — but *removing* it makes ranking worse (season
0.326→0.319; FWD 0.358→0.339), because the raw rates at in-season sample sizes are noisier than
they are informative. The compression is the correct response to the data; K=3 is in the right
neighbourhood and should not be tuned from this evidence.

**(iv) Refuted: conversion factors** — rank-neutral within position (1e), −0.001 season.

**(v) The residual truth: at one gameweek, attacking rates barely rank.** Prior xG+xA per match
alone scores 0.140 season (0.253 MID, 0.332 FWD) against minutes' 0.304 — and the quality oracle
in question 3 shows even *perfect* rate knowledge adds little at one gameweek. The model's
0.83–0.88 rank-correlation with a minutes ordering is therefore not an indictment; it is what a
correct one-week model looks like. The indictment only lands at the 5-GW horizon, where quality
knowledge is worth a lot and the model still cannot resolve it.

## 3. The realistic ceiling, and whether the app measures the wrong thing

Constructed reference points on the same measured population (every "ceiling" here is derived,
none asserted):

| Ranker | 1-GW season | 1-GW MID | 1-GW FWD | 5-GW season | 5-GW MID | 5-GW FWD |
|---|---|---|---|---|---|---|
| Minutes baseline | 0.304 | 0.394 | 0.396 | 0.414 | 0.473 | 0.470 |
| Model (as measured) | 0.326 | 0.387 | 0.358 | 0.425 | 0.459 | 0.416 |
| Model + live-window minutes (V1) | 0.354 | 0.410 | 0.423 | 0.420 | 0.444 | 0.454 |
| Model + damped attack multiplier | 0.329 | 0.393 | 0.371 | 0.431 | 0.471 | 0.437 |
| Quality oracle (leave-target-out season rate) | 0.332 | 0.402 | 0.393 | 0.485 | 0.516 | 0.545 |
| Oracle blends (partial lookahead, ceiling probes) | 0.375 | 0.440 | 0.449 | 0.490 | — | — |

The quality oracle knows each player's true season-long points-per-match from every gameweek
*except* the target — perfect quality knowledge, honestly excluded target. At one gameweek it
scores **0.332**: knowing exactly who the good players are is worth almost nothing more than
knowing who plays, because one week of FPL returns is noise-dominated. Even a probe blending that
oracle with the best buildable model reaches only 0.375. So the realistic single-gameweek ceiling
sits around **0.35–0.38**, and 0.323 is roughly 85–90% of the way there — single-GW Spearman can
never show a large win for any future model, however good.

Over the 5-gameweek horizon the picture inverts: the oracle reaches **0.485** (0.516 MID, 0.545
FWD) against the model's 0.425, and a mere rank-blend of minutes with oracle quality reaches
0.490. Aggregation averages the week noise away and quality knowledge compounds — and 5-GW totals
are what `PROJECTION_HORIZON = 5` feeds and the solver optimises. **Yes, the app is measuring the
wrong thing**: the backtest's ranking section scores only the noise-capped one-week question. The
same harness holds the whole season and can produce the 5-GW target with no new data
(recommendation R2). Expect the model's *current* 5-GW numbers to be unflattering at MID/FWD
(0.459/0.416 vs the minutes baseline's 0.473/0.470) — that is the honest baseline the learned
model must beat, and the ~0.06–0.13 gap to the oracle is the prize.

## 4. Baseline-v1 repair, or the model behind the seam?

Stated in the summary; the reasoning in full. Repair of baseline-v1 has hit two walls at once: the
instrument wall (single-GW resolution ±0.01, and the harness degrading the model's own inputs) and
the information wall (shrunk in-season xG/xA cannot resolve player quality; every constant-tuning
avenue tested here is worth ≤0.01 except the two named fixes). The two measured repairs — the
damped attacking multiplier and, later, minutes v2 — are worth shipping because they are cheap and
also fix *level* errors that ranking metrics don't see (a 24% over-projection of attackers in the
easiest fixtures directly distorts captaincy weeks and the −4-hit margin). Beyond those, the
five-input model is complete: it is the explainable fallback §6d wanted, and it should be
version-frozen, not polished.

The capability gap — 0.06 season, 0.13 forwards, at the horizon that matters — is a
quality-resolution problem, which is what learned models are for. But item 30 as written ("OpenFPL
retrain") is the wrong shape: the brief itself calls reconstructing 196 undocumented features
"the ticket shape this pipeline handles worst". The right shape is a **small learned model on the
~15 strongest columns already in the ingested source** (shots, shots on target, chances created,
big chances missed, touches in opposition box, the existing rates, minutes structure, team
strength), trained on point-in-time aggregates the `feature_history` pattern already provides,
written as `model_version = 'learned-v1'` behind the seam (§6c satisfied by construction), and
**gated by one pre-registered number**: beat the repaired baseline's per-position Spearman on the
5-GW target, on the same measured population, same exclusions. That gate is what makes it a safe
pipeline ticket — an objective definition of done where OpenFPL's has none.

What would change my mind: if R1 (harness minutes fidelity) comes back materially below the
predicted 0.35/0.41/0.42 — the instrument-artefact diagnosis would be wrong and this review's
model-quality read too generous; or if the repaired baseline closes to within ~0.02 of the 5-GW
oracle per position — then the learned model has no room and should not be built; or if learned-v1
cannot beat the gate after its budgeted attempts — the seam makes abandoning it a one-line
regression, which is exactly why the seam exists.

## 5. Recommendations, ranked by value per unit of work

Each is one night's scope. **[D]** = diagnostic/instrument (changes no live projection),
**[F]** = fix (changes live projections). None needs a live database read at build time except
where flagged; the backtest and report jobs already run with Supabase access in CI.

**R1 [D] — Give the backtest the model's real minutes input.** Two tickets, mirroring the
#146→#154 pattern exactly. (a) Migration + `scripts/build-feature-history.ts`: store the last
five per-match minutes per (player, gameweek) row (five columns or an int array), strictly-before
semantics unchanged. (b) `scripts/run-backtest.ts`: build `recentMinutes` from those columns,
keeping the averaged-match path as the pre-migration fallback, counted, like `hasDefconCounters`.
**Confirming measurement**: season Spearman ~0.323→~0.35; MID ~0.41 vs minutes baseline ~0.39;
FWD ~0.42 vs ~0.40 — the headline table flips. If it does not, the instrument-artefact diagnosis
is refuted and this review's question-2 answer is wrong. What this will NOT change: any live
projection, any recommendation, MAE materially (bias barely moves; this is a ranking-fidelity
fix). Reports before/after are not comparable — say so in the report, as #154/#175 did.

**R2 [D] — Add the 5-gameweek ranking target to the backtest.** `scripts/run-backtest.ts` only:
for every measured row with gameweek ≤ 34, also score projected points against the sum of actual
points over gameweeks g..g+4 (zeros for non-featuring weeks — that risk is part of what a
transfer buys), with the same three baselines plus one new derived reference: the leave-window-out
season points-per-match oracle, so the report shows headroom, not just rank. **Confirming
measurement**: expected first reading ≈ model 0.42–0.43 / minutes 0.41 / oracle ≈0.48–0.49
season. What this will NOT change: anything user-visible; it changes what "better" means for every
subsequent model ticket, which is the point. (R1(b) and R2 touch the same file; they can merge
into one ticket if a night runs short, but the measurements should be reported separately.)

**R3 [F] — Damp the attacking multiplier.** `src/lib/projection/fixture.ts`
(`attackingMultiplier` → `0.5 + expectedScore`, clamp unchanged) with the 1b bucket table quoted
as the derivation; `expectedGoalsConceded`/`defensiveMultiplier` untouched, explicitly.
**Confirming measurement**: backtest FWD Spearman +0.01–0.02 single-GW, MID +0.01 at 5-GW (after
R2); calibration-report goal ratios stay ~1.0 (the population mean is unchanged at a neutral
fixture). What this will NOT change: the defensive side, clean sheets, or the MID 5-GW deficit
against the minutes baseline — do not read the next report as a failure when those stand still.
Also record G8's answer (sensitivity too wide for goals, not too narrow) in the backlog.

**R4 [F] — Minutes model v2, starts-based.** Ingest `start_min`/`finish_min` (published, currently
dropped) into `player_match_stats`; extend `minutes.ts` to model P(start), P(60+ | start) and a
sub-minutes expectation, with the recent window shrunk toward the season share (the two-stage
pattern; the 5-GW measurements show a raw 5-match window is too reactive for the horizon).
Two-to-three tickets (migration+ingest; model; wiring). Only worth doing after R1/R2 exist to
score it. Expected value: the largest live-model gain available inside baseline-v1, since minutes
carry ~85% of its ranking signal.

**R5 [D] — Close three open questions in the backlog from evidence already in hand**, one small
documentation ticket: G10 = cold start (report 7's own bucket table, −0.057→+0.006); G8 =
answered in reverse (1b); forward-assist 0.70x = expected roster-churn artefact of the
calibration report's cross-population design, workstream closed (1e). Cheap, and it prevents
three future tickets being written against settled questions.

**R6 [F] — learned-v1 behind the seam** (feature-list items 30/31 reshaped): as specified in
question 4, gated on R2's metric. Two-to-three nights (feature assembly on the `feature_history`
pattern; training + evaluation; `emit-projections-csv` already keys on `model_version`). Do not
start before R1+R2 have landed and been read.

**Explicitly not recommended**: reverting the conversion factors, the price prior, two-stage
shrinkage or the bonus allocator (all either measured harmless or load-bearing); tuning
`SHRINKAGE_K` or defcon `k` (both refuted as problems); building cards/own-goals (G4 stands); any
further constant fitted against the single-GW Spearman (below instrument resolution); the OpenFPL
196-feature reconstruction in its original form. **Needs a live DB read, flagged for scheduling
outside the overnight pipeline**: the live-elo version of the 1b bucket table (fixtures + elo +
results from Supabase), and any future bonus validation (actual bonus via the FPL API — new
ingest surface, Tier 2).

## With exactly three tickets

1. **R1** — feature_history minutes-window columns + backtest read (its two halves batched as one
   night's pair if linting allows, else the migration half first). Highest information per unit of
   work in the repo right now: it either flips the finding this review was commissioned for, or
   refutes this review.
2. **R2** — the 5-GW ranking target with baselines and the oracle row. It redefines the objective
   to the one the solver already optimises, and every later model decision — including whether
   learned-v1 ever ships — reads from it.
3. **R3** — the damped attacking multiplier: the only model change in this review that is measured,
   mechanically explained, one line, and improves both ranking and levels at once.

Then read the two new reports before writing ticket four.
