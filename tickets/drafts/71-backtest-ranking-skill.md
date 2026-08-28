## Context

**Feature-list item 32, next slice. The backtest currently measures how close the model's numbers
are; this measures whether it puts the right players at the top — which is the only thing a
recommendation depends on.**

The first slice (#133, #140) reports mean absolute error of **1.819** and a bias of **−0.488**. Those
are honest figures and they answer a question nobody actually asks. **Every decision this app makes
is a ranking decision**: the captain is by definition the highest-projected player in the squad, and
a transfer is a claim that one player will outscore another.

**A model can have a poor absolute error and excellent ranking, or the reverse.** `product-brief.md`
§8 already leans on this — the confidence bands exist because *"the gap between the top three
transfer options is routinely under one point"*, which is a statement about ordering, not magnitude.
Nothing in the system has ever measured whether that ordering is any good.

**The calibration report anticipated this and could not answer it.** Its own distributions section
says: *"A mean can match while the spread is wrong, and the spread is what drives a recommendation."*
It then compares two independent top-20 lists that are **not paired by player**, because it has no
point-in-time basis to pair them on. `feature_history` now provides one.

Depends on #133 and #140 (merged, run twice). Nothing unmerged.

## Scope

**In scope:**

- **Per gameweek, over the measured population, rank players by point-in-time projected points and by
  actual points, and report the agreement between the two rankings** — a Spearman rank correlation,
  with its sample size.
- **Top-N overlap**, which is closer to what the app actually does: of the model's top 10 and top 20
  projected players in a gameweek, how many appeared in the actual top 10 and top 20.
- **The same two measures per position**, since a captain is chosen across positions but a transfer
  is usually within one.
- **A season aggregate and a per-gameweek table**, so a bad week is visible rather than averaged
  away — matching the existing report's shape.
- **Sanity bounds that fail the report rather than printing.** A Spearman correlation **outside
  −0.2 to 0.9**, or a top-10 overlap above **9 of 10**, means the harness is wrong rather than the
  model being extraordinary. See Notes for why the upper bounds matter more than the lower ones.
- **The measured population is unchanged** from #133 — the same exclusions, the same reconciliation,
  so the two halves of the report describe the same rows.
- **A minimum population per gameweek.** Fewer than 50 measured rows is reported as too small to
  read, never as a correlation.
- **`docs/projection-model-backlog.md` records** what ranking skill measures, that it is a different
  question from calibration, and that the recommendation-level replay remains open.

**Explicitly out of scope:**

- **No replay of transfers, captaincy against a real squad, or league position.** There is no stored
  squad for 2025-26 — the app did not exist — so a genuine captaincy replay is not possible for that
  season and inventing one would be measuring nothing. **Item 32's remaining work.**
- **No change to the projection model, or anything under `src/`.**
- **No change to the existing error metrics, exclusions or bounds** from #133 and #140. This slice
  adds sections; it does not revise the ones that exist.
- **No migration and no new table.** Results go in the artefact and the `job_runs` row, as before.
- **No use of the new `feature_history` columns** another ticket in this batch may be adding. Rank on
  what is there today; consuming those columns is a follow-up.
- **No conclusion written into the code** about whether the ranking is good.

## Definition of done

- [ ] A Spearman rank correlation between projected and actual points is computed per gameweek and
      across the season, each with its sample size.
- [ ] **The correlation implementation is tested against a hand-computed case.** A named test with
      6–8 players whose expected coefficient is worked out in the test's own comment — not copied
      from the failing output. *(`LEARNINGS-first-build-wave.md` §2: if a definition of done states a
      number, compute it.)*
- [ ] Perfect agreement returns 1, perfect reversal returns −1, and a shuffled ranking returns near
      zero. Named tests for all three.
- [ ] **Ties are handled explicitly.** Many players project identically at the position prior, and a
      naive implementation either crashes or silently invents an order. Named test with three tied
      projections.
- [ ] Top-10 and top-20 overlap are reported per gameweek and per position, as counts out of N.
- [ ] Per-position figures are reported for all four positions, with sample sizes.
- [ ] A gameweek with fewer than 50 measured rows is labelled too small to read. Named test.
- [ ] **The report fails, naming the figure, when a Spearman correlation falls outside −0.2 to 0.9 or
      a top-10 overlap exceeds 9.** Named tests at each bound.
- [ ] The measured population and its reconciliation are unchanged from #140 — the existing tests for
      both pass **unmodified**.
- [ ] Every Supabase read paginates and asserts its count.
- [ ] The job writes nothing except its own `job_runs` row and its artefact. Grep-checkable.
- [ ] `docs/projection-model-backlog.md` records the section described in Scope.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted, and no file under `scripts/`
      other than `run-backtest.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the statistics on constructed rankings, not
      that the figure produced from 8,590 real rows is meaningful. The human check after merge is
      dispatching `Backtest` and reading the correlation **against expectation before believing it**:
      **something in the 0.3–0.6 range is what a real, useful, imperfect projection model looks
      like.** Above 0.8 means a leak; below 0.1 means the model has no ranking skill at all and the
      whole recommendation approach needs rethinking. Both extremes are findings, and neither should
      be assumed.

## Notes for the Analyst / Builder

**Why ranking rather than error, as its *because*.** The app never shows a projected total to act
on — it shows *this player over that one*, and a captain who is by construction the top of a list.
**Because** every decision is ordinal, a model that is uniformly two points low is perfectly useful
while one that is unbiased but shuffles the order is worthless. **The existing error metrics cannot
tell those apart. This can.**

**The upper bound matters more than the lower one.** A suspiciously *good* correlation is the shape a
lookahead leak takes — if actual points reached the projection side, the model would appear to
predict beautifully and every count would still reconcile. **0.9 is deliberately tight**, and if the
report fails on it the first assumption should be a leak, not a triumph.

**Ties are not an edge case here.** #142's own finding is that 85 players have no history in either
season and all project at the position prior — identical values, in bulk. **Decide the tie rule
explicitly** (average ranks is standard) and test it, rather than discovering the default.

**Do not attempt a captaincy replay for 2025-26.** There is no stored squad for that season and no
honest way to invent one. The measure that *is* available — did the model's top-ranked player finish
near the top — is what top-N overlap already captures.

**Report "too small to read" rather than a number.** Early gameweeks have small measured populations
and a correlation over 20 rows is noise wearing a decimal point.

**This is Tier 2** — it extends the measurement all remaining model work will be judged by. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns
`scripts/build-feature-history.ts`, a new migration and `supabase/README.md`; the other owns
`src/lib/projection/`. This ticket touches neither — **this ticket owns
`docs/projection-model-backlog.md` for this batch**, and **must not read the new `feature_history`
columns**, which will not exist on this branch.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `src/` or `.github/` changes. No other file
under `scripts/` is modified — `build-feature-history.ts`, `calibration-report.ts`,
`project-points.ts` and `build-solver-input.ts` are all left alone. `docs/solver-notes.md` is not
modified.
