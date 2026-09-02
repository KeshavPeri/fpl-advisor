# Baseline projection calibration report

Generated: 2026-09-02T07:42:47.617Z · Job: `calibration-report` · Model version: `baseline-v1` · Actuals season: `2025-2026`

This report measures the baseline-v1 projection model against last season's actual results. **It does not change the model.** See `docs/projection-model-backlog.md` and `product-brief.md` §6d.

## Why this comparison is imperfect

**Directional evidence, not a verdict** — four reasons:

1. **Different seasons, mostly different players.** `player_match_stats` holds 2025-2026 match data; `player_projections` holds `baseline-v1`'s 2026/27 output. This is a *distributional* comparison — does a defender score about this many points per 90 and does a forward score about that many — not a player-for-player check. This is not a point-in-time backtest (feature item 29); it uses full-season hindsight on both sides, which is invalid for judging any one prediction but fine for judging a position-level distribution.
2. **2025-2026 was played under the PREVIOUS BPS rules.** The 2026/27 BPS rebalance (CBI at 1 per 3 actions instead of 2, the tackled penalty removed, revised goalkeeper save BPS) changes who earns bonus. The actual side below still cannot see bonus at all regardless of which rules apply — see point 3.
3. **The actual side can never include bonus or cards.** `player_match_stats` (sourced from FPL-Core-Insights) has no `bonus` column and no `bps` column — verified directly from the source CSV header on 28 Aug 2026 (ticket #127) — so the actual figures below are a permanent **under-count**, not a temporary gap a future ingest could close. The FPL bonus system awards 6 points (3/2/1) to three players out of the ~22 who appear in a match — roughly **0.27 points per player-appearance on average**, concentrated among a match's standout performers rather than spread evenly, so this under-count is larger for the top of the distribution (the Top-20 tables below) than for the position means. Cards remain unmodelled on both sides.
4. **The projected side models bonus (ticket #78); this report excludes it from every total it compares (ticket #127), to stay like-for-like against a side that can never have it.** `scripts/project-points.ts` allocates a projected bonus share into `player_projections.expected_points`; this report subtracts `components.points.bonusPoints` back out before summing, averaging or ranking anything below — a reporting decision only, `player_projections` itself is never written to or altered — and prints the excluded amount alongside each projected total (the **By position: totals** and **Top scorers** tables below) so the reader can see the size of what was set aside rather than taking the adjustment on trust. A projection row whose components carry no `bonusPoints` key — every row written before ticket #78 — is treated as exactly zero excluded bonus, not dropped and not an error. This means the Top-20 tables now read a little lower than the total a player would actually see in-app, which is intentional: the comparison would otherwise be biased against the model by exactly the size of the bonus term, concentrated exactly where those tables look. Mean excluded bonus per player-appearance: **0.083 pts** (n=4360 projected rows), checked against the 0.05–1 bound — the arithmetic ceiling is 6 bonus points shared per match. Within bound.

The **By point component** table below is unaffected by any of this: it omits bonus/cards entirely (see its own note).

5. **The two sides are drawn from different populations, and the projected side is now weighted to match (ticket #155).** The actual side is a sample of real, realized player-matches — appearances that actually happened, drawn from `player_match_stats`. The projected side is an expectation over every projected player-gameweek, weighted by `pSixtyPlus` (the model's own probability, from recent match history, that a given player-gameweek reaches a genuine 60+-minute appearance) so it estimates the same quantity — "points and minutes conditional on the player appearing" — rather than diluting it with rows for players who rarely feature. This is deliberately NOT `pAppears`: `pAppears` is a pure fitness/availability signal (close to 1.0 for any healthy player, starter or benchwarmer alike) and cannot tell a fit, rarely-selected backup apart from a nailed starter — `pSixtyPlus` can, because it is built from the same recent-minutes history as avgMinutes. 0 of 4360 projected rows had no stored `pSixtyPlus` (written before ticket #109/#148) and fall back to the pre-#155 unweighted rate for that row alone — see the provenance section below. A sanity bound on the RATIO of projected to actual appearance points per 90 (`assertAppearancePointsPlausible`) fails this report outright, per position, if that ratio falls outside [0.8, 1.25] — a judgement range, not an arithmetic one (ticket #155 follow-up; the earlier absolute bound around a 2-points-per-appearance "ceiling" was wrong, since a sub earning 1 point for a third of a match alone pushes a per-90 rate well past 2.0). This is the guard that would have caught the pre-#155 run's 1.42x goalkeeper ratio. A ratio bound cannot catch an error that moves both sides the same way.

## Headline: are defenders over-projected?

**Projected:** defenders 3.66 pts/90 vs midfielders 4.21 and forwards 4.46 — defenders projected above both: **no**. **Actual (2025/26):** defenders 3.85 pts/90 vs midfielders 4.29 and forwards 4.78 — defenders actually scored above both: **no**.

## By position: totals

Every figure carries its sample size in parentheses. **Projected pts/90 is appearance-weighted (ticket #155)** — weighted by `pSixtyPlus`, the model's own probability, from recent match history, that a projected player-gameweek reaches a genuine 60+-minute appearance, so it estimates points and minutes conditional on the player appearing rather than the raw ratio of summed totals. See caveat 5 above.

| Position | Actual pts/appearance (n) | Actual pts/90 (matches, players) | Projected pts/90 (rows, players) | Excluded bonus pts/90 | Ratio (proj/actual) |
|---|---|---|---|---|---|
| Goalkeeper | 3.19 (n=675) | 3.10 (878 matches, 43 players) | 3.19 (490 rows, 71 players) | 0.29 | 1.03x |
| Defender | 3.20 (n=3091) | 3.85 (3401 matches, 139 players) | 3.66 (1438 rows, 207 players) | 0.19 | 0.95x |
| Midfielder | 2.88 (n=4479) | 4.29 (4801 matches, 192 players) | 4.21 (1922 rows, 278 players) | 0.17 | 0.98x |
| Forward | 2.74 (n=1112) | 4.78 (1194 matches, 48 players) | 4.46 (510 rows, 73 players) | 0.31 | 0.93x |

## Clean-sheet rate, by position

Ticket #132: the implied clean-sheet rate behind the actual clean-sheet pts/90 figure above, printed explicitly as a percentage so an implausible reading is visible without doing the division by hand — `Implied clean-sheet rate` is the `Actual clean-sheet pts/90` column divided by `Points per clean sheet`. A rate above 60% for any position is impossible and would have made this report fail before reaching this line (see `assertCleanSheetRatesPlausible`) — this is the check that would have caught the ~95% bug three times over. A row with a null `team_goals_conceded` is excluded from the eligible matches/minutes behind this table (180 such row(s) this run — see the provenance section below), never read as a clean sheet.

| Position | Actual clean-sheet pts/90 (eligible matches, minutes) | Points per clean sheet | Implied clean-sheet rate |
|---|---|---|---|
| Goalkeeper | 1.08 (857 matches, 58347 min) | 4 | 27% |
| Defender | 1.13 (3356 matches, 225611 min) | 4 | 28% |
| Midfielder | 0.28 (4699 matches, 265062 min) | 1 | 28% |
| Forward | 0.00 (1182 matches, 56578 min) | 0 | n/a |

## By point component

Per-90 rates, actual vs projected, so a gap in the totals above is attributable to a specific component rather than only visible in aggregate. **Every projected component is appearance-weighted (ticket #155), same construction as the totals table above.** Bonus and cards are omitted from this table: the actual side is fixed at exactly 0 for both (no data), and the projected side's bonus (non-zero since ticket #78) has no actual-side counterpart to compare it against here — see the caveats above for how the totals tables elsewhere in this report are affected instead.

### Goalkeeper

*Sample: 878 actual player-matches (675 with minutes played, 43 distinct players) vs 490 projected rows (71 distinct players).*

| Component | Actual pts/90 | Projected pts/90 | Ratio (proj/actual) |
|---|---|---|---|
| Appearance | 2.01 | 2.12 | 1.06x |
| Goals | 0.00 | 0.00 | n/a |
| Assists | 0.01 | 0.02 | 1.15x |
| Clean sheets | 1.08 | 0.99 | 0.92x |
| Goals conceded | -0.56 | -0.49 | 0.88x |
| Saves | 0.58 | 0.55 | 0.94x |
| Defensive contribution | 0.00 | 0.00 | n/a |

### Defender

*Sample: 3401 actual player-matches (3091 with minutes played, 139 distinct players) vs 1438 projected rows (207 distinct players).*

| Component | Actual pts/90 | Projected pts/90 | Ratio (proj/actual) |
|---|---|---|---|
| Appearance | 2.18 | 2.17 | 1.00x |
| Goals | 0.27 | 0.31 | 1.12x |
| Assists | 0.24 | 0.23 | 0.94x |
| Clean sheets | 1.13 | 0.97 | 0.86x |
| Goals conceded | -0.50 | -0.49 | 0.99x |
| Saves | 0.00 | 0.00 | n/a |
| Defensive contribution | 0.53 | 0.48 | 0.90x |

### Midfielder

*Sample: 4801 actual player-matches (4479 with minutes played, 192 distinct players) vs 1922 projected rows (278 distinct players).*

| Component | Actual pts/90 | Projected pts/90 | Ratio (proj/actual) |
|---|---|---|---|
| Appearance | 2.41 | 2.32 | 0.96x |
| Goals | 0.77 | 0.81 | 1.05x |
| Assists | 0.51 | 0.51 | 1.01x |
| Clean sheets | 0.28 | 0.25 | 0.91x |
| Goals conceded | 0.00 | 0.00 | n/a |
| Saves | 0.00 | 0.00 | n/a |
| Defensive contribution | 0.33 | 0.32 | 0.96x |

### Forward

*Sample: 1194 actual player-matches (1112 with minutes played, 48 distinct players) vs 510 projected rows (73 distinct players).*

| Component | Actual pts/90 | Projected pts/90 | Ratio (proj/actual) |
|---|---|---|---|
| Appearance | 2.63 | 2.43 | 0.92x |
| Goals | 1.74 | 1.75 | 1.00x |
| Assists | 0.40 | 0.28 | 0.70x |
| Clean sheets | 0.00 | 0.00 | n/a |
| Goals conceded | 0.00 | 0.00 | n/a |
| Saves | 0.00 | 0.00 | n/a |
| Defensive contribution | 0.01 | 0.01 | 1.36x |

## Distributions: top scorers vs top projections, by position

A mean can match while the spread is wrong, and the spread is what drives a recommendation — the captain is by definition the highest-projected player. These are independent rankings (2025/26 actual total points vs baseline-v1 mean expected points per player), not paired by player.

#### Goalkeeper

**Top 20 actual scorers (2025/26, total points)**

| # | Player | Total pts | Matches |
|---|---|---|---|
| 1 | Raya | 152 | 37 |
| 2 | Donnarumma | 133 | 34 |
| 3 | Petrović | 124 | 38 |
| 4 | Verbruggen | 124 | 38 |
| 5 | Henderson | 124 | 37 |
| 6 | Pickford | 123 | 38 |
| 7 | Roefs | 123 | 35 |
| 8 | Leno | 119 | 38 |
| 9 | Kelleher | 118 | 37 |
| 10 | Sánchez | 112 | 36 |
| 11 | Martinez | 109 | 32 |
| 12 | Sels | 98 | 31 |
| 13 | Lammens | 98 | 32 |
| 14 | Pope | 91 | 32 |
| 15 | Dubravka | 89 | 38 |
| 16 | A.Becker | 85 | 26 |
| 17 | Vicario | 84 | 33 |
| 18 | Darlow | 69 | 23 |
| 19 | Perri | 39 | 29 |
| 20 | Mamardashvili | 26 | 17 |

**Top 20 projected players (baseline-v1, mean expected points, bonus excluded)**

| # | Player | Mean expected pts (excl. bonus) | Excluded bonus | Rows |
|---|---|---|---|---|
| 1 | Raya | 3.82 | 0.26 | 7 |
| 2 | Lammens | 3.43 | 0.24 | 7 |
| 3 | Donnarumma | 3.38 | 0.24 | 7 |
| 4 | Petrović | 3.27 | 0.32 | 7 |
| 5 | Pope | 3.25 | 0.32 | 7 |
| 6 | Pickford | 3.18 | 0.32 | 7 |
| 7 | Kelleher | 3.17 | 0.27 | 7 |
| 8 | Leno | 3.06 | 0.30 | 7 |
| 9 | A.Becker | 3.06 | 0.24 | 7 |
| 10 | Martinez | 3.06 | 0.29 | 7 |
| 11 | Sánchez | 3.02 | 0.25 | 7 |
| 12 | Sels | 3.00 | 0.28 | 7 |
| 13 | Horníček | 3.00 | 0.31 | 7 |
| 14 | Verbruggen | 2.86 | 0.26 | 7 |
| 15 | Henderson | 2.85 | 0.35 | 7 |
| 16 | Tzolakis | 2.78 | 0.35 | 7 |
| 17 | Scherpen | 2.77 | 0.31 | 7 |
| 18 | Rushworth | 2.76 | 0.25 | 7 |
| 19 | Darlow | 2.62 | 0.17 | 7 |
| 20 | Kinsky | 2.58 | 0.25 | 7 |

#### Defender

**Top 20 actual scorers (2025/26, total points)**

| # | Player | Total pts | Matches |
|---|---|---|---|
| 1 | Gabriel | 183 | 32 |
| 2 | Guéhi | 171 | 35 |
| 3 | Virgil | 170 | 38 |
| 4 | Senesi | 169 | 37 |
| 5 | Tarkowski | 166 | 37 |
| 6 | O'Reilly | 154 | 34 |
| 7 | Van Hecke | 151 | 36 |
| 8 | Lacroix | 151 | 36 |
| 9 | Truffert | 150 | 38 |
| 10 | Mukiele | 149 | 33 |
| 11 | J.Timber | 145 | 30 |
| 12 | Matheus N. | 141 | 35 |
| 13 | Chalobah | 135 | 35 |
| 14 | Muñoz | 135 | 29 |
| 15 | Mitchell | 133 | 38 |
| 16 | Collins | 129 | 37 |
| 17 | Richards | 129 | 33 |
| 18 | Alderete | 128 | 35 |
| 19 | Saliba | 127 | 31 |
| 20 | Keane | 126 | 34 |

**Top 20 projected players (baseline-v1, mean expected points, bonus excluded)**

| # | Player | Mean expected pts (excl. bonus) | Excluded bonus | Rows |
|---|---|---|---|---|
| 1 | Guéhi | 5.50 | 0.28 | 7 |
| 2 | O'Reilly | 4.78 | 0.23 | 7 |
| 3 | Maguire | 4.49 | 0.21 | 7 |
| 4 | Gabriel | 4.42 | 0.23 | 7 |
| 5 | Hill | 4.29 | 0.25 | 7 |
| 6 | De Cuyper | 4.26 | 0.25 | 7 |
| 7 | Collins | 4.22 | 0.20 | 7 |
| 8 | Virgil | 4.14 | 0.22 | 7 |
| 9 | White | 4.12 | 0.22 | 7 |
| 10 | Rúben | 4.04 | 0.23 | 7 |
| 11 | Khusanov | 3.94 | 0.19 | 7 |
| 12 | Calafiori | 3.90 | 0.20 | 7 |
| 13 | Thiaw | 3.90 | 0.20 | 7 |
| 14 | Botman | 3.88 | 0.20 | 7 |
| 15 | Tarkowski | 3.81 | 0.19 | 7 |
| 16 | Shaw | 3.81 | 0.18 | 7 |
| 17 | Hall | 3.76 | 0.24 | 7 |
| 18 | Silva | 3.71 | 0.23 | 7 |
| 19 | Senesi | 3.60 | 0.17 | 7 |
| 20 | Mosquera | 3.55 | 0.19 | 7 |

#### Midfielder

**Top 20 actual scorers (2025/26, total points)**

| # | Player | Total pts | Matches |
|---|---|---|---|
| 1 | B.Fernandes | 203 | 35 |
| 2 | Semenyo | 193 | 37 |
| 3 | Gibbs-White | 172 | 37 |
| 4 | Anderson | 172 | 38 |
| 5 | Rice | 164 | 37 |
| 6 | Rogers | 159 | 37 |
| 7 | Garner | 158 | 38 |
| 8 | Wilson | 153 | 36 |
| 9 | Szoboszlai | 152 | 36 |
| 10 | Enzo | 148 | 36 |
| 11 | Saka | 141 | 32 |
| 12 | Dewsbury-Hall | 139 | 31 |
| 13 | Bruno G. | 138 | 29 |
| 14 | E.Le Fée | 137 | 36 |
| 15 | Mbeumo | 135 | 33 |
| 16 | Fernandes | 135 | 36 |
| 17 | Scott | 134 | 37 |
| 18 | Ampadu | 133 | 35 |
| 19 | Gravenberch | 132 | 36 |
| 20 | Cunha | 130 | 34 |

**Top 20 projected players (baseline-v1, mean expected points, bonus excluded)**

| # | Player | Mean expected pts (excl. bonus) | Excluded bonus | Rows |
|---|---|---|---|---|
| 1 | B.Fernandes | 7.27 | 0.42 | 7 |
| 2 | Mbeumo | 5.60 | 0.31 | 7 |
| 3 | Saka | 5.22 | 0.30 | 7 |
| 4 | Szoboszlai | 5.06 | 0.27 | 7 |
| 5 | Palmer | 4.67 | 0.22 | 7 |
| 6 | Gakpo | 4.50 | 0.21 | 7 |
| 7 | Rogers | 4.48 | 0.20 | 7 |
| 8 | Tavernier | 4.43 | 0.25 | 7 |
| 9 | Ndiaye | 4.29 | 0.20 | 7 |
| 10 | Anderson | 4.27 | 0.15 | 7 |
| 11 | Scott | 4.25 | 0.19 | 7 |
| 12 | Foden | 4.20 | 0.22 | 7 |
| 13 | Bruno G. | 4.13 | 0.19 | 7 |
| 14 | Lewis-Potter | 4.04 | 0.19 | 7 |
| 15 | Stach | 3.91 | 0.14 | 7 |
| 16 | Schade | 3.86 | 0.18 | 7 |
| 17 | Enzo | 3.84 | 0.16 | 7 |
| 18 | Dewsbury-Hall | 3.81 | 0.16 | 7 |
| 19 | Rice | 3.77 | 0.14 | 7 |
| 20 | Cunha | 3.72 | 0.15 | 7 |

#### Forward

**Top 20 actual scorers (2025/26, total points)**

| # | Player | Total pts | Matches |
|---|---|---|---|
| 1 | Haaland | 200 | 36 |
| 2 | Thiago | 168 | 38 |
| 3 | João Pedro | 152 | 35 |
| 4 | Watkins | 145 | 37 |
| 5 | Calvert-Lewin | 127 | 35 |
| 6 | Welbeck | 117 | 37 |
| 7 | Gyökeres | 117 | 36 |
| 8 | Evanilson | 111 | 36 |
| 9 | Richarlison | 107 | 33 |
| 10 | Mateta | 103 | 32 |
| 11 | Igor Jesus | 103 | 37 |
| 12 | Ekitiké | 103 | 28 |
| 13 | Woltemade | 98 | 34 |
| 14 | Šeško | 94 | 30 |
| 15 | Beto | 92 | 37 |
| 16 | Barry | 89 | 38 |
| 17 | Brobbey | 86 | 31 |
| 18 | Georginio | 79 | 36 |
| 19 | Strand Larsen | 78 | 36 |
| 20 | Wilson | 74 | 34 |

**Top 20 projected players (baseline-v1, mean expected points, bonus excluded)**

| # | Player | Mean expected pts (excl. bonus) | Excluded bonus | Rows |
|---|---|---|---|---|
| 1 | Haaland | 5.06 | 0.44 | 7 |
| 2 | Thiago | 4.98 | 0.42 | 7 |
| 3 | João Pedro | 4.48 | 0.33 | 7 |
| 4 | Gonzalo | 3.86 | 0.34 | 7 |
| 5 | Calvert-Lewin | 3.65 | 0.27 | 7 |
| 6 | Havertz | 3.41 | 0.26 | 7 |
| 7 | N.Jackson | 3.36 | 0.28 | 7 |
| 8 | Evanilson | 3.34 | 0.26 | 7 |
| 9 | Igor Jesus | 3.24 | 0.20 | 7 |
| 10 | Isak | 3.23 | 0.27 | 7 |
| 11 | Richarlison | 3.12 | 0.19 | 7 |
| 12 | Barry | 3.07 | 0.24 | 7 |
| 13 | McBurnie | 3.04 | 0.20 | 7 |
| 14 | Awoniyi | 2.89 | 0.22 | 7 |
| 15 | Nketiah | 2.89 | 0.23 | 7 |
| 16 | Šeško | 2.82 | 0.20 | 7 |
| 17 | Brobbey | 2.72 | 0.11 | 7 |
| 18 | Wissa | 2.50 | 0.20 | 7 |
| 19 | Thomas-Asante | 2.48 | 0.15 | 7 |
| 20 | Woltemade | 2.47 | 0.13 | 7 |

## What this bears on, in `docs/projection-model-backlog.md`

- **G3 (bonus):** addressed by ticket #78 (bonus now modelled) and restored to a fair comparison by ticket #127 (this report excludes projected bonus from every total it compares, because the actual side can never carry it — verified, no `bonus` or `bps` column in the source). See the caveats section above for the mean excluded bonus and its bound check.
- **G6 (last season's behaviour under this season's rules):** this report is itself an instance of the residual risk G6 names — the actual side is scored under 2026/27 rules applied to 2025/26 raw actions, exactly as `src/lib/scoring/` is built to do, but the *behaviour* that produced those raw actions was not shaped by 2026/27 incentives.
- **G1 (goalkeeper saves not fixture-scaled) and G2 (45% of players have no history):** this report does not test either — G1 needs a fixture-level breakdown this position-level comparison does not do, and G2 is about which players get a signal at all, not about the calibration of the signal players do have. Not confirmed or refuted here.

## Sample sizes and data provenance

- players rows fetched: 629
- player_match_stats rows fetched (season=2025-2026, competition=prem): 12754
- player_match_stats rows excluded as non-Premier-League (season=2025-2026, competition known and != prem): 2586
- player_match_stats rows excluded for a null competition (season=2025-2026, not yet re-stamped since ticket #54): 0
- player_match_stats rows skipped (no player_code, or player_code not found in players): 2480
- player_match_stats rows with a null team_goals_conceded (ticket #132): 180 — excluded from the clean-sheet and goals-conceded figures only (see the Clean-sheet rate section above); every other component for these rows is still counted normally, never read as zero conceded
- player_projections rows fetched (model_version=baseline-v1): 4360
- player_projections rows skipped (player_id not found in players): 0
- player_projections rows appearance-weighted, pSixtyPlus present (ticket #155): 4360
- player_projections rows using the pre-#155 unweighted fallback, pSixtyPlus absent (ticket #155): 0

