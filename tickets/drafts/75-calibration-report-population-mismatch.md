## Context

**The calibration report's headline ratios are inflated by a population mismatch, and the report's
central question is currently being answered by a biased instrument.**
`LEARNINGS-second-build-wave.md` §3 and §16c both name this as the most expensive kind of wrong.

From the run of 29 Aug 2026, 16:30 UTC, the **By point component** tables:

| Position | Appearance, actual pts/90 | Appearance, projected pts/90 | Ratio |
|---|---|---|---|
| Goalkeeper | 2.01 | 2.84 | **1.42x** |
| Defender | 2.18 | 2.59 | 1.19x |
| Midfielder | 2.41 | 2.86 | 1.19x |
| Forward | 2.63 | 3.00 | 1.14x |

**Appearance points are capped at 2 per match and do not scale with minutes.** A per-90 appearance
figure above roughly 2.0 for a population of real appearances is arithmetically impossible, so
1.42x is not a model finding — it is the instrument.

### The mechanism, verified in the code, not inferred

`scripts/calibration-report.ts:622` computes the projected side as
`totalExpectedPoints / totalExpectedMinutes × 90` over **every projected row** — 475 goalkeeper
rows, 68 distinct players, including every backup and third-choice keeper. Line 569 computes the
actual side as `totalPoints / totalMinutes × 90` over **matches that were actually played** — 870
matches, 42 distinct players. **The two sides are not the same population.**

Substituting the model's own definitions (`expectedMinutes = avgMin × pAppears`,
`pSixtyPlus = sixtyRate × pAppears`, `appearancePoints = pAppears + pSixtyPlus`), the projected
appearance figure reduces to:

```
appearance pts/90  =  (1 + sixtyRate) / avgMin * 90
```

Availability cancels out entirely, and the result depends only on how much of a match the player
typically plays:

- nailed starter (`avgMin = 90`, `sixtyRate = 1.0`) → **2.00**
- rotation player (`avgMin = 45`, `sixtyRate = 0.4`) → **2.80**
- substitute (`avgMin = 20`, `sixtyRate = 0`) → **4.50**

Goalkeeper shows the worst ratio because it has the widest backup population relative to its
starters, not because keeper minutes are mis-projected. `src/lib/projection/minutes.ts` returns a
correct 90 for a keeper who played his last five matches.

### What this contaminates

Every **Ratio (proj/actual)** in the *By position: totals* table — GK 1.26x, DEF 1.08x, MID 1.09x,
FWD 1.08x — carries the same inflation, because the same denominator mismatch applies to the totals.
**That table is the one the report's own headline question reads from** ("are defenders
over-projected?"). Every per-component ratio is affected to the degree that component fails to
scale linearly with minutes.

**And no bound caught it.** The report already fails on an implausible clean-sheet rate above 60%
and on a mean excluded bonus outside [0.05, 1] — both good guards, neither looking at this. Same
shape as `LEARNINGS-second-build-wave.md` §14: a report printed a figure that is impossible on its
face and passed.

Depends on #152 (merged). Nothing unmerged.

## Scope

**In scope:**

- **Make the projected side appearance-weighted**, so it estimates the same quantity the actual side
  measures: points and minutes **conditional on the player appearing**, weighted by how often the
  model expects him to appear. `pAppears` and `pSixtyPlus` are already stored per fixture in
  `player_projections.components.fixtures[].modelInputs` — verified present, this ticket needs no
  new stored data.
- **A sanity bound on projected appearance points per 90**, per position, failing the report when it
  falls outside a stated range around the arithmetic maximum of 2 points per appearance. **This is
  the guard that would have caught this defect and it is the most valuable item in the ticket.**
- **The bound applied at every level the report prints it** — per position, not only at an
  aggregate. §14's rule.
- **The report states, in its own caveats section, which population each side is drawn from**, in
  one sentence each, so the next reader does not have to derive it from the code.

**Explicitly out of scope:**

- **No change to anything under `src/`**, to `player_projections`, or to what
  `scripts/project-points.ts` writes. This is a reporting-side fix only, exactly as ticket #127 was.
- **No change to `scripts/run-backtest.ts`.** It has the same neutral-fixture and population
  questions and they are a different ticket; the other ticket in this batch owns that file.
- **No new stored column, no migration.**
- **No change to the Top-20 distribution tables' construction**, beyond whatever falls out of the
  corrected per-90 arithmetic. Those tables are independent rankings, not paired by player, and that
  limitation is not being fixed here.
