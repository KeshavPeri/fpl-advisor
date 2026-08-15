# Decisions — ticket #34

## HIGH-IMPACT

(none this ticket)

## ROUTINE

- **Filtered `player_projections` reads by `model_version = 'baseline-v1'`** — because the
  table's primary key is `(gameweek_id, player_id, model_version)`, and an unfiltered read would
  emit duplicate rows the moment item 31 (retrained OpenFPL) writes a second model version under
  the same key. Matches the design intent already recorded in
  `tickets/drafts/15-projections-csv-adapter.md`, which is ahead of the live issue #34 body on
  this point — the two have drifted and issue #34's text should be synced to match. Low-risk,
  cheap to reverse, and squarely within this ticket's own purpose (a correct CSV, not a
  duplicated one). (Tier 3)
- **`PROJECTION_HORIZON` and `MODEL_VERSION` are declared as local constants in
  `emit-projections-csv.ts` rather than imported from `scripts/project-points.ts`** — CLAUDE.md's
  cross-import boundary is `scripts/*.ts` → `src/lib/`, not `scripts/*.ts` → `scripts/*.ts`, so
  this matches existing convention. Drift between the two jobs' horizons is caught at runtime
  instead: an empty horizon gameweek is a hard job failure, and any `player_projections`
  gameweek beyond the candidate horizon is reported in
  `job_runs.details.extraProjectionGameweekIdsBeyondHorizon`. (Tier 3)
- **Zero-fill chosen over omission** for a player missing a projection on some gameweek in the
  horizon — an omitted player can never be transferred in by the solver, while a zero-projected
  player simply never wins the optimisation; zero-fill preserves the solver's full search space.
  Documented in the CSV file's own header comment. (Tier 3)
- **`Team` column uses `teams.short_name`** (e.g. "ARS") rather than the full team name — the
  ticket's own notes say `Name`/`Team` are non-load-bearing (read by humans only, not by the
  solver's CSV readers), so compactness was preferred. (Tier 3)
- **New workflow step appended at the end of `scheduled-jobs.yml`** (after "Sync squad from
  FPL"), rather than immediately after "Project points" — the DoD only required running after
  item 10's projection step; appending at the end avoided any risk of reordering existing steps.
  (Tier 3)
- **`actions/upload-artifact@v4` with `retention-days: 14` and `if-no-files-found: warn`** — no
  prior artifact-upload usage in this repo to match; `warn` (not `error`) so an earlier step's
  failure isn't masked by the upload step also failing, and no empty artifact is fabricated when
  the CSV was never written. (Tier 3)
