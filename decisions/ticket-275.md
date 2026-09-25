# Ticket #275 — Reddit-style glass nav bar, screen titles, one card style

## HIGH-IMPACT

None this ticket.

## ROUTINE

- Left `--material-bar`, `--material-bar-blur`, `--material-bar-saturate`, `--scrim-strength`,
  `--nav-home-size`, `--nav-bump-overshoot`, `--nav-active-glow` defined but unused in `index.css`,
  rather than deleting them, because `index.css.test.ts` asserts relationships between them (e.g.
  "the nav bar is the glassiest surface") and `index.css`'s *test* is outside this ticket's Files
  list to touch meaningfully — leaving the tokens intact keeps that test green without editing a
  file the ticket didn't authorize touching. Two out-of-scope files' CSS *comments*
  (`MiniLeagueCard.css`, `VerdictCard.css`) now reference stale token names in prose only, no
  functional effect.
- All new visual/motion constants are invented, not derived from a brief number: collapse threshold
  (14px) / top guard (24px), bar height/collapsed diameter (3.5rem), `--nav-bar-reserve` (6rem),
  glass blur/saturate/fill/rim/sheen values for both the refraction and faux-glass tiers, the spring
  easing curve and durations, and the title fade distance/translate/shrink on scroll. None of these
  could be verified against a real device from this environment; reasoning for each is in code
  comments.
- `WhyIcon` (new nav icon for the Why tab) is a question-mark-in-circle. Rejected a lightbulb (reads
  as "tip," not "why") and a chat bubble (design-reference.md's "no chat bubbles/AI framing" rule).
- Collapsed nav state resets to expanded on every route change — the ticket doesn't specify this;
  chosen as the safer default since screens here don't carry over scroll-position semantics.
- On routes with no matching tab (`/squad`, `/override`), the collapsed circle and active pill
  default to the Home icon rather than rendering nothing.
- Surface's card-material resolution collapsed from three tiers to two (`level={1}` now renders the
  same class as `level={2}`; the near-black `--material-1` style is gone), per the ticket's "one
  card style" requirement — the `level`/`raised` prop API itself is unchanged so no screen needed
  editing.
- Glass "glow, not frost" implemented as two tiers: real `feDisplacementMap` SVG refraction where
  `CSS.supports('backdrop-filter','url(#…)')` passes (Chromium), and a heavier faux-glass fallback
  elsewhere, including iOS Safari (Keshav's phone) — matches the ticket's explicit acceptance of
  that platform limit; documented in the PR what the iPhone actually gets.
