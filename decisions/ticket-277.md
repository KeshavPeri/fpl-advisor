# Ticket #277 — Why screen, plain language

## HIGH-IMPACT

None this ticket.

## ROUTINE

- `reasonChip` thresholds (own_pct_rank/transfers_rank rank ≥0.7 or ≤0.3, price ≥80 tenths = £8.0m,
  lambda_for ≥1.8, p_cs ≥0.35, goal-stat rates) — the brief and ticket don't give exact cutoffs, so
  these were chosen as plain reads of "clearly high/low," documented inline in `derive.ts`.
- Headline figure is the starting XI's single-gameweek total (captain doubled), not the old
  5-gameweek horizon total. The "vs N if you roll" comparison is shown only when both figures share
  the same horizon; the only stored roll-alternative figures are horizon totals, and mixing horizon
  vs. single-gameweek would fabricate a comparison, so per the ticket's own fallback only the
  gameweek figure is shown when the comparison isn't available on that basis.
- Confidence badge colours: Clear → cyan, Close call → coral (risk/uncertainty), Leaning → neutral,
  following design-reference.md's cyan/coral convention rather than inventing a third accent.
- Coverage note now renders only when there's an actual data gap (previously always rendered, even
  as filler text) — satisfies both G4 (delete "built on real match history" filler) and product-brief
  §8 (state the coverage gap in words) with one change.
- Reused `DecisionHistoryScreen.css`'s existing `<details>`/`<summary>` chevron pattern for both the
  per-player "See the numbers" and "Other options" disclosures, for visual consistency rather than
  inventing a new disclosure affordance.
- **Scope note, not a deviation:** build item 3 asks player cards to show role, name, team, and the
  points figure. Team was left off — the `players` query in `api.ts` only selects `id, web_name`, and
  the ticket's Files list restricts `api.ts` edits to only the recommendation-solve-time fix. Adding a
  team fetch would be a second, unauthorized reason to touch that file, and it isn't in the DoD's
  enumerated test list. Left out rather than widening scope past what the ticket authorized; worth a
  follow-up ticket if Keshav wants team shown on the card.
