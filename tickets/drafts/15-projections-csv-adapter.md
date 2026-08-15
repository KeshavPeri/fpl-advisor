## Context

Feature-list item 11 — **the seam**. `product-brief.md` §6c: the solver "reads projections from a
CSV and does not care where they come from. **This CSV is the seam of the entire system**" — the
projection model can be replaced without touching the solver, the app, the data layer or the
notifications. Item 31 (swap in a retrained OpenFPL) is supposed to touch nothing but the projection
job. Whether that turns out to be true is decided by this ticket.

Depends on item 10's `public.player_projections` table being merged, its migration applied to live
Supabase, and `scripts/project-points.ts` having run at least once. Also depends on #29, which
pinned the solver at `45131c5a41d7caadb5cb626c012bfa9111dca7a2` and produced `docs/solver-notes.md`.

**This ticket produces the CSV. It does not run the solver.** Running it is item 12.

### What was verified in the solver's source, 15 Aug 2026

Read directly at the pinned commit, confirming and extending `docs/solver-notes.md`:

- **`dev/solver.py:136`** — `pd.merge(elements_team, data, left_on="id_x", right_on="ID")`. This is
  an **inner** merge, and `id_x` is the FPL **element id** from a live `bootstrap-static/` fetch.
  **Therefore `ID` must be a current-season FPL element id.** Any row whose `ID` is not in the live
  response is silently dropped before the solve, with no warning.
- **`dev/solver.py:143–145`** — raises `ValueError(f"{week}_Pts is not inside prediction data...")`
  for any gameweek in `range(next_gw, next_gw + horizon)`. **The column names are absolute FPL
  gameweek numbers**, not offsets: `1_Pts`, `2_Pts`, not `0_Pts`.
- **`utils.py:xmin_to_prob(xmin, ...)`** divides by `90` — **`{gw}_xMins` is expected minutes on a
  0–90 scale, not a probability.**
- **`dev/solver.py:183`** — the player pool is filtered on `total_min`, the **sum of every
  `{gw}_xMins` column across the horizon**, against `xmin_lb` (default `100`). A player projected
  well but with thin minutes disappears from the solve unless already in the squad.
- **`dev/data_parser.py:read_data`** — requires `data/{datasource}.csv` to exist inside the solver
  checkout before any reader runs. `Name`, `Team` and `Value` are read by neither `read_solio` nor
  `read_fplreview`; only `ID`, `Pos`, `{gw}_Pts` and `{gw}_xMins` are load-bearing.

## Scope

**In scope:**

- **`scripts/emit-projections-csv.ts`** — reads `public.player_projections` and `public.players`,
  and writes one CSV in the solver's expected input shape.
- Columns, in this order: `ID`, `Pos`, `Name`, `Team`, then `{gw}_Pts` and `{gw}_xMins` for each
  gameweek in the horizon, ascending.
- `ID` is `players.id` — the **current-season FPL element id**, per the inner merge above.
- `Pos` is `"G"` / `"D"` / `"M"` / `"F"`, mapped from `players.element_type` 1–4.
- Output path from `PROJECTIONS_CSV_PATH`, defaulting to `./out/projections.csv`. The job creates
  the directory if absent.
- A coverage self-check written into `job_runs.details` (see the definition of done).
- One new step in `.github/workflows/scheduled-jobs.yml`, after item 10's projection step, plus an
  `actions/upload-artifact` step so the CSV is downloadable from the run.
- One `job_runs` row per execution, `job_name = 'emit-projections-csv'`.

**Explicitly out of scope:**

- **The solver is not checked out, installed, configured or run.** No `uv`, no
  `sertalpbilal/FPL-Optimization-Tools` checkout, no `data/` directory inside a solver clone, no
  `user_settings.json`, no `solve.py` invocation. That is item 12, and the whole point of this
  ticket is that it can be verified without any of it.
- **No change to `.github/workflows/solver-smoke.yml`.**
- **No change to `src/lib/projection/` or to the model.** This ticket reads stored numbers and
  formats them. If a projection looks wrong, that is item 10's ticket, not this one.
- **No projection computed here.** If `player_projections` has no row for a player-gameweek, that
  is reported, not filled in.
- No Supabase Storage bucket, no committing the CSV to the repository, no upload to any external
  service. A file on the runner plus a workflow artifact is the entire delivery mechanism.
- No recommendation, no Plan A/B/C, no Telegram, no UI.
- No new dependency — Node's built-in file APIs are sufficient. Do not add a CSV-writing library.
- No new stored data in Supabase. This job only reads.

## Definition of done

