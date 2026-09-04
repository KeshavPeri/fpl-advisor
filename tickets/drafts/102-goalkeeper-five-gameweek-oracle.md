## Context

Ticket #201 extended the oracle-ceiling check from the season aggregate to every position, exactly
as `LEARNINGS-second-build-wave.md` §14 asks. It immediately caught something the aggregate had been
hiding: at the five-gameweek horizon the **goalkeeper** model scores Spearman **0.240** against its
own hindsight oracle's **0.201**. The model is above its ceiling, and the Backtest job is now red on
that one line.

`docs/projection-model-backlog.md` G14 has almost certainly already explained this. It established
that the quality oracle is a **quality-only** ranker with no fixture knowledge, that the model has
had genuine non-hindsight fixture knowledge since #175, and that for goalkeepers the weekly score is
dominated by the clean sheet — which is driven almost entirely by the opponent. G14's own
neutral-fixture ablation measured goalkeeper one-gameweek Spearman collapsing to **−0.021** when
fixture information is removed, against the oracle's 0.035 and the model's 0.157. Remove the
fixture and the model's goalkeeper ranking skill is gone.

G14 argued that at one gameweek and expected the effect to wash out over five, on the reasoning that
each leg's fixture is independent so fixture noise grows only as the square root of the horizon
while quality scales linearly. **For goalkeepers it evidently does not wash out.** That is the open
question, and it is a genuine finding rather than a defect.

**This is a diagnosis ticket. It changes no model figure.** The deliverable is an explanation that
survives its own falsification check, then a decision about the check.

## Lines of enquiry — none privileged

- **Is this simply G14's mechanism, undiminished?** A goalkeeper's five-gameweek total is five clean
  sheet lotteries plus a near-fixed appearance floor. If almost none of a keeper's variance is
  persistent player skill, then quality knowledge has very little to compound and the square-root
  argument never gets going. Test it on the numbers already in the report: compare how much of each
  position's five-gameweek variance the oracle explains against how much it explains at one
  gameweek.
- **Is the population the difference?** Goalkeeper is the smallest position by far — 616
  five-gameweek rows against 4,276 for midfielders. Check whether the gap is inside the noise a
  616-row Spearman carries.
- **Does the same shape appear for defenders?** They also earn clean sheets. Defender sits at 0.374
  against an oracle of 0.479 — comfortably bounded. If the mechanism is clean-sheet dominance, the
  gradient from goalkeeper to defender should be explainable in the same terms G14 used.

## The decision this ticket must reach

One of these, argued, not asserted:

1. **The oracle is not a valid ceiling for goalkeepers at either horizon**, for the same reason G14
   gave for one gameweek. Then the check exempts goalkeepers by name, with the exemption pointing at
   the entry that justifies it — and every other position stays checked.
2. **The oracle should be given the fixture information the model has.** A quality-plus-fixture
   oracle would be a genuinely fair bound at both horizons for every position. This is more work,
   needs its own leak-guard tests as rigorous as `computeOracleRate`'s, and is a new construction
   rather than a rewrite — but it is the answer that keeps a real bound on goalkeepers rather than
   removing one.
3. **Something else is wrong**, and the diagnosis says what.

Recommend one and say why. Implement it only if it is option 1 and the argument is complete;
option 2 is its own ticket.

## Falsification check

The explanation must account for **all three** of the following in terms of the constructions, not
by assertion:

1. why the goalkeeper five-gameweek model sits above its oracle,
2. why the defender five-gameweek model, also clean-sheet driven, sits comfortably below its oracle,
3. why the same goalkeeper gap is larger at one gameweek (0.157 against 0.035) than at five (0.240
   against 0.201) — the horizon is damping it, just not enough.

An explanation that covers one or two is incomplete and the ticket stays open. Say so rather than
shipping half an answer.

## Scope

**In scope:**

- Read the constructions and produce a written finding as a backlog entry, extending G14 rather than
  restating it.
- Any read-only variant computed inside the harness and **reported, never asserted**.
- If and only if the finding lands on option 1: a named goalkeeper exemption in
  `checkOracleCeiling`'s five-gameweek half, commented with a pointer to the entry that justifies it.

**Explicitly out of scope:**

- **The five-gameweek check stays in force for goalkeeper unless this ticket's own falsification
  check is fully satisfied.** It has caught two real leaks and one real finding. A red job is not a
  reason to relax a bound; a complete argument is.
- No exemption for any other position, and no change to the one-gameweek half, which #201 already
  retired.
- No change to any oracle construction — option 2 is a separate ticket if it is chosen.
- No change to anything under `src/`, no model figure moves, no migration, no workflow change.
- No constant tuned anywhere.

## Definition of done

- [ ] A backlog entry extending G14, naming the mechanism, that satisfies all three falsification
      points or states plainly which it cannot answer.
- [ ] The goalkeeper population question is addressed with a number, not dismissed.
- [ ] A recommendation between options 1, 2 and 3, with its reason.
- [ ] If option 1: the exemption is by position name, applies only to goalkeeper, only at five
      gameweeks, carries a comment pointing at the entry, and a named test proves every other
      position still fails on a breach.
- [ ] The report states, wherever the check is printed, that goalkeeper is exempt and why — an
      exemption nobody can see from the output is how a retired guard rail is forgotten.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`, its report
      fixture, `docs/projection-model-backlog.md`, and this ticket's own
      `decisions/ticket-<issue>.md`.

## Batch coupling — read this before starting

The learned-model training ticket in this same batch **imports** from `scripts/run-backtest.ts` —
its ranking summarizers, its five-gameweek window classifier and its population rules. **Do not
change the signature of any exported function in that file.** Both branches can be green and `tsc -b`
can still break on `main` after the second merge; that is `LEARNINGS-second-build-wave.md` §11, and
it cost a four-hour red deploy in August. Add to the file freely; change what it already exports,
and flag it rather than proceeding.

## Notes for the Analyst / Builder

- The tempting move is to make the red go away. It is the wrong instinct here for the same reason it
  was wrong for the five-gameweek leaks: this check has been right every time it has fired.
- G14 is the model for this entry — it reasoned from the constructions, made a pre-registered
  prediction, and that prediction was confirmed on the next live run to four positions out of four.
  Make a prediction the next report can check, and say what would refute it.
