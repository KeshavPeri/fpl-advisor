# Ticket #201 — decisions

## HIGH-IMPACT

- **Part 2 (pre-#191 minutes reconstruction), Tier 2.** Reconstructed the pre-#191 minutes model as
  a full parallel combiner (`projectPlayerFixturePreTicket191Minutes` /
  `projectRowPreTicket191Minutes`) rather than a minutes-only helper, **because**
  `projectPlayerFixture` in `src/lib/projection/expectedPoints.ts` calls the shipped
  `estimateMinutes` internally with no injection point, and `expectedPoints.ts` is out of this
  ticket's scope to touch. Every non-minutes step (rates, fixture multipliers, defcon, conversion
  factors, `totalMatchPoints`) reuses the exact same exported pure functions the live pipeline
  uses — only the minutes step itself is reconstructed by hand, matching the ticket's explicit
  instruction that this is "a reconstruction... not a fork." `src/lib/projection/minutes.ts` is
  confirmed byte-identical to `main`.

## ROUTINE

- **Part 1, Tier 3.** `checkOracleCeiling`'s new signature takes
  `Record<Position, PositionRankingSummary>` for the model/oracle five-gameweek breakdowns rather
  than four more raw numeric parameters — matches the existing `checkRankingSanityBounds`
  convention already established in `scripts/run-backtest.ts`.
- **Part 2, Tier 3.** Threaded the pre-#191 five-gameweek sum through by adding one field to
  `WindowGameweekOutcome`'s `ok` variant and one defaulted trailing parameter to
  `classifyFiveGameweekRow` (default `0`), rather than duplicating the leg-classification/lookup
  control flow a second time — matches this file's existing convention of defaulted trailing
  parameters that are exact no-ops at every pre-ticket call site.
- **Fix, not a model decision.** Two pre-existing tests in `scripts/run-backtest.test.ts` (written
  for #187) hardcoded the assumption that the shipped and pre-#191 minutes constructions gave the
  same `expectedMinutes` (40) on the worked window `[90, 90, 20, 0, 0]`. That stopped being true
  once #191 shipped (shipped model now gives 50) — confirmed broken on `origin/main` independent of
  this ticket's changes. Updated the assertions to the shipped model's actual current output; both
  now pass. Judged in-scope to fix because it is literally the same worked window this ticket's own
  definition of done pins.
- **Scope deviation, noted not applied.** `scripts/fixtures/backtest-report-10.md` was left
  untouched even though its content is now stale (it asserts wording Part 1 retires), because the
  only test reading it, `scripts/publish-backtest-summary.test.ts`, is outside this ticket's scope
  constraint and updating the fixture without updating that test would break it. The DoD's "named
  test pins exactly that pair" requirement (goalkeeper 0.240 vs 0.201) was instead satisfied
  directly in `run-backtest.test.ts` with constructed data.
