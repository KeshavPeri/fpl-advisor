## Context

The infrastructure half of feature-list item 12, pulled forward deliberately. Depends on nothing —
it neither reads nor produces app data.

`product-brief.md` §6c adopts `sertalpbilal/FPL-Optimization-Tools` as the optimiser rather than
building one, and calls its projections CSV **"the seam of the entire system"**. Two things are
unproven: whether that toolchain installs and runs inside a GitHub Action at all, and what column
headers its projections CSV actually expects. Both are discovered here, before item 11 writes an
adapter against a guessed format and before item 12 depends on a binary nobody has run.

This is the same move as #10's heartbeat: prove the machinery in isolation, so that when the real
integration fails it is obvious whether the job or the pipeline broke. It advances no user-visible
feature and is not on the critical path for a recommendation — it de-risks the two items that are.

## Scope

**In scope:**

- A **new, separate** workflow file `.github/workflows/solver-smoke.yml`, `workflow_dispatch` only —
  no `schedule:` trigger.
- A step that fetches `sertalpbilal/FPL-Optimization-Tools` **at a pinned commit SHA**, installs its
  dependencies, and runs its own solver against **its own bundled sample data**.
- Recording, in `decisions/ticket-<this number>.md`: the pinned SHA, the install commands that
  actually worked, the Python version used, the wall-clock time of the solve, and — most
  importantly — **the exact column headers of the sample projections CSV, quoted verbatim.**
- A short `docs/solver-notes.md` capturing the same headers and the invocation, so item 11 has a
  written target rather than a memory of a green run.

**Explicitly out of scope:**

- **No integration with this app's data.** No reading from Supabase, no writing to it, no
  `job_runs` row, no projections of ours. This ticket runs the solver against the upstream sample
  file and nothing else.
- **No CSV adapter.** Emitting our projections in the solver's format is item 11 and must not be
  started here — guard that seam.
- No recommendation generation, no Plan A/B/C, no chip logic, no squad solving.
- **No change to `.github/workflows/scheduled-jobs.yml`.** A new file, so the daily job is
  untouched and this cannot collide with anything.
- **No changes under `src/`.** Another ticket is running in the same batch and owns `src/lib/`.
- No new npm dependency; nothing here is JavaScript.
- No account, no API key, no credential, no paid service. The tool is Apache-2.0 and its
  dependencies are public.
- Does not vendor the upstream repository into this one.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` still pass clean — this ticket adds no
      JavaScript, so all three must be unaffected.
- [ ] `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/solver-smoke.yml'))"`
      exits 0.
- [ ] The workflow declares `workflow_dispatch` and **does not** declare `schedule`.
- [ ] `scheduled-jobs.yml` is byte-identical to `main`.
- [ ] The upstream repository is fetched at a **pinned 40-character commit SHA**, not a branch name
      and not a tag. The SHA appears literally in the workflow file.
- [ ] The workflow runs to completion and the solver produces a solution file from the upstream
      sample data. *(Owner-level — the workflow does not exist on the default branch until this
      merges, so expect CANNOT VERIFY. Keshav triggers it via workflow_dispatch after merging.)*
- [ ] The Builder ran the same install-and-solve sequence in its own session and reports the actual
      output — the commands used, whether the solve reached optimality, and how long it took. If the
      session's network policy blocks it, say so plainly rather than marking this from reading.
- [ ] `docs/solver-notes.md` exists and quotes the sample projections CSV's header row **verbatim**,
      character for character, plus the exact command that produced a solution.
- [ ] `decisions/ticket-<number>.md` records the pinned SHA, the Python version, and the solve time.
- [ ] No credential, token or `Authorization` header appears anywhere added by this ticket.
- [ ] Scope constraint: only `.github/workflows/solver-smoke.yml`, `docs/solver-notes.md` and this
      ticket's own `decisions/ticket-<number>.md` are added. Nothing under `src/`, `scripts/`,
      `supabase/` or `.github/workflows/scheduled-jobs.yml` changes, and `package.json` is
      untouched.

## Notes for the Analyst / Builder

- **A separate workflow file is a deliberate Tier 2 decision, made here.** Because the solver
  install is slow and this is a diagnostic, not a daily job — putting it in `scheduled-jobs.yml`
  would add minutes to every nightly run for something that has no daily output, and would make
  this ticket collide with every future ingest ticket. Log it with that reasoning; do not escalate.
- **Pinning to a SHA is not optional.** An unpinned upstream that changes overnight turns a working
  solver into a Friday-evening mystery mid-season, which `product-brief.md` §6a explicitly rejects
  as a failure mode. Resolve the current `main` SHA, pin it, record it.
- **Upstream install, as documented:** the project uses `uv`, which installs Python and dependencies
  together — `uv sync`, then `cd run && uv run python solve.py`. It depends on `pandas` and on
  **HiGHS via `highspy`**. On a GitHub runner, `astral-sh/setup-uv` or `pip install uv` both get
  you `uv`. **In your own session, prefer `pip install uv`:** the routine's cloud environment uses
  a custom network allowlist — the default list plus `fantasy.premierleague.com`, `*.vercel.app`,
  `vercel.com` and `*.supabase.co` — which covers the package registries but may not cover
  `astral.sh`, where the standalone `uv` installer script lives. A fetch failing with `403` and
  `x-deny-reason: host_not_allowed` is an owner action (Keshav adds the host); report it rather
  than routing around it. The GitHub Actions runner has unrestricted network access and is not
  subject to any of this. If the documented path does not work, report exactly what failed rather
  than substituting a different solver — CBC instead of HiGHS is a Tier 2 change, not a
  workaround.
- **The column headers are the point of this ticket.** A green run that does not write them down
  has failed its actual purpose. Item 11 has to emit that exact format, and "we ran it once and it
  worked" is not something a future session can build against.
- Configuration lives in `data/user_settings.json` and `data/comprehensive_settings.json`, with the
  projections CSV referenced by filename from the former. Note in `docs/solver-notes.md` which
  settings had to be changed, if any, to get a solve out of the sample data.
- **Do not point the solver at our data**, do not create `data/` in this repo, and do not write an
  adapter "while you're in there." Item 11 is the seam that lets the projection model be replaced
  later without touching the solver, the app, the data layer or the notifications. Blurring it here
  closes that upgrade path.
- Apache-2.0 permits this use. Nothing here requires an account or a payment method.