- **No re-tuning of the model in response to the corrected numbers.** Reading them is a later
  ticket.
- **No edit to `docs/projection-model-backlog.md`.** Record findings in this ticket's decisions file.

## Definition of done

- [ ] The projected side of every per-90 figure is appearance-weighted, and the report says so
      where it prints them.
- [ ] **A named test proves the arithmetic by hand on a constructed population** containing one
      nailed starter and one substitute, showing the projected appearance figure lands near 2.0
      rather than being dragged upward by the substitute. **Test the passing case first**
      (`LEARNINGS-second-build-wave.md` §10).
- [ ] A sanity bound on projected appearance pts/90 fails the report, naming the figure and the
      position, when the value falls outside its stated range. **Checked for every position, not
      only in aggregate.**
- [ ] A named test asserts the bound fails on a population that reproduces today's 2.84 goalkeeper
      figure — i.e. the guard demonstrably catches the exact defect this ticket fixes.
- [ ] `decisions/ticket-<number>.md` records the four positions' *By position: totals* ratios before
      and after, from the test fixtures rather than from a live run, plus one HIGH-IMPACT entry with
      its *because*.
- [ ] Every existing test passes **unmodified** except where a test asserts the old per-90
      construction directly. Any changed expected value is computed by hand in the test's own
      comment, never copied from failing output.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `src/screens/` or `src/components/` is
      added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic on constructed populations,
      not that the corrected figure is a better description of reality. The human check after merge
      is dispatching `Calibration report` and confirming **every position's projected appearance
      pts/90 now sits close to 2.0, and every ratio in *By position: totals* falls.** **Predicted
      before the run, so a surprise is visible: all four ratios go down, goalkeeper moves furthest
      (1.26x, the largest correction), and the ordering of the four positions' actual pts/90 is
      unchanged because nothing on the actual side is touched.** **A ratio that rises, or an actual
      figure that moves at all, means the change leaked into the wrong side.**

## Notes for the Analyst / Builder

**Do not fix this with a minutes threshold on the projected side.** Dropping rows below some
expected-minutes floor would work approximately and introduces a free parameter nobody can justify,
which is how an arbitrary constant becomes an established fact (`LEARNINGS-second-build-wave.md`
§13, and §16d on human checks derived from judgement). Appearance-weighting has no free parameter:
it is the model's own `pAppears`, already computed and already stored.

**The actual side is a sample of appearances; the projected side is an expectation over
player-gameweeks.** That sentence is the whole ticket. Everything else follows from making the
second estimate the same quantity as the first.

**Verify `components.fixtures[].modelInputs` carries `pAppears` and `pSixtyPlus` before building
on it**, rather than trusting this ticket. It is written by `scripts/project-points.ts` and every
row in the live table should carry it, but a row written before those fields existed would not —
**decide what an absent `pAppears` does and state it**; falling back to the current unweighted
behaviour for that row, and counting those rows in the report, is acceptable and is probably right.

**The bound's range is a judgement, and it must be marked as one in the ticket and in the code
comment** (§16d). The arithmetic maximum is exactly 2.0 points per appearance. A real population
sits slightly below it, because a player who appears but is subbed before 60 minutes earns 1 rather
than 2. Something like `[1.5, 2.1]` is defensible; **whatever is chosen, the comment must state that
the upper end is arithmetic and the lower end is a guess.**

**This is Tier 2** — it changes an instrument whose readings have already been used to reason about
the model, and reports from before it are not comparable to reports after it. Log it as HIGH-IMPACT
with its *because* and say that plainly in the entry.

**One companion ticket is running in this batch**, touching `scripts/run-backtest.ts` only. This
ticket touches neither that file nor anything it exports. Both import `src/lib/projection/`; **this
ticket must not touch that module at all.** The other ticket may, in one narrow case, add a new
**additive** export to `src/lib/projection/defconRate.ts` — additive only, no existing signature
changed — which is safe for this ticket because nothing here consumes it
(`LEARNINGS-second-build-wave.md` §11).

## Scope constraint

Nothing outside the following files changes:

- `scripts/calibration-report.ts`, `scripts/calibration-report.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`,
`src/screens/`, `src/components/`, `scripts/lib/` or any other `scripts/*.ts` changes. No dependency
is added, removed or upgraded. No build configuration changes.