**Shape — the contract with the solver**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] The header row is exactly `ID,Pos,Name,Team` followed by `{gw}_Pts,{gw}_xMins` pairs in
      ascending gameweek order, using **absolute FPL gameweek numbers**. For a horizon starting at
      gameweek 3 with 5 gameweeks, the header ends
      `3_Pts,3_xMins,4_Pts,4_xMins,5_Pts,5_xMins,6_Pts,6_xMins,7_Pts,7_xMins`. There is a named test
      asserting this exact string.
- [ ] `ID` is `players.id`. The string `player_code` does not appear in the `ID` column's derivation.
      Verifiable by search. *(`player_code` is the right key everywhere else in this repo and is the
      wrong one here — see the Notes.)*
- [ ] `Pos` maps `element_type` 1→`G`, 2→`D`, 3→`M`, 4→`F`. There is a named test per position.
- [ ] `{gw}_xMins` is expected minutes on a **0–90 scale per gameweek**, taken from
      `player_projections.expected_minutes` unmodified. No value is divided by 90, and no value is
      written as a probability. A double gameweek may legitimately exceed 90; that is not clamped.
- [ ] `{gw}_Pts` is `player_projections.expected_points` unmodified.
- [ ] **The read filters on a single named model version, from one constant with the value
      `'baseline-v1'`.** `player_projections`'s primary key is
      `(gameweek_id, player_id, model_version)`, so an unfiltered read emits one duplicate row per
      player per additional model the moment item 31 writes a second one — and the solver's
      `drop_duplicates(subset=["ID"], keep="first")` would silently pick whichever arrived first.
      There is a named test proving rows from a second model version are excluded.
- [ ] Every cell is a plain number with no thousands separator, no currency symbol and no quoting.
      Any `Name` containing a comma or a double quote is CSV-quoted correctly, and there is a named
      test using a name containing both.
- [ ] The file is written with a trailing newline and UTF-8 encoding, no BOM.

**Completeness — what the inner merge will do to us**

- [ ] **Every row is complete across the whole horizon.** A player missing a projection for any
      gameweek in the horizon is either written with an explicit `0` for that gameweek's pair, or
      omitted entirely — never written with an empty cell, and never written with a missing column.
      The choice is made once, documented in the file header, and applied consistently.
- [ ] `job_runs.details` records, as separately named counts: rows written; `players` rows with no
      `player_projections` row at all; player-gameweek pairs filled with `0` because a projection
      was missing; and the number of distinct gameweeks covered.
- [ ] The job **fails loudly, writing a failed `job_runs` row and exiting non-zero**, if any
      gameweek in the horizon has zero projection rows across all players — because
      `dev/solver.py` raises `ValueError` on a missing `{gw}_Pts` column and a silent empty column
      would surface as an opaque solver crash a step later.
- [ ] The job fails loudly if `player_projections` does not exist, naming the table and item 10's
      migration file, matching the `isMissingTable` pattern the other jobs already use.
- [ ] The job **warns and records a count** — but does not fail — when the total of a player's
      `{gw}_xMins` across the horizon is below `100`, since the solver's default `xmin_lb` will drop
      those players from the pool. The count goes in `job_runs.details`.

**Wiring**

