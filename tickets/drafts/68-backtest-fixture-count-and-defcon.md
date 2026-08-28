## Context

**The backtest ran for the first time on 28 August and passed its bounds — and its own output
contains two things that need answering before anyone trusts the headline.** This ticket answers
both inside the harness, because both are questions about the measurement rather than about the
model.

### 1. Gameweek 33 is an outlier, and the likely cause is a double count

| | Season norm | Gameweek 33 |
|---|---|---|
| Mean absolute error | ~1.83 | **2.532** |
| Mean signed error | ~-0.52 | **-1.544** |
| n | ~236 | 240 |

**The sample size is normal and the error is triple.** A signed error of -1.544 means actuals
exceeded projections by half again as much as any other week.

**The mechanism to check first: a double gameweek.** `feature_history` holds **one row per (player,
gameweek)**. The actual side sums every `player_match_stats` row for that player in that gameweek —
**two rows when the player played twice.** If the projected side assumes a single fixture, a double
gameweek produces exactly this signature: actuals roughly doubled, projections unchanged, sample size
normal, and everything still reconciling.

**This is not confirmed and the ticket must not assume it.** It is a hypothesis with a clear test,
and the fix is to handle the class rather than to patch gameweek 33.

**If it is real, every figure in the report is contaminated** — a handful of double gameweeks pull
the season aggregate down and make the model look worse than it is.

### 2. Defensive contribution is the largest error in the model, and only this instrument sees it

From the report's component table, across the measured population:

| Component | Mean actual | Mean projected | Signed error |
|---|---|---|---|
| Defensive contribution | **0.259** | **0.070** | **-0.189** |

**The model captures 27% of it.** That is the largest single component error and the biggest
contributor to the -0.524 overall bias.

**And the calibration report disagrees**, reporting defcon at 0.88x for defenders — nearly right.
**Both are true.** Full-season rates estimate defcon well; point-in-time estimation, especially early
in a season, shrinks hard toward a position prior. `defconRate.ts` uses `k = 5` phantom matches, so a
player with three prior matches is still mostly prior.

**Do not tune `k` on this evidence.** The report cannot currently distinguish a cold-start problem
that resolves as matches accumulate from a level problem that never does — and those want opposite
fixes. **This ticket makes that distinguishable; a later one acts on it.** Guessing at a constant
from an aggregate is how the calibration report sent three tickets chasing nothing
(`LEARNINGS-second-build-wave.md` §3).

Depends on #133 (merged, run once). Nothing unmerged.

## Scope

**In scope:**

- **Count fixtures per (player, gameweek) on both sides.** The actual side already sums every
  matching `player_match_stats` row; the projected side must know how many fixtures that gameweek
  held for that player's team and project accordingly.
- **Report the fixture count per gameweek** in the by-gameweek table, so a week with doubles is
  visible rather than mysterious.
- **A named diagnostic section for multi-fixture gameweeks**: how many player-gameweeks had more
  than one fixture, and the error figures with and without them. **If excluding them moves the
  season headline by more than 0.05, say so prominently.**
- **A defensive-contribution diagnostic**, breaking the defcon signed error down by
  **`prior_matches` bucket** — 1–4, 5–9, 10–19, 20+. This is the whole point: if the error shrinks
  as prior matches grow, it is cold start and the fix is the shrinkage; if it stays flat, it is a
  level problem and the fix is the estimator.
- **The same bucketing for the overall signed error**, since the cold-start question applies to every
  component.
- **The unresolved-`player_code` exclusion reported as a percentage** as well as a count — 4,209 of
  18,243 is 23% and reads very differently as a share.
