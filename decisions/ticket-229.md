# Ticket #229 — Replace frozen ClubElo with point-in-time team strength

## HIGH-IMPACT

- **Kept `buildClubFixtureSchedule`/`lookupClubFixtureSchedule`/`resolveFixtureTeams`/
  `eloForExpectedScore`/`buildFixtureContextFromExpectedScore`/`FixtureCoverageCounts`
  in `run-backtest.ts` rather than moving them with the rest.** Chose to leave them
  because the brief says only the #175 team-strength construction moves — these
  are ticket #193's own window-scheduling work and backtest-only elo-reverse-
  engineering glue, not part of what #229 asks to relocate.

- **`run-backtest.ts` re-exports the moved names instead of having
  `run-backtest.test.ts` re-point every import to the new module.** Chose the
  re-export because it is a strictly smaller, lower-risk diff that leaves the
  existing 300+ backtest tests byte-identical while still satisfying the DoD's
  "imports it, no second copy" requirement.

- **Added `fixtureSourceCounts` (full four-tier source breakdown) to
  `job_runs.details`, alongside the existing `fixtureEloFallbackCount` left
  untouched.** Chose to add rather than replace because the new precedence
  makes "elo fallback" no longer the only interesting split in the data, and
  the extra counter is cheap, additive observability that doesn't change any
  existing consumer's contract.

- **Extracted `buildFixtureContext` and `buildCurrentSeasonTeamMatchRecords` in
  `project-points.ts` as named, independently-testable pure functions rather
  than inlining the wiring.** Chose to extract because the ticket's central
  claim is about the *wiring* between precedence and the live job, not just
  the underlying primitives — and that wiring needed to be provable by a test
  without a live Supabase connection.

- **`scripts/team-strength-diagnostic.ts` imports `buildFixtureContext`,
  `TeamMetadata` and `CURRENT_SEASON` directly from `project-points.ts` rather
  than reimplementing the wiring.** Chose to reuse because a second copy of
  that exact wiring is precisely the kind of drift risk this whole ticket
  exists to eliminate.

## ROUTINE

- `HOME_EXPECTED_SCORE_BONUS`: implemented the ticket's own stated formula
  (`1 / (1 + 10 ** (-65 / 400)) - 0.5`) literally rather than the ticket's
  written digit `0.0927` — evaluating the formula gives `0.092466...`, which
  rounds to `0.0925`, not `0.0927`. The ticket states this value is "derived
  in a code comment... not a chosen number," so the formula is the authority
  and the literal was a rounding slip in the ticket text. Documented the
  discrepancy directly in the code comment and in the test that checks the
  constant, rather than silently using either number without explanation.
- `MAN_UTD_SHORT_NAME`/`MAN_CITY_SHORT_NAME` (FPL's own bootstrap-static short
  names, `'MUN'`/`'MCI'`) used as the falsification gate's match key, with an
  explicit `'not-applicable'` status (never a guessed pass/fail) if that exact
  fixture isn't present in whichever gameweek is `is_next` when the diagnostic
  actually runs.
- Diagnostic report lists both teams' rows per fixture (two rows, not one),
  which is mathematically equivalent for the population-stdDev gate (a home
  team's `expectedScore` and its away opponent's are exact complements), and
  makes locating "Man Utd's own row" direct regardless of venue.
- `TEAM_STRENGTH_DIAGNOSTIC_REPORT_PATH` env override with a
  `./out/team-strength-diagnostic.md` default, mirroring the existing
  `CALIBRATION_REPORT_PATH` convention in `calibration-report.ts` exactly.
- `leagueBaselineGoals: 1` used as a placeholder value passed into
  `buildFixtureContext` inside the diagnostic script — never read by
  `resolveFixtureExpectedScore`, so an arbitrary non-zero placeholder avoids
  an otherwise-unused fetch of `fixtures`' finished-score aggregation that
  this diagnostic has no other need for.

## Falsification gate — NOT YET EVALUATED

`scripts/team-strength-diagnostic.ts` is written and its own 25 tests pass
against constructed data (including a reproduction of the ticket's reported
Man Utd/Man City defect), but **it has never been run against live data**:
this environment has no Supabase credentials anywhere (confirmed
independently across all three tickets in this run). Per the ticket's own
text — "Stop and report — do not merge — if either of these fails" — **this
PR must not be merged until someone with production credentials runs
`npx tsx scripts/team-strength-diagnostic.ts` and reads
`./out/team-strength-diagnostic.md`**, confirming (1) the point-in-time
Man Utd `expectedScore` for the GW4 fixture is below 0.5, and (2) the
point-in-time population stdDev across the horizon's fixtures is not lower
than the frozen-elo stdDev over the same fixtures. This is flagged in the PR
body as well.
