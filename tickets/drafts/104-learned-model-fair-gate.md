## Context

Ticket #208's first run reported **GATE FAILED, 2 of 4 lines passed**. The failure verdict was
right. The gate itself was not, and the fault is in the ticket that specified it, not in the
implementation.

**What went wrong.** The gate mixed two kinds of threshold. Goalkeeper and defender were judged
against the incumbent computed live on the held-out fold. Midfield and forward were judged against
**fixed numbers — 0.464 and 0.476 — lifted from a full-season report.** The evaluation ran on
gameweeks 29 to 38, a fold where every ranker scores higher than its full-season figure: the
incumbent scores 0.503 there against 0.407 across the season, and the naive baseline 0.479 against
0.407. So two positions were measured against a bar set roughly 0.05 too low, and two against a
live one. The pass/fail split fell straight along that line.

**The like-for-like picture**, all from the same held-out fold, five-gameweek horizon:

| Position | Learned | Incumbent | Naive minutes |
|---|---|---|---|
| Goalkeeper | 0.322 | **0.462** | 0.342 |
| Defender | 0.421 | **0.428** | 0.421 |
| Midfielder | **0.543** | 0.527 | 0.528 |
| Forward | 0.575 | **0.617** | 0.518 |
| Season | 0.493 | **0.503** | 0.479 |

Read properly, the learned model beats the incumbent in exactly one place — midfield, by 0.016 —
and loses everywhere else, heavily at goalkeeper. That is a far more useful result than "2 of 4",
and it points at a hybrid rather than a replacement. But 0.016 on 1,509 windows from a single
arbitrary split is not evidence of anything yet. This ticket makes the measurement trustworthy.

## Scope

**In scope:**

- **Every threshold computed live, on the same fold, in the same run.** No figure quoted from any
  previous report, for any position. That is the whole defect being fixed.
- **Repeated splits.** Evaluate across several train/eval cutoffs — gameweek 22, 25, 28 and 31 —
  and report each position's result at every split, plus the spread. A per-position edge that
  survives every split is a finding; one that appears at a single cutoff is noise.
- Report the learned model, the incumbent and all three naive baselines side by side at both
  horizons, per position, per split, over identical populations.
- **The gate, restated:** for a position to be worth shipping, the learned model must beat **the
  incumbent** at that position on the five-gameweek target, on the majority of splits. Beating the
  naive baseline is not sufficient — the incumbent already does that at every position except
  midfield and forward, and shipping something worse than what exists is not an upgrade.
- A plain per-position verdict: ship, do not ship, or too close to call.

**Explicitly out of scope:**

- **No retraining to chase the gate.** Same model type, same hyperparameters, same feature list as
  #208. Only the evaluation changes. If the midfield edge disappears under repeated splits, that is
  the answer.
- Nothing user-visible. No projection written, no `model_version` added, no CSV change. Shipping a
  passing position behind the seam is the next ticket.
- **No edit to `scripts/run-backtest.ts`.** Import from it, as #208 already does.
- No change to anything under `src/`, no migration, no workflow change.

## Definition of done

- [ ] No threshold in the gate table is a literal constant carried over from a report. Every
      comparator is computed in the same run, on the same fold, from the same population.
- [ ] Results are reported at four train/eval cutoffs, per position, at both horizons, with the
      spread across splits shown.
- [ ] The gate is stated against the incumbent, per position, on the five-gameweek target, and the
      verdict is majority-of-splits.
- [ ] A named test proves the eval fold contributed nothing to fitting, at every cutoff.
- [ ] Every metric is still computed by a function imported from `scripts/run-backtest.ts`, never
      reimplemented. Grep-checkable: the script defines no Spearman and no rank function of its own.
- [ ] The report records the git SHA it ran at, and states which minutes model the incumbent
      figures reflect.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `scripts/train-and-evaluate-learned-model.ts`, its test file,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.

## Batch coupling — read this before starting

**The minutes-shrinkage ticket in this same batch changes the incumbent.** It widens
`PlayerProjectionInput` with an optional field and alters what `estimateMinutes` returns, so every
incumbent number in this report will differ from the ones quoted above. That is expected and is
exactly why every threshold is computed live. Record the SHA, state which minutes model was in
play, and do not compare against report 12's figures.

If that ticket changes an exported signature this script imports, `tsc -b` breaks on `main` after
the second merge even with both branches green — `LEARNINGS-second-build-wave.md` §11. Flag it
rather than working around it.

## Notes for the Analyst / Builder

- **The honest outcome here may well be "do not ship any of it."** A 0.016 midfield edge that halves
  under a second split is not a model, it is a coin landing the same way twice. Say so plainly; the
  seam exists so that abandoning this costs one line.
- If midfield survives every split and nothing else does, the recommendation is a hybrid — learned
  for midfielders, hand-built everywhere else — and that is a real, shippable result rather than a
  disappointment.
- The goalkeeper gap is the most informative number in the table and deserves a sentence in the
  report: the hand-built model has clean sheets and fixture scaling written into it explicitly,
  while the learned model has to rediscover both from fifteen columns and a few hundred rows. It is
  the clearest evidence in this project that structure beats learning where the structure is known.
