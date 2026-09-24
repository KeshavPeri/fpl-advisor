# Ticket #265 — Run gbm-v1 every night and write its projections next to baseline-v1

## HIGH-IMPACT

None.

## ROUTINE

- A double-gameweek row's `components` (drivers, `lambda_for`/`lambda_against`) reports the primary
  (first, by fixture id) fixture only — the ticket doesn't specify how to combine two fixtures' SHAP
  drivers or odds into one informational block. `expected_points`/`expected_minutes` are still the
  full two-fixture sum; only the informational fields are single-fixture.
- "% of horizon fixtures with odds" (the run summary line) is computed as % of actual fixtures with
  a matching live `fixture_odds` entry, not % of payload rows — the ticket's wording says "fixtures."
- Fixture "slot" order for a double gameweek is ascending fixture-id order, since the FPL fixtures
  response carries no reliable ordering field before kickoff times are confirmed for a newly
  announced DGW.
- `computed_at` is set explicitly on every payload row, matching `scripts/project-points.ts`'s
  existing convention, rather than relying on the column's DB default.
- Bug fix found during testing, not a design decision but worth recording: `lambda_for`/
  `lambda_against` come back from pandas as float `NaN` once the column holds real values elsewhere;
  `jsonb` has no `NaN` literal, so a bare `NaN` would make PostgREST reject the whole batch. Fixed by
  converting to `None` explicitly via `pd.isna(...)` in `build_payload`, locked in with a test.
