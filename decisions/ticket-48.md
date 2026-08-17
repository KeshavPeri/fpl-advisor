# Decisions — ticket #48

## HIGH-IMPACT

- **Imported `src/lib/projection/pointValues.ts`'s constants (`GOAL_POINTS`,
  `CLEAN_SHEET_POINTS`, `ASSIST_POINTS`, `APPEARANCE_POINTS_*`, `GOALS_CONCEDED_*`,
  `goalsConcededPointsApply`, `savePointsApply`) into `scripts/calibration-report.ts` rather
  than restating the point-value table** — **because** `pointValues.ts`'s own header states it
  is "the only place in the repository these numbers may appear" (ticket #33's DoD), and
  duplicating them here — including the non-obvious goalkeeper-goal value of 10 — would violate
  that invariant on the very ticket whose job is to check the model's own numbers are right.
  This only reads from `src/lib/projection/`; nothing under it is edited, which the ticket's
  scope still permits. `docs/projection-model-backlog.md`'s draft note anticipated an import
  from `src/lib/scoring/` but not this one, so it's logged here even though it needed no
  build-config change (`tsconfig.scripts.json` already had `allowImportingTsExtensions: true`
  and already includes the whole `scripts/` directory from ticket #33). (Tier 2)

## ROUTINE

- **`player_match_stats` filtered to `season = '2025-2026'` and `player_projections` filtered
  to `model_version = 'baseline-v1'`, both as named constants duplicated in-file rather than
  imported** — matching the `MODEL_VERSION`/`PROJECTION_HORIZON` duplication convention
  `scripts/emit-projections-csv.ts` already documents. **Because** both tables hold only one
  season/model-version today, but an explicit filter means a future second season or model
  can't silently widen this report's sample without someone noticing the constant needs
  updating. (Tier 3)
- **Used `status: 'skipped'` (not `'success'`) for the empty-table early-exit `job_runs`
  row**, matching the precedent `scripts/sync-squad.ts` already set for legitimate no-op
  states. (Tier 3)
- **New workflow (`calibration-report.yml`) is `workflow_dispatch`-only, no `schedule:`
  trigger** — this measures the model on demand rather than tracking data freshness nightly,
  matching `solver-smoke.yml`'s precedent and the ticket's own "so it can be re-run on demand"
  phrasing. (Tier 3)
