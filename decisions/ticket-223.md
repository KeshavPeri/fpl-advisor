# Ticket #223 — Score the recommendations the app has actually issued

## HIGH-IMPACT

- **The Roll counterfactual is derived purely by reversing Plan A's own stored transfer in place,
  rather than reading `squad_picks`.** Chose this because the ticket's own Notes name exactly the
  four tables (`recommendations`, `recommendation_decisions`, `prediction_log`,
  `player_match_stats`) as sufficient, and reversing Plan A's transfer composes cleanly with how
  the actual-decision reconstruction below is built, keeping one method for "what would the squad
  have looked like" across both counterfactuals.
- **"What Keshav actually did" is reconstructed, not read verbatim, because
  `recommendation_decisions.snapshot` never stores a full squad** — verified directly against
  `src/lib/commit/api.ts` and `src/lib/override/api.ts`, it stores only 7 scalar fields. The
  decision's own transfer plus captain/vice are applied onto the Roll base; the rest of the XI is
  assumed identical to Plan A's. This is wrong exactly when Keshav made a second, unrecorded change
  the same week — the override screen's own stated limit is "no multi-transfer entry" — so the
  error mode is bounded and named, not silent.
- **An override's net points and hit cost are reported as explicitly unknown (`null`), never
  guessed as zero**, because `registerOverride` always writes `hit_cost: null` by design — showing
  zero would misrepresent a real unknown as a real fact, the same failure mode the confidence-band
  rule in `product-brief.md` §8 exists to prevent elsewhere in the app. Gross points are still shown
  in full.
- **`player_match_stats` is never read**, despite being named in the ticket's own context
  paragraph, because `prediction_log` already carries settled actuals and the ticket's own Notes
  say "one source, not two" — reading both would risk the two sources disagreeing with no way to
  say which is right.
- **A gameweek is excluded wholesale, never partially scored**, the moment any needed entity (Plan
  A/B/C, Roll, or the actual decision) can't be computed. Chose this to keep "read = scored +
  excluded-by-reason" a strict, testable partition, matching `scripts/run-backtest.ts`'s own
  existing convention for the same problem.
- **Real FPL armband-fallback rules are implemented** (vice-captain's points double instead when
  the captain doesn't play; no doubling if neither plays), using `prediction_log.actual_minutes`,
  rather than naively always doubling the named captain. Chosen because the captaincy question is
  the DoD's own "the one Keshav feels most" item, and the minutes data needed to do it properly was
  directly available — a naive version would misreport exactly the decisions this report exists to
  get right.

**Calibration note for the orchestrator's own log:** six HIGH-IMPACT entries from one ticket is
above the "~5 a night" guideline in `CLAUDE.md`. Recorded as a calibration signal, not padded down
— each genuinely meets the Tier 2 test question (a report whose value is stated to compound weekly
makes its own interpretation choices expensive to silently change later), but the density is worth
Keshav noting.

## ROUTINE

- `MIN_GAMEWEEKS_FOR_SIGNAL = 20` (roughly half a season) is a stated, undisguised judgement for
  when this report's figures stop being dominated by week-to-week noise — not fitted from data,
  since there isn't enough yet to fit it from.
- Figures are always computed and printed, never nulled out for a small sample — a deliberate
  departure from `run-backtest.ts`'s "too small to read" convention, because that convention would
  null out everything for months and defeat the ticket's own stated point that the report's value
  compounds weekly. Every figure still carries its own `n`.
- No `players`/`gameweeks` table read for display names — the report labels by raw id, keeping the
  read set to exactly the four tables the ticket named. A friendlier report is deferred, matching
  "no app screen — this is a report first."
- No bench auto-substitution modelled — a blanking starter's real (zero) points count as scored;
  FPL's real auto-sub rule is not simulated. Stated explicitly in the script's own file header as a
  known simplification.
