## Context

**The wildcard / free-hit advisory measures two rebuilds, not one, so the number it stores is not
what it claims to be.**

`squad-rebuild-probe.yml` was dispatched for the first time on 30 Aug 2026 — the first run of
`preseason: true` in this project's history, and the human check ticket #134 could not perform
before its own merge. It solved cleanly (proven optimum, gap 0%) and every one of #134's five guard
rails held: nothing reached `solver_picks`, `recommendations` or Telegram. **The defect is in what
was measured, not in the safety case.**

### The mechanism, read from the uploaded solver log

`buildRebuildSolverConfig` (`scripts/build-solver-input.ts:662`) sets **both**:

```
preseason: true
chip_limits: { bb: 0, wc: variant === 'wc' ? 1 : 0, fh: ..., tc: 0 }
```

`preseason: true` already discards the current squad and builds a new fifteen from the full budget.
Handing the same solve a wildcard on top of that lets it rebuild **again**. The log shows exactly
that:

- **GW3** — `ITB=100.0->2.3`, fifteen `Buy` lines, no `Sell`: the preseason rebuild.
- **GW5** — `CHIP WC`, `NT=7`: seven more players in and out.
- **Results table** — `chip WC5` on all three solutions.

The stored delta is therefore the rebuild objective **295.54** against the chip-free baseline's
**260.21** — **+35.3** — of which an unknown share is a second free squad overhaul two gameweeks
later. **A real wildcard is one event.** The advisory reads as "this is what playing your wildcard
now is worth", and it is not.

`docs/solver-notes.md` already warns that this advisory "is always a large, positive-looking number"
because the rebuild is unconstrained. That reasoning is right and it is not this: the double
rebuild is additional, unintended, and was invisible until the probe was actually dispatched.

### Second observation — the three solutions are one solution

All three report **295.54** and differ only in which backup goalkeeper sits on the bench
(Petrović / Verbruggen / Tzolakis). `iteration_criteria`'s `this_gw_transfer_in_out` has nothing to
vary when the squad is unconstrained and every transfer is a buy, so Plan A/B/C is cosmetic in this
mode. **This ticket reports that; it does not fix it.**

Depends on #134 (merged) and the 30 Aug probe dispatch. Nothing unmerged.

## Scope

**In scope:**

- **`chip_limits` is all zeros in `buildRebuildSolverConfig`.** `preseason: true` is the rebuild;
  no chip is granted on top of it.
- **The `variant: 'wc' | 'fh'` parameter stays**, and stays required. It still selects which advisory
  is being produced and what is written to `chip_advisories.chip_code` — it just no longer sets a
  chip limit. Removing it would silently make the two variants indistinguishable, which is worse.
- **A test proving no chip can be enabled in a rebuild config**, in the same style as #134's existing
  `@ts-expect-error` proof that `buildSolverConfig` can never produce `preseason: true`.
- **A counter in `job_runs.details` recording how many distinct objective values the run's solutions
  carried**, so "three solutions, one answer" is visible on every future run rather than something a
  human has to spot in a log.
- **`docs/solver-notes.md` records the finding**, in the section that already documents this probe:
  what was actually run, not what was assumed — the discipline that file already establishes.

**Explicitly out of scope:**

- **No change to `buildSolverConfig`**, to `solver-run.yml`, or to `solver-chip-probe.yml`. The
  production solve path is untouched. **The `@ts-expect-error` test proving `preseason: true` cannot
  reach `buildSolverConfig` must still pass, unmodified.**
- **No change to what tables this probe writes.** `chip_advisories` and `job_runs`, insert only,
  exactly as now. All five of #134's guard rails stay in force.
- **No attempt to make Plan A/B/C meaningful in rebuild mode.** That needs a different
  `iteration_criteria` and is a separate question.
- **No modelling of a free hit's one-gameweek reversion.** #134 deliberately models both variants as
  a one-gameweek rebuild gap and says so; that stands.
- **No migration, no schema change, no UI change.** Nothing under `src/` or `supabase/`.
- **No re-dispatch of the workflow as part of the ticket** — a `workflow_dispatch` run is the human
  check after merge, not a definition-of-done item (`LEARNINGS-second-build-wave.md` §7).

## Definition of done

- [ ] `buildRebuildSolverConfig` returns `chip_limits: { bb: 0, wc: 0, fh: 0, tc: 0 }` for both
      variants. Grep-checkable: no `1` appears in that object literal.
