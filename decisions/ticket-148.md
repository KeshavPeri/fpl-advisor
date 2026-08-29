# Ticket #148 — Calibrate assist conversion per position

## HIGH-IMPACT

- **Chose four position-specific assist conversion factors (GK 2.30x, DEF 1.30x, MID 1.33x, FWD 2.12x)
  rather than one flat factor, because the measured ratios are not close together** — forwards measure
  at roughly double defenders/midfielders (2.12x vs 1.30–1.33x), corroborated independently by both the
  backtest's signed-error figures and the calibration report's per-position proj/actual ratios cited in
  the ticket. A single fitted factor would over-correct defenders/midfielders and under-correct
  forwards, exactly the comparison a captaincy decision turns on. The ticket's own instruction was to
  let the measurement decide the shape of the fix, and it decided against one factor.

  Measured directly from FPL-Core-Insights' 2025-2026 per-gameweek player-match CSVs (the same source
  `scripts/ingest-core-insights.ts` ingests), filtered to Premier League only, joined to that season's
  own `players.csv` for position. Ratio = actual assists / Σ xA:

  | Position | Actual assists | Σ xA | Ratio | Sample |
  |---|---|---|---|---|
  | Goalkeeper | 5 | 2.170866 | 2.30 | n=1026 player-matches, 56 players — thin, 5 events total |
  | Defender | 237 | 182.908110 | 1.30 | n=4450 player-matches, 189 players |
  | Midfielder | 593 | 444.415323 | 1.33 | n=5763 player-matches, 254 players |
  | Forward | 107 | 50.556239 | 2.12 | n=1515 player-matches, 66 players |

  This triangulates against the ticket's own calibration-report figures (DEF 0.74x, MID 0.78x, FWD
  0.43x proj/actual invert to ≈1.35x/1.28x/2.33x actual/proj) — different data, different method, same
  direction and similar magnitude.

- **Clamped the factor to [1.0, 2.5], applied at the point of use, because the underlying mechanism is
  strictly additive and the goalkeeper sample is thin.** The mechanism (xA not crediting penalties won,
  own goals forced, second assists) can only push actual assists above xA, never below — so 1.0 is the
  correct floor; a factor below it would contradict both the mechanism and the near-1.0x goals
  comparison, which needed no downward correction. 2.5 sits comfortably above the largest well-supported
  ratio (forward, 2.12x, n=107) while still containing a thin future sample — the goalkeeper row itself
  (2.30x from just 5 events) is exactly the kind of measurement this bound exists to guard against; it
  happens to clear 2.5 this season but a different season's handful of GK assists easily might not.

## ROUTINE

- Placed the four named constants and the `assistConversionFactor()` helper in `expectedPoints.ts`
  rather than `pointValues.ts`, because `pointValues.ts`'s own header restricts it to verified FPL rules
  values, not model-calibration constants — the calibration factor sits with the other calibration
  multipliers (`attackMultiplier`, `savesMultiplier`) already in `expectedPoints.ts`.
- Goalkeeper assist term handled via an explicit `switch` case rather than falling through to a shared
  default, per the definition of done.
