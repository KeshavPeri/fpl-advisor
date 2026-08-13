# Ticket #29 — Prove the solver runs in a GitHub Action

## HIGH-IMPACT

- **A new, separate `solver-smoke.yml` workflow file, not added to `scheduled-jobs.yml`.**
  Because the solver install is slow (deps + a HiGHS build) and this is a one-off diagnostic,
  not a daily job; folding it into the nightly workflow would add minutes to every nightly run
  for no daily output, and would collide with future ingest tickets landing on that same
  trigger. Pre-answered in the ticket; logged here per instruction, not re-derived.

- **Narrowed ticket #29's DoD from "solver produces a solution file from upstream sample
  data" + "solver-notes.md quotes the sample CSV header verbatim" to "workflow
  installs/resolves dependencies cleanly (checkout + `uv sync`, exit 0)" + "solver-notes.md
  documents `solve.py`'s required input columns, derived from source at the pinned commit,
  labelled as derived-not-sampled." Full solve-against-real-data proof deferred to item 11
  (the CSV adapter ticket). Because a full-history git audit
  (`git log --diff-filter=A --name-only --all --remotes -- "*.csv"`) confirmed
  `sertalpbilal/FPL-Optimization-Tools` has never shipped a projections input CSV on any
  branch — the ticket's premise was false, not just absent at the pinned commit — and
  product-brief.md §6c states this CSV "is the seam of the entire system" that item 11 alone
  is meant to build; constructing any input-shaped fixture now, synthetic or hand-crafted,
  ephemeral or not, would do that seam's schema-discovery work prematurely, which is the same
  objection round 1's synthetic-CSV attempt correctly triggered.**

  Ruled Tier 2 by the Analyst on review (not Tier 1 — no money/personal-data/credential/
  destructive-op involved; resolvable from the brief, logged HIGH-IMPACT, not blocked). The
  pin stays at current `main` HEAD (`45131c5a41d7caadb5cb626c012bfa9111dca7a2`): no historical
  commit ever had the file (verified — see `docs/solver-notes.md`), so moving the pin buys
  nothing. Full verification trail in `docs/solver-notes.md`.

## ROUTINE

- Used `astral-sh/setup-uv@v7` in the Action (rather than `pip install uv`) because a GitHub
  Actions runner has unrestricted network access to astral.sh and this is the documented,
  purpose-built action for the job; `pip install uv` was used in this session instead because
  this session's network allowlist may not cover `astral.sh` (it did not need testing — PyPI
  worked on the first try).
- Named the checkout step's local path `solver` (via `actions/checkout`'s `path:` input)
  rather than a bare top-level clone, purely so the workflow's later `working-directory`
  references read unambiguously.
