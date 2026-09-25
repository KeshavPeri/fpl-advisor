# Bottom navigation — Keshav's spec (25 Sept 2026)

Source: Keshav's screen recording of the Reddit iOS app (13 s), reviewed frame by frame, plus his words.
Supersedes the nav notes in `docs/my-ui-problems.md`. For the UI polish round (run 4), ticket type "polish".

## What he wants

1. **Floating glass pill, like Reddit's.** A rounded capsule floating above the content with side and
   bottom margins (not edge-to-edge, not docked). Icon plus small label per tab. Content scrolls
   visibly underneath it.
2. **"Crazy premium" liquid glass — glow, not frost.** Keshav, after seeing the current bar: **no heavy blur**
   (that reads as frosted). He wants a clear, premium glass finish with a *glow* — light blur at most,
   bright rim, specular sheen, soft outer glow in the accent colour. The background behind the bar must look **refracted and
   distorted, not just blurred**: lensing at the curved edges, a bright specular rim, and slight
   magnification or warping of what passes underneath.
3. **Premium tab-switch animation.** The active tab sits in its own darker inner pill (Reddit:
   Home → Games → Inbox). On switch, that pill **slides and stretches** to the new tab, like liquid,
   with spring easing, not an instant jump or a plain fade. Icons respond too: a small scale or bounce
   on the newly active one.
4. **Collapse on scroll.** Scrolling down, the bar **shrinks into one glass circle at the bottom-left**
   showing only the current tab's icon. Scrolling up (or tapping the circle) **restores** the full bar.
   Both directions are animated as one morph, pill ↔ circle, not a hide/show.

## Reference frames (Reddit)
- Full bar: 4 tabs, active tab in a darker inner pill, badge on Inbox.
- Scrolled: only a circle with the Home icon, bottom-left, over the content.
- Scrolled back up: the bar re-expands from that circle.

## Constraints the ticket must carry
- **Honest limit:** true refraction of what's behind an element needs `backdrop-filter: url(#svg-filter)`
  with `feDisplacementMap`. That works in Chromium. As far as we know, **iOS Safari (Keshav's phone,
  installed PWA) does not support SVG filters in `backdrop-filter`**. The Builder must feature-detect
  it and use the real distortion where supported. On iOS, build the best faux-glass: heavy blur,
  saturation boost, bright inner and outer rim, a specular highlight gradient, subtle edge darkening
  or chromatic fringe. Verify on the Vercel preview in iOS Safari and say in the PR what's possible.
- 60 fps on a mid iPhone. Only transform/opacity animations. Respect `prefers-reduced-motion`
  (no morph, instant state change).
- Safe-area insets (home indicator). Tap targets ≥ 44 px, the collapsed circle included.
- **Four tabs, Reddit-style:** Home, Why (reasoning, `/reasoning`), Chips, Record. Drop today's raised
  centre 'hump' on Home; every tab gets the same active treatment (the sliding inner pill). Keep the existing routes. Only the shell and nav change.
- Impeccable / emil-design-eng skills allowed (polish ticket, CLAUDE.md §design-pass).
