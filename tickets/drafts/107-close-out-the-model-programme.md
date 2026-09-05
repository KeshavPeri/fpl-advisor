## Context

Three weeks of model work have produced an honest instrument and almost no model improvement. That
is worth writing down properly, because without it the next session will re-run the same
experiments. This ticket closes three open threads with measurement, and records the conclusion in
`docs/projection-model-backlog.md`.

**Thread 1 — ticket #217's shrinkage barely moved anything, and it merged past its own gate.** Its
falsification check was explicit: *"at five gameweeks, midfield must rise from 0.421 toward 0.464
and forward from 0.442 toward 0.476. If neither moves materially, the diagnosis is wrong: stop, do
not merge."* Backtest report 13 gives midfield **0.426** and forward **0.446** — moves of 0.005 and
0.004 against targets of 0.043 and 0.034. That is not material, the ticket should have stopped and
reported, and it merged. Both facts need recording: why the change did nothing, and that the gate
did not hold.

**Thread 2 — learned-v1 is finished and should be parked.** Ticket #216's fair-gate re-run across
four splits: goalkeeper 0 wins of 4 (losing by up to 0.193), forward 0 of 4, defender 2 of 4,
midfielder 4 of 4 — at margins of **+0.001, +0.005, +0.005 and +0.024**. A mean edge near 0.009 on
a metric whose own resolution the model review put at about ±0.01 is not a result. The verdict
table says SHIP for midfield; the effect size says otherwise, and the honest reading is that the
learned model beats the hand-built one nowhere.

**Thread 3 — baseline-v1 is at its ceiling and the file should say so.** At five gameweeks the model
scores 0.409 against a naive minutes ranker's 0.407 and a hindsight ceiling of 0.506. Every
remaining constant the review tested was worth ≤0.01. The model is done unless new information
arrives — which is exactly what the penalty ticket in this batch is testing.

## Scope

**In scope:**

- **Measure why the shrinkage did nothing.** The obvious hypothesis, and the one to test first: for
  most players the five-match window mean and the season minutes-per-match are already very close,
  so shrinking one toward the other changes almost nothing. Report the distribution of
  `|window mean − season mean|` across the measured population, and what share of rows moved by
  more than a couple of minutes. A reported diagnostic only — never a check, never asserted.
- If that hypothesis holds, say what it means: the review's "the window is too reactive for a long
  horizon" premise is not wrong about the symptom but is wrong about the cause, and the real reason
  the naive minutes ranker beats the model at midfield and forward is still unexplained. **Record
  it as an open question rather than inventing an answer.**
- **A backlog entry parking learned-v1**, carrying the full four-split margin table verbatim, the
  effect size against the instrument's resolution, and the conclusion. State plainly that the
  midfield "SHIP" verdict was arithmetically correct and substantively too small to act on, so that
  a future reader does not find the table and revive it.
- **A backlog entry recording that `baseline-v1` is version-frozen**, with the figures above, and
  the standing rule the review already set: no further constant is to be tuned against these
  metrics, because every one tested was worth less than the instrument can resolve.
- **A learnings entry on the gate that did not hold** — ticket #217 carried a stop-and-report
  falsification check, the check failed, and the work merged anyway. Written up in
  `app-factory/LEARNINGS-second-build-wave.md` as a new numbered finding, in the same shape as §17.

**Explicitly out of scope:**

- **No model change of any kind.** Nothing under `src/` is touched. This ticket changes no
  projection, no recommendation and no report figure.
- No revert of #217. Its effect is near zero in both directions, so removing it buys nothing and
  costs another live-projection change; leave it and record what it did.
- No change to `checkOracleCeiling` or any bound.
- No new metric, no new baseline, no migration, no workflow change.

## Definition of done

- [ ] The window-versus-season-mean distribution is reported in the backtest, as a diagnostic, with
      sample sizes and a "too small to read" rule for thin buckets.
- [ ] The backlog carries an entry parking learned-v1 with the four-split margin table verbatim and
      an explicit statement of effect size against instrument resolution.
- [ ] The backlog carries an entry freezing `baseline-v1`, with the five-gameweek figures and the
      no-more-constant-tuning rule.
- [ ] The shrinkage finding is recorded, and if it does not fully explain the midfield and forward
      gap, that gap is left written down as an open question rather than closed with a guess.
- [ ] `LEARNINGS-second-build-wave.md` carries a new numbered section on the unheld gate, naming the
      ticket, the threshold, the measured move and the merge.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`, its report
      fixture, `docs/projection-model-backlog.md`, and this ticket's own
      `decisions/ticket-<issue>.md`. The `LEARNINGS-second-build-wave.md` entry is in the
      `app-factory` repo and is Keshav's to paste — supply the text in the PR body rather than
      attempting to write to a second repository.

## Batch coupling

The penalty ticket in this same batch changes `src/lib/projection/rates.ts` and may change what the
model projects. **Every figure this ticket reports must be computed live in the same run**, and the
report must state the git SHA it ran at. Do not quote report 13's numbers as though they were
fixed. That ticket does not edit `scripts/run-backtest.ts`, so there is no file collision, but the
numbers move.

## Notes for the Analyst / Builder

- **This ticket is bookkeeping and it is worth a slot.** `LEARNINGS-second-build-wave.md` §16e
  records exactly what happens when a project stops keeping its own record current: a question
  gets asked twice and nobody can answer it confidently. Three weeks of measurement deserve four
  paragraphs of conclusion.
- Be careful to write the learned-v1 entry so it reads as "measured and parked", not "failed". The
  experiment answered its question inside its budget, which is the seam working exactly as
  `product-brief.md` §6c intended.
- On the unheld gate: write it as a process finding, not a blame note. The check was in the ticket,
  it was correctly specified, and it still did not stop the merge — that is a gap in how the
  pipeline enforces a stop-and-report, and it is the second time (§17 was the first) that a
  falsification check has failed to halt anything.
