## Context

**Two defects in two reading instruments. Both were caught by looking at output, neither by a test,
and both trace to specification gaps in my own tickets rather than to the builds.** They are grouped
because they are the same category of work — making a thing that reports on the system tell the
truth — and because each is small on its own.

**This ticket supersedes draft 62, which covered the first half only. Do not file 62 separately.**

---

## Defect 1 — the solver `Results` parser discards every row of a chip-free log

The chip advisory job fails on every run:

```
solver-run/store-chip-advisory: failed: failed to parse the normal (chip-free) solver log:
the "Results" table was found but no data rows could be parsed under its header row.
```

**Ticket #126 was written from one captured log — the chip probe's, in which every solution played a
chip.** Its own definition of done predicted this: *"a solve that plays no chip has never been
observed."*

**The two real shapes, both now captured from the same production run of 29 August 2026:**

Chip-enabled:

```
Results
  iter  sell    buy         chip        score
     0  Wirtz   Szoboszlai  BB2, TC3   288.18
     1  Wirtz   Tavernier   BB2, TC3   286.65
     2  -       -           BB2, TC3   286.58
```

Chip-free:

```
Results
  iter  sell    buy         chip      score
     0  Wirtz   Szoboszlai  -        269.85
     1  Wirtz   Tavernier   -        268.32
     2  -       -           -        268.24
```

Three differences the parser does not survive: **an empty cell is `-`, not blank**, in every column
including `sell` and `buy` on a rolled transfer; **the header's column spacing shifts** between the
two (`chip        score` against `chip      score`); and **the chip cell can contain a space** —
`BB2, TC3` is one cell of two tokens.

**Worth recording while fixing it:** the chip-free best scores 269.85 and the chip-enabled best
288.18, a delta of **+18.33** over the horizon. The chip-enabled solve played **BB in gameweek 2 and
TC in gameweek 3**, where the probe two days earlier played **TC in gameweek 2 and BB in gameweek 4**
on a near-identical squad. **The timing is unstable between runs; the delta is not.** That is #126's
central design decision, now observed rather than argued.

---

## Defect 2 — the calibration report is reading clean sheets from the goalkeeper-only column

The report ran on 28 August and its headline says defenders actually scored **7.04 pts/90** against
a projected 4.13 — the model under-projecting them by 41%.

**That headline is an artefact.** From the report's own component tables:

| Position | Actual clean-sheet pts/90 | Points per clean sheet | Implied clean-sheet rate |
|---|---|---|---|
| Goalkeeper | 1.09 | 4 | **27%** ✅ |
| Defender | 3.81 | 4 | **95%** ❌ |
| Midfielder | 0.92 | 1 | **92%** ❌ |

**A 95% clean-sheet rate is impossible; the real rate is about 28%.** And goalkeepers come out
correct while outfielders do not — which is the exact signature of reading clean sheets from
`goals_conceded`, the goalkeeper-only stat that is 74% populated on keeper rows and **1.1% populated
on outfield rows**. An unpopulated value reads as zero conceded, which reads as a clean sheet.

The defender goals-conceded row confirms it independently: actual **-0.00** against a projected
-0.45, a ratio the report itself prints as **95.09x**.

**This is the same 95% bug `LEARNINGS-second-build-wave.md` §2 already records**, back because
`team_goals_conceded` did not exist until ticket #125 added it yesterday — and because ticket #127
explicitly told its Builder not to change what the report reads from `player_match_stats`, since
#125 owned that column in the same batch. **The gap is mine, from splitting the two.**

**Corrected to a realistic 28% rate, defenders land near 4.3 pts/90 against a projected 4.13** — and
the defender alarm is unfounded for the third time. **Nobody should act on that headline until this
lands.**

Depends on #125 (merged, migration applied, column now 98% populated) and #126 and #127 (merged).
Nothing unmerged.

## Scope

**In scope, defect 1:**

- **`scripts/lib/solver-output.ts` treats `-` as an empty cell** in every column of the `Results`
  table: no chip, no player sold, no player bought.
- **Column boundaries are derived from the header row of the log being parsed**, never from a
  constant. The header names are stable; their positions are not.
- **The existing cross-check against the per-gameweek `CHIP` lines is preserved**, and must read a
  chip-free log — `-` in the table and no `CHIP` line in the body — as agreement, not as a missing
  reading.

**In scope, defect 2:**

- **`scripts/calibration-report.ts` computes clean sheets and goals conceded from
  `team_goals_conceded`**, never from `goals_conceded`.
- **A row with a null `team_goals_conceded` is excluded from the clean-sheet and goals-conceded
  figures and counted separately**, not treated as zero conceded. The column is 98% populated for
  2025-2026 (15,026 of 15,340 rows) and the remaining 2% is the source's own gaps.
- **A hard bound on the derived clean-sheet rate.** Above **60%** for any position, the report
  **fails** and says the figure is impossible rather than printing it. *(This is the check that
  would have caught the bug three times now.)*
- **The report states the clean-sheet rate per position explicitly**, as a percentage, alongside the
  points figure — so the implausible number is visible without anyone doing division in their head.
- **The excluded-row count is reported** alongside the sample sizes.

**Explicitly out of scope:**

- **No change to the projection model, or anything under `src/`.**
- **No change to what the chip advisory means, how it is stored or displayed.** #126's design stands.
- **No loosening of either failure path.** An unparseable `Results` table must still fail, and an
  unparseable log must never look like a chip-free one.
- **No conclusion drawn about defenders versus forwards.** The report prints numbers; a person reads
  them. Writing a verdict into the code is what `LEARNINGS-second-build-wave.md` §3 records going
  wrong.
