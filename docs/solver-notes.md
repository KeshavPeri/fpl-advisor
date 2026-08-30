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
| `no_transfer_last_gws` | `2` | `0` | **Overridden (ticket #108).** Shipped `2` forbids transfers in the last 2 gameweeks of the solve horizon — sensible for upstream's own use case (a horizon run to the end of a season, where the optimiser should stop banking transfers it will never use), wrong for this app: our horizon is 5 and rolls forward every night, so gameweeks 4 and 5 of tonight's horizon are next month, not the end of anything, and we will genuinely transfer there. Left inherited, it banned transfers across 40% of every plan the solver built, distorted the stored multi-week plan (the Plan A/B/C reasoning screen), under-valued a banked free transfer via `ft_value_list`, and — because a multi-period optimiser's earlier decisions depend on what it plans later — even affected the gameweek-1 recommendation the app acts on. Set to `0`, not a smaller positive number, because this app's horizon has no "end of season" for any non-zero value to protect. See `NO_TRANSFER_LAST_GWS`'s comment in `scripts/build-solver-input.ts` and `decisions/ticket-108.md`. |
| `decay_base` | `0.9` | `0.9` | **Overridden (ticket #120).** Discounts future gameweeks' projected points by `decay_base^n` when computing `total_ev` (`n` = gameweeks out from the first horizon gameweek), so nearer gameweeks weigh more — across this app's 5-gameweek horizon the last gameweek (`n = 4`) carries `0.9^4 ≈ 0.656`, about 66% of the weight of the first. Value unchanged from what has been running (ticket #95's audit flagged it as inherited-but-defensible, and it was); this ticket makes it a chosen, documented value instead of a silently-inherited one. See `DECAY_BASE`'s comment in `scripts/build-solver-input.ts`. Whether 0.9 is the right discount is a measurement question for the backtest, not this ticket. |
| `ft_value_list` | `{"2": 2, "3": 1.6, "4": 1.3, "5": 1.1}` | `{"2": 2, "3": 1.6, "4": 1.3, "5": 1.1}` | **Overridden (ticket #142).** Not a scalar — a schedule pricing a banked free transfer by how many are already held. `dev/solver.py` reads it as `ft_value_list.get(str(s), ft_value)` inside a running total over `s` (`ft_states = [0, 1, 2, 3, 4, 5]`), verified directly against the source at the pinned commit: **the keys are the transfer count being moved TO, not moved from** — key `"2"` prices going from 1 to 2 banked transfers. This is what makes "roll your transfer" a real option rather than an obviously wasted week (product-brief.md §6d). Value unchanged from what has been running; this ticket makes it a chosen, documented value instead of a silently-inherited one. See `FT_VALUE_LIST`'s comment in `scripts/build-solver-input.ts`. |

**Every key `data/user_settings.json` ships is now explicitly set — the audit ticket #95 started
is complete.** `run/solve.py` merges our `--config` file on top of the shipped file with
`options.update(config_options)` (see above) — our key always wins when set, and the shipped
default silently survives for any key we never mention. Ticket #95 audited every key the shipped
file ships; #108 moved `no_transfer_last_gws` out of the inherited column; #120 moved
`decay_base` out of it, closing the scalar settings; #142 (this ticket) moves `ft_value_list` —
the one non-scalar, list-shaped setting the earlier tickets deliberately deferred rather than
conflate with "set the last scalar" — out of it too. Every key in the table above is now
overridden; none is silently inherited.

## Dispatch-only chip probe (ticket #114)

`chip_limits` has been `{ bb: 0, wc: 0, fh: 0, tc: 0 }` since ticket #41 — the solver has never
been asked to consider playing a chip in a real run. Turning that on is a one-line config
change (`scripts/build-solver-input.ts`'s `CHIP_PROBE` env var makes `buildSolverConfig` emit
`{ bb: 1, wc: 0, fh: 0, tc: 1 }` instead). Reading back which chip the solver decided to play,
and in which gameweek, is a separate, **unsolved** problem: none of the results-CSV columns
documented above ("Shipped settings audit" table and "Required input columns" section) carry a
chip decision. The chip choice appears only in `dev/solver.py`'s stdout, via
`print_transfer_chip_summary` (already `true` in every config this app has ever built), which
nobody has read with chips actually enabled.

Enabling chips in the *live* `solver-run.yml` run without a way to read that stdout back would
make the solver optimise assuming a chip is played, while the app kept presenting the resulting
transfer/captain recommendation without ever saying a chip was involved — a confidently wrong
recommendation, which product-brief.md §6a forbids ("no recommendation beats a wrong one").

`.github/workflows/solver-chip-probe.yml` exists to remove that guess before feature-list item
27 (chip strategy — product-brief.md §7, "Chip strategy for all eight chips") is written. It is
`workflow_dispatch`-only, sets `CHIP_PROBE`, runs the solver with Bench Boost and Triple Captain
enabled (Wildcard and Free Hit stay off — no full-squad solver support yet, see product-brief.md
§7), and stops after the solve: no `solver_runs`/`solver_picks`/`recommendations` row, no
Telegram send. It uploads the solver's raw stdout log, the results CSV, and the exact config
JSON it was given, as artefacts.

**Item 27 must be written from this probe's actual stdout output — not from the results-CSV
column list above.** The columns documented in "Required input columns" are what the solver
*reads*; they say nothing about what it *prints* when a chip is played. A future session
building the chip-parsing logic should dispatch this workflow, read the uploaded
`chip-probe-solver-log` artefact, and derive the stdout format from what is actually there —
the same discipline this document's "Resolved: no bundled sample projections CSV exists"
section above already establishes for this file: write down what was actually run, not a guess
from reading the README.

## `preseason: true` — what it does, and why it is safe only in isolation (ticket #134)

`data/user_settings.json` ships `preseason: true` by default. `scripts/build-solver-input.ts`'s
`buildSolverConfig` — the ONLY function that produces a config for the production solve path
(`solver-run.yml`, `solver-chip-probe.yml`) — has set `preseason: false` explicitly since ticket
#41, and its own comment there explains why: `true` makes `dev/solver.py` **discard the current
squad entirely** and build a brand-new one from scratch within the budget, ignoring
`team.json`'s `picks` array (see `buildTeamJson`'s own header — `team.json` is built from
`squads`/`squad_picks`, never from FPL's authenticated squad endpoint, and preseason mode would
throw that input away regardless of where it came from). `product-brief.md` §3 puts full-squad
building out of scope until item 28 — this ticket.

**Why this is destructive if it ever reaches a stored table.** Every downstream consumer of a
solve — `store-solver-output.ts` → `solver_picks`, `generate-recommendations.ts` →
`recommendations`, the verdict card, the Telegram message, the notification schedule — reads
"the most recent solve" and has no mechanism to tell a probe apart from the real thing. A
`preseason: true` solve's output landing in any of those tables would silently become the app's
answer: fourteen transfers presented with the same confidence as a normal one-transfer
recommendation. This is not a hypothetical; it is the entire reason item 28 waited until #126
(the chip-timing advisory) established a table shape — `chip_advisories` — that is architecturally
incapable of being read by any of those consumers (see that migration's own header: "Never read
by recommendations/solver_picks/the Telegram message").

**The guard rails, concretely:**

1. **`buildSolverConfig` itself never changes.** `preseason: true` is reachable ONLY through a
   separately-named function, `buildRebuildSolverConfig`, added by this ticket. There is no
   parameter on `buildSolverConfig` that can request it — provable by a `@ts-expect-error` test
   in `scripts/build-solver-input.test.ts` that fails `tsc -b` if that ever stops being true, plus
   a runtime test that every parameter shape `buildSolverConfig` actually accepts still returns
   `preseason: false`.
2. **Only one workflow ever calls `buildRebuildSolverConfig`.** The `REBUILD_VARIANT` environment
   variable is what routes `scripts/build-solver-input.ts`'s `main()` to it instead of
   `buildSolverConfig`, and `.github/workflows/squad-rebuild-probe.yml` is the only workflow file
   in this repository that sets it. `solver-run.yml` and `solver-chip-probe.yml` are untouched by
   this ticket.
3. **The rebuild probe's own workflow never stores a pick, a recommendation, or a notification.**
   `.github/workflows/squad-rebuild-probe.yml` calls `emit-projections-csv.ts`,
   `build-solver-input.ts` and `store-squad-advisory.ts` — and nothing else that writes
   application state. It is `workflow_dispatch`-only with no `schedule` key, so it never runs
   automatically.
4. **`scripts/store-squad-advisory.ts` writes to exactly two tables: `chip_advisories` (insert
   only, one row per run) and `job_runs`.** It never reads or writes `solver_picks`,
   `recommendations`, or anything Telegram-related. It never even reads *which players* the
   rebuild solve picked — only the two solves' own Results-table scores. The rebuilt squad's
   fifteen players exist only in the workflow's own uploaded artefacts (the results CSV, `if:
   always()`), never in any table.
5. **Wildcard and Free Hit are mutually exclusive within one run.** Before ticket #160,
   `chip_limits` carried `wc: 1` or `fh: 1`, never both — `buildRebuildSolverConfig`'s `variant`
   parameter is a single required `'wc' | 'fh'` union, not two independent flags, so "both" is not
   a representable value. **Since ticket #160 (see the dated addendum below), `chip_limits` is the
   literal `{ bb: 0, wc: 0, fh: 0, tc: 0 }` for both variants** — neither is ever granted at all,
   so "never both" now holds trivially. `variant` still stays a single required `'wc' | 'fh'`
   union; it now selects only which advisory `scripts/store-squad-advisory.ts` produces
   (`chip_advisories.chip_code`), never a `chip_limits` value.

**What this ticket reports, and what it deliberately does not.** The advisory is a single
number — the rebuild solve's objective minus the chip-free baseline's, both solved fresh against
the same projections CSV and the same five-gameweek horizon in the same dispatch — plus a fixed
sentence stating the horizon limitation. It is always a large, positive-looking number: the
rebuild is unconstrained by the current squad and by transfer costs, so it will beat the baseline
comfortably even in gameweeks where playing a wildcard would be a bad idea (the same "solver
always wants to play a chip now" finding the dispatch-only chip probe above already documented,
sharper here because there is no existing squad constraining the alternative at all). The UI
never colours this as a warning (design-reference.md: a large delta is information, not an
alarm) and never turns it into an instruction — see `product-brief.md` §6a and the chip-timing
advisory's own precedent above.

**Free Hit vs. Wildcard — modelled identically here, on purpose.** A real Free Hit reverts the
squad the following gameweek; a real Wildcard does not. Modelling that reversion across the
five-gameweek horizon is explicitly out of this slice — both variants are reported as a
one-gameweek rebuild gap, and the horizon-note sentence says so generically ("a wildcard or free
hit's real value depends on fixtures the model cannot see") rather than making a claim this
ticket cannot back up for either chip specifically.

**What could not be verified before this ticket's own review.** `preseason: true` has never been
run in this project — `squad-rebuild-probe.yml` cannot run until it is on the default branch (a
`workflow_dispatch` workflow file is only invocable from there), so nothing here proves the
solver behaves sanely in that mode, only that the config sent to it is correctly isolated. The
first real dispatch after merge is the first time this app has ever asked `dev/solver.py` to
build a squad from nothing.

### Update, 30 Aug 2026 — ticket #160: the first real dispatch found a double rebuild

`squad-rebuild-probe.yml` was dispatched for the first time on 30 Aug 2026 (`preseason: true`,
`variant: 'wc'`). It solved cleanly (proven optimum, gap 0%) and every one of the five guard
rails above held: nothing reached `solver_picks`, `recommendations`, or Telegram. **The defect
was in what was measured, not in the safety case.**

Before this ticket, `buildRebuildSolverConfig` set BOTH `preseason: true` AND `chip_limits: { bb:
0, wc: variant === 'wc' ? 1 : 0, fh: ..., tc: 0 }`. `preseason: true` already discards the current
squad and rebuilds a new fifteen within budget — that is the one rebuild this probe exists to
measure. Granting the requested variant's chip ON TOP of that let the same solve rebuild a
**second** time, at zero transfer cost, later in the horizon. The dispatch log is the evidence,
quoted verbatim, not paraphrased:

- **GW3** — `ITB=100.0->2.3`, fifteen `Buy` lines, no `Sell`: the preseason rebuild itself.
- **GW5** — `CHIP WC`, `NT=7`: seven *more* players in and out, on top of the GW3 rebuild.
- **Results table** — `chip WC5` on all three solutions.

The stored delta was therefore the rebuild objective **295.54** against the chip-free baseline's
**260.21** — **+35.3** — of which an unknown share was a second, unintended free squad overhaul
two gameweeks after the first. A real wildcard is one event; this measured something closer to
two. The fix: `chip_limits` is now the literal `{ bb: 0, wc: 0, fh: 0, tc: 0 }` for both variants
(`RebuildChipLimits` makes any other value a type error, not just a runtime default — see
`scripts/build-solver-input.ts`'s own comment on it) — `preseason: true` alone is the rebuild
being measured, and no chip is granted on top of it. The human check after the ticket #160 merge
is a re-dispatch confirming the rebuild log contains no `CHIP` line in any gameweek and the
results table's chip column is empty for every solution; the stored delta is expected to fall
from +35.3 as a result of the fix working, not as a regression.

**Second observation, 30 Aug 2026 (reported, not fixed): the three solutions are one solution.**
All three of the rebuild solve's iterations (Plan A/B/C) reported the **same** objective,
**295.54**, differing only in which bench goalkeeper was picked (Petrović / Verbruggen /
Tzolakis). `ITERATION_CRITERION`'s `this_gw_transfer_in` (`scripts/build-solver-input.ts`) has
nothing to vary when `preseason: true` makes the whole squad unconstrained and every "transfer" is
a buy, so Plan A/B/C is cosmetic in this mode. Ticket #160 does not attempt to make it meaningful
in rebuild mode — that needs a different `iteration_criteria` and is a separate question — but it
does add a counter, `rebuildDistinctObjectiveCount` in this run's `job_runs.details`
(`scripts/store-squad-advisory.ts`'s `countDistinctObjectiveValues`), so "three solutions, one
answer" is visible on every future run rather than something a human has to spot in a log by
eye. On the 30 Aug 2026 dispatch that counter would have read `1`.
