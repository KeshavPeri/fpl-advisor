# Ticket #182 — Damp the attacking fixture multiplier to its measured slope

## HIGH-IMPACT

- **Damped `attackingMultiplier` from `2 × expectedScore` to `ATTACKING_MULTIPLIER_OFFSET +
  expectedScore` (`ATTACKING_MULTIPLIER_OFFSET = 0.5`), clamp bounds unchanged at `[0, 2]`.**
  Because: the current 2× slope is measured at roughly twice the real goals-vs-`expectedScore`
  relationship. Reproduced bucket table from `docs/model-review-2026-09-02.md` §1b
  (2025-2026 Premier League matches, FPL-Core-Insights, n = 698 team-matches):

  | es bucket | n | mean es | actual goals | old model (2×es) |
  |---|---|---|---|---|
  | 0.00–0.35 | 123 | 0.251 | 1.04 | 0.50 |
  | 0.35–0.45 | 138 | 0.401 | 1.23 | 0.80 |
  | 0.45–0.55 | 176 | 0.500 | 1.35 | 1.00 |
  | 0.55–0.65 | 138 | 0.599 | 1.61 | 1.20 |
  | 0.65–1.01 | 123 | 0.749 | 1.75 | 1.50 |

  Endpoint slope: `(1.75 − 1.04) / (0.749 − 0.251) ≈ 1.43`. The Builder independently
  reproduced this arithmetic (endpoint slope 1.4257, whole-table weighted least squares ≈1.50)
  and confirmed the damped form `0.5 + es` matches the bucket means within −0.10 to +0.02 across
  all five buckets — no material disagreement with the review, so the ticket proceeded rather
  than stopping. The damped form overstated attacking output by ~24% at the easiest fixtures and
  understated it by ~30% at the hardest under the old formula; the new form matches measurement
  and stays exactly `1.0` at an even fixture (no change to the median case). Measured ranking
  effect per the review: +0.013 forward Spearman (1-GW), +0.012 midfielder Spearman (5-GW). This
  changes every live projection's attacking-side output.

## ROUTINE

- Clamp bounds `[0, 2]` promoted to named constants `ATTACKING_MULTIPLIER_MIN`/`MAX` (matching
  the `assistConversionFactor`/goal-conversion-factor pattern already used in this module), each
  value appearing exactly once (grep-checkable).
- Comment states which clamp end is arithmetic vs. judgement: `0` is arithmetic (a multiplier
  cannot be negative); `2` is a judgement call carried over unchanged from the pre-damping
  ceiling as defensive headroom for out-of-range input — the damped formula's own real domain
  now maxes at 1.5.
- `expectedPoints.test.ts`'s "only to surface the applied multiplier in modelInputs" scope note
  interpreted as also permitting the DoD-required byte-identical-components test, since the DoD
  explicitly requires it and it mirrors the established pattern already in that file without
  touching production code beyond the one additive field.
- New `modelInputs` field named `attackingMultiplier`, for exact symmetry with the existing
  `savesMultiplier` field.

## Note

Two other tickets landed in this same batch (#181: `feature_history.prior_recent_minutes`
substrate; #183: five-gameweek backtest ranking section). Neither touches
`src/lib/projection/fixture.ts` or `expectedPoints.ts`. The defensive/clean-sheet mirror
(`expectedGoalsConceded`, `defensiveMultiplier`) remains unmeasured and asymmetric to the
attacking side after this ticket — measuring it is a follow-up, not done here.