- **`docs/projection-model-backlog.md` records** the defcon finding, its two competing explanations,
  and that the diagnostic exists to separate them.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/` at all. **In particular no change to
  `defconRate.ts`, to `k`, or to any shrinkage constant** — this ticket measures, a later one acts.
- **No change to `feature_history`, its job or its schema.** One row per (player, gameweek) is
  correct; the fixture count is derivable at read time.
- **No migration, nothing under `supabase/`.**
- **No conclusion written into the code** about whether defcon is a cold-start or a level problem.
  The diagnostic reports; a person reads it.
- **No change to `scripts/calibration-report.ts`.** The two reports answer different questions and
  both should exist.
- **No change to the sanity bounds** established by #133, beyond the new diagnostic's own reporting.

## Definition of done

- [ ] The projected side accounts for the number of fixtures a player's team had in the target
      gameweek. **A named test constructs a player with two fixtures in one gameweek and asserts the
      projection covers both**, matching what the actual side sums. **This is the most important test
      in the ticket.**
- [ ] A single-fixture gameweek projects exactly as it does today. Full-equality test against the
      current behaviour — the change must be a no-op for the normal case.
- [ ] A blank gameweek — no fixture for that player's team — is excluded and counted separately, not
      measured as a zero. Named test.
- [ ] The by-gameweek table carries a fixture count, and the multi-fixture diagnostic reports the
      headline with and without those player-gameweeks. Named test.
- [ ] The defcon signed error is broken down by `prior_matches` bucket (1–4, 5–9, 10–19, 20+), with
      a sample size beside each. Named test.
- [ ] The overall signed error is bucketed the same way. Named test.
- [ ] A bucket with fewer than 50 measured rows is labelled too small to read rather than reported as
      a figure — the same rule #123's accuracy display uses.
- [ ] The unresolved-`player_code` exclusion is reported as a count **and** a percentage of rows read.
- [ ] **The reconciliation still holds exactly**: rows measured + rows excluded by reason = rows read.
      Asserted in a test, including the new blank-gameweek exclusion.
- [ ] The existing sanity bounds still fail the report when breached, and every #133 test not
      concerning fixture counts or bucketing passes **unmodified**.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted, and no file under `scripts/`
      other than `run-backtest.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic on constructed rows, not
      that gameweek 33 was in fact a double gameweek — that is only knowable from the rerun. The
      human check after merge is dispatching `Backtest` and reading three things: whether
      **gameweek 33's error has come back toward the ~1.8 norm** (which would confirm the
      hypothesis), what the multi-fixture diagnostic says the season headline moves by, and whether
      the defcon error **shrinks across the prior-matches buckets or stays flat**. That last one
      decides what the next model ticket is.

## Notes for the Analyst / Builder

**On the outlier, as its *because*.** The hypothesis is a double gameweek, but **because** a
hypothesis that explains one week is worth less than a fix that handles the class, this ticket
counts fixtures everywhere rather than special-casing gameweek 33. If the rerun shows gameweek 33
still anomalous, that is a genuine finding and a better one than a patched number.

**The defcon diagnostic is the point, and it must not turn into a tuning ticket.** Two explanations
fit the same aggregate: a cold start that resolves as evidence accumulates, and a systematically low
estimator that never does. **They want opposite fixes** — the first wants a smaller `k` or a better
prior, the second wants a different estimator — and the aggregate cannot tell them apart. The
buckets can. **Resist any change to `defconRate.ts` in this ticket, however obvious it looks.**

**Report "too small to read" rather than a number.** Early-season buckets will have few rows.
`LEARNINGS-second-build-wave.md` §3: a report that says it cannot measure something is trustworthy;
one that says "0.30, probably" is not.

**Keep the reconciliation exact.** Adding a new exclusion reason is the easiest way to break it, and
a nearly-reconciling count is the finding, not a rounding artefact.

**Do not fix the unresolved-`player_code` gap here** — 23% is large and it deserves its own ticket.
Report the percentage so its size is visible; that is all.

**This is Tier 2** — it changes what the measurement other model work will be judged by actually
measures. Log it as HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `src/lib/chips/` and
`src/screens/ChipsScreen.tsx`; the other owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`. This ticket touches neither — **this ticket owns
`docs/projection-model-backlog.md` for this batch.**

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `src/` or `.github/` changes. No other file
under `scripts/` is modified — `calibration-report.ts`, `build-feature-history.ts`,
`build-solver-input.ts` and `project-points.ts` are all left alone. `docs/solver-notes.md` is not
modified.
