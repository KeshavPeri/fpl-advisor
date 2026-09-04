# Ticket #197 — Diagnose the one-gameweek oracle-ceiling failure

## HIGH-IMPACT

- Added a new REPORTED-ONLY diagnostic to `scripts/run-backtest.ts` / `scripts/run-backtest.test.ts` — the one-gameweek measured population re-projected through the same `projectRow` combiner with every fixture forced neutral, printed under a new "Diagnostic (ticket #197)" report section. Chose this **because** the ticket's scope explicitly permits "a variant computed inside the harness and reported, never asserted" to test a hypothesis, and this gives a fresh, current-population confirmation of the fixture-information mechanism rather than relying solely on an older, separately-validated Python reconstruction (`docs/model-review-2026-09-02.md` §3). It touches no existing figure, adds no assertion, and `checkOracleCeiling` reads none of it.

## ROUTINE

- Placed the new field (`oneGwNeutralFixtureModel`) inside `FiveGameweekReportData` next to `oracleOneGw`, matching the file's existing convention of bundling all one-gameweek-oracle-adjacent diagnostics there rather than at the top-level `ReportData`.
