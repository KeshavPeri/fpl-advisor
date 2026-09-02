# Ticket #188 — Minutes model v2: separate start probability from minutes-given-start

## HIGH-IMPACT

- **Split `estimateMinutes` into a start/feature probability and a minutes-given-featured
  figure, and — only on a full 5-match window — drop the single lowest raw minutes value
  before computing either.** Because: minutes carry roughly 85% of the model's ranking signal
  and multiply into goals, assists, saves, CBI, recoveries (via `minutesFraction`) and gate
  clean sheets/defcon (via `pSixtyPlus`), so the plain arithmetic mean's sensitivity to one
  outlier (a rest, an early sub, a returning-from-injury cameo) was discounting every
  attacking/defensive term for a nailed starter by roughly a fifth. Real 2025-26
  `playermatchstats.csv` data (77 nailed-starter players, 1,232 sliding five-match windows,
  same source/method as #148/#162/#168) shows a one-zero-in-five window occurs 7.6% of the
  time and drags the plain mean to 70.7 vs a clean window's 88.8 — but the match immediately
  *after* a one-zero window shows almost the same continuation as after a clean window (mean
  81.5 vs 85.1 minutes; P(60+) 0.92 vs 0.94). One missed match barely predicts a reduced role
  in this population, so the plain mean's ~20% discount is measurably wrong, not just
  aesthetically undesirable. Dropping exactly the single lowest value on a full window
  recovers ≈90, matching the real "clean" population average, while a genuine second low value
  (the rotation-player guard) still pulls the estimate down substantially. A bare median was
  explicitly rejected — it would discard magnitude information from every value above the
  middle one, where "drop-one-of-five" keeps it and is what the next-match evidence actually
  supports.
  - **Worked case, before → after (Haaland, GW3):** window `90,90,90,90,0`, full availability.
    Before (v1): `expectedMinutes = 72.0`, `pSixtyPlus = 0.8`. After (v2): drop the 0 →
    `[90,90,90,90]`, all featured and all ≥60 → `expectedMinutes = 90`, `pSixtyPlus = 1.0`.
  - **Rotation-player guard, worked:** window `90,0,45,0,90`, full availability. Sorted
    `[0,0,45,90,90]`, drop one 0 → `[0,45,90,90]` (a zero remains) → `pFeature = 0.75`,
    `minutesGivenFeature = 75`, `pSixtyGivenFeature = 2/3` → `expectedMinutes = 56.25`,
    `pSixtyPlus = 0.5` — both well below a nailed starter's 90/1.0, confirming the change
    does not collapse into "every miss is noise."
  - Trim applies only on a full 5-row window; a partial window (1–4 rows) is used untrimmed,
    unchanged from v1, since there isn't enough data at that size to distinguish an outlier
    from real signal.
  - No exported signature in `src/lib/projection/` changed; `estimateMinutes(recentMinutes,
    availability)` is byte-identical, confirmed by diffing every `export` line against
    `origin/main`.
  - No recency/order dependency was introduced — the estimator remains order-insensitive,
    confirmed by reading the implementation (sorts by value, not position) and by QA
    independently.

## ROUTINE

- Downstream scope deviation, Analyst-classified Tier 3: one hardcoded expected value in
  `src/lib/projection/expectedPoints.test.ts` (a file outside this ticket's hard scope
  constraint) went stale because it hand-computed `pSixtyPlus` for window
  `[90,90,90,10,10]` under the old plain-mean estimator (0.6). Under the new (correct)
  estimator that same window legitimately produces 0.75 (trim drops one `10`, leaving
  `[10,90,90,90]`; 3 of 4 remaining rows reach 60+). The ticket's own DoD required
  `npm test` to pass clean, which directly conflicted with its file-scope constraint once this
  surfaced. I classified this against `escalation.md` (test question: "would this be expensive
  to reverse after ten more tickets are built on top of it?") — trivially reversible, a single
  test assertion, no data-shape or structural decision — and authorized the one-line fix as a
  narrow, explicitly logged exception rather than leaving a known-failing test in the suite.
  Builder touched only that one test's name/expectation/comment; QA independently recomputed
  the value and confirmed nothing else in the file changed.
- `pAppears` output kept exactly `= clamp01(availability)`, untouched — its existing doc
  comment already specified this and minutes history was never evidence for it.
- `expectedMinutes` defensively clamped to a max of 90 even though the measured source data
  never exceeds it, as a cheap invariant guard for the DoD's "never exceeds 90" tests.
- Tie-breaking on the trim step: when there are duplicate minimum values (e.g. two zeros),
  only one instance is dropped (sorts ascending, slices off index 0) — deliberate, so a
  genuine two-zero rotation pattern doesn't collapse into the same treatment as a true
  single-match blip.
- New helper functions (`dropSingleLowest`, `splitFeaturedFromSample`) kept module-private —
  no new exports were needed to satisfy the ticket's tests.

## Note

Three pre-existing, unrelated test failures remain in the full suite (README-migration-status
assertions in `scripts/ingest-core-insights.test.ts` and `scripts/build-feature-history.test.ts`)
— confirmed present on `origin/main` independently by both Builder (`git stash`) and QA (a
scratch worktree checked out at `origin/main`), so not attributable to this ticket.

**This ticket cannot be judged by the backtest.** Ticket #187, running concurrently in this same
batch, changes the backtest's own minutes input (`buildRecentMinutes`) to stop averaging and
feed the real five-match window this ticket's estimator now consumes correctly. The first
backtest run after both tickets land reflects both changes together — neither is individually
attributable from that run alone. The actual judge of this ticket post-merge is the Calibration
report's appearance ratio moving toward 1.00x at every position (currently GK 1.06x, DEF 1.00x,
MID 0.96x, FWD 0.92x) — a human check, not something either agent could run from here.
