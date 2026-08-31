# Ticket #162 — Calibrate goal conversion per position

## HIGH-IMPACT

- **Added a per-position goal conversion factor to `expectedGoals`, because the calibration
  report of 30 Aug 2026 showed defender goals over-projected by 38% (projected 0.38 pts/90 vs
  actual 0.27), while midfielders and forwards were already calibrated at ~1.02x.** Direct
  measurement from FPL-Core-Insights `playermatchstats.csv` (season 2025-2026, Premier League
  matches only, same method as merged #148 — reproduces #148's own assist figures exactly)
  gave actual-goals-over-summed-xG ratios of: goalkeeper undefined (0 goals / 0.16 xG,
  n=1026 player-matches), defender 0.757480 (n=4450, 189 players), midfielder 0.982929
  (n=5763, 254 players), forward 0.974892 (n=1515, 66 players). These are applied as
  `GOAL_CONVERSION_GOALKEEPER/DEFENDER/MIDFIELDER/FORWARD = 1.0/0.76/0.98/0.97`, with
  goalkeeper explicitly labelled no-information (not measured) since 0/0.16 is not a real
  ratio. This is Tier 2 — it changes the projection model every recommendation rests on. It
  affects `docs/projection-model-backlog.md` item G7 (whether a defender is ever the right
  captain) by cutting defender goal output by roughly a quarter, but does not settle G7:
  defender projections are still dominated by appearance, clean sheet and defensive
  contribution, not goals.

## ROUTINE

- Clamp bounds for the goal conversion factor set to `[0.5, 1.5]` — a judgement call, not a
  measured figure. Chosen to sit comfortably outside the measured range (0.757–1.0) without
  binding any of the four constants, mirroring the precedent set by #148's assist-conversion
  clamp. The upper bound is deliberately not capped at 1.0, since a position could genuinely
  out-convert its xG.
- The private, unexported `assertNeverPosition` helper (already used by `assistConversionFactor`)
  is now shared by the new goal-conversion switch too; its error message was generalized from
  assist-specific wording to generic "unhandled position code" wording. No behavioural or
  signature change — it is unexported and unreachable at runtime for valid positions.
