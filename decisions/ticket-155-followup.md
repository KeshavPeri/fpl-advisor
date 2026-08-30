# Ticket #155 (follow-up) — Correct the appearance points per-90 upper sanity bound

## HIGH-IMPACT (2026-08-30 — replaced the absolute bound with a ratio bound)

- **Tier 2 — replaced `APPEARANCE_POINTS_PER_90_LOWER_BOUND`/`UPPER_BOUND` (the absolute
  [1.5, 2.3] range) with `APPEARANCE_POINTS_PER_90_RATIO_LOWER_BOUND`/`RATIO_UPPER_BOUND` (a
  [0.8, 1.25] range on the RATIO of projected to actual appearance pts/90), because the
  absolute bound's premise — below, in the 2.1→2.3 entry — was itself wrong, not merely
  mis-derived.** Appearance points do not cap at a fixed per-90 ceiling at all: a player subbed
  off after 30 minutes earns 1 point for a third of a match, which alone pushes a per-90 rate
  to 3.0. There is no arithmetic floor on average-minutes-given-appearing that keeps a real
  position under any fixed number. The 30 Aug 2026 report run confirms this directly: the
  actual side (real, realized player-matches, not subject to any weighting scheme) reads GK
  2.01, DEF 2.18, MID 2.41, FWD 2.63 — every position legitimately at or above the "2.3
  ceiling" the old bound treated as impossible. Had the report checked any position with a
  higher average sub-cameo rate than this dataset's, the old bound would have failed a
  perfectly good report, which is the same false-positive failure mode the 2.1→2.3 fix below
  was trying to close — that fix corrected the arithmetic without questioning the premise it
  was arithmetic for.

  **The new bound checks something that does have a stable expected value: the ratio between
  the two sides of the SAME comparison this report exists to make.** A healthy model's
  projected appearance pts/90 should track its own realized actual pts/90 reasonably closely,
  regardless of what fixed value either one happens to sit at. `[0.8, 1.25]` is a JUDGEMENT
  CALL — there is no arithmetic derivation for how close projected and actual "should" be —
  chosen wide enough to admit the real report's ratios (close to 1.0x after the appearance-
  weighting fix) while still catching the exact defect this bound exists to catch: the
  pre-weighting-fix run's goalkeeper ratio was 1.42x (2.84 projected / 2.0 actual, using the
  actual side's own real figure), comfortably outside `[0.8, 1.25]`.

  **A ratio bound has a blind spot the absolute bound did not: it cannot catch an error that
  moves both sides the same way.** If some future defect scaled both the projected and actual
  per-90 figures by the same factor, their ratio would stay ~1.0 and this bound would stay
  silent — it only detects divergence BETWEEN the two sides, not a shared error common to both.
  This is a real and permanent gap, not an oversight to close later; it is documented in the
  code comment alongside the bound itself so a future reader does not mistake "this bound
  passed" for "these figures are correct in absolute terms."

## HIGH-IMPACT (superseded by the entry above — kept for the historical record)

- **Tier 2 — raised `APPEARANCE_POINTS_PER_90_UPPER_BOUND` from 2.1 to 2.3, because the
  original bound's own code comment mis-derived it.** Appearance points cap at exactly 2 per
  appearance, but the per-90 figure is not that flat 2 — it is
  `2 × 90 / average-minutes-given-appearing`, and any appearance that earns the full 2 points
  for fewer than 90 minutes (a 60–89 minute sub) pushes that ratio above 2.0. The original
  comment acknowledged this mechanism but picked 2.1 as "a small margin" without carrying the
  arithmetic through to a specific average-minutes floor. Doing that arithmetic — `2 × 90 / 78
  ≈ 2.31` for an average-minutes-given-appearing floor of 78, a realistic worst case across a
  position's population where subs cluster in the 60–89 minute window rather than exactly at
  60 — lands the ceiling at 2.3, not 2.1. **Because this bound throws (fails the report), not
  warns, a real position whose projected per-90 legitimately sits between 2.1 and 2.3 from
  ordinary substitution patterns would have been misreported as an impossible reading and
  blocked the report entirely — this was a live false-positive risk, not a cosmetic
  off-by-a-tenth.**

