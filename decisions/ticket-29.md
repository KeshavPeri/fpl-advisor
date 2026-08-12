# Ticket #29 — Prove the solver runs in a GitHub Action

## HIGH-IMPACT

- **A new, separate `solver-smoke.yml` workflow file, not added to `scheduled-jobs.yml`.**
  Because the solver install is slow (deps + a HiGHS build) and this is a one-off diagnostic,
  not a daily job; folding it into the nightly workflow would add minutes to every nightly run
  for no daily output, and would collide with future ingest tickets landing on that same
  trigger. Pre-answered in the ticket; logged here per instruction, not re-derived.

- **Pin re-verified at `45131c5a41d7caadb5cb626c012bfa9111dca7a2` (current upstream `main` as
  of 2026-08-12), not moved to an older commit, after checking whether an older commit could
  satisfy the ticket's "sample data" requirement instead.** An earlier pass at this ticket
  built a projections CSV from the live FPL `bootstrap-static` endpoint to prove a full solve;
  the Analyst correctly flagged that as out-of-scope adapter work (item 11's job, done early)
  regardless of the data source, and that code has been removed. The Analyst's suggested
  alternative — pin to a commit before `374c36c` ("remove unnecessary files", Aug 2025), which
  deleted files under `data/sample_outputs/` — was investigated directly rather than assumed:
  `git log --diff-filter=A --name-only --all --remotes -- "*.csv"` shows every CSV ever
  committed to this repository, on every branch, and none of them is a projections *input* a
  squad solve can run against. The two files `374c36c` removed
  (`optimal_plan_decay.csv`/`optimal_plan_regular.csv`) are solver *output* examples, not
  inputs; the only other CSVs ever committed are a per-team Assistant Manager chip file
  (`data/am_pts.csv`, unrelated format, and its reading code was already deleted before the
  pinned commit) and an unrelated goalkeeper-stats notebook fixture. **No commit in this
  repository's history ships a usable sample projections CSV**, so moving the pin does not
  satisfy the DoD item it was proposed to satisfy. Staying on current `main` was therefore the
  right call once this was checked — moving the pin for no benefit would just be pinning to an
  arbitrary older, less-maintained commit. Full verification trail in `docs/solver-notes.md`.

- **The workflow no longer attempts a full solve.** It proves install +
  dependency-resolution (`uv sync`) only, and stops there, because a solve step needs a
  projections CSV in the solver's input shape and — per the above — no genuine upstream sample
  exists, and building one (of any kind, live-fetched or hand-authored) reproduces the adapter
  objection this ticket is meant to avoid. This is flagged as an **open question returned to
  the coordinator/Analyst**, not resolved unilaterally: see `docs/solver-notes.md`, "Blocked:
  no bundled sample projections CSV exists," for the options awaiting a decision.

## ROUTINE

- Used `astral-sh/setup-uv@v7` in the Action (rather than `pip install uv`) because a GitHub
  Actions runner has unrestricted network access to astral.sh and this is the documented,
  purpose-built action for the job; `pip install uv` was used in this session instead because
  this session's network allowlist may not cover `astral.sh` (it did not need testing — PyPI
  worked on the first try).
- Named the checkout step's local path `solver` (via `actions/checkout`'s `path:` input)
  rather than a bare top-level clone, purely so the workflow's later `working-directory`
  references read unambiguously.
