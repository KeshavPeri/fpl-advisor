# Ticket #276 — Home: full-size bench, team colours, accuracy tile, premium mini-league card

## HIGH-IMPACT

None this ticket.

## ROUTINE

- Exact per-club colour values in `src/lib/teamColours.ts` (primary/secondary hex per club) were
  invented, not sourced from an official brand reference — desaturated toward the app's own surface
  luminance and kept out of the banned green/yellow hue bands, per design-reference.md. Rationale is
  documented in the file's own header.
- Confidence badge merge rule: when the plan's and the captain's confidence bands differ, the badge
  shows the weaker of the two (`combinedConfidenceBand` in `VerdictCard.tsx`), not just the plan's own
  band — interpretation of "say the confidence once."
- Confidence badge colour: "Clear" tinted cyan, "Close call" tinted coral (carrying forward the
  risk-adjacent meaning that used to live in the deleted "too close to separate" sentence), "Leaning"
  left neutral.
- Accuracy tile figure uses `--text-headline`, matching `MiniLeagueCard`'s rank-figure tier, since
  `--text-display` is reserved for `VerdictCard`'s points figure by an existing app convention.
- Accuracy tile's "one plain line" drops the "and M projections" clause from the full variant's
  wording, keeping only gameweek count + bias, to stay to one line at tile width.
- Mini-league gap bar copy: "Leading by N" for the leader, "N points to <name>" otherwise; the fill is
  a fixed `GAP_BAR_SCALE = 40`-point visual scale, not a real mathematical bound.
- Mini-league "leading" moment is a small crown glyph with a subtle local glow next to the rank
  figure — deliberately not the shared `Surface` `focal` glow, since `VerdictCard.tsx` already
  documents that treatment as reserved for exactly one panel on Home.
- Count-up duration: 700ms ease-out-cubic, applied to row point totals and the gap-bar figure (not the
  rank ordinal), skipped entirely under `prefers-reduced-motion`.
