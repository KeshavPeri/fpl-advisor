## Context

**Feature-list item 31 is "swap the projection source behind the CSV seam", and the seam has never
been tested.** This ticket proves it works, before there is a second model depending on it.

`product-brief.md` §6c calls the projections CSV **"the seam of the entire system"** — the property
that lets the projection model be replaced without touching the solver, the app, the data layer or
the notifications. `player_projections`'s primary key is `(gameweek_id, player_id, model_version)`,
and the column exists, in the migration's own words, *"precisely so a successor can be written
alongside `baseline-v1` rather than over it."*

**In practice the seam is welded shut.** `MODEL_VERSION = 'baseline-v1'` is a hardcoded constant in
`scripts/project-points.ts`, duplicated as a second hardcoded constant in
`scripts/emit-projections-csv.ts`, and `scripts/snapshot-predictions.ts` carries a third copy.
Running a second model alongside the first, or emitting a CSV from it, is not possible without
editing three files and redeploying — which is exactly the thing the seam was supposed to make
unnecessary.

**Why now, before item 30.** The retrain (item 30) is the largest modelling item on the list and it
depends on this seam being real. Discovering at that point that the seam does not work would be the
worst possible moment. `LEARNINGS-second-build-wave.md` §6 makes the general case: build the thing
that proves the chain works *early*, not late.

**This is groundwork for item 31, not item 31 itself.** Item 31 swaps the source once a successor
exists; this ticket makes swapping possible and proves it with a second version that is
deliberately trivial.

