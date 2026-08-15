## Context

Feature-list item 12 — the remaining half. #29 proved the solver's toolchain installs cleanly in a
GitHub Action at the pinned commit `45131c5a41d7caadb5cb626c012bfa9111dca7a2`. This ticket runs it
on our own data and stores what it produces.

Depends on item 11 (`scripts/emit-projections-csv.ts`, merged), item 10 (`player_projections`,
merged and populated), and #13/#14 (`squads` and `squad_picks`, the squad this solve starts from).

`product-brief.md` §6c: the solver is **adopted, not built** — it already implements multi-period
horizon planning, free-transfer valuation, bench weighting, hit limits and alternative-solution
generation. This ticket runs it. It does not interpret the result: Plan A/B/C, confidence bands and
stored reasoning are item 13.

### What was read in the solver's source at the pinned commit, 15 Aug 2026

Everything below was read directly, not inferred. Several of these contradict what a reasonable
person would assume.

- **`data/comprehensive_settings.json` ships `horizon: 8`.** `dev/solver.py:143–145` raises
  `ValueError(f"{week}_Pts is not inside prediction data…")` for **any** gameweek in
  `range(next_gw, next_gw + horizon)` without a `_Pts` column. Our CSV carries **five** gameweeks.
  **Running the solver at its default horizon crashes on the first call, every time.**
- **`xmin_lb` is `300` in the shipped settings**, not the `100` that `dev/solver.py:181` falls back
  to when the key is absent. It filters on the **sum** of `{gw}_xMins` across the horizon. At 300
  over five gameweeks a player needs to average 60 expected minutes a week to enter the pool at all.
- **`team_data` has three modes** (`run/solve.py`): `"id"` fetches the squad from FPL itself;
  `"json"` reads `data/team.json` from disk; `"json_string"` takes it inline. The shipped default is
  `"json"`, and **the error message for a missing `data/team.json` instructs the user to download it
  from `https://fantasy.premierleague.com/api/my-team/YOUR-TEAM-ID/`** — the authenticated endpoint.
  See the Notes: that instruction is a Tier 1 trap and must not be followed.
- **`preseason: true` in `data/user_settings.json`** replaces the squad with
  `{"picks": [], …, "bank": 1000}` — a full squad build from scratch, which
  `product-brief.md` §3 puts explicitly out of scope until the wildcard work.
- **`solve_regular()` builds an argparse flag for every settings key**, and `load_settings()` merges
  `data/comprehensive_settings.json` then `data/user_settings.json`. A `--config <path>` argument
  loads further files that override both. **Configuration does not require editing any file inside
  the solver checkout.**
- `secs: 600` is the solver time limit, `solver: "highs"` matches what #29 installed, and
  `chip_limits` are all `0`, so chips are already disabled.
- `num_iterations: 1` with `iteration_criteria: "this_gw_transfer_in_out"` is the Plan A/B/C
  mechanism §6c names. **Left at 1 by this ticket** — raising it is item 13's decision.
- Results are written by `run/solve.py` to `data/results/{datasource}_{stamp}_{runid}_{iter}.csv`,
  with columns including `week, id, name, pos, type, team, price, xP, lineup, bench, captain,
  vicecaptain, transfer_in, transfer_out, chip`.

## Scope

**In scope:**

- **`.github/workflows/solver-run.yml`** — a **new** workflow file, `workflow_dispatch` plus a
  schedule, that checks out the solver at the pinned SHA, installs it with `uv sync`, produces the
  input, runs the solve, and stores the output.
- **`scripts/build-solver-input.ts`** — reads `squads` and `squad_picks` for the current gameweek
  from Supabase and writes the solver's `data/team.json`, plus a config JSON carrying this app's
  setting overrides.
- **`scripts/store-solver-output.ts`** — parses the solver's results CSV and upserts it into
  Supabase.
- **`supabase/migrations/20260816090000_solver_output.sql`** — creates `solver_runs` and
  `solver_picks`, with RLS **and** GRANTs in the same file.
- Vitest tests for the pure parts of both scripts: the `team.json` shape, the config assembly, and
  the results-CSV parse.
- One `job_runs` row per execution.

**Explicitly out of scope:**

- **No recommendation, no Plan A/B/C, no confidence band, no captain advice in words, no stored
  reasoning.** Item 13 reads what this ticket stores.
