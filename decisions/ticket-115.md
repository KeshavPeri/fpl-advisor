# Ticket #115 — Preflight alarm for the league-baseline-goals fallback

## HIGH-IMPACT

None. This ticket is Tier 3 throughout — a read-only assertion added to an existing read-only
check, per the ticket's own classification.

## ROUTINE

- The PASS range for a computed value is treated as **inclusive** at both ends (1.0 and 2.5 pass;
  0.99 and 2.51 fail), **because** the ticket phrases the criterion as "within 1.0 to 2.5," which
  reads as an inclusive range under ordinary usage, and this keeps the boundary symmetric and
  testable at both ends.
- The finished-fixture count is read via a second, independent, DB-filtered count query rather than
  from `job_runs.details`, **because** `project-points.ts`'s own `details` object only records
  `leagueBaselineGoalsSource` and `leagueBaselineGoals`, never the finished-fixture count — so the
  count needed for the reason string has to come from the same filter shape (`finished = true`, both
  scores non-null) that `project-points.ts` uses for its own 20-fixture decision, mirroring the
  count-only-query convention `checkMatchData` already uses in this file. The 20-fixture threshold
  itself is duplicated only as a named constant (`LEAGUE_BASELINE_MIN_FINISHED_FIXTURES = 20`),
  matching the file's existing convention of duplicating `MODEL_VERSION`/`PREFLIGHT_HORIZON` as
  named constants, not re-deriving the decision logic.
- An unrecognised `leagueBaselineGoalsSource` value (neither `"fallback"` nor `"computed"`) is
  treated as FAIL, not silently passed, **because** the file's own stated rule is that it never
  returns PASS for something it could not evaluate — not explicitly asked for by the ticket, but a
  direct application of that existing rule.
- The new check is appended as check 11, independent of the target-gameweek cascade, **because** it
  doesn't depend on `targetGameweekId` and should always evaluate regardless of that cascade's state.
