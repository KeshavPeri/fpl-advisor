## Context

**The solver is forbidden from transferring in two of the five gameweeks it plans for, and nobody
chose that.** Found by the inherited-settings audit ticket #95 required, and deliberately left
unfixed there so it could be changed in isolation.

Verified against the pinned commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2`: `run/solve.py` loads
its own settings first and then does `options.update(config_options)`, so **our `--config` file
merges into the shipped settings rather than replacing them — every key we do not set, we silently
inherit.** `data/user_settings.json` ships `"no_transfer_last_gws": 2`, and
`scripts/build-solver-input.ts`'s `buildSolverConfig` does not set it.

### Why the shipped value is wrong for us specifically

Upstream's default horizon is **8** and is meant to be pointed at the run-in to the end of a season,
where "make no transfers in the last two gameweeks" is a sensible way to stop the optimiser burning
transfers it will never benefit from.

**Our horizon is 5, and it rolls forward every single night.** Gameweeks 4 and 5 of our horizon are
not the end of anything — they are next month, and we will absolutely be transferring then. The
setting bans transfers across **40% of every plan the solver builds.**

**What that distorts, concretely:**

- **The multi-week plan is wrong.** The reasoning screen now shows Plan A alongside Plans B and C
  (#102) with horizon totals; those totals are computed under a constraint that does not exist.
- **Free transfers are mis-valued.** `ft_value_list` prices a banked transfer by how useful it will
  be later. If the solver believes it cannot use transfers in weeks 4 and 5, it systematically
  under-values rolling — which biases it toward transferring now.
- **The gameweek-1 decision is affected, not just the tail.** A multi-period optimiser chooses this
  week's move partly on what it plans to do later. A false constraint on later weeks changes the
  move it recommends today.

**This is the same class as every other inherited default this project has been bitten by** — the
handoff's own list: shipped `horizon: 8` crashes on a 5-gameweek CSV, shipped `xmin_lb: 300` is not
the code's 100, shipped `preseason: true` wipes the squad. Each was found by reading the shipped
configuration rather than the code's fallback.

Depends on nothing unmerged.

## Scope

**In scope:**

- **Set `no_transfer_last_gws` explicitly in `buildSolverConfig`**, so it is never silently
  inherited again — the same reasoning that already puts `preseason`, `xmin_lb`,
  `keep_top_ev_percent` and `ev_per_price_cutoff` in that object explicitly rather than omitting
  them.
- **The value, pre-answered: `0`.** See Notes for the *because*.
- **A named exported constant** with a comment stating the shipped default, what it does, why it is
  wrong for a rolling horizon, and that it was set deliberately — not an inline literal.
- **`docs/solver-notes.md` updated**: move `no_transfer_last_gws` from the "inherited" column of the
  audit table #95 added into the "overridden" column, with the reasoning.

**Explicitly out of scope:**

- **No other solver setting changes. None.** Not `horizon`, not `xmin_lb`, not
  `keep_top_ev_percent`, not `ev_per_price_cutoff`, not `decay_base`, not `chip_limits`, not
  `num_iterations`, not `iteration_criteria`, not `secs`. **The entire value of this ticket is that
  exactly one thing changed** — the same rule #95 was held back for.
- **No change to `decay_base: 0.9`**, even though it is the other key #95's audit flagged as
  inherited. It is defensible as shipped and belongs in its own ticket, later, alone.
- **No change to the projection model, the CSV adapter, or `scripts/project-points.ts`.**
- **No change to `scripts/generate-recommendations.ts` or how plans are stored or collapsed.**
- **No migration, no UI, nothing under `src/` or `supabase/`.**
- **No re-pinning of the solver commit.**

## Definition of done

- [ ] `buildSolverConfig`'s returned object contains `no_transfer_last_gws: 0`, and `SolverConfig`
      types it. Grep-checkable: the string `no_transfer_last_gws` appears in
      `scripts/build-solver-input.ts`.
- [ ] The value comes from a named exported constant whose comment states the shipped default (2),
      what the setting does, and why zero is right for a rolling 5-gameweek horizon.
- [ ] A unit test asserts the built config carries `no_transfer_last_gws: 0`.
- [ ] **A unit test asserts every other key in the built config is unchanged** — a full-object
      equality assertion, so an accidental edit to any other setting fails the build. This is the
      ticket's most important test, and #95 established the same guard.
- [ ] `preseason` is still `false`, `xmin_lb` is still its existing constant,
      `keep_top_ev_percent` is still 25, `ev_per_price_cutoff` is still 10, and `chip_limits` is
      still `{ bb: 0, wc: 0, fh: 0, tc: 0 }`. Named test for each. *(The shipped `preseason: true`
      wipes the squad — that must never regress.)*
- [ ] `docs/solver-notes.md`'s inherited-versus-overridden table reflects the change.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** no test proves the solver behaves differently, because the
      constraint is applied inside the Python solver at run time. The human check after merge is
      dispatching `Solver run` and reading the stored plans: **transfers should now be able to
      appear in gameweeks 4 and 5 of the horizon, where previously they never could.** Compare the
      reasoning screen's horizon figures against a previous run.

## Notes for the Analyst / Builder

**Why zero and not one, stated as a *because*.** The setting exists to stop an optimiser wasting
transfers at the end of a season it will not play again. **Because our horizon rolls forward every
night, there is no end** — the last gameweek of tonight's horizon is the fourth gameweek of
tomorrow's, and we will keep transferring right through it. Any non-zero value bans transfers in
weeks we will genuinely use. If a Builder finds a case this reasoning does not cover, report it
rather than picking a compromise value.

**What this does not do, and it is worth being clear.** We only ever *act* on gameweek 1 of the
horizon — the recommendation the app shows and the notification sends is this week's move. So this
is not a bug that has been handing out wrong transfers; it is a bug that has been **distorting the
plan behind the decision**, and therefore the decision itself at the margin. Do not overstate it in
the decisions log, and do not understate it either.

**Expect solve time to rise slightly.** Removing a constraint enlarges the feasible space. The time
limit is unchanged on purpose so that shows up rather than being absorbed — a timeout after this
merges is a finding, not a failure, and belongs in the end-of-run note.

**Verify from the pinned commit, never from memory or a blog post.** The merge semantics
(`options.update(config_options)` in `run/solve.py`) and the shipped value
(`"no_transfer_last_gws": 2` in `data/user_settings.json`) were read at commit
`45131c5a41d7caadb5cb626c012bfa9111dca7a2` on 25 August 2026. The solver checkout step in
`.github/workflows/solver-run.yml` already pins it.

**This is Tier 2** — it changes the behaviour of the optimiser at the heart of the recommendation.
Log it as HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `src/lib/override/`,
`src/lib/decisions/` and two screens; the other owns `src/lib/projection/` and
`docs/projection-model-backlog.md`. This ticket touches nothing under `src/` at all.

## Scope constraint

Nothing outside the following files changes:

- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `src/` or `supabase/`
changes. No other file under `scripts/` changes, and `docs/projection-model-backlog.md` is not
modified.
