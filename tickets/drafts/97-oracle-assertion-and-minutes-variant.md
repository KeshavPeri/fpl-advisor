## Context

Two pieces of instrument work in `scripts/run-backtest.ts`. They are one ticket because they are
one file and the batch rule forces it, not because they are one idea. Report them separately.

**Part 1 — retire the one-gameweek ceiling assertion.** `docs/projection-model-backlog.md` G14
(ticket #197) diagnosed the failure and its pre-registered prediction was confirmed on backtest
report 10: forcing every fixture neutral drops goalkeeper Spearman to **−0.021** against the
quality oracle's 0.035 and the model-as-run's 0.157, defenders move 0.034, midfielders and forwards
barely move at all. All four positions moved as predicted. The conclusion is settled: the
one-gameweek quality oracle is a quality-only ranker with no fixture knowledge, the model has
genuine non-hindsight fixture knowledge since #175, and a quality-only ranker was never entitled to
bound it. G14's own recommendation is option 1: stop treating the one-gameweek comparison as a
pass/fail ceiling.

**Part 2 — judge ticket #191 (minutes model v2), which has been open since 2 September.** Its
definition of done pre-registered: *"if any position moves away from 1.00, revert rather than
tune."* Three of four did. The revert was deferred on the stated grounds that the backtest was the
better instrument and was broken at the time. The backtest is now honest, and the deferral has to
be closed rather than left to become a permanent keep by default
(`LEARNINGS-second-build-wave.md` §19c). Calibration reports 8 and 9 are identical on this —
appearance ratios 1.05 / 0.98 / 0.94 / 0.89 — so two readings now say the same thing, and neither
of them is the ranking evidence the deferral was waiting for.

## Scope

**In scope — Part 1:**

- Remove the one-gameweek branch of `checkOracleCeiling`'s assertion. The one-gameweek oracle stays
  fully computed and fully reported, including #197's fixture-forced-neutral diagnostic; it simply
  stops being something the job exits non-zero over.
- **Extend the five-gameweek branch to every position, not just the season aggregate.** Report 10
  shows the goalkeeper five-gameweek model at 0.240 against its own oracle at 0.201 — the model
  above its ceiling — and the check does not fire because it only reads the headline. That is the
  exact defect `LEARNINGS-second-build-wave.md` §14 recorded: a bound checked at the aggregate does
  not protect the breakdown. Per-position failures must fail the job, naming the position.
- Record the change in `docs/projection-model-backlog.md` under G14, as the follow-up that entry
  proposed.

**In scope — Part 2:**

- A reported-only variant re-projecting every one-gameweek measured row, and every five-gameweek
  window, through a pre-#191 minutes construction alongside the shipped one. The pre-#191
  construction is the plain mean of the recent-minutes window with no single-lowest drop and no
  start/minutes-given-start split — `git show e652df7 -- src/lib/projection/minutes.ts` is the
  exact diff to mirror.
- The variant is a second, clearly-named function inside the harness. **`src/lib/projection/minutes.ts`
  must not change.** The harness compares the shipped model against a reconstruction of the old
  one; it does not fork the live model.
- Both horizons reported side by side, per position, against the same naive baselines already in
  the report.

**Explicitly out of scope:**

- **The five-gameweek ceiling assertion is not relaxed, widened, downgraded or removed.** It has
  caught two real leaks. This ticket makes it stricter, never looser.
- No change to any oracle construction.
- No change to anything under `src/` — no live projection moves, and #191 is not reverted by this
  ticket. This ticket produces the evidence; the revert or keep is a decision Keshav makes from it.
- No migration, no new Supabase read, no workflow change.
- No constant tuned anywhere.

## Definition of done

- [ ] `checkOracleCeiling` no longer asserts anything about the one-gameweek horizon, and the
      one-gameweek oracle and #197's neutral-fixture diagnostic are still computed and printed
      unchanged.
- [ ] The five-gameweek half now checks the season aggregate **and every position**, and a
      per-position breach fails the job naming that position. A named test proves a per-position
      breach fails while the aggregate passes.
- [ ] On report 10's own figures the new per-position check would FAIL on goalkeeper (model 0.240,
      oracle 0.201). A named test pins exactly that pair.
- [ ] The pre-#191 minutes variant is reported at both horizons, per position, and asserts nothing.
- [ ] A named test proves the variant reproduces the pre-#191 arithmetic on the worked window
      `[90, 90, 20, 0, 0]`: expected minutes 40 and pSixtyPlus 0.4, against the shipped model's 50
      and 0.5.
- [ ] `src/lib/projection/minutes.ts` is byte-identical to `main`.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`, its report
      fixture, `docs/projection-model-backlog.md`, and this ticket's own
      `decisions/ticket-<issue>.md`. Nothing else.

## What this ticket does NOT settle, and must say so

The Backtest job may still exit 1 after this merges — now on the new per-position five-gameweek
check, which is a real finding rather than a broken assertion. That is the check working. It does
not mean this ticket failed.

## Notes for the Analyst / Builder

- Do not "fix" the goalkeeper five-gameweek breach in this ticket. Surfacing it is the job; the
  cause is the same fixture-knowledge mechanism G14 describes and it needs its own entry, not a
  patch made in passing.
- Report the two parts in two separate report sections and two separate decisions entries. A single
  ticket with two premises is how ticket 89 went wrong; keeping them visually separate is what
  stops a reader crediting one part's result to the other.
