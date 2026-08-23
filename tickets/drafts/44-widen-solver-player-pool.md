## Context

**The solver has only ever surfaced a handful of distinct transfer targets**, and the reason is two
settings we never chose. `HANDOFF-to-orchestrator-chat.md` §6 item 4 names this as the next
solver-side change and says to make it **in isolation**, because changing it alongside anything else
makes it impossible to tell which change moved the recommendations.

### What was verified at ticket-writing time, from the pinned solver source

`scripts/build-solver-input.ts`'s `buildSolverConfig` sets `horizon`, `preseason`, `xmin_lb`,
`chip_limits` and a handful of others — and **says nothing about the player pool**. Verified against
the pinned commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2`:

- `run/solve.py` loads its own settings first and then does `options.update(config_options)` — our
  `--config` file **merges into** the shipped settings rather than replacing them. **Every key we
  do not set, we silently inherit.**
- `data/user_settings.json` at that commit ships `"keep_top_ev_percent": 5` and
  `"ev_per_price_cutoff": 30`. **Both are in force in every solve we have ever run, and neither was
  a decision.**
- In `dev/solver.py`, the two are percentile filters, not the percentages their names suggest:

  ```
  cutoff = merged_data["total_ev"].quantile((100 - options.get("keep_top_ev_percent", 10)) / 100)
  safe_players_due_ev = merged_data[(merged_data["total_ev"] > cutoff)]["ID"].tolist()
  ```
  ```
  ev_per_price = merged_data["total_ev"].div(merged_data["now_cost"])
  cutoff = ev_per_price.quantile(ev_per_price_cutoff / 100)
  merged_data = merged_data[(ev_per_price > cutoff) | (merged_data["ID"].isin(safe_players))].copy()
  ```
  ```
  xmin_lb = options.get("xmin_lb", 100)
  merged_data = merged_data[(merged_data["total_min"] >= xmin_lb) | (merged_data["ID"].isin(safe_players))].copy()
  ```

**So the pool is:** the top **5%** of players by horizon EV — about thirty of six hundred — who are
exempt from everything else; **plus** everyone above the **30th percentile** of EV-per-price who
also clears `xmin_lb` (300 minutes across the horizon, which we do set deliberately).

The exemption is the important part: a player outside the top 5% by raw EV must pass **both** the
efficiency filter and the minutes filter to be considered at all. That is a hard prune, and it is
the mechanism behind the solver repeatedly proposing the same few names.

**This is the class of defect the handoff warns about explicitly** — *"the solver's shipped defaults
are wrong for us and crash on contact"* — applied to two settings that do not crash, and so were
never noticed.

Depends on nothing unmerged.

## Scope

**In scope:**

- **Set `keep_top_ev_percent` and `ev_per_price_cutoff` explicitly in `buildSolverConfig`**, so
  neither is ever silently inherited again — the same reasoning that already puts `preseason: false`
  and `xmin_lb` in that object explicitly rather than omitting them.
- **The new values, pre-answered:** `keep_top_ev_percent: 25` and `ev_per_price_cutoff: 10`. See
  Notes for the reasoning behind each.
- **Both values as named exported constants** with a comment stating what the shipped default was,
  what the percentile semantics actually are, and that they were widened deliberately — not as
  inline literals.
- **Counters proving the widening happened**, written into the `build-solver-input` `job_runs`
  details: the number of players in the projections CSV, and the two configured values. The solver's
  own post-filter pool size is not visible to this job, so **do not invent a number for it** — the
  observable proof is on the solver's stdout, which the workflow already captures.
- **An audit of every other key we inherit**, written into `docs/solver-notes.md` as a table: which
  keys `data/user_settings.json` ships at the pinned commit, which we override, and which we
  inherit. **This is documentation, not a behaviour change** — but two inherited keys are worth
  naming while looking (see Notes) and a future ticket should not have to rediscover the merge
  semantics.

**Explicitly out of scope:**

- **No other solver setting changes.** Not `xmin_lb`, not `horizon`, not `decay_base`, not
  `no_transfer_last_gws`, not `num_iterations`, not `iteration_criteria`, not `secs`. **The whole
  value of this ticket is that exactly two things changed** — anything else moving makes the next
  recommendation impossible to attribute, and that is the stated reason this work was held back.
- **No chip flags.** `chip_limits` stays `{ bb: 0, wc: 0, fh: 0, tc: 0 }`. That is item 27.
- **No change to the projection model, the CSV adapter, or `scripts/project-points.ts`.**
- **No change to `scripts/generate-recommendations.ts` or how plans are stored.**
- **No migration, no UI, nothing under `src/` or `supabase/`.**
- **No re-pinning of the solver commit.**

## Definition of done

- [ ] `buildSolverConfig`'s returned object contains `keep_top_ev_percent` and
      `ev_per_price_cutoff`, and `SolverConfig` types them. Grep-checkable: both strings appear in
      `scripts/build-solver-input.ts`.
- [ ] Both values come from named exported constants, not inline literals, and each constant's
      comment states the shipped default, the percentile semantics, and why it was changed.
- [ ] A unit test asserts the built config carries exactly `keep_top_ev_percent: 25` and
      `ev_per_price_cutoff: 10`.
- [ ] **A unit test asserts every other key in the built config is unchanged from before this
      ticket** — a full-object equality assertion, so an accidental edit to `xmin_lb`, `horizon`,
      `decay_base` or `chip_limits` fails the build. This is the ticket's most important test.
- [ ] `chip_limits` is still `{ bb: 0, wc: 0, fh: 0, tc: 0 }`. Named test.
- [ ] `preseason` is still `false`. Named test. *(The shipped file says `true`, which wipes the
      squad — this must never regress.)*
- [ ] `job_runs.details` for `build-solver-input` carries the projections-CSV player count and both
      configured values.
- [ ] `docs/solver-notes.md` gains a section recording: that `--config` merges rather than replaces
      (with the `options.update(config_options)` line quoted), the full list of keys
      `data/user_settings.json` ships at the pinned commit, and which of them we override versus
      inherit.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** no test here can show the solver actually considers more
      players, because the filtering happens inside the Python solver at run time. The human check
      after merge is dispatching `Solver run` and reading the solve's own output for the pool size,
      then comparing the transfer targets in the three stored plans against previous runs. **A solve
      that now takes materially longer, or that times out, is the signal that 25 is too wide** — the
      time limit is unchanged on purpose so that shows up rather than being absorbed.

## Notes for the Analyst / Builder

**Why 25 and 10, stated as *becauses* rather than as taste.**

- `keep_top_ev_percent: 5 → 25`. **Because** this is the set of players exempt from every other
  filter, and at 5% it is roughly thirty players out of six hundred — narrower than a single
  gameweek's set of genuinely reasonable transfer targets across four positions and twenty clubs.
  Twenty-five per cent is about 150 players, which is wide enough to contain the plausible options
  and still far narrower than the whole league. **It is deliberately not 100**: the filters exist
  because the integer program's size and solve time grow with the pool, and the ticket's own DoD
  treats a timeout as a signal rather than a failure to hide.
- `ev_per_price_cutoff: 30 → 10`. **Because** this one drops the bottom 30% of players by
  expected-value-per-million, which sounds harmless and is not: a premium player's EV per price is
  structurally lower than a cheap defender's, so an efficiency filter systematically prunes exactly
  the expensive players a transfer recommendation most often turns on. Ten per cent still removes
  the genuine dead weight without that bias.
- **Both moves are in the same direction and neither is tuned.** There is no measurement behind
  these numbers and the ticket does not pretend otherwise — they are a deliberate widening, and the
  next ticket in this area should narrow them again with a number rather than an argument.

**Two other inherited keys worth naming while you are in there — document them, do not change
them.**

- `no_transfer_last_gws: 2` forbids transfers in the last two gameweeks of the horizon. That is
  sensible for a season-end horizon and odd for our rolling five-gameweek one, where it silently
  bans transfers in gameweeks 4 and 5 of every solve. We only ever act on gameweek 1, so it does not
  corrupt the decision — but it does distort the multi-week plan the reasoning screen shows.
- `decay_base: 0.9` discounts each future gameweek. Reasonable, and worth knowing it was inherited
  rather than chosen.

**Record both in `docs/solver-notes.md` and leave the behaviour alone.** They are candidates for
their own ticket, later, in isolation — same rule as this one.

**Do not verify these values from memory or from a blog post.** They were read from
`data/user_settings.json`, `run/solve.py` and `dev/solver.py` at the pinned commit
`45131c5a41d7caadb5cb626c012bfa9111dca7a2` on 23 August 2026. If the Builder needs to confirm
anything further, read that commit — the solver checkout step in `.github/workflows/solver-run.yml`
already pins it.

**A note on the solver's own defaults, because it is a trap.** `dev/solver.py` reads
`options.get("keep_top_ev_percent", 10)` — an in-code default of **10**, different from the **5**
the shipped settings file carries. That difference is exactly the "check the shipped configuration,
not just the code's fallback" lesson in `LEARNINGS-second-build-wave.md` §7, which has already cost
this project one mis-calibrated warning. The value in force is the shipped one, because the config
files load first and our overrides merge on top.

**Two other tickets may be running in this batch.** One owns `src/lib/accuracy/`,
`src/components/AccuracyCard.tsx` and `src/screens/HomeScreen.tsx`; the other owns `src/lib/chips/`,
`src/screens/ChipsScreen.tsx` and `src/lib/notification/message.ts`. This ticket touches nothing under `src/` at all.

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `src/` or `supabase/`
changes. No other file under `scripts/` changes.
