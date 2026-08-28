## Context

**The last inherited solver setting, and the one that decides whether rolling a transfer is worth
anything.**

Ticket #95's audit listed every key `data/user_settings.json` ships at the pinned commit and which we
override. #110 moved `no_transfer_last_gws` out of the inherited column; #120 moved `decay_base` and
recorded **`ft_value_list` as the one remaining item, with its own ticket still to be written.** This
is that ticket.

**It is in force right now and nobody chose it.** The production solve log prints it on every run:

```
Using FT values of {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}
```

**What it does.** It prices a banked free transfer by how many you already hold: going from one
transfer to two is worth 2 points, two to three is worth 1.6, and so on down to 1.1 for the fifth.
That schedule is what makes "roll your transfer" a real option rather than an obviously wasted week —
it is the number the optimiser weighs against making a move now.

**Why it is the most consequential of the three inherited keys.** `decay_base` discounts the future
uniformly and `no_transfer_last_gws` distorted the tail. **This one sits directly on the
roll-or-transfer decision**, which is the single decision the app exists to make — and
`product-brief.md` §6d's transfer-hit rule leans on the same trade-off: *"a break-even hit is noise,
not an edge."*

**And it is not a scalar.** The three previous keys were single numbers. This is a schedule, which is
why #120 deliberately deferred it rather than folding it in.

Depends on nothing unmerged.

## Scope

**In scope:**

- **Set `ft_value_list` explicitly in `buildSolverConfig`**, so it is never silently inherited again —
  the same reasoning that already puts `preseason`, `xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff`, `no_transfer_last_gws` and `decay_base` in that object explicitly.
- **The values, pre-answered: `{"2": 2, "3": 1.6, "4": 1.3, "5": 1.1}` — unchanged from what we have
  been running.** This ticket changes no behaviour. See Notes.
- **A named exported constant** with a comment stating the shipped schedule, what it prices, that the
  keys are the transfer count being moved *to*, and that it was reviewed and kept rather than
  inherited.
- **`docs/solver-notes.md` updated**: `ft_value_list` moves to the overridden column, and the audit
  table gains a closing line stating that **every key `data/user_settings.json` ships is now
  explicitly set** — with the `options.update(config_options)` merge semantics quoted once more so
  the next reader does not rediscover them.

**Explicitly out of scope:**

- **No behaviour change of any kind.** The emitted config must be functionally identical to today's.
- **No other solver setting changes.** Not `horizon`, `xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff`, `no_transfer_last_gws`, `decay_base`, `chip_limits`, `num_iterations`,
  `iteration_criteria`, `secs` or `preseason`.
- **No tuning of the schedule.** Whether 2 / 1.6 / 1.3 / 1.1 is right is a measurement question that
  wants the backtest, not an argument. See Notes.
- **No change to the maximum rollable transfers.** `product-brief.md` §6d states up to five free
  transfers may be rolled; the schedule's five keys already match and this ticket does not touch that
  rule.
- **No change to the projection model, the CSV adapter, or anything under `src/`.**
- **No migration, no UI, no workflow change, no re-pinning of the solver commit.**

## Definition of done

- [ ] `buildSolverConfig`'s returned object contains `ft_value_list`, and `SolverConfig` types it.
      Grep-checkable: the string `ft_value_list` appears in `scripts/build-solver-input.ts`.
- [ ] The value comes from a named exported constant whose comment states the shipped schedule, what
      it prices, and that it was reviewed and kept.
- [ ] A unit test asserts the built config carries exactly `{"2": 2, "3": 1.6, "4": 1.3, "5": 1.1}`.
- [ ] **A unit test asserts every other key in the built config is unchanged** — a full-object
      equality assertion, so an accidental edit to any other setting fails the build. #95, #110 and
      #120 all established this guard; it is the most important test here too.
- [ ] `preseason` is still `false` on the production path, `no_transfer_last_gws` still `0`,
      `keep_top_ev_percent` still `25`, `ev_per_price_cutoff` still `10`, `decay_base` still `0.9`,
      and `chip_limits` still all zeros on the production path. Named test for each.
- [ ] The chip-enabled and rebuild config variants (#126, #134) carry the same `ft_value_list` and
      are otherwise unchanged. Named test for each variant.
- [ ] `docs/solver-notes.md` shows `ft_value_list` as overridden and states the audit is complete.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file under
      `scripts/` other than `build-solver-input.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** nothing here proves the solver behaves identically, because
      the objective is built inside the Python solver at run time. **The whole point is that it
      should behave identically**, so the human check after merge is dispatching `Solver run` and
      confirming the stored plans, their horizon figures and the roll-versus-transfer decision are
      unchanged from the previous run. **A changed recommendation after this merge means something
      went wrong**, not that the ticket worked.

## Notes for the Analyst / Builder

**Why the values do not change, as its *because*.** Three solver settings have already moved this
month — the pool in #95, the transfer ban in #110, and chips enabled on a separate solve in #126.
**Because** the effect of each is only attributable if it lands alone, adding a behavioural change
here would make all four unreadable. This ticket is bookkeeping: it converts an inherited schedule
into a chosen one, and choosing it means writing down what it is and why we kept it.

**Read the keys correctly before commenting them.** The solver prints
`Using FT values of {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}` on every run — **confirm from
`dev/solver.py` at the pinned commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2` whether a key is the
transfer count being moved *to* or *from*** before writing the comment. Getting that backwards in a
comment is how the next reader tunes it in the wrong direction, and this project has already been
bitten by a default read from the code rather than from the shipped configuration
(`LEARNINGS-second-build-wave.md` §7).

**If the schedule is later found to be wrong, it will be found by measurement.** A flatter schedule
makes the solver hoard transfers; a steeper one makes it spend them. Which is better is exactly what
the backtest (item 32) is being built to answer, and exactly the kind of question that produces a
confident wrong answer when argued.

**This closes the audit.** After this, every key the solver ships is explicitly set by us, and
`docs/solver-notes.md` should say so plainly — so the next person who wonders "what else are we
inheriting?" gets an answer instead of a re-derivation.

**This is Tier 3** — it stores no data, changes no schema, and by design changes no behaviour. Log it
normally, and note in the decisions file that the inherited-settings audit is now closed.

**Two other tickets may be running in this batch.** One owns `src/lib/chips/` and
`src/screens/ChipsScreen.tsx`; the other owns `scripts/run-backtest.ts` and
`docs/projection-model-backlog.md`. This ticket touches neither — **this ticket owns
`docs/solver-notes.md` for this batch.**

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `src/` or `.github/` changes. No workflow
file is touched. No other file under `scripts/` is modified, and
`docs/projection-model-backlog.md` is not modified.
