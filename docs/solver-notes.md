# Solver notes — sertalpbilal/FPL-Optimization-Tools smoke test (ticket #29)

This is the written target for the future CSV-adapter ticket. It records what was actually
run, not a guess from reading the README.

## Pinned commit

`45131c5a41d7caadb5cb626c012bfa9111dca7a2` — resolved from upstream `main` on 2026-08-12 via
`git ls-remote https://github.com/sertalpbilal/FPL-Optimization-Tools.git HEAD`.

## Toolchain install — verified, works cleanly

```
pip install uv        # in this session; the Action uses astral-sh/setup-uv instead
uv sync                 # installs Python 3.14.7 + all deps in ~5s, no manual Python install
```

`uv sync` output confirmed: Python 3.14.7, `highspy==1.15.1` (bundles HiGHS 1.15.1), `pandas==3.0.5`.
No install failures, no manual dependency wrangling. This half of the ticket's purpose —
"does the toolchain install and run inside a GitHub Action at all" — is answered: yes, cleanly,
in about 5 seconds.

## Blocked: no bundled sample projections CSV exists

**Revision note (this section replaces an earlier version of this file).** The first pass at
this ticket worked around the missing sample data by building a projections CSV from the live
FPL `bootstrap-static` endpoint, shaped to match the solver's expected input format. On review,
that was correctly identified as out of scope: shaping a CSV to satisfy `dev/solver.py`'s
`prep_data` inner-join *is* the CSV-adapter work the ticket explicitly reserves for a later
item, regardless of whether the data source is live or hand-authored. That code has been
removed. This section documents the actual, verified state instead.

**No commit in `sertalpbilal/FPL-Optimization-Tools`'s history — checked across every branch —
has ever shipped a projections CSV that `solve.py` can consume for a squad solve.** Verified
directly, not assumed, with:

```
git log --diff-filter=A --name-only --all --remotes -- "*.csv"
```

Every CSV ever added to the repository, in full:

| File | What it actually is |
|---|---|
| `data/am_pts.csv` | Per-**team** points for the (now-removed) Assistant Manager chip. Keyed by `team`, not by player — not a projections file, and the code that read it was deleted in commit `dd15feb` before the pinned commit. |
| `data/sample_outputs/optimal_plan_decay.csv` | A solver **output** example (columns: `week,name,pos,type,team,price,xP,lineup,captain,vicecaptain,transfer_in,transfer_out`) — this is the shape `solve.py` *produces*, not what it *reads*. |
| `data/sample_outputs/optimal_plan_regular.csv` | Same as above, other decay setting. |
| `notebooks/data/gk_season.csv` | Goalkeeper season stats for an unrelated tutorial notebook, no relation to `solve.py`'s projections format. |

The commit that removed the two `sample_outputs` files, `374c36c` ("remove unnecessary
files", Aug 2025), is real, but those files were never usable as solver *input* in the first
place — pinning to a commit before it does not produce a usable sample projections CSV,
because one was never there. Going back to the repository's very first commit
(`9651526`, "Add README file") confirms the same thing from the other direction: the original
README's own instructions required a user to supply either their own projections file or FPL
login credentials — never a bundled sample.

**Net effect:** with the `data/am_pts.csv` code path, whatever it read, gone from the code
before the pinned commit, and no other projections CSV ever committed, `run/solve.py` cannot
be run to a real squad solve against genuine upstream sample data, because no such file exists
anywhere in this repository's recorded history. This is not a gap in this session's searching —
`git log --diff-filter=A --all --remotes` is exhaustive over every commit that ever added a
file, on every branch this clone knows about.

**What the workflow does instead:** `.github/workflows/solver-smoke.yml` now proves
installability only (checkout at the pinned SHA, `uv sync`) and stops there. It does not
attempt a solve, and does not read from any external data source, live or otherwise — the
scope concern that triggered this revision is fully addressed by removing that step, not
worked around.

**Open question for a human decision**, since none of the following can be chosen
unilaterally without touching the "no adapter, no external data source" constraint one way or
another:

1. Accept a small, hand-authored fixture CSV (a handful of real current FPL player IDs, real
   positions, plausible points) checked into this smoke workflow purely as CI test data, on the
   understanding that it is explicitly *not* production adapter code and is scoped to proving
   the solve step only — same objection as before, since building it still shapes data to the
   solver's expected columns; flagging rather than choosing.
2. Accept that this ticket's "solver runs to completion and produces a solution file" DoD item
   cannot be satisfied against real upstream sample data because none exists, and descope that
   item to "installs and resolves dependencies cleanly" — with a full solve proof deferred to
   whichever ticket first builds real projection data (the CSV-adapter item this ticket was
   explicitly protecting).
3. Something else Keshav specifies.

## Toolchain verification actually performed, for the record

Before this revision, the install-and-solve sequence was run end-to-end in this session using
a live-data CSV (since removed from scope) and reached a proven-optimal solve
(HiGHS: status Optimal, gap 0%, 0.25s solve time; ~5.2s total wall clock including live API
calls). That run is not reported as satisfying this ticket's DoD — it demonstrated the
toolchain and the HiGHS/`highspy` install path work, but it used data this revision determined
was out of scope to produce. The install-only path above (`uv sync` alone, no solve) is the
part of that verification still directly relevant to this ticket's remaining scope.

## Required input column shape, for whoever builds the adapter later

Documented here so the CSV-adapter ticket doesn't have to re-derive it from scratch, even
though no sample file confirms it directly — this is read from `dev/solver.py`'s `prep_data`
(lines ~136–210), which is the actual consumer:

- `ID` — required. Inner-merge key against live FPL `elements` (`id_x`). Must be a real,
  current FPL element id or the row is dropped before solving.
- `Pos` — required. Read directly as `merged_data["Pos"]`. Values used elsewhere in the repo:
  `"G"`, `"D"`, `"M"`, `"F"`.
- `{gw}_Pts` — required, one column per gameweek in the configured horizon.  `prep_data` raises
  `ValueError(f"{week}_Pts is not inside prediction data...")` if a horizon gameweek's column
  is missing.
- `{gw}_xMins` — required, paired with `{gw}_Pts`, used for the minutes-based player-pool
  filter (`xmin_lb`) and the randomisation noise term.

Columns present in the wider community "FPL Review" / "solio" format but not required by the
solver code path used here (`read_solio`/`read_fplreview`, both a plain `pd.read_csv`):
`Name`, `Value`, `Team`. Those are only read by the `mixed`/`mikkel` conversion helpers in
`dev/data_parser.py`.
