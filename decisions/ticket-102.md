# Ticket #102 — Show Plan B and Plan C on the reasoning screen

## HIGH-IMPACT

None. No decision met the "expensive to reverse after ten more tickets" test — every judgment
call below extends an established convention rather than inventing a new one.

## ROUTINE

- The horizon points gap between an alternative and Plan A is computed from `net_points_rounded`
  (post-hit), not the gross figure, as the fairer "true expected outcome" comparison between
  plans — a hit-adjusted alternative should be compared on what it actually nets, not what it
  scores before the hit is paid.
- Alternatives carry no per-player projection-component breakdown or full reason list — only a
  `reasonHeadline` (the first stored reason) — kept deliberately lean per the ticket's "not a
  menu" framing. The full `AlternativePlanData` is still fetched and stored, so nothing is lost
  if a future ticket wants to show more.
- The coin-flip note names Plan A vs Plan B specifically, never Plan C, because
  `src/lib/recommendation/confidence.ts` derives `confidence_band` from the Plan A/Plan B score
  gap specifically — verified by reading that module rather than assumed from the field name.
