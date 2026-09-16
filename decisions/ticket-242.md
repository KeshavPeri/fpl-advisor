# Ticket #242 — Team strength is over-dispersed — shrink it toward the league mean

## HIGH-IMPACT

- **`TEAM_STRENGTH_SHRINKAGE_K = 5`** because it was fitted from the ticket's own precomputed
  orientation table (K=5 → resulting population stdDev 0.1739, the closest in-band value to the
  0.1701 calibration target recorded in `SCALE`'s own comment). Live Supabase credentials are not
  available in this run's environment, so the value could not be independently re-derived against
  live gameweek-5 data as the ticket asks — it is trusted from the ticket text's own table, not
  re-measured. **Must be re-verified against a live run of `scripts/team-strength-diagnostic.ts`
  before this PR is trusted**, and re-derived once ten gameweeks are on record, per the ticket's
  own instruction and the constant's doc comment.

- **`computeFixtureExpectedScore`'s new `shrinkageK` parameter defaults to
  `TEAM_STRENGTH_SHRINKAGE_K`, not 0.** Because the ticket simultaneously requires (a) the live
  path (`expectedPoints.ts`) to receive shrinkage, (b) `expectedPoints.ts` to stay untouched
  (owned by ticket #117), and (c) `scripts/run-backtest.ts`'s existing calls — which pass no 5th
  argument — to stay byte-identical "via a default." These three cannot all hold at once: both
  unmodified callers omit the argument, so both receive whatever the default is. The Builder chose
  to default to the calibrated K because clearing the live falsification gate is the ticket's
  explicit stop-ship requirement and `expectedPoints.ts` may not be touched. **Side effect, left
  unresolved in this file's scope:** `run-backtest.ts`'s own full-season backtest calls will now
  also apply a small K=5 shrinkage they don't strictly need, since full-season rates were already
  low-variance. Verified this doesn't break `run-backtest.test.ts` (296 tests) or
  `train-and-evaluate-learned-model.test.ts` (47 tests) — neither hardcodes absolute
  `expectedScore` values — but real backtest output will shift slightly. **Flagged for Keshav:**
  either accept this small backtest behaviour change, or file a follow-up ticket threading
  `shrinkageK = 0` explicitly through `run-backtest.ts`'s call sites so its output stays exactly
  byte-identical as the ticket originally intended.

## ROUTINE

- `MIN_EXPECTED_SCORE` / `MAX_EXPECTED_SCORE` = 0.05 / 0.95 (the output-bound guard in
  `computeFixtureExpectedScore`) taken directly from the ticket text, Tier 3.
- Diagnostic gate 4 bounds, `[0.10, 0.90]`, and gate 2's new band, `[0.14, 0.20]`, taken directly
  from the ticket text.
- `shrunkRate` (`rates.ts`) could not be called directly for this construction — its
  `SHRINKAGE_K = 3` is hardcoded inside its own body rather than taken as a parameter, and team
  strength needed an independently calibrated K (5, not 3). Wrote a separate `shrunkTeamStrengthRate`
  reusing `shrunkRate`'s exact arithmetic pattern (`(total + k * prior) / (observedCount + k)` with
  `prior = 0`) rather than importing the function itself, since nothing would actually call it with
  the same K. Documented in the code comment.
- `HOME_EXPECTED_SCORE_BONUS`'s pre-existing 0.0925-vs-"0.0927" rounding discrepancy (noted by a
  prior ticket) was left as-is — out of this ticket's scope, unrelated to the shrinkage work.
