# Ticket #133 — Build the backtest harness — so the model can be measured on what it could actually have known

## HIGH-IMPACT

- **The ticket as a whole is Tier 2** per its own framing — it establishes the measurement other
  model work will be judged by.
- **How a projection is built from `feature_history`'s cumulative totals, given no per-match history
  exists there.** Because the ticket requires using `src/lib/projection/` unmodified but
  `feature_history` stores only season-to-date sums — no last-five-match window, no per-match
  defensive-contribution hit/miss, no fixture or ClubElo data per row — three approximations were
  made: (a) rates (xG, xA, saves, CBI, recoveries) are computed **exactly** from the cumulative
  totals, since the shrinkage formula is already generic in the underlying count — no information is
  lost here; (b) minutes and defensive-contribution hit rate are estimated by feeding one *averaged*
  "typical match" into the existing per-match minutes/defcon-rate modules, a real approximation
  documented at length in the job's file header and in `docs/projection-model-backlog.md`'s new
  section; (c) every projection uses a **neutral fixture** (`fplDifficulty=3` → `expectedScore=0.5`
  → every multiplier exactly 1.0), since no per-row fixture data exists — mathematically exact as
  "no fixture effect assumed," not a hand-picked fudge; (d) every player is assumed **fully
  available**, since no historical daily-status signal exists for a past season and using today's
  status would itself be a form of lookahead.
  **QA's independent review adds one nuance worth carrying forward**: averaging to one "typical
  match" collapses the minutes model's `pSixtyPlus` figure to a binary 0-or-1 depending only on
  whether the *average* clears 60 minutes, which understates the true 60+ rate for a bimodal
  rotation/impact-sub player (e.g. alternating 90/20 minutes reads as 0% rather than the true ~60%).
  The same collapse also caps the defensive-contribution shrinkage denominator at at most one
  synthetic match regardless of a player's real appearance count, pulling high-appearance players'
  defcon projections further toward the position prior than the live pipeline would. Both effects
  are consistent with what the header discloses qualitatively, not contradicted by it, but the
  specific mechanism is worth a human's attention before trusting the report's per-position defcon
  breakdown too literally.

## ROUTINE

- Env var named `BACKTEST_SEASON` (job-specific, trimmed, defaults to `2025-2026`) — matches
  `FEATURE_HISTORY_SEASON`'s convention without sharing the variable.
- `BACKTEST_REPORT_PATH` default `./out/backtest-report.md`, matching `CALIBRATION_REPORT_PATH`'s
  pattern.
- On a sanity-bound failure, the report file is still written for diagnosis but the job exits
  non-zero and `job_runs.status = 'failure'` — matching `calibration-report.yml`'s precedent that the
  report is most useful when the job failed partway.
- New workflow file `backtest.yml` rather than folding into an existing one, for the same
  collision-avoidance reason `calibration-report.yml` gives.
- Extracted a pure `classifyRow` function, not requested verbatim by the ticket, so the two named
  population-exclusion rules are directly unit-testable and are the single source of truth `main()`
  also uses.
- Position priors are computed per (gameweek, position) from that same gameweek's cross-player
  `feature_history` rows only — the only way to get a shrinkage prior with zero lookahead, since
  every input to it is itself already strictly-before that gameweek by `feature_history`'s own
  construction.