- **No `num_iterations` above 1.** Item 13.
- **No Telegram, no notification of any kind.** Items 14 and 15.
- **No UI, no route, no component.** Nothing under `src/` changes at all.
- **No chip logic.** `chip_limits` stay at `0` and no `use_wc` / `use_bb` / `use_fh` / `use_tc` value
  is set. Items 25–27.
- **No wildcard or free-hit full-squad solve, and `preseason` is never `true`.** Item 28.
- **No change to `scripts/emit-projections-csv.ts`, `scripts/project-points.ts`, or
  `src/lib/projection/`.** This ticket consumes the CSV; it does not change how it is produced.
- **No change to `.github/workflows/scheduled-jobs.yml` or `.github/workflows/solver-smoke.yml`.**
  A new file, for the same reason #29 used one — see `decisions/ticket-29.md`.
- **No fork of, patch to, or file written inside `solver/` other than the two input files this
  ticket puts in its `data/` directory.** The pin does not move.
- No new npm dependency.
- **No new personal data.** The squad, bank and free transfers are already stored and already
  pre-approved by `product-brief.md` §5.

## Definition of done

**Build and scope**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] `.github/workflows/scheduled-jobs.yml` and `.github/workflows/solver-smoke.yml` are
      byte-for-byte unchanged.
- [ ] The solver checkout `ref:` is exactly `45131c5a41d7caadb5cb626c012bfa9111dca7a2`. No branch or
      tag reference appears in the new workflow.
- [ ] No new entry in `package.json`.

**The input — this is where the ticket is won or lost**

- [ ] The config passed to the solver sets **`horizon` to 5 or fewer**, and the value is derived
      from the number of distinct gameweeks actually present in the emitted CSV rather than
      hardcoded independently of it. There is a named test proving a config built from a
      three-gameweek CSV requests a horizon of 3, not 5 and not 8.
- [ ] The config sets **`team_data` to `"json"`** and `scripts/build-solver-input.ts` writes
      `data/team.json` **from `squads` and `squad_picks`**. The strings `my-team`, `"id"` as a
      `team_data` value, and `generate_team_json` appear nowhere in this repo. Verifiable by search.
- [ ] The config sets **`preseason` to `false`**, explicitly, overriding the shipped
      `user_settings.json`. There is a named test asserting it.
- [ ] `data/team.json` contains a `picks` array of 15 entries, each with `element`,
      `purchase_price`, `selling_price` and `element_type`; a `chips` array; and a `transfers`
      object carrying `bank`, `value`, `cost` and `limit`. `bank` and `value` come from `squads` in
      the same tenths-of-a-million units the rest of the repo uses, and `limit` from
      `squads.free_transfers`.
- [ ] The projections CSV is written to `solver/data/<datasource>.csv` by running the **existing**
      `scripts/emit-projections-csv.ts` with `PROJECTIONS_CSV_PATH`, and the config's `datasource`
      value matches that filename. The CSV is not regenerated by any new code.
- [ ] The config sets `xmin_lb` to **150**, overriding the shipped `300` (see Notes), and the run
      records how many players survived the pool filters.
- [ ] `chip_limits` remain `{"bb": 0, "wc": 0, "fh": 0, "tc": 0}` and no chip is ever forced or
      allowed. Verifiable by search: `use_wc`, `use_bb`, `use_fh`, `use_tc` are not assigned
      non-empty values anywhere.
- [ ] The solver is configured entirely through a config file and/or CLI flags. **No file inside the
      solver checkout is edited**, and `data/user_settings.json` and
      `data/comprehensive_settings.json` are not modified. The two files this ticket writes into
      `solver/data/` are the projections CSV and `team.json`.

**The run**

- [ ] **CANNOT VERIFY inside this run, and expected:** that the workflow completes a real solve on
      GitHub infrastructure. A `workflow_dispatch` workflow can only be triggered once its file
      exists on the **default branch**, so a brand-new workflow file on a `claude/` branch cannot be
      run from within the pipeline — exactly as with `solver-smoke.yml` in #29, which Keshav ran
      after merge. QA must mark this CANNOT VERIFY and say why, rather than claiming it or treating
      it as a failure. **This remains the ticket's central claim; it is simply verified by Keshav
      after merge, and it is what actually closes the ticket.**
