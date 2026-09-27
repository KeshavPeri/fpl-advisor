# Ticket #284 — Wildcard and Free Hit nightly squad

## HIGH-IMPACT

- Rewrote the "safety case" header text in both `squad-rebuild-probe.yml` and
  `store-squad-advisory.ts` (originally written for #134, which said storing the rebuild squad
  was "a different feature, explicitly out of scope") to state the new reality honestly, rather
  than leaving it saying the literal opposite of what this ticket does. Because: the header text
  is treated as a safety mechanism in this codebase, and #284 is precisely the ticket that puts
  storing the squad in scope — leaving stale wording there would be worse than updating it. What
  remains true and load-bearing was kept verbatim: this workflow never writes to
  `recommendations`, `solver_picks`, or notifications/Telegram, and the stored squad is still
  presented purely as an advisory (product-brief.md §6a), never as an instruction.
- Moved "latest advisory per chip" deduplication out of the `api.ts` Postgrest query into a
  pure, unit-tested function in `derive.ts` (`latestSquadAdvisoryPerChip`), adding `id` to
  `SquadAdvisoryRow` so it survives the trip. Because: the DoD requires this behavior be
  provable via `derive.test.ts`, the only editable test file for this feature, and a dedup
  buried in a Postgrest query can't be unit-tested without a database — this also matches the
  sibling `deriveChipAdvisories`, which already does its collapsing in `derive.ts`, not `api.ts`.
- Position grouping in the "See the squad" disclosure reads `elementType` from the shared
  `src/lib/squad/positions.ts` vocabulary rather than the raw `chip_rebuild_picks.position` CSV
  string, with an explicit fallback group (labelled with the raw string) for any player id the
  pool doesn't recognise. Because: keeps the app's one position vocabulary consistent across
  every screen, per design-reference.md's "extending existing UI matches existing components"
  rule; the raw CSV value is still stored verbatim in the new column, as the migration spec
  requires.
- `chip_rebuild_picks.position` is stored verbatim from the results CSV's own `pos` column,
  un-normalized, following this codebase's established "third-party output is ground truth"
  convention (`chip_advisories.chip_code`, `solver_runs.solver_status`). This could not be
  re-verified against a live solve run in this sandbox (no live dispatch available) that FPL's
  GKP/DEF/MID/FWD convention is exactly what the pinned solver emits — flagged as an assumption
  based on FPL's standard API vocabulary, worth a spot-check on the first real dispatch.
- The Chips screen tolerates `chip_rebuild_picks` not existing yet on the live database (same
  missing-table detection as the backend script) rather than erroring the whole screen. Because:
  Vercel auto-deploys `main` immediately on merge, while applying the migration is a separate,
  owner-only, later step — without this tolerance, merging would break the live Chips screen
  (which already has WC/FH `chip_advisories` rows from the 25 Sept dispatch) until the migration
  is applied by hand.

## ROUTINE

- Migration timestamp `20260926090000` (today's date, later than the existing latest
  `20260917100000`).
- Reused `fetchPlayers`/`fetchExistingSquad` from `src/lib/squad/api.ts` directly in
  `src/lib/chips/api.ts` — the ticket named `fetchExistingSquad` explicitly; extended to
  `fetchPlayers` for names/positions, following the exact precedent `src/lib/override/api.ts` +
  `OverrideScreen.tsx` already set for the same two functions.
- "Captain" tag in the disclosure reuses `--accent-cyan` (the app's existing captaincy accent
  from `PlayerShirt.css`); only the captain is marked, not the vice-captain, matching the
  ticket's literal wording.
- This gameweek's projected-points figure (captain doubled, rounded, null unless exactly 11
  starters) mirrors `src/lib/verdict/derive.ts`'s `sumGameweekPoints` exactly but is a local
  copy, not an import — same "small local copy of a domain calc" precedent this codebase already
  documents elsewhere.
- Workflow uses a `strategy.matrix` (`fromJSON` expression) resolving to `['wc','fh']` on any
  non-manual trigger, or the single dispatched variant on `workflow_dispatch`, with
  `fail-fast: false`. Every uploaded-artifact name now carries a `-${{ matrix.variant }}` suffix
  since `actions/upload-artifact@v4` forbids reusing a name within one run — a necessary
  consequence of running two parallel jobs, not something the ticket called out explicitly but
  required for the workflow to actually run.