- [ ] The `RebuildChipLimits` type makes a non-zero chip limit **unrepresentable**, not merely
      unused — so a future edit cannot reintroduce this without a type error. A named test proves it,
      in the same style as #134's existing variant test.
- [ ] `preseason: true` is still set for both variants, and the existing full-object-equality tests
      against `buildSolverConfig`'s output for the same `{horizon, datasource, secs}` still pass with
      `chip_limits` as the only remaining intentional difference alongside `preseason`.
- [ ] The `variant` parameter is still required and still a `'wc' | 'fh'` union, and still determines
      `chip_advisories.chip_code`. Named test.
- [ ] `job_runs.details` carries the count of distinct objective values across the run's solutions.
- [ ] `docs/solver-notes.md` records the double-rebuild finding and the one-distinct-objective
      observation, dated, in the existing squad-rebuild section.
- [ ] #134's five guard rails are all still true, and the ticket's decisions file states each one
      explicitly rather than asserting them collectively.
- [ ] Every existing test passes **unmodified** except those asserting the old `chip_limits` value.
- [ ] Nothing under `src/`, `supabase/`, `.github/`, `src/screens/`, `src/components/`,
      `scripts/lib/`, `scripts/run-backtest.ts` or `scripts/solver-run`-path files is added, changed
      or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** no test here can prove the solver behaves correctly with
      chips off in preseason mode, because a `workflow_dispatch` workflow's behaviour is only
      observable from a real dispatch. The human check after merge is dispatching
      `Squad rebuild probe` and confirming the rebuild log contains **no `CHIP` line in any
      gameweek** and the results table's `chip` column is empty for every solution. **The stored
      delta will fall from +35.3 — that is the ticket working, not a regression.** **What will NOT
      change:** the GW3 fifteen-buy rebuild stays, because that is `preseason: true` and it is the
      thing being measured.

## Notes for the Analyst / Builder

**The safety case is not what failed here, and the decisions log should say so.** Every guard rail
#134 built held on the first real dispatch: no `solver_picks` row, no `recommendation`, no Telegram
send, `wc` and `fh` never both set, and `buildSolverConfig` untouched. What failed is a modelling
assumption nobody could test until the workflow existed on the default branch — which is precisely
the limitation #134's own text predicted. **Read that as the process working, not as a defect in
#134.**

**Why zero and not one, as the *because*.** `dev/solver.py` treats `preseason: true` as "you have no
squad, build one within the budget". A wildcard is the same operation, priced at zero transfer
cost. Granting both means the solve rebuilds at the horizon's start and again at the chip gameweek,
so the objective it returns is the value of **two** unconstrained squad selections. Since the
advisory's entire purpose is to answer "what is one rebuild worth right now", the chip must be off.

**Do not remove the `variant` parameter as a simplification.** It no longer changes `chip_limits`,
which makes removing it look tempting. It still selects the advisory's `chip_code`, and #134's
mutual-exclusion argument — "both together is not a representable value of this type" — depends on
the union staying a required single choice.

**The user-facing advisory sentence was checked and needs no change — do not touch it.**
`SQUAD_ADVISORY_HORIZON_NOTE` in `src/lib/chips/derive.ts` reads *"This is a five-gameweek view — a
wildcard or free hit's real value depends on fixtures the model cannot see."* It makes no claim that
a chip was played, so it is already correct after this fix. It lives under `src/`, which this ticket
declares out of scope; naming it here rather than leaving it implied is the D10 check
(`deltas.md` D10) that stops a Notes instruction contradicting the scope constraint.

**Keep `docs/solver-notes.md`'s existing discipline.** That file's own standard is "write down what
was actually run, not a guess from reading the README". The entry should quote the log's own
evidence — the `CHIP WC` line at GW5 and the `WC5` in the results table — not describe it.

**This is Tier 2** — it changes what a stored advisory means, and every `chip_advisories` row written
by a rebuild probe before this ticket carries the old, inflated interpretation. Say that plainly in
the decisions entry. Rows are not deleted or rewritten: the table is append-only by design.

**One companion ticket is running in this batch**, touching `scripts/run-backtest.ts` only. This
ticket touches neither that file nor anything it exports.

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `scripts/store-squad-advisory.ts`, `scripts/store-squad-advisory.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `.github/`, `src/screens/`,
`src/components/`, `scripts/lib/` or any other `scripts/*.ts` changes — `scripts/run-backtest.ts` in
particular is owned by the other ticket in this batch. No dependency is added, removed or upgraded.
No build configuration changes.
