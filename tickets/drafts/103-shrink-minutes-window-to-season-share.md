## Context

`docs/model-review-2026-09-02.md` §1f named a specific defect and only half of it has ever been
acted on: *"at the 5-GW target the plain season-average-minutes baseline beats the 5-match-window
model for midfielders (0.473 vs 0.444) — the window is too reactive for a long horizon — so minutes
v2 should shrink the recent window toward the season share, exactly the two-stage pattern rates
already use."*

Ticket #191 attempted the first half (a start / minutes-given-start split) and was reverted by #207
after measuring worse at both horizons. **The shrinkage half has never been built**, and backtest
report 12 shows it is now the single largest remaining gap in the model:

| Five-gameweek ranking | Model | Naive "prior minutes per match" |
|---|---|---|
| Season | 0.407 | 0.407 |
| Midfielder | **0.421** | **0.464** |
| Forward | **0.442** | **0.476** |
| Defender | 0.385 | 0.362 |
| Goalkeeper | 0.228 | 0.071 |

The naive baseline is nothing but a season minutes average. The full model — which has that same
history plus fixtures, xG, xA, clean sheets and defensive contribution — loses to it by 0.043 at
midfield and 0.034 at forward. A model with strictly more information losing to one input means it
is using that input badly, and the review already said how: the five-match window is too twitchy
over a five-week horizon.

`src/lib/projection/rates.ts` already solves exactly this problem for xG and xA, with the
"phantom nineties" shrinkage formula and no fitted constant. This ticket applies the same shape to
minutes.

## Scope

**In scope:**

- `estimateMinutes` takes the player's **season minutes per match** alongside the recent window, and
  shrinks the window's mean toward it using the existing shrinkage shape — more recent matches means
  more weight on the window, few means more weight on the season figure. Reuse `rates.ts`'s formula
  and its existing constant; **do not introduce a new fitted parameter.**
- Thread the season figure through as an optional field on `PlayerProjectionInput`, populated by
  every producer: `scripts/project-points.ts` (live), `scripts/run-backtest.ts`'s `projectRow`
  (from `prior_minutes / prior_matches`), and `scripts/calibration-report.ts`. A producer that
  cannot supply it falls back to today's behaviour, counted and reported — never silently.
- **Measure the change inside the same run.** `scripts/run-backtest.ts` already carries
  `estimateMinutesPreTicket191`, the harness-only comparison function #201 added. Repoint that
  section at the pre-shrinkage construction so one report shows the shipped model against the
  unshrunk one, per position, at both horizons. That is this ticket's own falsification check.

**Explicitly out of scope:**

- No return of #191's start / minutes-given-start split, no `dropSingleLowest`, no other change to
  the minutes model. This ticket changes how the window is weighted against the season, nothing else.
- No new fitted constant anywhere. If the existing shrinkage constant looks wrong for minutes, say
  so and stop — do not tune it.
- No change to rates, defcon, fixtures, bonus, the solver, the app, or any confidence threshold.
- No migration, no new Supabase read, no workflow change.

## Definition of done

- [ ] `estimateMinutes` shrinks the recent window toward the season figure using the shrinkage
      shape already in `rates.ts`, with no new fitted parameter.
- [ ] The shrinkage collapses to today's behaviour exactly when a player has a full window and no
      season history beyond it, and to the season figure when the window is empty. Named tests for
      both ends.
- [ ] A named test on a concrete case: a nailed starter with one recent rested match moves less
      than he does today, and a genuinely fading player still moves.
- [ ] Every producer of `PlayerProjectionInput` supplies the season figure, or is counted in a
      reported fallback tally.
- [ ] The backtest report shows the shrunk model against the unshrunk one, per position, at both
      horizons, in one run.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `src/lib/projection/minutes.ts`, `src/lib/projection/expectedPoints.ts`,
      `scripts/project-points.ts`, `scripts/run-backtest.ts`, `scripts/calibration-report.ts`, their
      test files, and this ticket's own `decisions/ticket-<issue>.md`.

## Falsification check — STOP AND REPORT

The premise is a causal claim about a measured number, so it carries figures that must move
(`LEARNINGS-second-build-wave.md` §17).

**At five gameweeks, midfield must rise from 0.421 toward the 0.464 baseline, and forward from
0.442 toward 0.476.** If neither moves materially, the diagnosis is wrong: stop, do not merge, and
report the numbers. Do not adjust the shrinkage strength to make it move.

What this will NOT change: goalkeeper and defender, where the model already beats the baseline
comfortably and the minutes signal is not the binding constraint. Do not read those standing still
as a failure.

## Notes for the Analyst / Builder

- **This changes every projected point in the live app.** Keshav's post-merge sequence is scheduled
  jobs, solver run, preflight, then a fresh backtest.
- The two-stage pattern is already written down and already measured as principled in
  `docs/projection-model-backlog.md` G6 — read that entry before writing the formula, rather than
  inventing a second shrinkage convention in the same codebase.
- **Batch coupling:** widening `PlayerProjectionInput` is a shared-type change, and another ticket
  in this batch imports from `scripts/run-backtest.ts`. Adding an optional field is backward
  compatible; changing or removing an existing one is not. Do neither without flagging it — that is
  `LEARNINGS-second-build-wave.md` §11, and it cost a four-hour red deploy in August.
