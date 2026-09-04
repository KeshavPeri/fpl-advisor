## Context

Ticket #191 (minutes model v2, commit `e652df7`) separated P(start) from minutes-given-start and
dropped the single lowest value from a full five-match window. Its own definition of done
pre-registered a revert condition: **"if any position moves away from 1.00, revert rather than
tune."**

Three of four positions did, on the day it shipped. The revert was deferred — openly, and with the
departure stated — on the grounds that the backtest was the better instrument for the question and
was broken at the time. That instrument is now honest, and the evidence is in. All three lines point
the same way.

**1. The pre-registered calibration criterion, failed and still failing.** Appearance ratios by
position:

| Report | GK | DEF | MID | FWD |
|---|---|---|---|---|
| 7 — before #191 | 1.06 | 1.00 | 0.96 | 0.92 |
| 8 — after #191 | 1.05 | 0.98 | 0.93 | 0.89 |
| 9 — after #191, five days on | 1.05 | 0.98 | 0.94 | 0.89 |

Three positions moved away from 1.00 and stayed there. Two independent readings, same answer.

**2. The honest backtest, both horizons.** Ticket #201 reconstructed the pre-#191 minutes model
inside the harness and ran both side by side over the identical population, with every other input
held constant (backtest report 11):

| Ranking | Pre-#191 | Shipped (#191) |
|---|---|---|
| One gameweek, season | **0.354** | 0.345 |
| Five gameweek, season | **0.407** | 0.397 |
| One gameweek, midfield | **0.411** | 0.400 |
| One gameweek, defence | **0.296** | 0.286 |
| Five gameweek, midfield | **0.421** | 0.412 |
| Five gameweek, defence | **0.385** | 0.374 |

The shipped model wins only at goalkeeper on one gameweek (0.157 against 0.149) and at goalkeeper
and forward on five (0.240/0.452 against 0.228/0.442). It loses the season aggregate at both
horizons and loses midfield and defence at both.

**3. The independent prediction.** `docs/model-review-2026-09-02.md` §3 predicted a correct
live-window minutes model would score **0.354** at one gameweek, from a reconstruction built
separately in Python with no lookahead. The pre-#191 construction scores exactly that. #191 moved
the model away from the review's predicted state, not toward it.

**And the prize is concrete.** At five gameweeks the naive "prior minutes per match" baseline scores
0.407 and the shipped model scores 0.397 — the model currently loses to a one-line ranker. The
pre-#191 model scores 0.407. Reverting closes that deficit entirely.

## Scope

**In scope:**

- Restore `src/lib/projection/minutes.ts` to its pre-#191 state: the plain mean of the
  recent-minutes window, no `dropSingleLowest`, no start/minutes-given-start split.
  `git show e652df7 -- src/lib/projection/minutes.ts` is the exact diff to reverse.
- Restore the corresponding tests, and delete the tests that only existed to prove the #191
  behaviour.
- Fix the two `buildRecentMinutes` assertions in `scripts/run-backtest.test.ts` that #191 broke and
  that have been failing on `main` ever since — the window `[90, 90, 20, 0, 0]` returns to expected
  minutes **40** and pSixtyPlus **0.4**, which is what those tests already assert. They should
  simply start passing again; if they do not, the revert is incomplete.
- A backlog entry recording the three lines of evidence above, and stating plainly that #191's idea
  was reasonable and its execution measurably worse, so nobody re-proposes it without new grounds.

**Explicitly out of scope:**

- **No new minutes model.** This ticket reverts; it does not tune, and it does not attempt the
  review's R4 remainder (shrinking the recent window toward the season share). That is a separate
  ticket and it must be measured against the reverted incumbent, not against #191's.
- No change to `scripts/run-backtest.ts` — ticket #201's pre-#191 comparison sections stay exactly
  as they are. They will now report two near-identical models, which is correct and is the proof
  the revert landed.
- No change to any other projection input, to the solver, to the app, or to any confidence
  threshold.
- No migration, no new Supabase read, no workflow change.

## Definition of done

- [ ] `src/lib/projection/minutes.ts` is functionally identical to its state at the commit before
      `e652df7` — no `dropSingleLowest`, no `splitFeaturedFromSample`, `estimateMinutes` returning
      the plain windowed mean scaled by availability.
- [ ] `estimateMinutes` keeps its exported signature and its `MinutesEstimate` shape unchanged, so
      no consumer needs editing.
- [ ] The window `90, 90, 90, 90, 0` returns expected minutes 72 and pSixtyPlus 0.8 — the exact
      case #191's own file header cited as the problem it was solving. A named test pins it, with a
      comment saying this is deliberate and why.
- [ ] The window `[90, 90, 20, 0, 0]` returns expected minutes 40 and pSixtyPlus 0.4.
- [ ] The two previously-failing `buildRecentMinutes` assertions in `scripts/run-backtest.test.ts`
      now pass, untouched.
- [ ] The full test suite's failure count drops by exactly those two against `main`.
- [ ] The backlog entry records the three evidence tables above verbatim.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `src/lib/projection/minutes.ts`, its test file,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.
      `scripts/run-backtest.ts` does not change.

## What this changes for real, and the post-merge check

**This is the first ticket in three weeks that changes a live projection.** Every projected point
in the app moves. Keshav's post-merge sequence is the standard one — scheduled jobs, solver run,
preflight — and then a fresh Backtest, where the expected reading is: the shipped model and the
pre-#191 comparison sections now agree to within rounding, the five-gameweek season figure sits at
about 0.407, and the gap to the naive minutes baseline closes to roughly zero.

If the two sections do not converge, the revert is incomplete and that is the thing to check first.

## Notes for the Analyst / Builder

- **#191 was not a bad idea and the ticket should say so.** Averaging `90, 90, 90, 90, 0` to 72
  minutes genuinely does describe a player nobody is. The reasoning was sound, the data behind it
  was real, and it was measured properly the moment a working instrument existed. It lost. That is
  pre-registration working exactly as intended, and recording it that way is what stops the same
  idea arriving again in six months dressed as a new insight.
- Do not take the opportunity to "improve" the reverted model while you are in the file. Revert,
  measure, then decide separately.
