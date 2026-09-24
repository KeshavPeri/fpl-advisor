## Why

Run 2 adds market-odds features to `gbm-v1` (ticket R2-T1 in `docs/model-diagnosis-2026-09-24.md` §8).
That needs two things this ticket builds: a converter from 1X2 probabilities to each team's expected
goals (λ), and four seasons of historical odds keyed on FPL team `code` so the model can train on them.

Source: penaltyblog `goal_expectancy` and opisthokonta.net "Expected goals from bookmaker odds" —
independent-Poisson fit to the 1X2 (and optionally over/under 2.5) prices.

Historical odds are committed at `model/data/odds/E0_{2223,2324,2425,2526,2627}.csv`
(football-data.co.uk; 380 matches per finished season, 50 so far for 2026-27).

## Measured already (24 Sept, on the committed CSVs)

- λ from **1X2 only** ranks fixtures almost exactly like λ from 1X2 + over/under 2.5: Spearman of
  λ_against 0.995–0.998 in every season. But 1X2-only runs low on total goals (≈2.58 vs actual ≈2.8
  per match), so its mean `exp(−λ_against)` overshoots the real clean-sheet rate by 0.035–0.070.
- With over/under 2.5 added, the clean-sheet rate is within 0.002–0.040 of actual in all four seasons.
- **Decision (logged, not yours to revisit):** the live `fixture_odds` table has 1X2 only, so the
  output λ columns are computed **from 1X2 only**, for both history and live. Training and live must
  see the same feature. A tree model only needs the ranking, which 1X2 gets right. The O/U path
  exists in `goal_expectancy` and is tested, but is not used for the output columns.

## Build

- `implied.py`
  - `remove_overround(odds) -> probs` — proportional, same as `removeOverround` in
    `src/lib/projection/marketOdds.ts` (lines 75–86).
  - `goal_expectancy(p_home, p_draw, p_away, p_over25=None) -> (lambda_home, lambda_away)` —
    least squares on independent Poisson (goals 0–10), `scipy.optimize.minimize` L-BFGS-B, bounds
    [0.05, 5.0], start (1.3, 1.1).
- `team_names.py` — this exact dict, no fuzzy matching, unmapped names skipped and counted:
  Arsenal 3, Aston Villa 7, Bournemouth 91, Brentford 94, Brighton 36, Burnley 90, Chelsea 8,
  Coventry 9, Crystal Palace 31, Everton 11, Fulham 54, Hull 88, Ipswich 40, Leeds 2, Leicester 13,
  Liverpool 14, Luton 102, Man City 43, Man United 1, Newcastle 4, Nott'm Forest 17,
  Sheffield United 49, Southampton 20, Sunderland 56, Tottenham 6, West Ham 21, Wolves 39.
  (Checked against vaastav `teams.csv` at SHA `9779cdbc0c07f6c900c2d0c181ddf6bb9c800f88`, all five
  seasons; these are the only 27 names in the five CSVs.)
- `history.py` — `load_odds_history() -> pd.DataFrame` reads every `model/data/odds/E0_*.csv`
  (`encoding='latin-1'`). **Read columns by name, never position** — positions differ by season.
  Use `AvgH/AvgD/AvgA`, falling back to `B365H/B365D/B365A` per row if missing. `Date` is
  `dd/mm/yyyy`. Output exactly the contract columns: `season, gw, kickoff_date, home_code,
  away_code, p_home, p_draw, p_away, lambda_home, lambda_away, source`. `gw` may be left null here
  (R2-T1 joins on date ±1 day and team codes). `source = 'football-data'`.

## Definition of done — offline only

`cd model && pip install pandas numpy scipy pytest && python -m pytest tests/test_fpl_odds_implied.py tests/test_fpl_odds_history.py`
passes, with these tests:
1. Symmetric input (p_home = p_away) gives λ_home = λ_away within 0.01.
2. (0.45, 0.28, 0.29) normalised gives λ_home in [1.25, 1.45] and λ_away in [0.90, 1.10]
   (penaltyblog reference 1.342 / 1.019; measured 1.343 / 1.021).
3. Round trip: 1X2 from a known λ pair, solved back, |Δλ| < 0.01.
4. All 380 rows of each finished season map to two team codes; zero unmapped names.
5. Per finished season, λ from 1X2 + O/U gives mean `exp(−λ_against)` within 0.05 of the actual
   clean-sheet rate from `FTHG/FTAG`.
6. Per finished season, Spearman between 1X2-only and 1X2+O/U λ_against is ≥ 0.98.

## Post-merge owner check (does not block this PR)

None.

## Files

All new: `model/fpl_odds/{__init__,implied,history,team_names}.py`,
`model/tests/test_fpl_odds_implied.py`, `model/tests/test_fpl_odds_history.py`.
Must not import `fpl_model`. Must not create or edit `model/requirements.txt`, `model/README.md`,
`.gitignore`, `feature-list.md`, or anything under `model/fpl_model/`, `model/data/`,
`model/reference/`.
