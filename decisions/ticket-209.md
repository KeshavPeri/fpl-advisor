# Ticket #209 — Diagnose the goalkeeper five-gameweek oracle breach

## HIGH-IMPACT

- **Chose option 1 (exempt goalkeeper from the five-gameweek oracle-ceiling check, by name,
  at that horizon only) because the falsification check is fully satisfied by one mechanism:**
  a goalkeeper's fixture-independent, season-measurable quality signal is 55–135x smaller than
  the other three positions' (squared-Spearman of the oracle itself: GK 0.0012 at one gameweek
  and 0.0404 at five, versus 0.0702–0.1624 and 0.2294–0.3158 for DEF/MID/FWD). G14's
  square-root-of-horizon compounding argument does operate on goalkeepers — the gap shrinks
  from 0.122 to 0.039 exactly as predicted — but it is compounding a starting signal too small
  to close the gap in five legs, while defenders (also clean-sheet driven) have a second,
  fixture-independent scoring dimension (defensive contribution + attacking returns) that keeps
  their oracle a real bound. This is a HIGH-IMPACT call under escalation.md's test question: it
  changes what the nightly correctness check validates for goalkeepers going forward, and
  reversing it requires re-doing this diagnosis or a future run's evidence contradicting it.
  Rejected option 2 (a fixture-aware oracle valid for every position at both horizons) as a
  separate, ticket-sized new construction needing its own leak-guard tests — correct as a
  destination, wrong as a rider on this diagnosis ticket. Rejected option 3 because no part of
  the falsification check pointed at a different or additional cause.
- Full argument, the population-size standard-error read (GK SE≈0.040 on n=616 vs MID
  SE≈0.015 on n=4,276), and a falsifiable prediction for future backtest runs are recorded in
  `docs/projection-model-backlog.md` entry G16 — this decisions entry summarizes rather than
  duplicates it.

## ROUTINE

- Used squared-Spearman ("share of rank variance explained") as the comparison metric across
  positions and horizons — a heuristic already used the same way in the existing G8/G12
  backlog entries, not a new modelling technique.
- Left `scripts/fixtures/backtest-report-10.md` untouched despite it being named in the
  ticket's scope constraint, following the precedent `decisions/ticket-201.md` recorded for the
  same file: it is a hand-built, non-live fixture consumed only by
  `scripts/publish-backtest-summary.test.ts`, which is outside this ticket's scope and was
  confirmed (by QA, independently) to still pass unmodified.

## Note for a future ticket

QA observed `docs/projection-model-backlog.md` has had two entries both numbered "## G15"
since tickets #201 and #203 landed — pre-existing on `main`, not introduced by this ticket.
Worth a renumbering pass sometime; not fixed here as it is outside this ticket's scope.
