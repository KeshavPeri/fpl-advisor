# Ticket #155 — Fix the calibration report's population mismatch

## HIGH-IMPACT

- **Tier 2 — changed the calibration instrument whose readings have already been used to
  reason about the model, because the projected side and actual side of every appearance-based
  per-90 figure were being computed over different populations.** The actual side is a sample
  of matches that were actually played; the projected side, unweighted, was a mean over every
  rostered row including deep backups, which inflated every appearance-points ratio (the
  arithmetically-impossible GK figure of 2.84 pts/90, 1.42x, in the 29 Aug 2026 16:30 UTC run).
  **Because pre-#155 reports and post-#155 reports are not measuring the same quantity, they
  are not comparable — treat any calibration report from before this ticket as describing a
  different, biased instrument.**

  The first construction (weighting the projected side's numerator and denominator by an extra
  factor of `pAppears`) was built, then rejected during QA: `pAppears` is a pure
  fitness/availability signal (`src/lib/projection/minutes.ts`) that sits at ~1.0 for any
  healthy player regardless of how much he's actually selected, so it cannot distinguish a
  healthy third-choice keeper from a nailed starter — QA proved this numerically, showing the
  first construction reduced to a no-op (identical to the pre-#155 formula) on a realistic
  68-goalkeeper-shaped population. The shipped fix instead weights by `pSixtyPlus`
  (`sixtyPlusRate × pAppears`), derived from `recentMinutes` — the same history `avgMinutes` is
  built from — which does discriminate: a fit-but-rarely-selected backup has a low
  `sixtyPlusRate` and is correctly suppressed, while a nailed starter's stays near 1.0. No new
  free parameter was introduced; `pSixtyPlus` is already computed and stored per fixture.

  **Ratios before/after, from the test fixtures** (illustrative constructions, not a live run
  — the aggregation is applied identically regardless of position, so these numbers demonstrate
  the mechanism working correctly for the population shape that produced the worst live
  distortion; the ticket's own DoD defers confirming the real per-position live numbers to the
  human check after merge):
  - Single starter (avgMin 90, sixtyRate 1.0) + single healthy substitute (avgMin 15–20,
    sixtyRate 0, `pAppears` 1.0 for both): pre-#155 ratio **2.5714**, first (`pAppears`)
    construction unchanged at **2.5714** (no correction), shipped (`pSixtyPlus`) fix
    **2.0000**.
  - Realistic ~68-goalkeeper population (20 starters, 48 healthy-but-rarely-used backups):
    pre-#155 **3.142857** (22/7), shipped fix **2.000000** — landing inside the sanity bound's
    `[1.5, 2.1]` range.
  - Graded population (40 deep-bench rows that never reach 60 minutes, 8 "emergency cover"
    backups with a 0.2–0.4 sixty-plus rate — testing that the fix isn't an all-or-nothing
    cliff on the extreme case): pre-#155 **2.986784** (678/227), shipped fix **2.045454**
    (45/22).
  - Live headline figures this ticket is expected to correct, from the 29 Aug 2026 16:30 UTC
    run's "By position: totals" table — the **before** state: GK 1.26x, DEF 1.08x, MID 1.09x,
    FWD 1.08x. **After** figures for a live run were not produced by this ticket (out of
    scope, per the DoD's own "what a substitute cannot catch" item) — confirming all four fall,
    with GK moving furthest, is the required human check after merge.

## ROUTINE

- The sanity bound (`assertAppearancePointsPlausible`, range `[1.5, 2.1]`) was written once in
  round 1 and never touched again — its upper end is the arithmetic ceiling (2 points per
  appearance), its lower end a judgement call (a player subbed before 60 minutes earns 1, not
  2), marked as such in the code comment per the ticket's explicit instruction.
- Accepted, documented limitation: a genuine impact substitute who reliably plays a meaningful
  sub-60-minute role also gets `pSixtyPlus = 0`, the same as a true benchwarmer, and so
  contributes nothing to the aggregate. QA independently checked this doesn't bias the report
  in the direction that would mask a real defect (any row with nonzero weight has a local
  per-90 ratio ≥ ~1.5, so the residual bias, if any, skews high — the same direction the bound
  already guards against — never low).
- Report caveat text and the "By position: totals" section intro were corrected to describe
  `pSixtyPlus` precisely and to stop describing `pAppears` as "how often the model expects the
  player to appear," since it measures fitness/availability, not selection frequency.