- [ ] Because that is so, the workflow's own log must be the diagnostic: every step prints what it
      is about to do and with what configuration, the assembled solver config is echoed before the
      solve, and the solver's stdout is captured in full rather than swallowed.
- [ ] The workflow uploads, as named artifacts: the projections CSV fed in, the generated
      `team.json`, the solver's stdout log, and every results CSV produced.
- [ ] The solver's time limit is set explicitly and is **shorter than the job's own timeout**, so a
      slow solve returns an incumbent rather than being killed mid-write. The workflow job declares
      a `timeout-minutes`.
- [ ] `job_runs` gets one row per execution with `job_name = 'solver-run'`, carrying the gameweek
      solved, the horizon used, the solver's reported status, the objective value, the wall-clock
      solve time, and the surviving pool size.

**The three failure modes — `product-brief.md` §6c, and they are not interchangeable**

- [ ] **Install or checkout failure** fails the workflow loudly with a non-zero exit and a failed
      `job_runs` row naming the step.
- [ ] **A solve that hits the time limit and returns a non-optimal incumbent is stored, and stored
      as non-optimal** — `solver_runs` carries the solver's own status string, and a run that is not
      a proven optimum is distinguishable from one that is by reading a single column. It is never
      recorded as optimal.
- [ ] **An infeasible solve** writes a failed `job_runs` row whose message says the registered squad
      does not reconcile and that the squad should be re-checked — not a generic solver error. The
      exact wording is the Builder's, but the message must name the squad as the likely cause.
- [ ] A missing or empty projections CSV, or a gameweek with no projection rows, fails **before**
      the solver is invoked, with a message naming the cause.
- [ ] No squad in `squads` for the target gameweek exits **zero** with a named message and no solve
      attempted — the same shape as `sync-squad.ts`'s unset-`FPL_ENTRY_ID` path. This is a normal
      pre-GW1 state, not a failure.

**Storage**

- [ ] `supabase/migrations/20260816090000_solver_output.sql` creates `solver_runs` (one row per
      solve: gameweek, solver status, objective, horizon, seconds taken, `config jsonb`,
      `created_at`) and `solver_picks` (one row per player per gameweek per solution, carrying at
      least `solution_index`, `gameweek_id`, `player_id`, `player_code`, `is_lineup`, `bench_order`,
      `is_captain`, `is_vice_captain`, `is_transfer_in`, `is_transfer_out`, `expected_points`).
- [ ] **`solution_index` exists from the start**, even though this ticket only ever writes `0`, so
      item 13 can raise `num_iterations` without a second migration.
- [ ] **The same migration issues `GRANT SELECT` to `anon` and `GRANT SELECT, INSERT, UPDATE` to
      `service_role` on both new tables**, and enables RLS with a `SELECT` policy for `anon`.
      `DELETE` is not granted. *(`deltas.md` D8 — RLS and GRANTs are two independent gates.)*
- [ ] The migration is idempotent, with the same `anon`/`service_role` role guard every prior
      migration in this repo uses. Running it twice creates nothing the second time.
- [ ] `solver_picks.player_code` is populated by joining the solver's player id to `players.code`.
      The solver's `id` column is a current-season FPL element id and is stored as `player_id`.
- [ ] `scripts/store-solver-output.ts` reads exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, never
      deletes a row, and upserts. `.delete(` appears in neither new script.
- [ ] Scope constraint: only `.github/workflows/solver-run.yml`, `scripts/build-solver-input.ts`,
      `scripts/store-solver-output.ts`, their test files,
      `supabase/migrations/20260816090000_solver_output.sql`, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. **Plus any build-configuration file the
      above genuinely requires in order to compile, which must be logged as a decision with the
      failure it fixes** — see `deltas.md` D10. Nothing under `src/` changes.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

### The Tier 1 trap, stated plainly

`run/solve.py`'s own error message tells the user to download `data/team.json` from
`https://fantasy.premierleague.com/api/my-team/YOUR-TEAM-ID/`. **That endpoint requires an FPL
login.** `product-brief.md` §6a and §5 are unambiguous: this app never authenticates to FPL, never
stores a credential, cookie or session, and never calls `my-team/`. **This is the single reason the
whole app needs no account, and it must not be undone — not behind a flag, not "just for the
solver", not temporarily.** A ticket or a run that proposes it is a Tier 1 stop.

