# Ticket #187 — Backtest: use real recent-minutes window and fix the 5-GW oracle

## HIGH-IMPACT

- **This whole ticket is Tier 2 — it changes the instrument every model judgement is read
  from, and no report before this lands is comparable to any report after.** Because: both
  halves of the fix change what every measured row's projection is (the real five-match
  window instead of one averaged synthetic match) and what the oracle compares that
  projection against (a total in the target's own units, not a rate). This is the ticket's
  own text and matches `escalation.md`'s Tier 2 test — how data is structured, and expensive
  to reverse once further tickets are built on top of these numbers.
- **The five-gameweek oracle's rate factor is conditioned on `featured`, not raw match
  count, and multiplied by a separate out-of-window appearance-rate factor.** Because:
  `computeOracleRate`'s existing "matches" denominator already partially dilutes for
  non-featured gameweeks (a row can exist with 0 minutes), so combining that same dilution
  with an explicit appearance-rate multiplier would double-penalize rotation risk. Keeping
  the rate factor conditioned on featuring, with appearance-rate as the sole
  non-appearance signal, keeps the two factors non-overlapping and independently
  interpretable: "how well he scores when he plays" × "how often he plays."
- **`computeOracleRate` (the single-gameweek oracle) is left completely untouched.**
  Because: the ticket's scope and DoD target the five-gameweek construction only, and the
  single-gameweek oracle's ordering was already independently confirmed correct (model
  0.325 vs oracle 0.336) — touching a working, validated function to satisfy a defect it
  doesn't have would be scope creep.
- **`checkOracleCeiling` is wired into the job's hard failure gate
  (`job_runs.status = 'failure'`, non-zero exit), not left as a report-only note.**
  Because: the DoD requires "STOP and report rather than shipping a ceiling the model
  exceeds — that's a finding, not a pass." A console line a human could skim past doesn't
  satisfy "stop"; the existing sanity-bound mechanism (already used for MAE/clean-sheet/
  Spearman bounds) does, and folds this check into the same gate other bounds already use.

### Reconciliation against `docs/model-review-2026-09-02.md`

| Dimension | Review | This repo | Verdict |
|---|---|---|---|
| Population | ~10,580 rows (the review's own Python reconstruction, which the review itself notes "lacks the blank-gameweek and unresolved-fixture exclusions") | 10,460 rows in backtest report 7, applying all 6 exclusion reasons | This repo's is more complete and correct; the review's was a simplified validation harness. Adopted: this repo's population (already in place, unchanged by this ticket). |
| Truncation rule | "gameweek ≤ 34" for a 38-gameweek season | Same rule (`isFiveGameweekWindowTruncated`) | Identical — no conflict, no change needed. |
| Non-appearance treatment | Zeros for non-featuring weeks | Same | Identical — no conflict, no change needed. |
| Oracle definition | A bare points-per-match rate, at both horizons | Was the same rate at 5-GW (the defect); now fixed to rate × out-of-window appearance rate × horizon for the 5-GW target only | This is the one real mismatch, and the fix adopted here is the ticket's own diagnosis, not a construction taken from the review's code — the review's 5-GW oracle predates this fix and never specified the corrected form. |

**Unresolved residual, explicitly flagged, not swept under the rug:** none of the four
dimensions above explain the *model's own* five-gameweek Spearman gap — the review's
independent prediction (0.425) vs. the shipped, pre-fix run (0.672) — because that number
doesn't depend on the oracle at all. Important context: the review's five-gameweek figures
were never validated against a real implementation; the five-gameweek target didn't exist in
code when the review was written, and the review's own validation table only cross-checks
one-gameweek figures against backtest report 7. So 0.425 is an independent Python
*prediction* for a feature that didn't yet exist, not a verified benchmark. **Unproven
hypothesis, recorded as a hypothesis, not a conclusion:** the repo's own code comments flag
"five projections summed, never one projection × 5" as a consequential, explicitly-called-out
design choice; if the review's Python reconstruction took the cheaper "one projection × 5"
shortcut, that would mechanically depress its correlation relative to a harness that (like
this one) builds five fresh per-gameweek projections. This could not be confirmed without the
review's source and is left as an open question for the next real backtest run to settle, not
picked as a number.

## ROUTINE

- `PlayerSeasonMatch.featured` added as optional, not required — avoids touching ~15
  pre-existing `computeOracleRate`/`groupSeasonMatchesByPlayer` test literals that don't
  reference it; every real code path (`buildPlayerSeasonMatches`) always sets it.
- `RecentMinutesSourceCounts`/`RecentMinutesWindowLengthDistribution` counted over every
  `feature_history` row read (not just the measured population), mirroring
  `DefconSourceCounts`'s existing precedent exactly, at the same point in the same loop.
- Window-length histogram keyed as `Record<number, number>` rather than a fixed-size tuple,
  so this file never needs to import `RECENT_MATCH_COUNT` from `minutes.ts` just to size an
  array.
- New report sections ("Minutes evidence", "Oracle-ceiling check") appended strictly after
  the existing five-gameweek section, never inserted mid-report — preserves the file's own
  byte-identical-report convention/test for both the pre-#183 and pre-#187 content.
- `buildRecentMinutes` returns a defensive copy of the stored window rather than the live
  reference, with a named test proving it.
- Oracle prose in the report updated to describe the rate-vs-total distinction; the exact
  pre-existing header lines the tests string-match on were kept as literal strings.

## Note

**This is the fifth "instrument, not model" finding in this project**, extending the pattern
from #146→#154 and #167→#175: the harness, not the model, was the thing measured wrong.
`docs/projection-model-backlog.md` G9's approximation 1 (minutes) is now closed — the defcon
half was closed by #154; this ticket closes the minutes half.

**Batch-attribution caveat:** ticket #188, running concurrently in this same batch, changes
how `estimateMinutes()` *consumes* the window this ticket now feeds it correctly. The first
backtest run after both tickets land reflects both changes together — neither is individually
attributable from that run alone.

**Live numeric verification could not be performed in this sandboxed session** — no Supabase
credentials were available to run the harness against real data and observe whether the fixed
oracle now sits above the fixed model at both horizons. The code-level mechanism (the hard
failure gate, and the unit tests exercising it with synthetic data) was verified instead. Per
the ticket's own text, confirming the live ordering is a post-merge human check: dispatch the
`Backtest` job and read whether the oracle-ceiling check reports PASSED at both horizons.

**Every figure in every existing report section will move on the next run** — MAE, signed
error, and every component figure — because each measured row now receives a different
projection (the true window instead of the averaged match). These are not comparable to any
previous run.
