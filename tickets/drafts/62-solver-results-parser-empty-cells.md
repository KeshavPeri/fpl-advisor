## Context

**A parser defect in ticket #126, caused by a specification gap in that ticket rather than by the
build.** The chip advisory job fails on every run:

```
solver-run/store-chip-advisory: failed: failed to parse the normal (chip-free) solver log:
the "Results" table was found but no data rows could be parsed under its header row.
```

**The cause.** #126 was written from one captured log — the chip probe's, in which every solution
played a chip. Its own definition of done said this would happen: *"the parser is tested against one
captured log, not against every shape the solver can print — a solve that plays no chip has never
been observed."* It landed exactly there.

### The two real shapes, both now captured

**Chip-enabled** (`solve-chip.log`, 29 August 2026):

```
Results
  iter  sell    buy         chip        score
     0  Wirtz   Szoboszlai  BB2, TC3   288.18
     1  Wirtz   Tavernier   BB2, TC3   286.65
     2  -       -           BB2, TC3   286.58
```

**Chip-free** (`solve.log`, same run):

```
Results
  iter  sell    buy         chip      score
     0  Wirtz   Szoboszlai  -        269.85
     1  Wirtz   Tavernier   -        268.32
     2  -       -           -        268.24
```

**Three differences the current parser does not survive:**

1. **An empty cell is `-`, not blank.** No chip is `-`; a rolled transfer has `-` in both `sell` and
   `buy`. A parser expecting a chip token discards every row.
2. **The header's column spacing shifts between the two** — `chip        score` against
   `chip      score`. Any fixed-offset assumption derived from one log breaks on the other.
3. **The chip cell can contain a space**: `BB2, TC3` is one cell, two tokens. Naive
   whitespace-splitting mis-columns the row.

Note also that solution 2 in both logs is a **roll** — `-` for both sell and buy — which is a
legitimate and common outcome, not an edge case.

### The finding worth carrying, separate from the defect

Chip-free best score **269.85**, chip-enabled best **288.18** — a delta of **+18.33** over the
five-gameweek horizon. And the chip-enabled solve played **BB in gameweek 2, TC in gameweek 3**,
where the probe two days earlier played **TC in gameweek 2, BB in gameweek 4** on a near-identical
squad. **The timing is unstable run to run; the delta is not.** That is the horizon bias #126
describes, now observed rather than predicted, and it belongs in the decisions log.

Depends on #126 (merged). Nothing unmerged.

## Scope

**In scope:**

- **`scripts/lib/solver-output.ts` treats `-` as an empty cell** in every column of the `Results`
  table: no chip, no player sold, no player bought.
- **Column boundaries are derived from the header row of the log being parsed**, never from a
  constant. The header names — `iter`, `sell`, `buy`, `chip`, `score` — are stable; their positions
  are not.
- **Tests against both real logs, verbatim**, using the two blocks quoted above as fixtures.
- **The existing cross-check against the per-gameweek `CHIP` lines is preserved**, and must agree
  that a chip-free log has no chips — a `-` in the table and no `CHIP` line anywhere is agreement,
  not a missing reading.
- **The decisions log records the timing instability** observed above, with both runs' chip choices
  and the delta.

**Explicitly out of scope:**

- **No change to what the advisory means, how it is stored, or how it is displayed.** #126's design
  stands; only the parse is wrong.
- **No change to `chip_limits`, the workflow, the second solve, or the production recommendation.**
- **No loosening of the failure behaviour.** A `Results` table that genuinely cannot be parsed must
  still fail loudly — **an unparseable log and a chip-free log must never look the same**, which is
  precisely the confusion this defect created.
- **No parsing of `WC` or `FH`.** Still unobserved, still out of scope, still item 28.
- **No migration, no UI change, nothing under `supabase/`.**

## Definition of done

- [ ] A fixture containing the **chip-free** block above parses to three solutions with **no chips**,
      scores 269.85, 268.32 and 268.24, and solution 2 carrying no player sold and none bought.
      Named test.
- [ ] A fixture containing the **chip-enabled** block above still parses to three solutions, each
      with `BB` in gameweek 2 and `TC` in gameweek 3, scores 288.18, 286.65 and 286.58. Named test.
      *(Note this differs from the probe's `TC2, BB4` — the parser must read what is there, never
      what was there last time.)*
- [ ] `-` is treated as empty in the `sell` and `buy` columns as well as `chip`. Named test on
      solution 2 of both fixtures.
- [ ] Column boundaries are derived from the parsed header row. Grep-checkable: no numeric character
      offset constant appears in the parser.
- [ ] The two header spacings above both parse correctly. Named test for each.
- [ ] A `Results` table whose header is present but whose rows are genuinely malformed — a truncated
      log, a row with fewer cells than the header — **still fails**, with a message naming what it
      could not read. Named test. **This is the most important test in the ticket.**
- [ ] A chip-free log's cross-check passes: no chips in the table and no `CHIP` line in the body is
      agreement. Named test.
- [ ] A log with `-` in the table but a `CHIP TC` line in the body still **fails** as a
      disagreement. Named test — the cross-check must not be weakened by this fix.
- [ ] `scripts/lib/solver-output.ts` stays pure: the strings `supabase`, `fetch` and `process.env`
      appear nowhere in it.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file under
      `scripts/` other than the parser, `store-chip-advisory.ts` and their tests changes.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** two log shapes are now covered where one was before, but
      a solve that is infeasible, that times out on its incumbent, or that returns fewer than three
      solutions has still never been observed. The human check after merge is dispatching
      `Solver run` and confirming `store-chip-advisory` succeeds and a `chip_advisories` row appears
      with a delta of roughly **+18** — and that the normal recommendation is still unchanged.

## Notes for the Analyst / Builder

**The rule this encodes, as its *because*.** A parser written against one example is a parser that
encodes that example's accidents. **Because** the two logs differ in spacing, in empty-cell
representation and in chip content — three ways, all invisible until the second sample existed —
**parse by the header the log actually carries, and treat every cell as optional.** If a Builder hits
a case this reasoning does not cover, report it rather than guessing at a third shape.

**Both fixtures must go in the test file verbatim.** They are the only two real observations that
exist. A paraphrased or tidied fixture would re-create the defect, because the accidents — the
spacing, the `-` — are the whole point.

**Do not make failure quieter to make this pass.** The reason this defect was caught in one run
rather than silently producing an empty advisory is that #126 chose to fail loudly on an unparseable
table. Keep that. A chip advisory that silently reads "no chip" when the log could not be parsed
would be worse than today's error.

**The chip timing moved between two runs and the delta did not.** Probe: `TC2, BB4`. Production run
two days later: `BB2, TC3`. Same squad, near-identical projections. **Record this in the decisions
log** — it is the first direct evidence for #126's central design decision, that the delta is
reportable and the timing is not, and it is exactly the kind of observation that gets lost.

**This is Tier 3.** It corrects a parse; it stores nothing new, changes no schema and alters no
behaviour beyond making a broken job work.

**This ticket may run alongside others in this batch.** It touches nothing under `src/`,
`supabase/` or `.github/`, and no `scripts/` file other than the parser, its caller and their tests.

## Scope constraint

Nothing outside the following files changes:

- `scripts/lib/solver-output.ts`, `scripts/lib/solver-output.test.ts`
- `scripts/store-chip-advisory.ts`, `scripts/store-chip-advisory.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `src/` or `docs/` changes. No other file under `scripts/` is modified.