## ROUTINE (2.1 → 2.3 change, superseded)

- Updated the bound's code comment to state the two ends' derivations explicitly: the upper
  end (2.3) is arithmetic, following from the per-90 formula above; the lower end (1.5)
  remains a judgement call with no arithmetic derivation, as it already was — this was
  correctly identified in the original round and is unchanged here.
- Updated `scripts/calibration-report.test.ts`'s inline comment referencing the numeric bound
  (2.1 → 2.3); every assertion in the test file already referenced
  `APPEARANCE_POINTS_PER_90_UPPER_BOUND` and `APPEARANCE_POINTS_PER_90_LOWER_BOUND`
  symbolically rather than hardcoding 2.1, so no test assertion needed to change — the two
  regression-derivation tests whose hand-computed ratios (2.571428..., 3.142857..., 2.986784...)
  exceed both 2.1 and 2.3 still correctly demonstrate the pre-#155 defect either way.
- Full test file re-run after the change: 102 passed, 0 failed. `tsc -p tsconfig.scripts.json
  --noEmit` clean.

## ROUTINE (2026-08-30 — absolute bound replaced with ratio bound)

- Removed `APPEARANCE_POINTS_PER_90_LOWER_BOUND`, `APPEARANCE_POINTS_PER_90_UPPER_BOUND`, and
  `APPEARANCE_POINTS_ARITHMETIC_MAXIMUM` entirely — no absolute per-90 figure is checked any
  more. Added `APPEARANCE_POINTS_PER_90_RATIO_LOWER_BOUND` (0.8) and
  `APPEARANCE_POINTS_PER_90_RATIO_UPPER_BOUND` (1.25).
- `assertAppearancePointsPlausible`'s signature changed from
  `ReadonlyMap<Position, number | null>` (projected pts/90 only) to
  `ReadonlyMap<Position, { projected: number | null; actual: number | null }>`, since a ratio
  bound needs both sides. The call site in `main()` now reads `actualByPosition[position]` as
  well as `projectedByPosition[position]` to build the map — `actualByPosition` was already
  computed earlier in `main()` for the report body, so no new aggregation was added.
- Rewrote the section comment above the bound and the report-body caveat paragraph that
  mentions it, both now explaining the ratio and stating plainly, per the ticket instruction,
  that a bound on a ratio cannot catch an error that shifts both sides identically.
- Rewrote `scripts/calibration-report.test.ts`'s `assertAppearancePointsPlausible` describe
  block for the new two-argument shape, including a direct reproduction of the pre-fix 1.42x
  goalkeeper ratio and a case at the real post-fix FWD figure (2.63 proj vs 2.63 actual) that
  the old absolute bound would have failed outright. Removed the old describe block's
  now-meaningless "passes at the arithmetic ceiling itself, 2.0" case.
- The `appearanceWeightedPer90` regression tests (single-substitute and the two
  ~68-goalkeeper population fixtures) previously asserted their hand-computed results also fell
  within `[APPEARANCE_POINTS_PER_90_LOWER_BOUND, APPEARANCE_POINTS_PER_90_UPPER_BOUND]` as a
  belt-and-braces sanity check unrelated to what those tests are actually proving (the
  appearance-weighting arithmetic, ticket #155). Those extra assertions were removed rather
  than rewritten against the new ratio constants — they never tested
  `assertAppearancePointsPlausible` and were redundant with the tests' own `toBeCloseTo`
  checks.
- Full test file re-run after the change: 103 passed, 0 failed (one new test added over the
  prior 102). `tsc -p tsconfig.scripts.json --noEmit` clean. `npm run lint` clean for both
  changed files.
