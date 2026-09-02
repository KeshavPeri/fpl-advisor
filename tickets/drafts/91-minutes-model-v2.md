## Context

**Minutes carry roughly 85% of this model's ranking signal, and the estimator is one arithmetic mean
that a single unusual match can move by a fifth.**

`src/lib/projection/minutes.ts`:

```ts
const averageMinutes = recentMinutes.reduce((s, m) => s + m, 0) / recentMinutes.length
const sixtyPlusRate  = recentMinutes.filter((m) => m >= 60).length / recentMinutes.length
return {
  expectedMinutes: averageMinutes * pAppears,
  pAppears,
  pSixtyPlus: sixtyPlusRate * pAppears,
}
```

**A live, checkable example from gameweek 3.** Haaland — a nailed starter — carries
`expectedMinutes = 72.0` and `pSixtyPlus = 0.8`, against B. Fernandes at `90.0` and `1.0`. A five-match
window of `90, 90, 90, 90, 0` produces exactly those numbers: one rested or curtailed match drags the
mean down 20% and the sixty-plus rate down to 0.8. **`minutesFraction` multiplies goals, assists,
saves, CBI and recoveries, and `pSixtyPlus` gates clean sheets and defensive contribution — so that
single outlier is discounting every attacking term he has by a fifth**, and costs 0.2 appearance
points on top.

Measured cost in that case: roughly **1.2 points** of Haaland's gameweek-3 projection, against a
2.4-point gap to the recommended captain. Not decisive there, but it is the same discount applied to
every rotation-risk judgement the app makes.

**The model conflates two different questions.** *Will he start?* and *how long does he last when he
does?* have different distributions and different evidence, and averaging them together loses both.
A player who starts every match and is always subbed on 70 minutes, and a player who starts four in
five and plays 90, produce the same mean and mean very different things for a transfer.

`docs/model-review-2026-09-02.md` names a starts-based minutes v2 as one of exactly two repairs worth
making to `baseline-v1`, and identifies minutes as where most of its ranking signal already lives.

Depends on #185 (the stored last-five window) and the backtest consumer being written in the same
batch. Nothing unmerged.

## Scope

**In scope:**

- **Separate the two questions inside `estimateMinutes`**: estimate a probability the player features
  meaningfully, and separately a typical minutes figure given that he does, then combine them.
  `expectedMinutes` and `pSixtyPlus` keep their existing meanings and ranges; only how they are
  derived changes.
- **Make the estimate robust to one outlier.** A single zero, a single early substitution or a single
  rested match in a five-match window must not move a nailed starter's figures by a fifth. **The
  chosen estimator and its justification are the Builder's call and must be recorded**, with the
  worked `90, 90, 90, 90, 0` case in the decisions file showing before and after.
- **`pSixtyPlus` derived as a probability of starting multiplied by a probability of reaching 60
  minutes given a start**, rather than a raw count over the window.
- **Availability still gates everything.** `pAppears` is unchanged in meaning and is still applied.
- **The no-history path is unchanged** — `NO_HISTORY_BASELINE_MINUTES` and
  `NO_HISTORY_BASELINE_SIXTY_PLUS_RATE` keep their current values and behaviour.

**Explicitly out of scope:**

- **No signature change to any export in `src/lib/projection/`, and this is a hard constraint.**
  `estimateMinutes(recentMinutes, availability)` keeps its exact shape — another ticket in this batch
  edits `scripts/run-backtest.ts`, which imports this module, and a signature change breaks `tsc -b`
  on the second merge even though the file lists are disjoint
  (`LEARNINGS-second-build-wave.md` §11). New exports are additive only.
- **No new input.** No starts column, no `players.status` beyond the availability already passed, no
  new stored data, no migration. Everything comes from the window and the availability the function
  already receives.
- **No change to `RECENT_MATCH_COUNT`.**
- **No change to goals, assists, clean sheets, defcon, saves, bonus, the fixture multipliers or the
  shrinkage.** Exactly one module moves.
- **No change to any file under `scripts/`.** Both consumers pick this up on their next run.
- **No edit to `docs/projection-model-backlog.md`.**

## Definition of done

