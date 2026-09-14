# Ticket #230 — Preflight check 6 must fail on stale team ratings

## HIGH-IMPACT

- Chose **FAIL** (not WARN) as the verdict for the existing null-elo /
  FDR-fallback condition, because the brief says FAIL. The ticket's "Verdict
  logic" section explicitly lists this as "FAIL ... (today's rule,
  unchanged)", and the Definition of Done's named test list says "a null elo
  still fails as it does today" — both stated as FAIL. The actual code before
  this ticket returned WARN for this condition (a deliberate call from ticket
  #69), so "unchanged"/"as it does today" was inaccurate framing in the
  ticket text, not a second, conflicting instruction. The two explicit,
  authoritative spec sections (verdict-logic bullets and DoD test names)
  agree with each other and only disagree with a stale code comment, so this
  was resolved without asking: FAIL wins. This is also the only reading
  consistent with the ticket's Out-of-scope note that "check 6 becoming a
  failure... is the intended outcome" — that only makes sense if check 6
  gains a FAIL it did not previously have.

## ROUTINE

- `ELO_STALE_HOURS = 240` (ten days) — Tier 3, specified directly by the
  ticket, following the existing `staleHoursThreshold = 36` pattern in
  check 8.
