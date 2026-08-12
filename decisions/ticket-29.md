# Ticket #29 — Prove the solver runs in a GitHub Action

## HIGH-IMPACT

- **A new, separate `solver-smoke.yml` workflow file, not added to `scheduled-jobs.yml`.**
  Because the solver install is slow (deps + a HiGHS build) and this is a one-off diagnostic,
  not a daily job; folding it into the nightly workflow would add minutes to every nightly run
  for no daily output, and would collide with future ingest tickets landing on that same
  trigger. Pre-answered in the ticket; logged here per instruction, not re-derived.

- **The upstream repo at the pinned commit does not ship a bundled sample projections CSV** —
  the ticket's premise on this point does not hold. Verified directly: `data/` at
  `45131c5a41d7caadb5cb626c012bfa9111dca7a2` contains only settings files and docs; the
  historical sample data was deleted upstream in commit `374c36c` (Aug 2025), confirmed via
  `git log --all -- "*.csv"` against upstream history. Because the ticket's purpose (prove the
  toolchain, capture the real column headers) is still fully achievable without a bundled
  sample, I did not stop and escalate this as a blocking question — instead the workflow
  builds a minimal projections CSV from the live public FPL `bootstrap-static` endpoint (the
  same endpoint the solver itself calls at runtime regardless of CSV contents) using real
  current player IDs. Real IDs are not optional: `dev/solver.py:prep_data` inner-joins the
  projections CSV against live FPL data on `ID`, so synthetic/fake IDs merge to zero rows and
  the model is infeasible before the solver even starts. This is not this app's data, not a
  CSV adapter, and nothing upstream is vendored — full reasoning and the exact header row are
  in `docs/solver-notes.md`. Flagging this HIGH-IMPACT because it changes what "the sample
  data" means for whoever reads this ticket's outcome later, and because the future CSV-adapter
  ticket should target the header derived from source code (`docs/solver-notes.md`), not a file
  that turned out not to exist.

- **Smoke-test horizon set to 1 gameweek, not the shipped default of 8.** Because a 1-GW
  smoke CSV is the minimal thing that proves install → solve → output end-to-end; proving
  behaviour at the product's real 8-GW horizon is out of scope for this ticket (no
  recommendation generation, no squad solving per the ticket's explicit exclusions) and is
  flagged in `docs/solver-notes.md` as unverified by this smoke test, for whichever ticket
  next depends on real solve timing.

## ROUTINE

- Used `astral-sh/setup-uv@v7` in the Action (rather than `pip install uv`) because a GitHub
  Actions runner has unrestricted network access to astral.sh and this is the documented,
  purpose-built action for the job; `pip install uv` was used in this session instead because
  this session's network allowlist may not cover `astral.sh` (it did not need testing — PyPI
  worked on the first try).
- Named the checkout step's local path `solver` (via `actions/checkout`'s `path:` input)
  rather than a bare top-level clone, purely so the workflow's later `working-directory`
  references read unambiguously.
- Kept the CSV-building Python inline in the workflow step (heredoc) rather than committing a
  script under `.github/` or `scripts/`, since `scripts/` is explicitly out of scope for this
  ticket and the script has no reuse beyond this one diagnostic step.
