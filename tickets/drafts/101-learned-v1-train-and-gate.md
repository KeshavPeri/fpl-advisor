## Context

Ticket #203 built `training_features` — 18,023 point-in-time rows for 2025-2026, reconciling
exactly against `feature_history`'s 18,588 read minus 565 with no prior matches. This ticket trains
a model on them and measures it against a pre-registered gate. It ships no projection: the gate
decides whether a later ticket puts `learned-v1` behind the CSV seam at all.

This is R6 from `docs/model-review-2026-09-02.md` §5, reshaped as that review asked — a small
learned model on columns this repo already ingests, not the OpenFPL 196-feature reconstruction,
which `product-brief.md` §6d calls the ticket shape this pipeline handles worst.

## The gate — pre-registered, and not negotiable inside this ticket

Measured on the five-gameweek ranking target, over the same measured population and the same
exclusions the backtest already uses, per position:

| Position | Must beat | What that number is |
|---|---|---|
| Midfielder | **0.464** | the naive "prior minutes per match" baseline |
| Forward | **0.476** | the naive "prior minutes per match" baseline |
| Goalkeeper | the incumbent's own figure, computed in the same run | the model beats the baseline here |
| Defender | the incumbent's own figure, computed in the same run | the model beats the baseline here |

The hindsight ceiling for reference is 0.201 / 0.479 / 0.521 / 0.562. The winnable band at midfield
and forward is roughly 0.06 to 0.09 of Spearman, and that is the entire prize.

**Why the gate is the naive baseline and not the hand-built model.** The review's original gate was
"beat the repaired baseline". Backtest report 11 shows the naive minutes ranker already beating the
hand-built model at five gameweeks, so that gate would pass a model with no real skill. This
correction is the point of stating the gate here rather than inheriting it.

**Compute the incumbent live, in the same run. Never quote a figure from a previous report.** Ticket
#204 reverts the minutes model, which moves every incumbent number. A gate read against a stale
comparator is not a gate.

## Scope

**In scope:**

- A new script that reads `training_features`, trains a model to predict a player-gameweek's points,
  and evaluates it at both horizons.
- **Reuse the harness's own metric code by importing it — never reimplement it.**
  `scripts/run-backtest.ts` already exports the ranking summarizers, the five-gameweek window
  classifier and the population rules. Import them. A second implementation of Spearman or of the
  window construction is how two instruments drift apart, and this repo has paid for that once
  already.
- A held-out evaluation that cannot see the gameweeks it is scored on. State the split rule
  explicitly and test it, exactly as the strictly-before guarantee is tested elsewhere.
- A written result: per-position Spearman at both horizons for the learned model, the incumbent and
  the three naive baselines, side by side, plus a plain statement of whether each gate line passed.
- The model choice, its hyperparameters and the reason for both, recorded in the decisions file.
  Something small and inspectable — gradient boosting on ~15 columns, not a neural network.

**Explicitly out of scope:**

- **Nothing user-visible.** No projection is written, no `player_projections` row gains a new
  `model_version`, no CSV changes, no recommendation moves. Putting a passing model behind the seam
  is the next ticket.
- **No change to `scripts/run-backtest.ts`.** Import from it; do not edit it. Ticket #205 owns that
  file this batch — see the coupling note below.
- No change to anything under `src/`, to `baseline-v1`, or to any existing report.
- No new external data source, no new ingest column, no migration.
- No tuning against the gate. Fit on the training split, evaluate once on the held-out split,
  report the number you get. Refitting until the gate passes is how a model that has learned
  nothing clears a bar.

## Definition of done

- [ ] The training and evaluation split is explicit, documented, and covered by a named test proving
      no gameweek in the evaluation set contributed to fitting.
- [ ] Every metric is computed by a function imported from `scripts/run-backtest.ts`, not
      reimplemented. Grep-checkable: the new script defines no Spearman, no rank function and no
      window classifier of its own.
- [ ] The result table reports the learned model, the incumbent and the three naive baselines at
      both horizons, per position, over the same population.
- [ ] Each gate line is reported as an explicit pass or fail against the numbers above.
- [ ] The decisions file records the model type, its hyperparameters, the column list actually used,
      and why — plus every column that was dropped and the reason.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new script and its test under `scripts/`,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.
      Nothing else — in particular `scripts/run-backtest.ts` and everything under `src/` are
      unchanged.

## Batch coupling — read this before starting

Two other tickets run alongside this one and both touch things this ticket depends on.

- **#204 reverts `src/lib/projection/minutes.ts`.** The exported signature and the `MinutesEstimate`
  shape do not change, so nothing here needs editing — but every incumbent number moves. This is
  why the gate compares against a live-computed incumbent rather than report 11's figures.
- **The goalkeeper-oracle ticket edits `scripts/run-backtest.ts`.** It must not change the signature
  of any function this script imports. If it does, `tsc -b` breaks on `main` after the second merge
  even though both branches are green — the exact failure `LEARNINGS-second-build-wave.md` §11
  records. If you need an export that does not exist yet, say so and stop rather than adding it
  here.

## If the gate fails

Say so plainly and stop. Do not tune, do not widen the gate, do not report a near miss as a pass.
The review's own words: the seam makes abandoning this a one-line regression, which is exactly why
the seam exists. A failed gate after a budgeted attempt is a real result and it saves two more
nights.

## Notes for the Analyst / Builder

- The training rows carry one season. That is a real limit on what any model can learn, and the
  result should be read with it in mind — say it in the report rather than leaving a reader to
  infer it.
- Ids are not stable across seasons. Key on `player_code` and `team_code` throughout
  (`deltas.md` D9).
- Every paginated Supabase read needs an explicit ordering. `scripts/lib/paginate.ts` fails closed
  without one, and it is right to.
- No live database read is required at build time beyond what the script itself does when Keshav
  runs it by hand, the same way `build-training-features.ts` runs.
