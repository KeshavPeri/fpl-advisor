# Ticket #160 — Stop the rebuild advisory playing a wildcard on top of the rebuild

## HIGH-IMPACT

- **`chip_limits` in `buildRebuildSolverConfig` is now all zeros for both variants, because
  `preseason: true` already rebuilds the squad from scratch within budget, and granting a
  wildcard on top of that let the solver rebuild a second time later in the horizon at zero
  cost.** The 30 Aug 2026 dispatch log showed exactly this: GW3 was the preseason rebuild
  (fifteen `Buy` lines, `ITB` 100.0→2.3), then GW5 showed `CHIP WC` with seven more
  transfers in/out. The stored delta (+35.3, i.e. 295.54 vs the chip-free baseline's 260.21)
  therefore reflected an unknown mix of "value of one rebuild" and "value of a second free
  overhaul two gameweeks later" — not what the advisory claims to measure. This is Tier 2: it
  changes what a stored advisory means. **Every `chip_advisories` row written by a rebuild
  probe before this ticket carries the old, inflated interpretation. Those rows are not
  deleted or rewritten — `chip_advisories` is append-only by design.**
- **`store-squad-advisory.ts`'s guard on the rebuild solution was inverted** — it used to throw
  if the solution did *not* play the requested chip; it now throws if the solution plays *any*
  chip at all. **Because** once `chip_limits` is all-zero, the requested chip can structurally
  never appear in a rebuild solution's Results table, so the old guard would fire on every real
  dispatch and permanently prevent any rebuild advisory from ever being stored again. The new
  guard preserves the original intent (refuse to guess, catch anomalies) but checks the
  opposite condition, since "a chip appeared" is now the anomaly. Tier 2, forced directly by
  the `chip_limits` fix above, not an independent scope decision.
- **`chip_gameweek_id` is now set from the target `gameweekId` parameter directly, instead of
  being read off the played chip's own token gameweek.** **Because** there is no longer a chip
  token in the rebuild solution to read a gameweek from — the rebuild happens immediately at
  the dispatched gameweek, not at a distinct later "chip plays here" moment. The column is a
  real FK to `gameweeks(id)`, so it must hold a valid row; `gameweekId` is already used
  elsewhere in the same row (`gameweek_id`) and is guaranteed valid. QA confirmed this is a
  defensible simplification given the chip token no longer exists, worth a human glance but not
  a defect.

## #134's five guard rails, re-verified individually (all still true)

1. `buildSolverConfig` is untouched — still unconditionally `preseason: false`; its own
   `@ts-expect-error` "no `variant` field" test passes unmodified.
2. Only `squad-rebuild-probe.yml` sets `REBUILD_VARIANT`; `solver-run.yml` and
   `solver-chip-probe.yml` are untouched (nothing under `.github/` changed in this diff).
3. The rebuild workflow still calls only `emit-projections-csv.ts`, `build-solver-input.ts`,
   `store-squad-advisory.ts` — no change to what it invokes.
4. `store-squad-advisory.ts` still writes only to `chip_advisories` (insert) and `job_runs`
   (insert); it still never reads which players were picked, so nothing reaches
   `solver_picks`, `recommendations`, or Telegram.
5. Wildcard and Free Hit are still mutually exclusive — now trivially, since both chip limits
   are always zero; `variant` is still a single required `'wc' | 'fh'` union that determines
   only `chip_advisories.chip_code`.

## ROUTINE

- The new counter is named `rebuildDistinctObjectiveCount` (not the generic
  `distinctObjectiveCount`) to make explicit it's scoped to the rebuild solve's own solutions,
  not the baseline solve's — a naming choice, Tier 3.
