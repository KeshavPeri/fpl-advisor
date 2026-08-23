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

## Resolved: no bundled sample projections CSV exists, on any branch, ever

**PREMISE CHECK — read this before re-investigating.** The ticket's original assumption that
upstream ships "its own bundled sample data" was checked directly and found **false** across
this tools repository's *entire* git history (not just absent at the pinned commit). A future
session building item 11 (the CSV adapter) should not re-run this investigation — the
verification below is exhaustive. Treat "no sample CSV exists upstream" as a settled fact, not
an open question.

**Revision history of this section, for context.** The first pass at this ticket worked around
the missing sample data by building a projections CSV from the live FPL `bootstrap-static`
endpoint, shaped to match the solver's expected input format. On review, that was correctly
identified as out of scope: shaping a CSV to satisfy `dev/solver.py`'s `prep_data` inner-join
*is* the CSV-adapter work the ticket explicitly reserves for item 11 (product-brief.md §6c:
this CSV "is the seam of the entire system"), regardless of whether the data source is live or
hand-authored, ephemeral or not. That code has been removed. A second pass proposed pinning to
a commit predating the deletion of some `data/` files; that was also checked and rejected,
since no historical commit ever had a usable file either. The Analyst ruled (Tier 2, not
blocking) to descope this ticket's solve-proof DoD items rather than construct any
input-shaped fixture — see `decisions/ticket-29.md`. This section documents the resulting,
final, verified state.

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

**What the workflow does, final state:** `.github/workflows/solver-smoke.yml` proves
installability only — checkout at the pinned SHA, then `uv sync` — and stops there, exit code
0. It does not attempt a solve, and does not read from any external data source, live or
otherwise.

**Reformulated DoD, as ruled by the Analyst (Tier 2, logged in `decisions/ticket-29.md`):**

1. *Was:* "The workflow runs to completion and the solver produces a solution file from the
   upstream sample data." *Now:* the workflow runs to completion: checkout + `uv sync`
   succeeds with exit code 0, proving the pin, environment and YAML are correct in isolation.
   No solve step is included — this repository has never shipped a projections input CSV on
   any branch (verified by the full-history audit above), so there is nothing to solve
   against here. Full solve-against-real-data proof is deferred to item 11, which builds the
   CSV adapter described in product-brief.md §6c.
2. *Was:* "`docs/solver-notes.md` exists and quotes the sample projections CSV's header row
   verbatim." *Now:* this document instead documents the exact columns `solve.py`'s
   `prep_data` requires (its inner-join keys), derived by reading `solve.py`'s source at the
   pinned commit — see "Required input columns" below, explicitly labelled there as
   derived-from-source, not read from a bundled sample, since no sample exists.

## Toolchain verification actually performed, for the record

Before this revision, the install-and-solve sequence was run end-to-end in this session using
a live-data CSV (since removed from scope) and reached a proven-optimal solve
(HiGHS: status Optimal, gap 0%, 0.25s solve time; ~5.2s total wall clock including live API
calls). That run is not reported as satisfying this ticket's DoD — it demonstrated the
toolchain and the HiGHS/`highspy` install path work, but it used data this revision determined
was out of scope to produce. The install-only path above (`uv sync` alone, no solve) is the
part of that verification still directly relevant to this ticket's remaining scope.

## Required input columns

**Source: derived from reading `dev/solver.py`'s source at the pinned commit
(`45131c5a41d7caadb5cb626c012bfa9111dca7a2`), lines ~136–210 of `prep_data` — NOT read from a
bundled sample CSV, since no sample CSV exists anywhere in upstream's history (see above).**
Documented here so the CSV-adapter ticket (item 11) doesn't have to re-derive it from scratch:

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

## Shipped settings audit — every key `data/user_settings.json` sets at the pinned commit (ticket #95)

The pinned commit (`45131c5a41d7caadb5cb626c012bfa9111dca7a2`) ships `data/user_settings.json`
with a full set of defaults. `scripts/build-solver-input.ts`'s `buildSolverConfig` passes its
own settings-override object to `run/solve.py --config <path>`, which merges on top of the
shipped file — **not the other way round**. The merge is one line, `run/solve.py`:

```python
options.update(config_options)
```

`options` starts as whatever the shipped `data/user_settings.json` loaded; `config_options` is
our `--config` file. `dict.update` means **our key always wins when we set it explicitly, and
the shipped default silently survives for any key we never mention.** That silent-survival path
is exactly how `keep_top_ev_percent` and `ev_per_price_cutoff` went unnoticed for as long as
they did — `buildSolverConfig` never set them, so the shipped values governed every solve
without anyone deciding that on purpose.

| Key | Shipped default | What we set | Status |
|---|---|---|---|
| `keep_top_ev_percent` | `5` | `25` | **Overridden (ticket #95).** Percentile of `total_ev` exempted from every other pool filter. 5% (~30 of ~600 players) was narrower than one gameweek's genuinely reasonable transfer targets across 4 positions/20 clubs. Deliberately not tuned — see `KEEP_TOP_EV_PERCENT`'s comment in `scripts/build-solver-input.ts`. |
| `ev_per_price_cutoff` | `30` | `10` | **Overridden (ticket #95).** Bottom percentile by EV-per-price dropped from the pool (unless already in the `keep_top_ev_percent` safe set). 30% systematically pruned expensive players, since EV-per-price is structurally lower for them even at high raw EV — exactly the players a transfer recommendation often turns on. Deliberately not tuned — see `EV_PER_PRICE_CUTOFF`'s comment in `scripts/build-solver-input.ts`. |
| `xmin_lb` | `300` | `150` | Overridden (ticket #41) — see `XMIN_LB`'s comment in `scripts/build-solver-input.ts`. Untouched by ticket #95. |
| `preseason` | `true` | `false` | Overridden (ticket #41) — the shipped `true` replaces the whole squad with an empty one. Untouched by ticket #95. |
| `no_transfer_last_gws` | `2` | *(not set — inherited)* | **Inherited, undocumented until now.** Forbids transfers in the last 2 gameweeks of the solve horizon. This distorts the multi-week plan shown on the reasoning screen, since the horizon's later weeks show "no transfer" not because that's the best decision but because the solver was forbidden from proposing one — but it does **not** corrupt the actual GW1 decision this app acts on, since GW1 is never inside that forbidden window at a 5-gameweek horizon. Left as-is; flagged here so a future ticket touching multi-week display doesn't mistake it for a real recommendation. |
| `decay_base` | `0.9` | *(not set — inherited)* | **Inherited, reasonable.** Discounts future gameweeks' projected points by `0.9^n` when computing `total_ev`, so nearer gameweeks weigh more. Worth noting explicitly that this is inherited, not a value this app chose — if the discount ever looks wrong in practice, this is where to look. |

Both `no_transfer_last_gws` and `decay_base` are documented here for completeness (ticket #95's
scope), not changed — see the ticket's Scope OUT.