We do not need it. We already store the squad ourselves, in `squads` and `squad_picks`, written by
manual entry (#13) and by the public-endpoint sync (#14). **Build `team.json` from those two tables.**
The solver does not care where the file came from — that is the whole point of the `"json"` mode.

Do not use `team_data: "id"` either. It works and it uses public endpoints, but it makes the solver
the second thing in the system that decides what our squad is, and the first is our own database.
One writer, one truth.

### Purchase and selling price

`squad_picks` does not store what Keshav paid for a player. For the first solve, set
`purchase_price` and `selling_price` both equal to the player's current `players.now_cost`. This is
correct before GW1 (nothing has been bought or sold yet) and mildly wrong afterwards — a player who
has risen is worth slightly less to sell than his headline price. **Log it as a decision, note it in
`docs/projection-model-backlog.md`, and do not silently invent a purchase price.** Storing real
purchase prices is a follow-up ticket; it needs a transfer ledger that does not exist yet.

### Horizon — the one that crashes on contact

Our CSV carries five gameweeks. The solver's shipped horizon is eight. `prep_data` raises on the
first missing `{gw}_Pts` column, so the default configuration fails immediately and every time.
**Derive the horizon from the CSV**, do not hardcode a second copy of the number, and do not raise
either value independently of the other — item 10's `PROJECTION_HORIZON` and this config are two
ends of the same fact.

### `xmin_lb` at 150 — Tier 3, decided here

The shipped value of 300 across a five-gameweek horizon demands an average of 60 expected minutes a
week to enter the pool. That would eliminate every rotation option, and — because a player with no
Premier League history gets a conservative minutes fallback — a large share of the 45% of the squad
list the projection model has no history for (`product-brief.md` §8, data-coverage confidence).
**150** keeps genuine rotation risks visible while still excluding players who essentially do not
play. It is a guess and it is labelled as one: **report the surviving pool size in `job_runs`
every run**, so the number can be tuned from evidence rather than argued about. If the pool comes
back under about 150 players, the filters are too tight and that is a finding worth reporting.

### Running it

`uv sync` installs into the solver checkout; run the solve from that directory. `run/solve.py`
imports `from paths import DATA_DIR` and `from dev.solver import …`, so the solver's own root must
be the working directory and on the import path. **#29 proved `uv sync` works and nothing more** —
whether `run/solve.py` executes to completion in an Action is genuinely unproven and is the largest
risk in this ticket. If it fails on an import path, a missing extra, or a Python version, **report
that as the finding**; do not patch files inside the solver checkout to work around it. A pinned
third-party repository that needs patching is a decision for Keshav, not a 3am fix.

`is_latest_version()` is commented out at the top of `solve_regular()`, so there is no `git fetch`
at runtime. Do not re-enable it.

### `prep_data` fetches `bootstrap-static/` itself, and that is accepted

Resolved when item 11 was written; see that ticket's notes and `docs/solver-notes.md`. It fetches
*player metadata* — prices, teams, element types — not projections, so §6c's replaceable-projection
seam is intact. Accept the fetch. It is the third FPL call in the pipeline, not a new class of
dependency, and it maps onto §6c's "fail loudly" mode. If it ever needs to be eliminated, `utils.py`
routes it through `cached_request`, which reads `<solver>/.cache/http_cache.json` and skips the
network for entries younger than `CACHE_EXPIRATION` — **which is 300 seconds, not the 24 hours its
own docstring claims.** Do not build that here.

### Scheduling

Give the workflow `workflow_dispatch` **and** a schedule, but do not put it on the same trigger as
`scheduled-jobs.yml` — the solve needs the projections to be fresh, so schedule it after that
workflow's 17:45 UTC run has had time to finish. Pick a time, state it in a comment, and derive the
UTC value explicitly: Singapore is UTC+8 with no DST, so a Singapore-evening time is the same day in
UTC and a Singapore small-hours time is the previous day. Getting this wrong shifts every run by a
day, silently.

### What a substitute cannot catch

Unit tests prove the `team.json` shape, the config assembly and the results parse without a database
or a solver. They cannot prove the solve runs, and they cannot prove the GRANTs are right — a local
Postgres runs as superuser, for whom grants are irrelevant (`deltas.md` D8). **The workflow must
actually be run**, and its artifacts are the evidence.
