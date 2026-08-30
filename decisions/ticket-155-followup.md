# Ticket #155 (follow-up) — Correct the appearance points per-90 upper sanity bound

## HIGH-IMPACT

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

## ROUTINE

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
