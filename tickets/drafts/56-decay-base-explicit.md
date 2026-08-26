## Context

**The last unaudited setting we inherit from the solver.** Ticket #95's audit listed every key
`data/user_settings.json` ships at the pinned commit and which of them we override; ticket #110 moved
`no_transfer_last_gws` out of the inherited column. **`decay_base: 0.9` is what remains.**

Verified at the pinned commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2`: `run/solve.py` loads its
own settings first and then does `options.update(config_options)`, so our `--config` file **merges
into** the shipped settings. Every key we do not set, we silently inherit — and
`scripts/build-solver-input.ts`'s `buildSolverConfig` does not set this one.

**What it does.** It discounts each future gameweek in the objective: a point projected for
gameweek 2 of the horizon is worth `0.9` of a point projected for gameweek 1, gameweek 3 is worth
`0.81`, and so on. Across our 5-gameweek horizon the last gameweek carries about **66%** of the
weight of the first.

**Why this ticket exists even though 0.9 is defensible.** It is defensible — discounting the future
is correct, since a plan five weeks out will be re-solved four times before it happens. **The
problem is that nobody chose it.** Every other inherited default this project has been bitten by was
also defensible-looking: `horizon: 8` crashed on contact with a 5-gameweek CSV, `xmin_lb: 300` was
not the code's fallback of 100, `preseason: true` wipes the squad, `keep_top_ev_percent: 5` pruned
the pool to thirty players, `no_transfer_last_gws: 2` banned transfers across 40% of the horizon.
**An inherited value is one nobody can defend when it turns out to matter.**

This ticket makes the last one explicit and closes the audit. Depends on nothing unmerged.

## Scope

**In scope:**

- **Set `decay_base` explicitly in `buildSolverConfig`**, so it is never silently inherited again —
  the same reasoning that already puts `preseason`, `xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff` and `no_transfer_last_gws` in that object explicitly.
- **The value, pre-answered: `0.9` — unchanged from what we have been running.** This ticket changes
  no behaviour. See Notes.
- **A named exported constant** with a comment stating the shipped value, what the discount does,
  the effective weight of the last horizon gameweek, and that it was reviewed and kept rather than
  inherited.
- **`docs/solver-notes.md` updated**: `decay_base` moves from the inherited column of #95's audit
  table to the overridden column, and the table gains a line stating that **every key
  `data/user_settings.json` ships is now explicitly set** — with the merge semantics quoted, so the
  next reader does not have to rediscover them.

**Explicitly out of scope:**

- **No behaviour change of any kind.** The emitted config must be functionally identical to today's.
- **No other solver setting changes.** Not `horizon`, `xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff`, `no_transfer_last_gws`, `chip_limits`, `num_iterations`,
  `iteration_criteria`, `secs` or `preseason`.
- **No tuning of the discount.** Whether 0.9 is the *right* number is a measurement question that
  wants the backtest, not an argument. See Notes.
- **No change to `ft_value_list`**, which is the other shipped key that shapes the objective. It is
  a nested object rather than a scalar, it interacts with free-transfer valuation, and it deserves
  its own ticket after this one closes the scalar audit — record it in `docs/solver-notes.md` as the
  one remaining item rather than folding it in here.
- **No change to the projection model, the CSV adapter, or anything under `src/`.**
- **No migration, no UI, no workflow change.**
- **No re-pinning of the solver commit.**

## Definition of done

- [ ] `buildSolverConfig`'s returned object contains `decay_base`, and `SolverConfig` types it.
      Grep-checkable: the string `decay_base` appears in `scripts/build-solver-input.ts`.
- [ ] The value comes from a named exported constant whose comment states the shipped value, the
      effect of the discount across a 5-gameweek horizon, and that it was reviewed and kept.
- [ ] A unit test asserts the built config carries `decay_base: 0.9`.
- [ ] **A unit test asserts every other key in the built config is unchanged** — a full-object
      equality assertion, so an accidental edit to any other setting fails the build. #95 and #110
      both established this guard; it is the most important test here too.
- [ ] `preseason` is still `false`, `no_transfer_last_gws` is still `0`, `keep_top_ev_percent` is
      still `25`, `ev_per_price_cutoff` is still `10`, and `chip_limits` is still all zeros. Named
      test for each.
- [ ] `docs/solver-notes.md`'s inherited-versus-overridden table shows `decay_base` as overridden,
      states that the scalar audit is now complete, and names `ft_value_list` as the one remaining
      inherited key with its own ticket still to be written.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file under
      `scripts/` other than `build-solver-input.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** nothing here proves the solver behaves identically, because
      the objective is built inside the Python solver at run time. **The whole point is that it
      should behave identically**, so the human check after merge is dispatching `Solver run` and
      confirming the stored plans and their horizon figures are unchanged from the previous run. **A
      change in the recommendation after this merge means something went wrong**, not that the
      ticket worked.

## Notes for the Analyst / Builder

**Why the value does not change, stated as a *because*.** Two solver settings have already moved
this month — the pool widened in #95, and the transfer ban lifted in #110. **Because** the effect of
each is only attributable if it lands alone, adding a third behavioural change now would make all
three unreadable. This ticket is bookkeeping: it converts an inherited value into a chosen one, and
choosing it means writing down what it is and why we kept it.

**If the discount is later found to be wrong, it will be found by measurement.** A lower base makes
the solver short-sighted and transfer-happy; a higher one makes it hoard transfers for plans that
never survive contact. Which is better is exactly the kind of question the backtest (item 32)
exists for, and exactly the kind that arguing about produces a confident wrong answer.

**Do not read the value from memory or a blog post.** `"decay_base": 0.9` was read from
`data/user_settings.json` at commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2` on 27 August 2026,
and the merge semantics from `run/solve.py`'s `options.update(config_options)` at the same commit.
The solver checkout step in `.github/workflows/solver-run.yml` pins it.

**Note the interaction worth recording but not acting on.** `decay_base` and `ft_value_list` both
shape how the optimiser values the future: one discounts future points, the other prices a banked
transfer. Changing either in isolation is measurable; changing both is not. That is the reason
`ft_value_list` is deliberately left for its own ticket.

**This is Tier 3** — it stores no data, changes no schema, and by design changes no behaviour. Log
it normally, and note in the decisions file that the scalar audit is now closed.

**Two other tickets may be running in this batch.** One owns `src/lib/projection/rates.ts`,
`scripts/project-points.ts` and `docs/projection-model-backlog.md`; the other adds a new migration
and a new script under `scripts/`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `src/` or `supabase/`
changes. No other file under `scripts/` changes, and `docs/projection-model-backlog.md` is not
modified.