- **No investigation of the 2,520 skipped `player_code` rows.** Real, 16% of the season, and a
  separate ticket — record it in the decisions log.
- **No parsing of `WC` or `FH` chip codes.** Unobserved, out of scope here.
- **No migration, no UI, nothing under `supabase/`.**

## Definition of done

**Defect 1**

- [ ] A fixture containing the **chip-free** block above parses to three solutions with no chips,
      scores 269.85, 268.32 and 268.24, and solution 2 carrying no player sold and none bought.
- [ ] A fixture containing the **chip-enabled** block above parses to three solutions, each with
      `BB` in gameweek 2 and `TC` in gameweek 3, scores 288.18, 286.65 and 286.58. *(Note this
      differs from the probe's `TC2, BB4` — the parser reads what is there, never what was there
      last time.)*
- [ ] `-` is treated as empty in `sell` and `buy` as well as `chip`. Named test on solution 2 of both
      fixtures.
- [ ] Column boundaries are derived from the parsed header. Grep-checkable: no numeric character
      offset constant appears in the parser.
- [ ] A `Results` table with a genuinely malformed row — truncated, or fewer cells than the header —
      **still fails**, naming what could not be read. Named test.
- [ ] A chip-free log's cross-check passes; a log with `-` in the table but a `CHIP TC` line in the
      body still **fails** as a disagreement. Named tests for both.

**Defect 2**

- [ ] The report's clean-sheet and goals-conceded figures are computed from `team_goals_conceded`.
      Grep-checkable: `goals_conceded` appears in `scripts/calibration-report.ts` only as part of the
      string `team_goals_conceded`.
- [ ] A match row with a null `team_goals_conceded` is excluded from those two figures and counted,
      not read as zero. Named test.
- [ ] **The report fails when any position's derived clean-sheet rate exceeds 60%**, with the rate
      and the position named. Named tests at 59% and 61%.
- [ ] The clean-sheet rate is printed per position as a percentage. Named test.
- [ ] The excluded-row count appears in the provenance section.
- [ ] Every existing test in `scripts/calibration-report.test.ts` not concerning clean sheets, goals
      conceded or the bound passes **unmodified** — including #127's bonus-exclusion tests.
- [ ] The existing assertion that the source does not reference `team_goals_conceded` is **removed**,
      since that is now exactly what it must reference.

**Both**

- [ ] `scripts/lib/solver-output.ts` stays pure: `supabase`, `fetch` and `process.env` appear nowhere
      in it.
- [ ] Nothing under `src/`, `supabase/`, `docs/` or `.github/` is added, changed or deleted, and no
      file under `scripts/` other than the four named and their tests changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** two solver-log shapes are now covered where one was before,
      but an infeasible solve, a timed-out incumbent, or a run returning fewer than three solutions
      has still never been observed. And no test proves the corrected clean-sheet figure is *right*,
      only that it is no longer impossible. The human check after merge is: dispatch `Solver run`,
      confirm `store-chip-advisory` succeeds with a delta near **+18** and that the normal
      recommendation is unchanged; then dispatch `Calibration report` and confirm **every position's
      clean-sheet rate is between roughly 20% and 40%**. A defender figure near 28% means the
      instrument is finally measuring the right thing.

## Notes for the Analyst / Builder

**The rule behind defect 1, as its *because*.** A parser written against one example encodes that
example's accidents. **Because** the two logs differ in spacing, in empty-cell representation and in
chip content — three ways, all invisible until a second sample existed — parse by the header the log
actually carries and treat every cell as optional. Both fixtures go into the test file **verbatim**;
a tidied fixture would re-create the defect, because the accidents are the point.

**The rule behind defect 2, as its *because*.** `LEARNINGS-second-build-wave.md` §2 says it in one
line: **bounds-check any derived rate that has a known real-world limit.** A clean-sheet rate above
60% is impossible. This exact figure has now been wrong twice — once at 95% in the first wave, and
again at 95% here — and both times the report was internally consistent, carried its sample sizes and
listed honest caveats. **Consistency is not correctness.** The bound is what makes the difference,
and it must fail rather than warn.

**Do not weaken either failure to make a run go green.** A chip advisory that silently reads "no
chip" when the log could not be parsed, or a calibration report that prints an impossible rate with a
footnote, would both be worse than today's loud failures.

**Record two things in the decisions log**, because both will otherwise be lost: the chip timing
instability observed above (probe `TC2, BB4`, production `BB2, TC3`, same squad, delta stable at
roughly +18), and the 2,520 match rows the report skips for an unresolvable `player_code` — 16% of
the season, unexplained, and worth its own ticket.

**This is Tier 2** — it changes what a decision-supporting instrument measures. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/run-backtest.ts`, its own new
workflow and `docs/projection-model-backlog.md`; the other owns `scripts/build-solver-input.ts`,
`src/lib/chips/`, `src/screens/ChipsScreen.tsx` and `docs/solver-notes.md`. This ticket touches none
of them — in particular, **do not edit `scripts/build-solver-input.ts` or either docs file.**

## Scope constraint

Nothing outside the following files changes:

- `scripts/lib/solver-output.ts`, `scripts/lib/solver-output.test.ts`
- `scripts/store-chip-advisory.ts`, `scripts/store-chip-advisory.test.ts`
- `scripts/calibration-report.ts`, `scripts/calibration-report.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `docs/` or `src/` changes. No workflow file
is touched. `scripts/build-solver-input.ts`, `scripts/project-points.ts` and
`scripts/build-feature-history.ts` are not modified.
