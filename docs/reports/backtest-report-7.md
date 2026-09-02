# Backtest report — point-in-time projection vs actual

Generated: 2026-09-02T07:42:53.767Z · Job: `run-backtest` · Season: `2025-2026`

Measures the projection only — no transfers, captaincy, solver, or league position (item 32's remaining work). Every projected figure below is built strictly from `feature_history` prior-gameweek totals — no later gameweek, no live current-season data. See `scripts/run-backtest.ts`'s file header for the full method and its documented approximations, and `docs/projection-model-backlog.md` for what this slice does and does not settle.

## Sanity check: PASSED

Overall mean absolute error and every position's derived clean-sheet rate are within their sane bounds.

## Headline

Measured population: **10460** player-gameweek row(s). Mean absolute error: **1.800**. Mean signed error: **-0.196** — the model is UNDER-projecting by 0.196 points per player-gameweek on average.

## The measured population, and what is excluded

- `feature_history` rows read (season=2025-2026): 18588
- rows with a matching `player_match_stats` actual gameweek entry found: 12567
- **rows measured (headline population)**: 10460
- excluded — no prior matches (`prior_matches = 0`, no point-in-time signal): 565
- excluded — player did not feature this gameweek (a correct zero that would flatter the error): 6913
- excluded — blank gameweek (player's team had no fixture at all, ticket #140): 266
- excluded — actual data incomplete (`team_goals_conceded` null, ~2% known gap, ticket #125): 264
- excluded — unresolved position (neither `feature_history.element_type` nor the `players` fallback resolves, ticket #154): 0 (0% of rows read)
- excluded — unresolved fixture teams (own club or the opponent faced could not be resolved, ticket #175 — chiefly mid-season transfers, see that ticket's own note): 120 (1% of rows read)

Reconciliation: 10460 measured + 8128 excluded = 18588, against 18588 rows read.

## Fixture coverage (ticket #175)

Before this ticket, every measured row below was projected under a neutral fixture (expectedScore exactly 0.5, every multiplier exactly 1.0) — the harness could not see which team a player faced. This ticket reads `feature_history.team_code` (the player's own club) and `player_match_stats.opponent_team_code` (the club faced) and builds a point-in-time team-strength table from `player_match_stats` rows strictly before the row being projected — see `scripts/run-backtest.ts`'s file header for the construction and its SCALE constant. A team below 3 prior matches (a JUDGEMENT call, not derived) falls back to the same neutral expectedScore every row used before this ticket — a genuinely resolvable club with too little history yet, never an unresolved one (which is excluded separately above, never silently defaulted to neutral).

- measured rows that used a real, computed fixture: 9930
- measured rows that fell back to the neutral fixture (insufficient prior team history): 530


## Position resolution and defensive-contribution evidence (ticket #154)

Ticket #146 added `element_type` and the two per-match defcon counters to `feature_history`; this is the first slice to read them. Position resolution is a strict 3-way partition of every row read; defcon-evidence source is a strict 2-way partition of the same population (not only the measured rows below — `buildDefconMatches` also runs for excluded rows via the position-prior computation).

- position from `feature_history.element_type` (primary source): 18588
- position from the `players` table fallback (row predates ticket #146): 0
- position unresolved (neither source — excluded as `unresolvedPlayerCode` above): 0
- defensive-contribution evidence from stored `prior_defcon_qualifying_matches`/`prior_defcon_hits` counters: 18588
- defensive-contribution evidence from the pre-#154 single-averaged-match fallback (row predates ticket #146): 0


## By position

| Position | n | Mean absolute error | Mean signed error | Derived clean-sheet rate |
|---|---|---|---|---|
| Goalkeeper | 702 | 1.722 | -0.068 | 25.2% |
| Defender | 3649 | 2.065 | -0.194 | 26.5% |
| Midfielder | 4836 | 1.640 | -0.210 | 28.3% |
| Forward | 1273 | 1.691 | -0.216 | 0.0% |

## By gameweek

A bad week is visible here rather than averaged away into the season figure above. "Multi-fixture rows" is how many of that gameweek's measured player-gameweeks had more than one fixture (ticket #140) — a nonzero value flags a candidate double gameweek.

| Gameweek | n | Mean absolute error | Mean signed error | Multi-fixture rows |
|---|---|---|---|---|
| 2 | 256 | 1.967 | -0.225 | 0 |
| 3 | 274 | 1.808 | -0.331 | 0 |
| 4 | 265 | 1.709 | -0.433 | 0 |
| 5 | 286 | 1.721 | 0.096 | 0 |
| 6 | 295 | 1.723 | 0.036 | 0 |
| 7 | 297 | 1.499 | -0.009 | 0 |
| 8 | 291 | 1.740 | -0.163 | 0 |
| 9 | 299 | 1.772 | -0.072 | 0 |
| 10 | 291 | 1.752 | -0.034 | 0 |
| 11 | 294 | 1.940 | -0.251 | 0 |
| 12 | 297 | 1.848 | -0.132 | 0 |
| 13 | 298 | 1.661 | -0.036 | 0 |
| 14 | 298 | 1.862 | -0.269 | 0 |
| 15 | 305 | 1.733 | -0.246 | 0 |
| 16 | 293 | 1.975 | -0.134 | 0 |
| 17 | 290 | 1.665 | -0.449 | 0 |
| 18 | 286 | 1.748 | -0.389 | 0 |
| 19 | 285 | 2.041 | -0.654 | 0 |
| 20 | 289 | 1.821 | -0.344 | 0 |
| 21 | 287 | 1.835 | -0.265 | 0 |
| 22 | 286 | 1.854 | -0.345 | 0 |
| 23 | 298 | 1.955 | 0.003 | 0 |
| 24 | 297 | 1.719 | -0.138 | 0 |
| 25 | 293 | 1.758 | 0.022 | 0 |
| 26 | 294 | 1.921 | 0.051 | 28 |
| 27 | 290 | 1.669 | -0.206 | 0 |
| 28 | 293 | 1.755 | -0.089 | 0 |
| 29 | 256 | 1.729 | -0.167 | 0 |
| 30 | 274 | 1.906 | -0.404 | 0 |
| 31 | 229 | 1.838 | -0.324 | 0 |
| 32 | 280 | 1.743 | -0.234 | 0 |
| 33 | 285 | 2.208 | -0.216 | 93 |
| 34 | 189 | 1.841 | -0.282 | 0 |
| 35 | 278 | 1.674 | -0.188 | 0 |
| 36 | 276 | 1.822 | -0.301 | 31 |
| 37 | 282 | 1.748 | -0.034 | 0 |
| 38 | 284 | 1.686 | -0.221 | 0 |

## Multi-fixture gameweeks (ticket #140)

Player-gameweeks with more than one fixture: **152** of 10460 measured.

- Season headline WITH multi-fixture rows (the figure above): n=10460, MAE=1.800, mean signed error=-0.196
- Season headline WITHOUT multi-fixture rows: n=10308, MAE=1.784, mean signed error=-0.201

Excluding multi-fixture player-gameweeks moves the season MAE by 0.016 — within the 0.05 threshold, not a material driver of the headline on its own.

## Defensive-contribution signed error, by prior_matches bucket (ticket #140)

Full-season calibration can look correct while point-in-time estimation shrinks hard toward the position prior early in a player's history — this table is what tells a cold-start problem (shrinks toward 0 as the bucket rises) apart from a level problem (stays flat). A bucket under 50 measured rows is reported as "too small to read", never as a number nobody checked.

| prior_matches | n | Mean signed error |
|---|---|---|
| 1–4 | 1764 | -0.057 |
| 5–9 | 2041 | -0.059 |
| 10–19 | 3547 | -0.045 |
| 20+ | 3108 | 0.006 |

## Overall signed error, by prior_matches bucket (ticket #140)

The same bucketing applied to the overall signed error, for comparison against the defcon-only breakdown above.

| prior_matches | n | Mean signed error |
|---|---|---|
| 1–4 | 1764 | -0.232 |
| 5–9 | 2041 | -0.206 |
| 10–19 | 3547 | -0.268 |
| 20+ | 3108 | -0.086 |

## By component

Mean actual vs mean projected per component, across the measured population — attributes a gap in the headline to a specific term rather than leaving it only visible in aggregate. Bonus is absent from both sides (see file header) rather than shown as an always-zero row.

| Component | Mean actual | Mean projected | Mean signed error |
|---|---|---|---|
| Appearance | 1.709 | 1.617 | -0.092 |
| Goals | 0.432 | 0.414 | -0.018 |
| Assists | 0.254 | 0.234 | -0.020 |
| Clean sheets | 0.437 | 0.392 | -0.044 |
| Goals conceded | -0.173 | -0.156 | 0.017 |
| Saves | 0.040 | 0.037 | -0.003 |
| Defensive contribution | 0.256 | 0.222 | -0.035 |

## Ranking skill (ticket #147)

The metrics above measure how close the model's numbers are; this measures whether it puts the right players at the top — the only thing a recommendation actually depends on (the captain IS the squad's top-projected player; a transfer IS a claim one player will outscore another). Same measured population as above, no new Supabase read. **Spearman rank correlation** ranks projected and actual points among the same set of rows (tied values share the average rank they would occupy) and reports how well the two orderings agree — 1 is perfect agreement, −1 is perfect reversal, 0 is no relationship. **Top-N overlap** is closer to what the app actually does: of the players ranked in the model's top 10 (or top 20) that gameweek, how many were also in the actual top 10 (or top 20). See `docs/projection-model-backlog.md` for what this section does and does not settle — no conclusion about whether the ranking is good is drawn here.

### Ranking sanity check: PASSED

The season aggregate and every position's Spearman correlation and top-10 overlap are within their sane bounds.

### Season aggregate

- Spearman rank correlation: **0.323** (n=10460)
- Top-10 overlap: **47 of 370 (12.7%)**
- Top-20 overlap: **145 of 740 (19.6%)**

Top-10/20 figures are summed across every gameweek with at least 50 measured rows (the same threshold the by-gameweek table below applies) — a season-wide overlap RATE, not a single top-10 selected from the whole season pooled together.

### By position

A captain is chosen across positions, but a transfer is usually within one — Spearman is pooled across the whole season for that position (like the by-position table above); top-N overlap is summed across every gameweek that position appears in, uncapped by the 50-row gameweek gate (a per-gameweek goalkeeper population is often under 50 by construction).

| Position | n | Spearman | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| Goalkeeper | 702 | 0.168 | 205 of 360 (56.9%) | too small to read |
| Defender | 3649 | 0.272 | 73 of 370 (19.7%) | 262 of 740 (35.4%) |
| Midfielder | 4836 | 0.382 | 79 of 370 (21.4%) | 220 of 740 (29.7%) |
| Forward | 1273 | 0.361 | 161 of 370 (43.5%) | 514 of 720 (71.4%) |

### By gameweek

A gameweek with fewer than 50 measured rows is reported "too small to read" rather than as a correlation nobody could trust.

| Gameweek | n | Spearman | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| 2 | 256 | 0.288 | 2 of 10 (20.0%) | 5 of 20 (25.0%) |
| 3 | 274 | 0.321 | 2 of 10 (20.0%) | 3 of 20 (15.0%) |
| 4 | 265 | 0.406 | 3 of 10 (30.0%) | 5 of 20 (25.0%) |
| 5 | 286 | 0.287 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 6 | 295 | 0.290 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 7 | 297 | 0.428 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 8 | 291 | 0.414 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 9 | 299 | 0.370 | 0 of 10 (0.0%) | 5 of 20 (25.0%) |
| 10 | 291 | 0.382 | 2 of 10 (20.0%) | 3 of 20 (15.0%) |
| 11 | 294 | 0.295 | 0 of 10 (0.0%) | 2 of 20 (10.0%) |
| 12 | 297 | 0.357 | 1 of 10 (10.0%) | 2 of 20 (10.0%) |
| 13 | 298 | 0.363 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 14 | 298 | 0.270 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 15 | 305 | 0.475 | 3 of 10 (30.0%) | 4 of 20 (20.0%) |
| 16 | 293 | 0.274 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 17 | 290 | 0.356 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 18 | 286 | 0.294 | 0 of 10 (0.0%) | 1 of 20 (5.0%) |
| 19 | 285 | 0.188 | 0 of 10 (0.0%) | 1 of 20 (5.0%) |
| 20 | 289 | 0.268 | 2 of 10 (20.0%) | 2 of 20 (10.0%) |
| 21 | 287 | 0.236 | 0 of 10 (0.0%) | 1 of 20 (5.0%) |
| 22 | 286 | 0.182 | 0 of 10 (0.0%) | 1 of 20 (5.0%) |
| 23 | 298 | 0.182 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 24 | 297 | 0.440 | 0 of 10 (0.0%) | 4 of 20 (20.0%) |
| 25 | 293 | 0.375 | 3 of 10 (30.0%) | 5 of 20 (25.0%) |
| 26 | 294 | 0.337 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 27 | 290 | 0.413 | 0 of 10 (0.0%) | 1 of 20 (5.0%) |
| 28 | 293 | 0.319 | 2 of 10 (20.0%) | 3 of 20 (15.0%) |
| 29 | 256 | 0.372 | 1 of 10 (10.0%) | 7 of 20 (35.0%) |
| 30 | 274 | 0.249 | 2 of 10 (20.0%) | 3 of 20 (15.0%) |
| 31 | 229 | 0.274 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 32 | 280 | 0.362 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 33 | 285 | 0.371 | 1 of 10 (10.0%) | 8 of 20 (40.0%) |
| 34 | 189 | 0.273 | 0 of 10 (0.0%) | 5 of 20 (25.0%) |
| 35 | 278 | 0.362 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 36 | 276 | 0.391 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 37 | 282 | 0.269 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 38 | 284 | 0.211 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |

### By gameweek × position (ticket #159, Defect 3)

The finest grain this report prints — the only place the Defender/Midfielder identical-overlap observation noted in this ticket's decisions file is distinguishable on the next run (not asserted as a bug here). Not gated by the 50-row gameweek threshold above (a per-gameweek, per-position population, goalkeepers especially, is routinely under 50 by construction); IS gated by the top-N-meaningfulness check directly below.

| Gameweek | Position | n | Top-10 overlap | Top-20 overlap |
|---|---|---|---|---|
| 2 | Goalkeeper | 19 | 6 of 10 (60.0%) | too small to read |
| 2 | Defender | 88 | 3 of 10 (30.0%) | 6 of 20 (30.0%) |
| 2 | Midfielder | 119 | 4 of 10 (40.0%) | 7 of 20 (35.0%) |
| 2 | Forward | 30 | 5 of 10 (50.0%) | 16 of 20 (80.0%) |
| 3 | Goalkeeper | 20 | 3 of 10 (30.0%) | too small to read |
| 3 | Defender | 93 | 4 of 10 (40.0%) | 7 of 20 (35.0%) |
| 3 | Midfielder | 133 | 2 of 10 (20.0%) | 5 of 20 (25.0%) |
| 3 | Forward | 28 | 5 of 10 (50.0%) | 16 of 20 (80.0%) |
| 4 | Goalkeeper | 17 | 7 of 10 (70.0%) | too small to read |
| 4 | Defender | 93 | 2 of 10 (20.0%) | 11 of 20 (55.0%) |
| 4 | Midfielder | 130 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 4 | Forward | 25 | 7 of 10 (70.0%) | too small to read |
| 5 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 5 | Defender | 102 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 5 | Midfielder | 135 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 5 | Forward | 30 | 6 of 10 (60.0%) | 17 of 20 (85.0%) |
| 6 | Goalkeeper | 20 | 2 of 10 (20.0%) | too small to read |
| 6 | Defender | 103 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 6 | Midfielder | 140 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 6 | Forward | 32 | 3 of 10 (30.0%) | 15 of 20 (75.0%) |
| 7 | Goalkeeper | 18 | 6 of 10 (60.0%) | too small to read |
| 7 | Defender | 100 | 5 of 10 (50.0%) | 11 of 20 (55.0%) |
| 7 | Midfielder | 145 | 3 of 10 (30.0%) | 5 of 20 (25.0%) |
| 7 | Forward | 34 | 3 of 10 (30.0%) | 15 of 20 (75.0%) |
| 8 | Goalkeeper | 20 | 6 of 10 (60.0%) | too small to read |
| 8 | Defender | 99 | 4 of 10 (40.0%) | 10 of 20 (50.0%) |
| 8 | Midfielder | 141 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 8 | Forward | 31 | 5 of 10 (50.0%) | 16 of 20 (80.0%) |
| 9 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 9 | Defender | 99 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 9 | Midfielder | 145 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 9 | Forward | 35 | 2 of 10 (20.0%) | 14 of 20 (70.0%) |
| 10 | Goalkeeper | 20 | 7 of 10 (70.0%) | too small to read |
| 10 | Defender | 97 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 10 | Midfielder | 142 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 10 | Forward | 32 | 5 of 10 (50.0%) | 15 of 20 (75.0%) |
| 11 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 11 | Defender | 99 | 0 of 10 (0.0%) | 5 of 20 (25.0%) |
| 11 | Midfielder | 142 | 2 of 10 (20.0%) | 6 of 20 (30.0%) |
| 11 | Forward | 33 | 5 of 10 (50.0%) | 13 of 20 (65.0%) |
| 12 | Goalkeeper | 20 | 4 of 10 (40.0%) | too small to read |
| 12 | Defender | 101 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 12 | Midfielder | 140 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 12 | Forward | 36 | 3 of 10 (30.0%) | 12 of 20 (60.0%) |
| 13 | Goalkeeper | 20 | 4 of 10 (40.0%) | too small to read |
| 13 | Defender | 97 | 2 of 10 (20.0%) | 8 of 20 (40.0%) |
| 13 | Midfielder | 144 | 3 of 10 (30.0%) | 6 of 20 (30.0%) |
| 13 | Forward | 37 | 4 of 10 (40.0%) | 13 of 20 (65.0%) |
| 14 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 14 | Defender | 104 | 3 of 10 (30.0%) | 8 of 20 (40.0%) |
| 14 | Midfielder | 136 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 14 | Forward | 38 | 4 of 10 (40.0%) | 13 of 20 (65.0%) |
| 15 | Goalkeeper | 20 | 7 of 10 (70.0%) | too small to read |
| 15 | Defender | 111 | 1 of 10 (10.0%) | 8 of 20 (40.0%) |
| 15 | Midfielder | 139 | 2 of 10 (20.0%) | 8 of 20 (40.0%) |
| 15 | Forward | 35 | 2 of 10 (20.0%) | 13 of 20 (65.0%) |
| 16 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 16 | Defender | 103 | 0 of 10 (0.0%) | 4 of 20 (20.0%) |
| 16 | Midfielder | 137 | 3 of 10 (30.0%) | 8 of 20 (40.0%) |
| 16 | Forward | 34 | 4 of 10 (40.0%) | 15 of 20 (75.0%) |
| 17 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 17 | Defender | 101 | 3 of 10 (30.0%) | 6 of 20 (30.0%) |
| 17 | Midfielder | 132 | 2 of 10 (20.0%) | 3 of 20 (15.0%) |
| 17 | Forward | 38 | 7 of 10 (70.0%) | 16 of 20 (80.0%) |
| 18 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 18 | Defender | 97 | 0 of 10 (0.0%) | 6 of 20 (30.0%) |
| 18 | Midfielder | 132 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 18 | Forward | 37 | 5 of 10 (50.0%) | 15 of 20 (75.0%) |
| 19 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 19 | Defender | 100 | 0 of 10 (0.0%) | 5 of 20 (25.0%) |
| 19 | Midfielder | 129 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 19 | Forward | 36 | 2 of 10 (20.0%) | 13 of 20 (65.0%) |
| 20 | Goalkeeper | 21 | 7 of 10 (70.0%) | too small to read |
| 20 | Defender | 104 | 1 of 10 (10.0%) | 7 of 20 (35.0%) |
| 20 | Midfielder | 128 | 2 of 10 (20.0%) | 9 of 20 (45.0%) |
| 20 | Forward | 36 | 2 of 10 (20.0%) | 15 of 20 (75.0%) |
| 21 | Goalkeeper | 21 | 4 of 10 (40.0%) | too small to read |
| 21 | Defender | 107 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 21 | Midfielder | 128 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 21 | Forward | 31 | 4 of 10 (40.0%) | 13 of 20 (65.0%) |
| 22 | Goalkeeper | 20 | 3 of 10 (30.0%) | too small to read |
| 22 | Defender | 106 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 22 | Midfielder | 126 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 22 | Forward | 34 | 2 of 10 (20.0%) | 14 of 20 (70.0%) |
| 23 | Goalkeeper | 20 | 6 of 10 (60.0%) | too small to read |
| 23 | Defender | 111 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 23 | Midfielder | 130 | 1 of 10 (10.0%) | 3 of 20 (15.0%) |
| 23 | Forward | 37 | 3 of 10 (30.0%) | 12 of 20 (60.0%) |
| 24 | Goalkeeper | 20 | 6 of 10 (60.0%) | too small to read |
| 24 | Defender | 107 | 3 of 10 (30.0%) | 10 of 20 (50.0%) |
| 24 | Midfielder | 133 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 24 | Forward | 37 | 6 of 10 (60.0%) | 16 of 20 (80.0%) |
| 25 | Goalkeeper | 19 | 5 of 10 (50.0%) | too small to read |
| 25 | Defender | 100 | 0 of 10 (0.0%) | 6 of 20 (30.0%) |
| 25 | Midfielder | 134 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 25 | Forward | 40 | 7 of 10 (70.0%) | 13 of 20 (65.0%) |
| 26 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 26 | Defender | 101 | 4 of 10 (40.0%) | 7 of 20 (35.0%) |
| 26 | Midfielder | 137 | 4 of 10 (40.0%) | 7 of 20 (35.0%) |
| 26 | Forward | 37 | 4 of 10 (40.0%) | 14 of 20 (70.0%) |
| 27 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 27 | Defender | 101 | 1 of 10 (10.0%) | 8 of 20 (40.0%) |
| 27 | Midfielder | 134 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 27 | Forward | 36 | 5 of 10 (50.0%) | 15 of 20 (75.0%) |
| 28 | Goalkeeper | 20 | 5 of 10 (50.0%) | too small to read |
| 28 | Defender | 98 | 1 of 10 (10.0%) | 8 of 20 (40.0%) |
| 28 | Midfielder | 136 | 2 of 10 (20.0%) | 4 of 20 (20.0%) |
| 28 | Forward | 39 | 4 of 10 (40.0%) | 15 of 20 (75.0%) |
| 29 | Goalkeeper | 16 | 6 of 10 (60.0%) | too small to read |
| 29 | Defender | 90 | 5 of 10 (50.0%) | 11 of 20 (55.0%) |
| 29 | Midfielder | 116 | 2 of 10 (20.0%) | 10 of 20 (50.0%) |
| 29 | Forward | 34 | 5 of 10 (50.0%) | 12 of 20 (60.0%) |
| 30 | Goalkeeper | 18 | 7 of 10 (70.0%) | too small to read |
| 30 | Defender | 96 | 2 of 10 (20.0%) | 8 of 20 (40.0%) |
| 30 | Midfielder | 127 | 1 of 10 (10.0%) | 5 of 20 (25.0%) |
| 30 | Forward | 33 | 4 of 10 (40.0%) | 14 of 20 (70.0%) |
| 31 | Goalkeeper | 14 | 7 of 10 (70.0%) | too small to read |
| 31 | Defender | 74 | 0 of 10 (0.0%) | 4 of 20 (20.0%) |
| 31 | Midfielder | 112 | 2 of 10 (20.0%) | 5 of 20 (25.0%) |
| 31 | Forward | 29 | 4 of 10 (40.0%) | 14 of 20 (70.0%) |
| 32 | Goalkeeper | 19 | 5 of 10 (50.0%) | too small to read |
| 32 | Defender | 93 | 4 of 10 (40.0%) | 9 of 20 (45.0%) |
| 32 | Midfielder | 132 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 32 | Forward | 36 | 5 of 10 (50.0%) | 13 of 20 (65.0%) |
| 33 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 33 | Defender | 99 | 5 of 10 (50.0%) | 11 of 20 (55.0%) |
| 33 | Midfielder | 129 | 2 of 10 (20.0%) | 7 of 20 (35.0%) |
| 33 | Forward | 38 | 5 of 10 (50.0%) | 13 of 20 (65.0%) |
| 34 | Goalkeeper | 12 | too small to read | too small to read |
| 34 | Defender | 69 | 2 of 10 (20.0%) | 9 of 20 (45.0%) |
| 34 | Midfielder | 80 | 2 of 10 (20.0%) | 8 of 20 (40.0%) |
| 34 | Forward | 28 | 5 of 10 (50.0%) | 17 of 20 (85.0%) |
| 35 | Goalkeeper | 19 | 7 of 10 (70.0%) | too small to read |
| 35 | Defender | 101 | 4 of 10 (40.0%) | 10 of 20 (50.0%) |
| 35 | Midfielder | 121 | 1 of 10 (10.0%) | 4 of 20 (20.0%) |
| 35 | Forward | 37 | 5 of 10 (50.0%) | 14 of 20 (70.0%) |
| 36 | Goalkeeper | 18 | 8 of 10 (80.0%) | too small to read |
| 36 | Defender | 103 | 2 of 10 (20.0%) | 9 of 20 (45.0%) |
| 36 | Midfielder | 119 | 4 of 10 (40.0%) | 8 of 20 (40.0%) |
| 36 | Forward | 36 | 6 of 10 (60.0%) | 14 of 20 (70.0%) |
| 37 | Goalkeeper | 18 | 5 of 10 (50.0%) | too small to read |
| 37 | Defender | 99 | 1 of 10 (10.0%) | 6 of 20 (30.0%) |
| 37 | Midfielder | 129 | 3 of 10 (30.0%) | 7 of 20 (35.0%) |
| 37 | Forward | 36 | 4 of 10 (40.0%) | 13 of 20 (65.0%) |
| 38 | Goalkeeper | 19 | 5 of 10 (50.0%) | too small to read |
| 38 | Defender | 103 | 0 of 10 (0.0%) | 2 of 20 (10.0%) |
| 38 | Midfielder | 124 | 4 of 10 (40.0%) | 9 of 20 (45.0%) |
| 38 | Forward | 38 | 4 of 10 (40.0%) | 16 of 20 (80.0%) |

## Naive ranking baselines (ticket #159, Defect 1)

The season Spearman above has no comparator on its own — an absolute band was previously asserted from general intuition, not derived from anything about weekly FPL scoring. These three baselines are computed over the EXACT SAME measured population as the model's own ranking above (no separate population, no second Supabase read, and never `players.now_cost` — a 2026/27 price would be both a cross-season mismatch and a lookahead against these 2025/26 gameweeks). A model with real skill should beat them; one that does not is decoration, not signal.

- **Prior minutes per match** (`prior_minutes / prior_matches`) — the player who has played the most, stays.
- **Prior xG+xA per match** (`(prior_xg + prior_xa) / prior_matches`) — the player with the best underlying attacking numbers, stays.
- **Constant (zero-skill floor)** — every row ranked identically; the zero-skill floor, and a self-test of the correlation code itself (an implementation that scores a constant ranking WELL, rather than at exactly 0, is broken — see `computeConstantBaselineSpearman`).

| Ranking | Season | Goalkeeper | Defender | Midfielder | Forward |
|---|---|---|---|---|---|
| Model (projection) | 0.323 | 0.168 | 0.272 | 0.382 | 0.361 |
| Prior minutes per match | 0.299 | -0.003 | 0.232 | 0.388 | 0.402 |
| Prior xG+xA per match | 0.139 | 0.039 | 0.127 | 0.247 | 0.333 |
| Constant (zero-skill floor) | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |

### Verdict — model Spearman minus each baseline's (season aggregate)

A DIFFERENCE, never checked against an asserted threshold (ticket text) — the report states the number and stops there.

- Model (0.323) minus Prior minutes per match (0.299) = **0.023**
- Model (0.323) minus Prior xG+xA per match (0.139) = **0.184**
- Model (0.323) minus Constant (zero-skill floor) (0.000) = **0.323**

## Provenance

- players rows fetched: 629
- feature_history rows fetched (season=2025-2026): 18588
- player_match_stats rows fetched (season=2025-2026, competition=prem): 12754
- sanity bounds: mean absolute error in [1, 3.5]; derived clean-sheet rate ≤ 60% per position
- ranking sanity bounds (#147, extended by #159 to top-20): Spearman rank correlation in [-0.2, 0.9]; top-10 AND top-20 overlap ≤ 90%, at the season aggregate and every position
- top-N meaningfulness threshold (#159): a top-N figure is refused ("too small to read") when N exceeds 75% of the population it was drawn from — a judgement, not a derived bound