- [ ] `scripts/emit-projections-csv.ts` reads exactly `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and the
      optional `PROJECTIONS_CSV_PATH`. No `VITE_`-prefixed variable appears in it.
- [ ] The job performs **no network request other than to Supabase**. The strings
      `fantasy.premierleague.com`, `raw.githubusercontent.com` and `github.com` do not appear in the
      file. Verifiable by search.
- [ ] The job writes no row to any table other than `job_runs`. `.insert(`, `.upsert(`, `.update(`
      and `.delete(` appear in this file only against `job_runs`.
- [ ] The horizon is read from the same source item 10 uses — `gameweeks.is_next` plus the following
      ids — and the two jobs cannot disagree about which gameweeks are in scope. If
      `player_projections` covers a different set, the job reports the difference in
      `job_runs.details`.
- [ ] The new workflow step runs **after** item 10's projection step in
      `.github/workflows/scheduled-jobs.yml`, and **the heartbeat, core-insights, FPL-ingest,
      squad-sync and projection steps all still exist and are unmodified in the merged file.**
- [ ] An `actions/upload-artifact` step uploads the CSV, named so it is identifiable from the run
      summary. The workflow still succeeds when the file is absent because an earlier step failed —
      the upload does not mask a failure or invent an empty artifact.
- [ ] Scope constraint: only `scripts/emit-projections-csv.ts`, its test file,
      `.github/workflows/scheduled-jobs.yml`, and this ticket's own `decisions/ticket-<number>.md`
      are added or changed. Nothing under `src/`, `supabase/` or `docs/` changes; no other file in
      `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

### The `prep_data` question — resolved, and it does not block this ticket

`docs/solver-notes.md` and the orchestrator handoff both flag that `dev/solver.py`'s `prep_data`
fetches live `bootstrap-static/` itself, and ask whether that breaks §6c's claim that the solver
"does not care where the projections come from". **The honest answer is that it does not, and the
handoff overstated the coupling.** What `prep_data` fetches is *player metadata* — current prices,
teams, element types, availability. It does not fetch projections. Replacing the projection model
still means changing only the producer of this CSV, which is exactly the property §6c is protecting.

What the fetch genuinely costs us is **reproducibility**, and that only bites when we replay
history — item 32's backtest cannot have the solver pulling *today's* `bootstrap-static/` while
simulating a 2025/26 deadline. That is a wave-10 problem, not a GW1 one.

**What it forces on *this* ticket, and the reason it had to be read before writing this ticket:**
the merge is on the live element id, so `ID` must be `players.id`. This is the one place in this
codebase where `player_code` is the wrong key, and the rule everywhere else is the opposite. Say so
in the file header comment.

**Recorded for item 12, so it is decided from evidence rather than at 3am** — the three options
weighed, with what was actually found in the source at the pinned commit:

1. **Bypass `prep_data` and call the model-building code directly.** Rejected as the default. It
   throws away the maturity that made §6c adopt this solver, and every upstream change becomes ours
   to re-derive.
2. **Pre-seed the solver's HTTP cache.** `utils.py` routes the fetch through `cached_request(url)`,
   which reads `<solver-checkout>/.cache/http_cache.json`, a plain JSON object keyed by URL with
   `{"data": ..., "timestamp": ...}` per entry, and skips the network when the entry is younger than
   `CACHE_EXPIRATION`. **Note that `CACHE_EXPIRATION = 300` seconds — the docstring above it claims
   24 hours and is wrong.** Writing that file immediately before invoking the solver in the same
   step makes the fetch disappear entirely. The pin is fixed, so this cannot change under us. This
   is the escape hatch, and it becomes **mandatory** at item 32.
3. **Accept the fetch, with graceful failure.** Recommended for item 12 now. The Action already
   calls the FPL API twice per run (`ingest-fpl`, `sync-squad`); a third call in the same workflow
   is not a new class of dependency, and it maps cleanly onto §6c's "run fails loudly, Telegram
   sends a failure notice, the app shows the previous recommendation with its age".

**None of this belongs in this ticket's code.** It is written here so item 12 inherits a decision
instead of a question.

### The rest

- **`Name` and `Team` are for humans.** Neither `read_solio` nor `read_fplreview` reads them; they
  are a plain `pd.read_csv`. Emit them so a failed solve can be diagnosed by opening the file, and
  say in the header comment that they are non-load-bearing. Do not emit `Value` — it invites
  confusion with `players.now_cost`, which the solver takes from its own live fetch anyway.
- **`Pos` is also not load-bearing.** The squad-shape constraints use `element_type` from the
  solver's own fetch, not this column; `Pos` is read only by an optional price filter. Emit
  `G`/`D`/`M`/`F` per `docs/solver-notes.md` and do not agonise over it.
- **Do not write into a solver checkout.** `read_data` requires the file to sit at
  `<solver-checkout>/data/{datasource}.csv`, but arranging that is item 12's job, in item 12's
  workflow, where the checkout exists. This job writes one file to a path it is told about. Keeping
  it that way is what lets this ticket be verified with no Python, no `uv` and no solver at all.
- **Zero-fill versus omit.** Pick zero-fill unless there is a reason not to: an omitted player
  cannot be transferred *in* by the solver, whereas a zero-projected player simply never wins the
  optimisation. Omission silently narrows the search space; zeroes do not. Whichever is chosen,
  document it in the file header and make the count visible in `job_runs.details`.
- **The `xmin_lb` warning matters more than it looks.** With the solver's default of `100` total
  expected minutes across a 3-gameweek horizon, a fringe player projected at 30 minutes a week is
  invisible to the solve. That is usually correct behaviour, but it must be *visible*, or a "why
  did it never suggest him" question in October has no answer.
- **What a substitute cannot catch here.** Tests can prove the header string, the quoting, the
  position mapping and the zero-fill rule with no database and no solver. They cannot prove the
  emitted `ID` values survive the solver's inner merge against live `bootstrap-static/` — that is
  proven for the first time in item 12, and it is the single thing most likely to be wrong. Item 12
  should therefore report its post-merge row count as an explicit definition-of-done item.
