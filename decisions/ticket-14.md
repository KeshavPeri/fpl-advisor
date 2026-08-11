# Decisions — ticket #14

## HIGH-IMPACT

- **Bank, squad value, transfers, points, rank and chips are always overwritten from the API
  once a deadline has passed; only the 15-player composition (`squad_picks`) follows
  "reconcile, don't overwrite."** Because these are simple scalar facts FPL reports with no
  meaningful "which source is right" ambiguity, whereas *which players* are picked is the
  judgment-call data the ticket's notes say the accuracy tracker later depends on.
  `squads.source` stays a whole-row provenance flag (matching #13's existing schema) rather
  than growing per-field provenance columns. (Tier 2)

- **Diff detection between stored and API squads is set-based** — player id, starting/bench
  status, captain and vice-captain — deliberately independent of `squad_position` ordering.
  Because two squads with the same 15 players in the same starting/bench/captaincy
  configuration are "the same squad" even if internal slot order differs between how the
  manual-entry screen and the API-derived builder assign slots; ordering-only differences
  would otherwise generate spurious diffs on every sync. (Tier 2)

- **On a detected diff, neither `squads` nor `squad_picks` is touched at all — not just the
  picks.** Because leaving `squads.source` as `'api_sync'` next to picks that were never
  actually confirmed would be a more confusing state than leaving the whole row `manual` until
  a human reconciles it; the diff is recorded in `job_runs` for visibility instead. (Tier 2)

- **Sync status (last-successful-sync timestamp, staleness, diff) is derived entirely from
  `job_runs`, not new `squads` columns.** Because every fact the DoD asks the UI to surface is
  already written to `job_runs.details`, and `job_runs` is already `SELECT`-able by `anon`; this
  avoids the schema growth the ticket explicitly gates behind "only if genuinely needed." (Tier 2)

- **Target gameweek uses the same "lowest gameweek whose deadline hasn't passed, else highest"
  rule as #13's manual-entry screen, reimplemented rather than imported.** Because the
  `scripts/`/`src/` compilation boundary is already a convention every other script in this
  repo follows; keeps API sync and manual entry writing to the same gameweek row without
  crossing that boundary. (Tier 2)

## ROUTINE

- `free_transfers` is preserved from any existing `squads` row (or defaults to 1) on every
  write from this script — the API doesn't expose it and it's not in this ticket's field list.
- `total_transfers`, `overall_points` and `overall_rank` are nullable rather than defaulted to
  0, so "never synced" stays distinguishable from "genuinely zero."
- A malformed `FPL_ENTRY_ID` (set but not a plain integer) exits 1, not 0 — kept distinct from
  "unset," which is the normal pre-setup state and must exit 0 per the DoD.
- `scripts/sync-squad.ts` guards its `main()` invocation with an `import.meta.url` check so its
  pure functions are importable for unit tests without triggering a real run.
- Position-code constants are duplicated locally in `scripts/sync-squad.ts` rather than
  imported from `src/lib/squad/positions.ts`, matching every other `scripts/*.ts` file's
  established convention of not crossing the scripts/src compilation boundary.
