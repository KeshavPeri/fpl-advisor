# Ticket #127 — Restore the calibration report to a like-for-like comparison

## HIGH-IMPACT

- **Bonus is subtracted from the projected side rather than estimated on the actual side.**
  Because the actual side can never carry bonus — verified directly: no `bonus` and no `bps`
  column exists in the FPL-Core-Insights source — the projected side is the only one that can be
  made comparable without inventing data. Removing a term we can measure is honest; estimating one
  we cannot would be inventing the very thing the report exists to check.
- **The denominator for the mean-excluded-bonus bound check is "all projected rows read," not just
  started/high-minutes rows.** Because the ticket's own bound derivation (6 points shared per
  match) is stated in terms of per-appearance rows generally, and this is the simplest defensible
  reading that doesn't require guessing at an undefined minutes threshold.
- **The ticket as a whole is Tier 2** per its own framing — it changes what a decision-supporting
  instrument measures, even though it touches no stored data and draws no conclusion about
  defenders versus forwards itself.

## ROUTINE

- Column layout and wording for the new "Excluded bonus" table columns (position table: "Excluded
  bonus pts/90"; Top-N tables: "Excluded bonus").
- Exact bound-check warning phrasing when the mean excluded bonus falls outside 0.05–1.00.
- Placement of the new caveat point as a fourth bullet under the existing "Why this comparison is
  imperfect" section, rather than a new section — chosen to respect the DoD requirement that
  existing sections, headings and ordering stay unchanged.
