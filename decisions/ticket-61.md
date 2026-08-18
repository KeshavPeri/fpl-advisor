# Ticket #61 — Add the verdict card to the home screen

## HIGH-IMPACT

- **The card's headline is sourced verbatim from `recommendation_reasons` at `order_index = 0`,
  rather than re-derived from typed columns.** Because the recommendations migration's own comment
  already documents this exact convention — item 14 (Telegram) uses the first reason line as the
  headline — this card follows an established, multi-consumer contract instead of inventing a
  second way to phrase the same decision, and it satisfies the DoD's "at least one reason line, in
  order_index order" requirement with zero duplication.
- **`fetchVerdict()` always returns the single latest Plan A row across all gameweeks, not filtered
  to the current one; staleness is decided by the caller comparing gameweek ids.** Because
  product-brief.md §6a requires showing the previous run's recommendation, clearly marked with its
  age, rather than nothing, when the current gameweek's plan hasn't been generated yet — "no
  recommendation" and "stale recommendation" are different states and this shape is what lets the
  card tell them apart.
- **Player names for captain/vice-captain/transfer in-out are resolved via an extra `players` query
  in `verdict/api.ts`, rather than reused from reason-line text.** Because the stored `coverage`
  column carries only a `playerId`, not a name, a name lookup was unavoidable for the coverage note
  regardless — reusing it for the captain/vice-captain line too decouples this card from the exact
  wording of `src/lib/recommendation/reasons.ts`, which another ticket in this same batch owns and
  may be editing concurrently.

## ROUTINE

- The confidence word renders as the literal lowercase band value (`clear` / `marginal` /
  `coin-flip`) rather than a capitalised label, to stay exactly grep-matchable against
  product-brief.md §8's literal wording.
- The coverage-gap note is coloured `--accent-coral` (the risk family), read as an
  honesty/confidence-risk signal alongside hit cost and staleness, even though design-reference.md's
  three named risk examples don't list it by name.
- No player price/money is shown on the card at all — the DoD's `formatMoney` bullet read as a
  guard against mis-rounding *if* money appears, not a requirement to add it. Kept the card to
  headline, captain/vice, points, hit, confidence and coverage, per the ticket's own "a fourth
  element probably belongs on the reasoning screen" guidance.
- `VerdictCard` owns its own fetch effect, keyed on `gameweekId`, independent of `HomeScreen`'s
  pitch-loading state machine — so a slow or failed recommendation read never blocks or blanks the
  pitch, and vice versa.
