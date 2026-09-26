## Why

Feature item 28 is half built. `squad-rebuild-probe.yml` (#134) already solves the best full 15 from
scratch for a Wildcard (`REBUILD_VARIANT=wc`) or Free Hit (`fh`), on the live `gbm-v1` projections, and
`scripts/store-squad-advisory.ts` stores one number ("+23 pts if rebuilt now") in `chip_advisories`,
which the Chips screen shows. **The squad itself is never stored**, so Keshav gets a number with
nothing behind it, and the probe only runs when dispatched by hand. First dispatch, 25 Sept: every step
green. Keshav wants to see the squad in the app when he's deciding on a chip.

## Build

1. **Run it nightly, both chips.** Add a `schedule` to `squad-rebuild-probe.yml` at `0 19 * * *`
   (after `solver-run.yml`'s 18:20 UTC), keeping `workflow_dispatch`. Run both variants (a matrix over
   `wc`, `fh`, or two sequential solves). The safety case in that file's header stays true: this
   workflow never stores solver picks, recommendations, notifications or predictions.
2. **Store the squad.** New migration `supabase/migrations/<timestamp>_chip_rebuild_picks.sql` (idempotent,
   same style as `20260925090000_mini_league_standings.sql`): table `public.chip_rebuild_picks` with
   `chip_advisory_id bigint REFERENCES public.chip_advisories(id)`, `player_id integer`,
   `player_code integer`, `position text`, `is_starting boolean`, `bench_order smallint`,
   `is_captain boolean`, `is_vice_captain boolean`, `expected_points numeric`, PK
   `(chip_advisory_id, player_id)`. RLS on, `SELECT` for `anon`, `SELECT, INSERT` for `service_role`, no
   `UPDATE`/`DELETE`. Pick a timestamp later than every existing migration.
   Extend `store-squad-advisory.ts` to insert the 15 rows (from the rebuild solve's results CSV, for the
   first rebuild gameweek) right after its `chip_advisories` row, same run. If the picks table doesn't
   exist yet, log it and keep storing the advisory (the migration lands after merge).
3. **Chips screen.** Under each "Squad rebuild" row (Wildcard, Free Hit), a "See the squad" disclosure,
   closed by default. It shows the starting XI and bench grouped by position, with the captain marked,
   expected points next GW, and **"In / Out vs your team"**: who comes in and who goes, against the
   existing saved squad (`src/lib/squad/api.ts` `fetchExistingSquad`). Label the Free Hit squad "for
   Gameweek N only — your team returns after". Read the latest advisory per chip only. No change to Home,
   recommendations or the solver's normal run. Keep the existing Chips visual style (UI polish is deferred).
4. `supabase/README.md`: add the migration row, marked **NOT YET APPLIED**. `feature-list.md`: item 28 →
   note that the squad is now visible nightly.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Tests: results-CSV → 15 pick rows (11 starting, 4 bench, exactly one captain and one vice); the store
  step still writes the advisory when the picks table is missing; the chips `derive` picks the latest
  advisory per chip and computes In/Out correctly against a fixture squad (including 0 changes and 15
  changes); YAML valid.

## Post-merge owner check (does not block this PR)

Keshav applies the migration (the orchestrator gives the exact steps). The orchestrator dispatches the
workflow once for each variant and checks the rows. **Not a gate.**

## Files

Edit: `.github/workflows/squad-rebuild-probe.yml`, `scripts/store-squad-advisory.ts` + its test,
`src/lib/chips/api.ts`, `src/lib/chips/types.ts`, `src/lib/chips/derive.ts` + `derive.test.ts`,
`src/screens/ChipsScreen.tsx` + `.css`, `supabase/README.md`, `feature-list.md`. New:
`supabase/migrations/<timestamp>_chip_rebuild_picks.sql`. **Not** `scripts/build-solver-input.ts`,
`scripts/preflight-check.ts`, `scripts/ingest-core-insights.ts`, `model/`, or anything the normal
solver run writes.
