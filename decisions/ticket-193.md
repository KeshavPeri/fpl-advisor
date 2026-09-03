# Ticket #193 — the club fixture schedule replaces the appearance-keyed leg fixture count

Draft file: `tickets/drafts/93-five-gameweek-appearance-leak.md`. GitHub issue: `#193`.
Branch: `claude/ticket-193-club-schedule-fixtures`.

## Falsification check — PASSED, both conditions

The ticket's premise was a causal claim about a measured number, so it carried figures that had
to move if the claim was true (`LEARNINGS-second-build-wave.md` §17). Measured against live
Supabase data on this branch, workflow run `33757203659`:

| Condition | Threshold in the ticket | Measured | Verdict |
|---|---|---|---|
| Legs the club played but the player did not | "a large share of all legs"; near zero refutes | **6,836** of 36,736 (**18.6%**) | PASS |
| 5-gameweek model Spearman | must fall materially below 0.619 | **0.397** | PASS |
| Model against the 5-gameweek oracle | must sit below it | oracle **0.506**, model 0.397 | PASS |

Leg arithmetic reconciles exactly: 36,232 with a fixture + 504 blank = 36,736 = 9,184 windows x 4.

**The exclusion confound was considered and ruled out.** The new `unresolvedTeamCode` exclusion
shrinks the measured population, so part of the fall could in principle be a population change
rather than the fix. It is not: the exclusions account for roughly 1% of rows, and a 1% change
in population cannot move a rank correlation by 0.222. The independent check agrees — the
2 September model review predicted 0.425 for a leak-free construction built in Python from the
public CSVs, and 0.397 lands beside it.

## HIGH-IMPACT — the schedule's shape

`buildClubFixtureSchedule` returns `Map<string, (number | null)[]>` keyed `"<teamCode>:<gameweek>"`,
one entry per distinct `match_id`, read through an exported `lookupClubFixtureSchedule` accessor.

**Because** it mirrors the `windowKey` / `buildFeatureHistoryIndex` convention already in the same
file. A second keying convention inside one 4,000-line module costs more in future confusion than
any efficiency it could buy, and the accessor keeps the key format in exactly one place.

## HIGH-IMPACT — a null `team_code` is now an exclusion, not a fallback

A window whose start row carries a null `team_code` raises a new `unresolvedTeamCode` exclusion,
replacing the previous harmless fallback.

**Because** every leg's fixture count now depends on resolving which club the player belongs to.
When that is unknown the honest answer is to drop the window, not to guess a club and inherit its
schedule — a guessed fixture count would propagate silently through all five legs and would be
invisible in the output. This is the same rule the ticket applied to a leg with no schedule entry:
zero fixtures, counted, never a fabricated neutral one.

Consequence, stated because it looks like churn in the diff: several existing tests relied on the
old fallback and now set `team_code` explicitly. That is the guard rail arriving, not test damage.

## ROUTINE — the new counters tally over measured windows only

A window excluded partway through drops its earlier legs' tallies with it. This matches the
function's existing rule that a window is only as good as its worst-resolved leg — a partial sum
silently missing a leg was never allowed, and a partial count should not be either.

## ROUTINE — the G leg is outside the new diagnostics

The window's own start leg takes its fixture count from the already-correct single-gameweek path,
and by construction it featured, since the single-gameweek section excludes non-featuring rows
before anything is projected. Counting it would inflate the denominator with rows this ticket does
not touch.

## Known approximation, recorded not hidden

The schedule is reconstructed from matches that were actually played; this job still has no
independent fixture-schedule table for a past season. A fixture postponed after its horizon began
is therefore indistinguishable from a club that never had one — both read as a blank gameweek, so
the 504 blank-gameweek legs are a slight overcount. Recorded in `docs/projection-model-backlog.md`
under the G13 addendum so it is not rediscovered as a bug later.

## What did NOT change, and must not be read as this ticket failing

Per `LEARNINGS-second-build-wave.md` §15.

- **The Backtest job still exits 1.** The one-gameweek oracle-ceiling check (oracle 0.336 below
  the model's 0.345) is a separate defect with a separate cause and its own ticket. It was failing
  before this branch and is failing identically on it.
- No live projection, recommendation, Telegram message or app surface moved. MAE, the mean signed
  error and the whole one-gameweek section are unchanged.
- Report 9's and report 10's five-gameweek sections are not comparable. Report 9's 0.619 is a
  leaked figure.
- `computeOracleFeaturedRate`, `computeOracleAppearanceRate`, `computeOracleFiveGameweekEstimate`
  and `checkOracleCeiling` are untouched, and the bound is not relaxed. It has now caught two
  distinct leaks in this one construction.

## Test state at merge

1,829 passed, 9 failed. All 9 confirmed pre-existing on `main` with a byte-identical failure set;
this branch adds 19 tests, all passing. Six of the nine are the `supabase/README.md`
migration-listing assertions, which assert a row still reads "not yet applied" and therefore break
by design the moment a migration is applied and the table is updated. They are bad tests and have
their own follow-up.
