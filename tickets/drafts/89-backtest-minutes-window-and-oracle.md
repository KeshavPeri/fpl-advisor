## Context

**Two defects in the same instrument, in the same file. Both make the backtest lie in opposite
directions, and neither is a model problem.**

### Defect 1 — the harness still feeds the model one averaged match

`scripts/run-backtest.ts`'s `buildRecentMinutes` returns **an array of exactly one synthetic match**:

```ts
export function buildRecentMinutes(row) {
  return row.prior_matches > 0 ? [averageMinutesPerMatch(row)] : []
}
```

The live model calls the same `estimateMinutes()` with the player's **last five actual matches**.
Averaging destroys the distinction between a nailed starter and a rotation player, which is the
strongest signal the model has.

`docs/model-review-2026-09-02.md` rebuilt the harness independently, validated it against the shipped
one (Spearman 0.326 against 0.323, MAE 1.797 against 1.800, goalkeeper exact), then changed only this
input. **The verdict flips at every position**: midfielders 0.410 against the minutes baseline's
0.394, forwards 0.423 against 0.396. The measured attacking "deficit" is smaller than the handicap
the harness imposes.

**Ticket #185 already stored the fix.** `feature_history.prior_recent_minutes` is applied, populated,
and read by nothing. This ticket is its consumer — the same #146 → #154 and #167 → #175 pattern.

### Defect 2 — the five-gameweek oracle is not a ceiling, and the model beat it

The 2 Sept run reports, at five gameweeks: **model 0.672, oracle 0.507.** A model above its own
ceiling is a contradiction, and ticket #183 said explicitly that this outcome must be treated as a
failure rather than a triumph.

**It is the oracle that is wrong, and the fault is in #183's own wording.** The oracle ranks players
by **points per match** — a rate. The five-gameweek target is a **total**, and a five-gameweek total
is dominated by *how many* of those five a player actually plays. The oracle cannot see that; the
model can, because minutes is what it is best at. It is a rate estimator being scored on a totals
target.

Three independent checks say this is not a leak: the single-gameweek ordering is still correct
(model 0.325, oracle 0.336), the constant baseline still scores exactly 0.000, and every figure above
the new section is unchanged.

**A third problem sits on top: the shipped numbers do not match the review's.**

| | Review | Shipped run |
|---|---|---|
| Model, 5 GW | 0.425 | **0.672** |
| Oracle, 5 GW | 0.485 | **0.507** |

Both sides differ, so the two constructions are not the same thing. **Until that is reconciled, no
five-gameweek figure from this project should be quoted anywhere.**

Depends on #183, #185 (migration applied, `feature_history` rebuilt) — merged. Nothing unmerged.

## Scope

**In scope:**

- **Read `feature_history.prior_recent_minutes`** and pass it to `estimateMinutes()` in place of the
  single averaged match. Fall back to the existing single-averaged-match construction only when the
  column is null, counted and reported with its reason.
- **Fix the oracle so it estimates the same quantity as its target.** For the five-gameweek target
  that means a **total**, not a rate: the player's out-of-window points-per-match multiplied by an
  out-of-window estimate of how often he features. **Both factors must come from outside the target
  window** — the appearance rate is exactly as leak-prone as the scoring rate.
- **Reconcile against `docs/model-review-2026-09-02.md`.** State, in the decisions file, what differs
  between that review's five-gameweek construction and this repository's — population, truncation
  rule, treatment of non-appearances, or oracle definition — and which is correct. **If the review's
  is correct, adopt it.**
- **Counters** in the report and in `job_runs.details`: rows using the stored window, rows on the
  averaged-match fallback, and the distribution of window lengths.

**Explicitly out of scope:**

- **No change to anything under `src/`.** `minutes.ts` already accepts the array. Another ticket in
  this batch changes that module's internals; this one changes only what is handed to it.
- **No change to the measured population, the exclusions, or the reconciliation**, beyond the new
  fallback counter.