- [ ] `estimateMinutes` derives `expectedMinutes` and `pSixtyPlus` from a start probability and a
      minutes-given-start figure, with the construction and its *because* in the module comment.
- [ ] **The worked case is a named test:** a window of `90, 90, 90, 90, 0` at full availability
      produces materially higher `expectedMinutes` and `pSixtyPlus` than the current 72.0 and 0.8,
      **with the expected values computed by hand in the test's own comment.**
- [ ] **A genuine rotation player is not inflated.** A window of `90, 0, 45, 0, 90` produces figures
      recognisably below a nailed starter's. Named test. **This is the item that stops the ticket
      turning into "make everyone a starter".**
- [ ] A window of five identical full matches still produces `expectedMinutes = 90 × pAppears` and
      `pSixtyPlus = pAppears`. Named test — the unambiguous case must not move.
- [ ] Availability still scales both outputs, and zero availability still produces zero. Named test.
- [ ] The empty-window path returns the existing no-history baseline unchanged. Named test.
- [ ] `expectedMinutes` never exceeds 90 and `pSixtyPlus` never exceeds 1. Named tests.
- [ ] **No exported signature in `src/lib/projection/` changes.** Grep-checkable.
- [ ] Every existing test in `minutes.test.ts` that does not concern the estimator's internals passes
      **unmodified**. Any changed expected value is computed by hand in the test's own comment, never
      copied from failing output.
- [ ] `src/lib/projection/` stays pure: no I/O, no clock, no environment.
- [ ] Nothing under `scripts/`, `supabase/`, `docs/`, `src/screens/`, `src/components/` or `.github/`
      is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch, and read this carefully.** The human check after merge is
      running `project-points`, then dispatching **`Calibration report`** and confirming the
      appearance ratio moves toward 1.00x at every position — it currently reads GK 1.06x, DEF 1.00x,
      MID 0.96x, FWD 0.92x. **Judge this ticket on the calibration report, not the backtest.** Another
      ticket in this batch changes the backtest's own minutes input, so the first backtest run after
      this batch reflects both tickets and attributes neither. The calibration report is untouched by
      that ticket and is the clean instrument here. **What will NOT change:** goals, assists and
      defensive-contribution *rates* are unaffected — but every term that multiplies by
      `minutesFraction` will shift in level, so small movements across the whole component table are
      expected and are not leakage.

## Notes for the Analyst / Builder

**Measure the shape of the problem before choosing an estimator.** Fetch the FPL-Core-Insights
per-gameweek CSVs — the method #148, #162 and #168 all used — and look at the real distribution of
last-five-match minutes windows across the 2025-2026 season. **How often does a nailed starter's
window contain one zero, and what does the mean do to him when it does?** Choose the estimator from
that evidence and record it. **Do not pick a median because it sounds robust** — say what the data
shows and why the chosen form follows.

**The failure mode to design against is over-correction.** An estimator that ignores zeros entirely
would rate an injured player identically to a fit one, which is worse than today's behaviour. The
rotation-player test in the definition of done exists precisely to catch that, and it should be
written before the estimator.

**Order within the window is now meaningful and is available.** #185 stores
`prior_recent_minutes` most-recent-first, and the live pipeline builds its window the same way. A
player whose zero was five matches ago is different from one whose zero was last week. **Using
recency is permitted and is probably right — but if you do, say so explicitly**, because
`estimateMinutes` has been order-insensitive until now and a silent dependency on order is a trap for
the next caller.

**This is Tier 2** — minutes multiply into every component of every projection, so this changes every
recommendation the app makes. Log it as HIGH-IMPACT with its *because*, including the worked Haaland
figures before and after.

**Two other tickets are running in this batch**, owning `scripts/run-backtest.ts` and a new ClubElo
ingest script plus `.github/workflows/scheduled-jobs.yml`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/minutes.ts`, `src/lib/projection/minutes.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/`, `src/screens/`,
`src/components/` or `.github/` changes. `src/lib/projection/rates.ts`, `fixture.ts`,
`defconRate.ts`, `bonus.ts`, `expectedPoints.ts` and `pointValues.ts` are not modified. No exported
signature in `src/lib/projection/` changes; new exports are additive only.
