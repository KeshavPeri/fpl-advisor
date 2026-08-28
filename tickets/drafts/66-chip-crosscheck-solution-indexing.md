## Context

**The chip cross-check fails on every chip-enabled log, because it cannot find the per-gameweek
`CHIP` lines it is checking against.**

```
solver-run/store-chip-advisory: failed: failed to parse the chip-enabled solver log:
solution 0: the Results table and the per-gameweek CHIP lines disagree on which chip(s) were
played — Results table says [BB2, TC3], per-gameweek CHIP lines say [(none)]. Refusing to pick one.
```

**The `Results` half of ticket #132 works** — it read `[BB2, TC3]` correctly, which is what that
ticket set out to fix. The body reader is what is wrong, in two ways at once.

### 1. The solution numbering differs between the two halves of the log

The body labels its blocks **1-based**; the `Results` table labels the same solutions **0-based**:

```
Solution 1
    ** GW 2:
    CHIP BB
    ...
    ** GW 3:
    CHIP TC
```

```
Results
  iter  sell    buy         chip        score
     0  Wirtz   Szoboszlai  BB2, TC3   288.18
     1  Wirtz   Tavernier   BB2, TC3   286.65
     2  -       -           BB2, TC3   286.58
```

**`Solution N` in the body is `iter N-1` in the table.** Verified against the transfers, not only the
chips: `Solution 1` buys Szoboszlai and `iter 0` says buy Szoboszlai; `Solution 2` buys Tavernier and
`iter 1` says Tavernier; `Solution 3` is a roll and `iter 2` carries `-` in both columns. A
cross-check looking for a body block called "Solution 0" finds nothing and reports `(none)`.

### 2. The `CHIP` lines are indented

Both `** GW 2:` and `CHIP BB` are indented four spaces inside their solution block. A reader anchored
to the start of a line matches neither.

### Why the tests did not catch it

Ticket #132's definition of done covered a **disagreement failing** and a **chip-free log agreeing**.
**It never asserted that a chip-enabled log's cross-check passes** — the one case that had to work.
That gap is upstream, at drafting, and it is the third time this parser has been specified against
imagined cases rather than the captured ones.

Depends on #132 (merged). Nothing unmerged.

## Scope

**In scope:**

- **The body reader maps `Solution N` to `iter N-1`**, so the two halves of the log are compared for
  the same solution. The mapping lives in one named place with a comment stating the evidence above.
- **The body reader tolerates leading whitespace** on the `Solution`, `** GW n:` and `CHIP XX` lines.
- **A chip found in a body block is attributed to the gameweek of the `** GW n:` header it sits
  under**, so `CHIP BB` beneath `** GW 2:` is `BB` in gameweek 2 — matching the `BB2` the table
  encodes.
- **The cross-check keeps failing on a genuine disagreement**, unchanged.

**Explicitly out of scope:**

- **No change to the `Results` table parser.** That half is correct and #132's fixtures for it must
  keep passing unmodified.
- **No change to what the advisory means, how it is stored, or how it is displayed.**
- **No weakening of the cross-check into a warning, a fallback, or a "prefer the table" rule.** Two
  readings that agree is the whole point; if they disagree the job must still refuse.
- **No parsing of `WC` or `FH`.** Still unobserved, still item 28's business.
- **No migration, no UI, nothing under `supabase/` or `src/`.**

## Definition of done

- [ ] **A fixture containing a full chip-enabled log — solution blocks and `Results` table together —
      passes the cross-check.** All three solutions agree on `BB` in gameweek 2 and `TC` in
      gameweek 3. **This is the test that was missing and it is the most important one here.**
- [ ] The mapping is asserted directly: a fixture whose `Solution 1` block differs from `Solution 3`
      is checked against `iter 0` and `iter 2` respectively, and a fixture that would pass under a
      naive same-number mapping **fails**. Named test.
- [ ] `Solution`, `** GW n:` and `CHIP XX` lines are recognised with leading whitespace. Named test.
- [ ] A chip is attributed to the gameweek of the `** GW n:` header above it. Named test with chips
      in two different gameweeks of one solution.
- [ ] A genuine disagreement still fails, naming both readings — #132's existing test for this passes
      **unmodified**.
- [ ] A chip-free log still cross-checks as agreement — #132's existing test passes **unmodified**.
- [ ] Every `Results`-table test from #132 passes **unmodified**. If one needs changing, the fix has
      gone too far.
- [ ] `scripts/lib/solver-output.ts` stays pure: `supabase`, `fetch` and `process.env` appear nowhere
      in it.
- [ ] Nothing under `src/`, `supabase/`, `docs/` or `.github/` is added, changed or deleted, and no
      file under `scripts/` other than the parser, `store-chip-advisory.ts` and their tests changes.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the fixtures are two captured logs, not every shape the
      solver can print — an infeasible solve, a timed-out incumbent, or a run returning fewer than
      three solutions has still never been observed. The human check after merge is dispatching
      `Solver run`, confirming it goes green, and confirming a `chip_advisories` row appears with a
      delta near **+18** while the normal recommendation is unchanged.

## Notes for the Analyst / Builder

**The rule this encodes, as its *because*.** A cross-check is only worth having if the agreeing case
is tested. **Because** #132 asserted only that disagreement fails and that an empty log agrees, a
reader that finds *nothing at all* looked identical to a reader working correctly on a chip-free
log — and the check reported a disagreement that was really a failure to read. **Test the passing
case first; the failing cases are the easy half.**

**Use the full captured logs as fixtures, verbatim, both halves together.** The defect lives in the
relationship between the body and the table, so a fixture containing only one of them cannot catch
it. #132's fixtures were `Results`-table extracts; this ticket needs whole-log fixtures.

**Verify the mapping on the transfers, not the chips.** In the captured log all three solutions play
the same chips, so the chips alone cannot prove which body block belongs to which `iter`. The buy and
sell columns can, and do — that is how the 1-based-to-0-based mapping above was established.

**Do not "fix" this by trusting the `Results` table alone.** It is the cheaper option and it throws
away the property that makes the advisory trustworthy. Two independent readings that agree is
evidence; one reading is a guess, and this project has already shipped a doubled figure (#72) that a
second reading would have caught.

**This is Tier 3.** It corrects a parse; it stores nothing new, changes no schema, and alters no
behaviour beyond making a broken job work.

**This ticket may run alongside others in the batch.** It touches nothing under `src/`, `supabase/`,
`docs/` or `.github/`, and no `scripts/` file other than the parser, its caller and their tests — in
particular **not** `scripts/build-solver-input.ts`, `scripts/calibration-report.ts` or
`scripts/run-backtest.ts`.

## Scope constraint

Nothing outside the following files changes:

- `scripts/lib/solver-output.ts`, `scripts/lib/solver-output.test.ts`
- `scripts/store-chip-advisory.ts`, `scripts/store-chip-advisory.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `src/`, `docs/` or `.github/` changes. No
other file under `scripts/` is modified.
