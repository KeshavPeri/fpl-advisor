## Context

`scripts/run-backtest.ts`'s `checkOracleCeiling` fails at the one-gameweek horizon and has done
for several reports: the quality oracle scores Spearman **0.336** while the model it is supposed
to bound scores **0.345**, over the same 10,460-row population. The check exits the job non-zero.

That bound is the most productive check in this harness — it caught two separate lookahead leaks
in the five-gameweek construction (backlog G13 and its #193 addendum), and it must not be relaxed
to make this failure go away. But it is now the **only** thing keeping the Backtest job red, so no
future ticket can get a clean signal from that workflow until this is settled.

**This is a diagnosis ticket. It changes no behaviour.** The deliverable is a written explanation
that survives its own falsification check, and a proposal. Any change to the oracle or to the
assertion is a follow-up ticket with its own check. The repo's standing rule applies:
`LEARNINGS-second-build-wave.md` §18 — when a measured number is surprising, the default hypothesis
is that the instrument is wrong, not the model.

## What is already known, and must be accounted for

Do not re-derive these. They are the constraints any correct explanation has to fit.

- **The five-gameweek oracle does not have this problem.** After #193 it sits at 0.506 against the
  model's 0.397 — comfortably above, as a ceiling should be. Whatever is wrong is specific to the
  one-gameweek construction or to the one-gameweek comparison, not to oracle logic in general.
- **The one-gameweek model path cannot leak.** Each row is projected from its own `feature_history`
  row, whose strictly-before guarantee is structural, and non-featuring rows are excluded before
  anything is projected. The three leaks found so far were all in the five-gameweek window path.
- **A leak-free independent construction predicted this exact inversion.**
  `docs/model-review-2026-09-02.md` §3 built the backtest again in Python from the public CSVs and
  reported, at one gameweek, quality oracle **0.332** against a model-with-live-window-minutes of
  **0.354**. The review's own text says the single-gameweek question is nearly saturated and the
  oracle "reaches only ~0.33" there. So the inversion was predicted, by a construction with no
  lookahead, before the harness ever produced it.
- **The by-position table is the sharpest clue in the report.** Goalkeepers: oracle **0.035**,
  model **0.157**. Defenders: oracle 0.265, model 0.286. Midfielders: oracle 0.402, model 0.400.
  Forwards: oracle 0.403, model 0.428. The oracle loses worst exactly where the model's points
  come from something the oracle cannot see.

## Lines of enquiry — none privileged, all to be tested against the constraints above

- **What does the oracle actually know?** It is a player's out-of-window points-per-match rate. It
  knows nothing about who the player faces, whether he plays that week, or that a goalkeeper's
  score is mostly a clean sheet. The model knows all three. If a quality-only ranker is simply not
  an upper bound on a model that also has minutes and fixture information, then the oracle is not
  mis-specified at all — **the assertion is**, and the fix is to stop calling it a ceiling at one
  gameweek. The goalkeeper figures are the strongest evidence for this reading.
- **Why does the same construction bound the model at five gameweeks and not at one?** Aggregating
  five weeks averages away the week-to-week noise that dominates a single gameweek, so quality
  knowledge compounds while the model's minutes edge does not. A correct explanation must say this
  in terms of the two constructions, not by assertion.
- **Tie handling.** A zero-point actual is extremely common. Check whether ties are handled
  identically on the oracle's ranking and the model's, and whether a tie-heavy target penalises one
  ordering more than the other.
- **Population identity.** Confirm the oracle is ranked over exactly the same rows as the model,
  row for row, with the same exclusions — the report says 0 rows skipped, but confirm it rather
  than reading it.

## Falsification check

The diagnosis is confirmed only when it explains **both** of the following in terms of the
construction:

1. why the one-gameweek oracle scores below the model, **and**
2. why the five-gameweek oracle, built from the same idea, scores above it.

An explanation that accounts for one and not the other is incomplete and the ticket stays open.
Say so plainly rather than shipping half an answer.

## Scope

**In scope:**

- Read the two oracle constructions and the check, and produce a written finding.
- Any read-only computation needed to test a hypothesis — a variant computed inside the harness
  and reported, never asserted.
- The finding written into `docs/projection-model-backlog.md` as its own entry.
- A proposal, stated but not implemented: either the oracle is wrong and how, or the assertion is
  wrong and what should replace it at one gameweek.

**Explicitly out of scope:**

- **No change to `checkOracleCeiling`** — not relaxed, not widened, not downgraded to a warning,
  not removed, not made to pass. It is the guard rail that found both five-gameweek leaks.
- No change to `computeOracleFeaturedRate`, `computeOracleAppearanceRate` or
  `computeOracleFiveGameweekEstimate`.
- No change to any model figure, to `src/`, to a migration or to a workflow.
- No constant tuned anywhere.

## Definition of done

- [ ] A written finding in `docs/projection-model-backlog.md` naming the mechanism, not a
      hypothesis list.
- [ ] The finding explains both horizons, per the falsification check above, or states plainly
      that it cannot and leaves the question open.
- [ ] The goalkeeper figures (oracle 0.035 against model 0.157) are addressed explicitly — any
      explanation that does not account for the largest gap in the table is not the explanation.
- [ ] A stated proposal for the follow-up, with which of the two things is wrong, the oracle or
      the assertion.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `docs/projection-model-backlog.md` and this ticket's own
      `decisions/ticket-<issue>.md`. If a variant computation is genuinely needed inside the
      harness, `scripts/run-backtest.ts` and `scripts/run-backtest.test.ts` may change to add a
      REPORTED diagnostic only — never an assertion, never a change to an existing figure.

## Notes for the Analyst / Builder

- The tempting move here is to "fix" the oracle until the check passes. That is the failure this
  repo has already paid for once: ticket 89 rewrote the five-gameweek oracle against a confident
  wrong diagnosis, the number moved 0.507 to 0.506, and a night was spent (§17). The oracle is the
  easier construction to re-read, which is exactly why it attracts the blame.
- It is a legitimate and valuable outcome for this ticket to conclude that nothing is broken and
  that the one-gameweek section simply cannot support a ceiling check. Say it if it is true.
- Whatever the finding, the five-gameweek half of `checkOracleCeiling` stays exactly as it is.