Depends on item 10 (merged, #33) and item 11 (merged, #34). Nothing unmerged.

## Scope

**In scope:**

- **A single shared model-version resolution**, read from an environment variable
  (`PROJECTION_MODEL_VERSION`), trimmed, defaulting to `baseline-v1`. Same convention
  `CORE_INSIGHTS_SEASON` and `FEATURE_HISTORY_SEASON` already establish.
- **`scripts/project-points.ts` writes under the resolved version**, rather than a hardcoded
  literal.
- **`scripts/emit-projections-csv.ts` reads under the resolved version**, rather than its own
  hardcoded literal — so a CSV can be emitted from whichever model is asked for, with **no code
  change at all.**
- **A second, deliberately trivial model version to prove the seam**, selected by the same variable:
  `flat-v0`, which projects every available player at a fixed, position-independent expected-points
  figure and every unavailable player at zero. **It is not a model and must not be mistaken for
  one** — its entire job is to be visibly different from `baseline-v1` so a swap is observable end
  to end.
- **`scripts/project-points.ts` selects which projection function to run** from the resolved
  version, through one explicit mapping. An unrecognised version **fails loudly, naming the value
  and listing the known ones** — it never falls back to `baseline-v1`.
- **Counters in `job_runs.details`** for both jobs: the resolved model version, so a run's
  provenance is readable from the job row alone.
- **The decisions log records** that the seam is now exercised, what `flat-v0` is for, and that
  item 31 remains open until a real successor exists. **No documentation file is edited** — another
  ticket in this batch owns `docs/projection-model-backlog.md`.

**Explicitly out of scope:**

- **No change to `baseline-v1`'s behaviour, at all.** With the variable unset, every job must
  produce byte-for-byte what it produces today. This is the ticket's central constraint.
- **No change to `scripts/snapshot-predictions.ts`.** It carries a third copy of the constant and
  should eventually share this resolution, but the prediction log is a frozen historical record and
  changing what it snapshots mid-season is a separate, more delicate decision. **Record it in the
  decisions log as a known follow-up; do not touch the file.**
- **No trained model, no OpenFPL, no feature engineering.** Item 30.
- **No change to `scripts/build-solver-input.ts`, the solver config, or the workflows.** A run under
  a different model version is a hand-run experiment for now.
- **No UI showing which model produced a recommendation.** Worth doing later; not here.
- **No migration.** `player_projections.model_version` already exists and is already in the key.
- **No deletion of any `player_projections` row.** Two versions coexist by design — that is the
  point.

## Definition of done

- [ ] With `PROJECTION_MODEL_VERSION` unset, `project-points` writes rows with
      `model_version = 'baseline-v1'` and every projected value is identical to today's. **A test
      asserts full equality of the produced rows against the current behaviour** — this is the most
      important test in the ticket.
- [ ] With the variable unset, `emit-projections-csv` produces a byte-identical CSV to today's for
      the same input. Named test.
- [ ] With the variable set to `flat-v0`, `project-points` writes rows under that version and
      **leaves every existing `baseline-v1` row untouched**. Named test asserting both versions
      coexist for the same gameweek and player.
- [ ] With the variable set to `flat-v0`, `emit-projections-csv` emits from those rows and not from
      `baseline-v1`'s. Named test.
- [ ] An unrecognised version fails loudly, naming the supplied value and listing the known
      versions, and writes a `job_runs` row with `status = 'failure'`. Named test. **It must never
      silently fall back** — a run that quietly projected under the wrong model would be
      indistinguishable from a correct one in every downstream table.
- [ ] `flat-v0` projects every available player at the same figure regardless of position, and every
      unavailable player at zero. Named tests. *(Position-independence is what makes a swap visible
      at a glance: if defenders and forwards project identically, the swap took effect.)*
- [ ] `job_runs.details` carries the resolved model version for both jobs.
- [ ] The version is resolved in exactly one place and imported by both jobs — **the duplicated
      literal is gone from both.** Grep-checkable: the string `'baseline-v1'` appears at most once
      across `scripts/project-points.ts` and `scripts/emit-projections-csv.ts` combined.
- [ ] `scripts/snapshot-predictions.ts` is unchanged. Grep-checkable.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file under
      `scripts/` other than the two named jobs and their tests changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** no test proves the solver accepts a CSV emitted from a
      different model, because the solve happens inside the Python solver at run time. The human
      check after merge is the actual proof of this ticket: run `project-points` and
      `emit-projections-csv` with `PROJECTION_MODEL_VERSION=flat-v0`, then dispatch `Solver run`
      **by hand against that CSV**, and confirm it solves. **A recommendation that looks obviously
      strange is the correct outcome** — `flat-v0` is not a model. Then confirm the next normal
      nightly run produces a normal `baseline-v1` recommendation, unaffected.

## Notes for the Analyst / Builder

**Why a deliberately stupid second model, stated as its *because*.** A seam is only proven by
passing something different through it. **Because** a second *plausible* model would make a failed
swap hard to spot — the numbers would look reasonable either way — `flat-v0` is built to be
obviously, visibly wrong: every player the same, regardless of position or fixture. **If a
recommendation under `flat-v0` looks sensible, the swap did not happen.** That is the test.

**The name matters.** `flat-v0`, not `test` or `dummy`, because it will appear in
`player_projections.model_version` rows that persist, and a future reader must be able to tell what
it was without finding this ticket.

**Do not delete `flat-v0` rows afterwards.** `player_projections` has no `DELETE` grant for
`service_role` by design, and the coexistence of two versions is the property being demonstrated.
They are harmless: every consumer filters on the version it wants, which is what this ticket makes
true.

**The third copy of the constant is deliberately left alone.** `scripts/snapshot-predictions.ts`
freezes a pre-deadline record that is meant never to change; making it follow a variable mid-season
risks a snapshot under one model being settled against a projection from another. That is a real
decision and it deserves its own ticket — **log it as a known follow-up rather than fixing it
quietly.**

**Read `scripts/emit-projections-csv.ts`'s file header before starting.** It explains why the read is
filtered on `model_version` at all: without the filter, a second version would silently double every
player's rows in the CSV and the solver's own de-duplication would keep whichever arrived first. That
comment is the reason this ticket is possible without a schema change — and it is also the exact bug
this ticket must not introduce.

**This is Tier 2** — it changes how the projection model is selected, which every downstream figure
depends on. Log it as HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/ingest-core-insights.ts`,
`scripts/build-feature-history.ts`, a new migration and `supabase/README.md`; the other owns
`scripts/calibration-report.ts` **and `docs/projection-model-backlog.md`**. This ticket touches none
of them — in particular, **do not edit `docs/projection-model-backlog.md`**; this ticket's findings
belong in its own decisions file.

## Scope constraint

Nothing outside the following files changes:

- `scripts/project-points.ts`, `scripts/project-points.test.ts`
- `scripts/emit-projections-csv.ts`, `scripts/emit-projections-csv.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` or `docs/` changes. No workflow file is
touched. Nothing under `src/` changes. `scripts/snapshot-predictions.ts`,
`scripts/ingest-core-insights.ts`, `scripts/build-feature-history.ts`,
`scripts/build-solver-input.ts`, `scripts/calibration-report.ts` and
`docs/projection-model-backlog.md` are not modified.