- **No change to the single-gameweek ranking section's construction**, its baselines, or the
  component tables. Their *values* will move — that is this ticket working — but nothing about how
  they are computed changes.
- **No new stored column, no migration, no new Supabase read** beyond the one column.
- **No tuning of anything in response to the new numbers.**
- **No edit to `docs/projection-model-backlog.md`** or to the review document.

## Definition of done

- [ ] `buildRecentMinutes` returns the stored window, most-recent-first, unmodified. A named test
      proves a five-entry window reaches `estimateMinutes()` intact rather than being averaged.
- [ ] A row with a null `prior_recent_minutes` falls back to the previous construction, is counted,
      and is reported. **The count is expected to be near zero** — a large number means #185's
      rebuild did not land and the run should be read as suspect.
- [ ] The oracle estimates a total for the five-gameweek target and a per-gameweek figure for the
      single-gameweek target, in the same units as each target.
- [ ] **A named test proves no data from inside the target window reaches the oracle — including the
      appearance-rate factor.** This is the most important test in the ticket.
- [ ] **The oracle sits above the model at both horizons.** If it does not after the fix, **stop and
      report** rather than shipping a ceiling the model exceeds. That outcome would mean the oracle is
      still mis-specified, and it is a finding, not a pass.
- [ ] The constant baseline still scores exactly 0.000 at both horizons. Named test.
- [ ] The decisions file reconciles this repository's five-gameweek construction against the review's,
      names every difference, and states which was adopted and why.
- [ ] Every existing test passes **unmodified** except where one asserts the single-averaged-match
      construction or the old oracle directly.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or any other
      `scripts/*.ts` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the human check after merge is dispatching `Backtest` and
      reading **whether the model now beats the "prior minutes per match" baseline at midfielder and
      forward on the single-gameweek target** — the review predicts roughly 0.410 against 0.394 and
      0.423 against 0.396. **Both outcomes are findings.** If it still loses with a faithful minutes
      window, the review's central claim is refuted and that is more valuable than confirming it.
      **What will also change:** MAE, signed error and every component figure move, because the
      projection each row receives changes. **They are not comparable to any previous run.** Say so
      in the decisions file.

## Notes for the Analyst / Builder

**This is the second half of a defect the repo already half-fixed.**
`docs/projection-model-backlog.md` G9 lists minutes and defensive contribution together as one
approximation. Ticket #154 fixed the defcon half by reading #146's stored counters; the minutes half
was never extended. **This is the fifth "instrument, not model" finding in this project** — say so in
the decisions file, and note that G9's approximation 1 is now closed.

**On the oracle, the failure was a specification failure and the decisions entry should say so.**
Ticket #183 asked for "quality estimated from actual results outside the target window" without
requiring that the estimate be expressed in the target's units. A rate estimator scored against a
totals target is handicapped by construction. **The lesson generalises: any comparator must estimate
the same quantity as the thing it is compared against.**

**The appearance-rate factor is the leak risk.** It is tempting to use how many of the five gameweeks
the player actually featured in — that is inside the window and would be a leak that produces a
spectacular, wrong ceiling. Use his out-of-window appearance rate.

**Reconciling with the review is not optional.** Two constructions producing 0.425 and 0.672 for the
same nominal metric cannot both be right, and the difference must be named before either number is
used. If the difference cannot be identified from the review document, **say so and report the two
figures side by side** rather than picking one.

**This is Tier 2** — it changes the instrument every model judgement is read from, and no report
before it is comparable to any report after it. Log it as HIGH-IMPACT with its *because*.

**Two other tickets are running in this batch.** One owns `src/lib/projection/minutes.ts`; the other
owns a new ClubElo ingest script and `.github/workflows/scheduled-jobs.yml`. This ticket touches
neither. **The minutes ticket changes how `estimateMinutes()` consumes the window this ticket starts
feeding it, so the first backtest after this batch reflects both — neither is individually
attributable from that run alone.** Note that in the decisions file.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or
any other `scripts/*.ts` changes. No dependency is added, removed or upgraded. No build configuration
changes.
