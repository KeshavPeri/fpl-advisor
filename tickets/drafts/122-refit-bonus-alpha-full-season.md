## Problem

`ALPHA` in `src/lib/projection/bonus.ts` was fitted on **one gameweek**.

Ticket #241 sharpened the bonus share from a linear proportional split to
`excess^ALPHA`, fitting ALPHA on gameweek 2 (n = 616) and scoring it on
gameweek 3 (n = 652) held out. That was the honest thing to do with the data
available — `gameweek_live_stats` (#224) reads FPL's `event/{gw}/live/`
endpoint, which serves the current season only, so three gameweeks was the
entire universe. #241's own comment says the instrument "gains exactly one
gameweek per week" and asks for a re-fit at ten gameweeks.

That is no longer true. `public.player_gameweek_history` now carries real
per-gameweek `bonus` and `bps` for the **complete 2025-2026 season** —
roughly 29,979 player-gameweek rows against the 1,268 ALPHA was fitted and
scored on. A one-parameter fit on a single gameweek, when 38 are available,
is a number we should not be shipping.

## The work

Re-fit `ALPHA` against the full 2025-2026 season, with a real holdout.

- **Fit** on gameweeks 1–28 of 2025-2026.
- **Score** on gameweeks 29–38, held out and never touched by the fit.
- **`player_gameweek_history.bonus` and `.bps` are SEASON-CUMULATIVE-TO-DATE
  snapshots, not per-gameweek totals** (verified by #248, which traced a
  player's rows across consecutive gameweeks and found them monotonic).
  Difference consecutive rows for the same `player_code` and `season` to get
  a gameweek's own bonus. A player's first appearance in the season is his
  own baseline. Reading a row as a single gameweek's total is the single
  easiest way to get this ticket completely wrong — assert the differencing
  with a named test before anything else.
- Fit by minimising absolute mean signed error on the **top-20-projected**
  population per gameweek, exactly the objective #241 used, so the two
  numbers are comparable.
- Projected bonus for a past season must be **reconstructed point-in-time**,
  never read from `player_projections` (which holds 2026/27 only). Reuse
  `expectedBps`, `nonAppearanceBps` and `allocateFixtureBonus` from
  `bonus.ts` unmodified, driven from `feature_history`/`player_match_stats`
  the same way `scripts/run-backtest.ts` drives the rest of the model. Do not
  write a second projection path.

Extend `scripts/bonus-validation-report.ts` to read
`player_gameweek_history` for past seasons while keeping its existing
`gameweek_live_stats` path for the current one. Report which source each
season came from — a report that silently mixes two instruments is worse than
one that names them.

Record in ALPHA's doc comment: the fitted value, both populations and their
sizes, the fit/holdout split, the previous value and its one-gameweek
provenance, and the date. **Tier 2, log HIGH-IMPACT.**

## Falsification gate

The premise is that a one-gameweek fit is unreliable. Two figures must move,
both measured on the **held-out gameweeks 29–38 of 2025-2026**:

1. The top-20 mean absolute signed error under the re-fitted ALPHA must be
   **lower** than under the current ALPHA, measured on the same held-out
   rows. If it is not, the one-gameweek fit was already right, ALPHA does not
   change, and that is a valid result — ship the report and say so.
2. The all-players mean signed error must stay within **0.020** in absolute
   terms, and the mean per-fixture allocated total must stay **above 5.70**.
   Both are #241's own guards against trading the level for the shape, and
   both still apply.

**Stop and report** if the reconstructed projected-bonus figures for
gameweeks 2 and 3 of 2026-2027 do not reproduce #241's published numbers —
projected 0.338 and 0.334 for the top 20 — within **0.02**. Same model, same
data; if it does not reproduce, the reconstruction is wrong and no fit from
it can be trusted.

Paste the full before-and-after report into the PR body.

## Definition of done — offline only

Everything here must be doable with no credentials and no network.

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: cumulative bonus/bps are differenced correctly, including a
  player's first gameweek and a gap where he has no row; the fit/holdout split
  never overlaps; a season with no `player_gameweek_history` rows falls back
  to `gameweek_live_stats` and says so; ALPHA = 1 still reproduces the pre-#241
  linear allocation exactly.
- The fit itself runs offline against the two public FPL-Core-Insights CSVs
  (`playerstats.csv` and the per-gameweek `playermatchstats.csv`), fetched
  directly — the same route #248 used. It must NOT read Supabase.
- `docs/projection-model-backlog.md`'s G3 entry updated with the full-season
  measurement.

## Post-merge owner check (does not block this PR)

Keshav re-runs `scripts/bonus-validation-report.ts` against live data and
pastes the result. This is a confirmation, not a gate. **Do not put it in the
Definition of Done and do not block on it.**

## Out of scope

- `expectedBps` and `nonAppearanceBps`. This ticket changes how shares are
  SPREAD, never how BPS is estimated. If the fit says the problem is in the
  BPS estimate, stop and report rather than widening scope.
- Predicting exact 1st/2nd/3rd placings.
- `src/lib/projection/expectedPoints.ts`, `teamStrength.ts`, `fixture.ts`,
  `scripts/project-points.ts`, `scripts/preflight-check.ts`,
  `scripts/team-strength-diagnostic.ts`,
  `scripts/recommendation-scorecard.ts`, `scripts/ingest-core-insights.ts`.

## Files

- `src/lib/projection/bonus.ts`
- `src/lib/projection/bonus.test.ts`
- `scripts/bonus-validation-report.ts`
- `scripts/bonus-validation-report.test.ts`
- `docs/projection-model-backlog.md`
