## Context

**The backtest has been grading the model on a blurred version of its own inputs, and it is the
reason the model appeared to lose to a trivial baseline.**

`docs/model-review-2026-09-02.md` rebuilt the backtest independently from the FPL-Core-Insights CSVs
and validated it against the shipped one before changing anything — season Spearman 0.326 against the
report's 0.323, goalkeeper 0.168 exact, MAE 1.797 against 1.800, all three naive baselines within
0.005. It then changed **one thing**: the minutes input.

`scripts/run-backtest.ts`'s `buildRecentMinutes` returns **an array of exactly one synthetic match** —
the player's average minutes across all prior matches:

```ts
export function buildRecentMinutes(row) {
  return row.prior_matches > 0 ? [averageMinutesPerMatch(row)] : []
}
```

The live model calls the same `estimateMinutes()` with the player's **last five actual matches**
(`RECENT_MATCH_COUNT = 5`). Feeding it one averaged match instead destroys the distinction between a
nailed starter and a rotation player, which is exactly the signal minutes carry.

**Swapping in a true last-five window flips the verdict at every position.** Midfielders go to 0.410
against the minutes baseline's 0.394; forwards to 0.423 against 0.396. **The measured
midfielder/forward deficit that prompted the whole model review is smaller than the degradation the
harness itself introduces.**

**This is the fifth "instrument, not model" finding in this project**, and the second half of a defect
we already half-fixed. `docs/projection-model-backlog.md` G9 lists minutes and defensive contribution
together as one approximation — *"estimated from one averaged typical match"*. Ticket #154 fixed the
defcon half by reading the stored per-match counters #146 added. **The minutes half was never
extended, and `buildRecentMinutes` still carries the original construction.**

**This ticket stores the substrate. A follow-up consumes it.** Same split as #146 → #154 and
#167 → #175, both of which worked cleanly. **No backtest number will move when this merges.**

Depends on #121, #125, #146, #167 — all merged and applied. Nothing unmerged.

## Scope

**In scope:**

- **A migration adding `prior_recent_minutes integer[]` to `feature_history`** — the minutes played in
  that player's most recent qualifying Premier League matches **strictly before** that gameweek,
  most recent first, capped at `RECENT_MATCH_COUNT`.
- **`scripts/build-feature-history.ts` populates it**, from the same `player_match_stats` rows it
  already reads to build the cumulative `prior_*` totals, under the same strictly-before rule and the
  same `competition = 'prem'` filter.
- **Counters in `job_runs.details`**: rows written carrying a non-null array, rows carrying a full
  five-match window, rows carrying a shorter one (a player early in a season), and rows carrying an
  empty array (no prior matches at all).
- **`supabase/README.md`'s applied table gets a row** for the new migration, marked not-yet-applied.

**Explicitly out of scope:**

- **No change to `scripts/run-backtest.ts`.** It is the consumer and it is the next ticket.
  **Every backtest figure — MAE, signed error, Spearman, the three baselines, every exclusion count —
  will be byte-identical after this merges.**
- **No change to anything under `src/`.** `minutes.ts` already accepts the array shape this ticket
  stores; nothing there needs touching.
- **No change to `scripts/project-points.ts`, `ingest-core-insights.ts` or any other `scripts/*.ts`.**
  The live model already builds its own five-match window from `player_match_stats` and is unaffected.
- **No change to the existing `prior_*` cumulative columns.** They stay, and stay populated — other
  consumers read them.
- **No back-computation of any other window length, and no storing of anything but minutes.**
- **No re-run of any job as part of the ticket.** Applying the migration and rebuilding are Keshav's
  post-merge steps.

## Definition of done

- [ ] One migration file adds the column, is idempotent, and issues any GRANT it needs in the same
      file (`deltas.md` D8 — RLS and GRANTs are independent gates).
- [ ] `build-feature-history.ts` populates the array from Premier League matches **strictly before**
      that row's gameweek. **A named test proves a gameweek-N row contains no minutes from gameweek N
      or later — the lookahead guard, and the most important test in this ticket.**
- [ ] The array is ordered most-recent-first and never longer than `RECENT_MATCH_COUNT`. Named tests
      for a player with more than five prior matches, exactly five, two, and none.
- [ ] The window is built from the same filtered row set the cumulative `prior_*` columns use, so a
      row's `prior_matches` and its array length agree wherever `prior_matches` is below
      `RECENT_MATCH_COUNT`. Named test.
- [ ] All four counters appear in `job_runs.details` and reconcile arithmetically against rows
      written.
- [ ] `supabase/README.md` carries a row for the new migration.
- [ ] Every existing test passes **unmodified**.
- [ ] Nothing under `src/`, `.github/`, `docs/` or any other `scripts/*.ts` is added, changed or
      deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the window's shape and its strictly-before
      guarantee on constructed rows, not that the live rebuild populates it. The human check after
      merge is applying the migration, re-running `build-feature-history.ts` by hand, and confirming
      from `job_runs` that **the array is non-null on essentially every row with `prior_matches > 0`**,
      with a full five-match window on the large majority. **What will NOT change, and must not be
      read as this ticket failing: every number in the backtest report.** The consumer ticket is what
      moves them, and it cannot run until this migration is applied.

## Notes for the Analyst / Builder

**An `integer[]` column rather than five separate columns, and this is the *because*.**
`src/lib/projection/minutes.ts`'s `estimateMinutes(recentMinutes: readonly number[], availability)`
already takes an array, and `RECENT_MATCH_COUNT` is an exported constant in that module. Storing an
array means the window length is defined by code, in one place, and changing it later needs no
migration. Five fixed columns would put that constant in the schema as well, in a second place that
can drift.

**Most-recent-first, and say so in the column comment.** `estimateMinutes` averages the window and
counts how many entries reach 60 minutes, so order does not currently affect the result — but an
undocumented order is a trap for the first consumer that cares, and the live pipeline's own window is
built most-recent-first.

**The strictly-before rule is the whole value of `feature_history` and it is easy to lose here.**
The cumulative columns get it right today; the array must be built from the identical row set and the
identical cut-off, not from a separately-derived query that might include the target gameweek.

**A column with no consumer is the dangerous one** (`deltas.md` D9). This one gets its consumer in
the very next batch — say so in the decisions file and name it.

**This is Tier 2** — it is the substrate the fairness of every future model judgement rests on. Log
it as HIGH-IMPACT with its *because*. The migration is Keshav's to apply; no agent touches live data.

**Two other tickets are running in this batch.** One owns `src/lib/projection/fixture.ts`; the other
owns `scripts/run-backtest.ts`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- One new file under `supabase/migrations/`
- `supabase/README.md`
- `scripts/build-feature-history.ts`, `scripts/build-feature-history.test.ts`
- `decisions/ticket-<this issue number>.md`

Nothing under `src/`, `docs/`, `.github/` or any other `scripts/*.ts` changes —
`scripts/run-backtest.ts`, `scripts/project-points.ts` and `scripts/ingest-core-insights.ts` in
particular are untouched. No dependency is added, removed or upgraded. No build configuration changes.
