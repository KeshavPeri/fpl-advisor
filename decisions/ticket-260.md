# Ticket #260 — One switch for which projection model the solver and app use

## HIGH-IMPACT

None this ticket.

## ROUTINE

- `emit-projections-csv.ts`'s empty-gameweek hard-fail was changed to check the union of
  `active` + `fallback` gameweek coverage rather than `active` alone. Because the ticket's own
  per-pair fallback mechanism means a temporary gap in the active model must not hard-fail the
  job — an active-only check would contradict the fallback the ticket asks for.
- Added a small `modelVersionsSettled` diagnostic field per gameweek to `settle-predictions.ts`'s
  `job_runs.details`, since a gameweek can now carry rows for more than one `model_version` and
  this makes that visible for QA/ops without changing settlement behaviour.
- Cleaned up a few `preflight-check.ts` comments left dangling by the removal of the old
  `MODEL_VERSION` constant they referenced.
- Pre-existing test failures noted, not caused by this ticket: 7 failures in
  `scripts/ingest-core-insights.test.ts` and `scripts/build-feature-history.test.ts` (stale
  README "not yet applied" migration-status assertions), confirmed present identically on
  unmodified `main` via `git stash`.
