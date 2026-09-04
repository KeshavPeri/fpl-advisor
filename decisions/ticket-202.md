# Ticket #202 — decisions

## HIGH-IMPACT

None. Every decision below is Tier 3 (routine convention / judgement call) — nothing here
introduces a new data structure, a new framework or major library, or anything else that fails
`escalation.md`'s "expensive to reverse after ten more tickets" test.

## ROUTINE

- **The section E diagnosis.** #194's DoD required `position: sticky` be gone from `VerdictCard.css`
  — it already was, and grep plus `VerdictCard.test.ts` confirm it still is. The pinned-to-viewport
  fault the owner is still seeing on-device is not a literal `sticky`. Traced instead to `html,
  body` (`index.css`) and `.app-shell` (`AppShell.css`) both setting `overflow-x: hidden` while
  leaving `overflow-y` at its default — per the CSS Overflow spec this pairing silently computes
  `overflow-y: auto`, turning those elements into their own scroll containers instead of letting the
  document scroll normally, which is a documented source of iOS Safari `position: fixed` /
  `backdrop-filter` compositing misbehaviour matching the reported symptom. Switched both rules to
  `overflow-x: clip` with an explicit `overflow-y: visible`, and added a regression test sweeping
  every stylesheet in `src/` for the same unpaired pattern. `VerdictCard.css` itself was not
  touched — there was nothing there to fix. **This is a plausible, mechanically sound diagnosis, not
  a confirmed device fix** — flagged as CANNOT VERIFY below.
- Exact new RGB values for `--material-1/2/3`, `--material-edge-*`, `--material-sheen-*`,
  `--panel-border` chosen to satisfy "strictly lower luminance" while preserving "elevation beats
  border" with margin (verified by hand computation before committing). `--panel-border` alpha
  dropped 0.08 → 0.06 to keep that margin once the fills darkened further.
- Backdrop's two new gradient centres' size/position, and the parallax factor (0.05, clamped
  ±28px) — no numeric spec given in the ticket, exercised judgement.
- Grain merged into `.app-shell__backdrop`'s own layered background
  (`background-blend-mode: overlay`) rather than kept as a sibling div, with opacity baked into the
  SVG (`opacity='0.5'` on the `<rect>`) to approximate the previous div's `opacity: 0.05` —
  an approximation, unverifiable without a browser.
- Nav bar `--nav-bar-height` (3.25rem) and `--nav-bump-overshoot` (0.9375rem) kept close to the
  already-shipped proportions rather than inventing new ones, since the ticket says the shape is
  "nearly right" and only the continuity mechanism was wrong.
- Nav bar geometry built as a CSS `mask-image` union (pill ∪ circle, one glass fill) plus a small
  fixed-size inline SVG arc for the dome's rim stroke, chosen over two rejected alternatives: a
  dynamically-measured single SVG path (needs a `ResizeObserver`, more moving parts) and a "gooey"
  blur+contrast merge (incompatible with genuine `backdrop-filter` translucency on the same shape).
  `-webkit-mask-image` / `-webkit-mask-composite: source-over` fallbacks included for older Safari;
  on an iOS old enough to lack both, the bar degrades to an unmasked rounded-rect with a floating
  circle rather than breaking.
- Active nav state now applies uniformly to all three destinations (not just Home) and uses
  `--accent-cyan` for icon+label, letting Home drop its #194-era special-case override now that it
  shares the same mechanism as the others.
- Icon stroke weights 1.5/2 → 1.75/2.25, keeping the existing +0.5 relative increment convention.
- PlayerShirt: single-line `nowrap` + `text-overflow: ellipsis` replaces the previous two-line wrap
  mechanism (the actual cause of names breaking mid-word); 64px shirt width
  (`space-12 + space-4`); 12px row gap (`space-3`, down from 16px, to keep five shirts fitting);
  1px name-to-price gap (`space-1 / 4`).
- `.pitch__row` / `.pitch__bench-row` distribution switched from `justify-content: center` to
  `space-evenly`, chosen specifically because it correctly centres a lone goalkeeper (unlike
  `space-between`, which would shove a single item to one edge).

## Animation (section F) — 2 accepted, 11 rejected

**Accepted:**
1. Backdrop parallax (section A) — makes the material behind every panel continuously change as
   the page scrolls, which is what makes the blur do visible work; transform-only, gated behind
   `prefers-reduced-motion`.
2. Nav bar active-item bloom (`--nav-active-glow` box-shadow transition on tab change) — state
   indication for the current destination, directly answering the owner's most specific complaint
   (glow missing on Home).

**Rejected, with the gate question that killed each:**
1. Animated/shimmering grain — *purpose?* Purely decorative, seen on every open.
2. Player-shirt hover/press bounce — *how often seen?* The pitch is the home screen; presumed
   rejected per the ticket's own "seen on every open" bucket.
3. Truncated-name marquee/scroll reveal — *purpose?* No state to indicate; decorative on a
   frequently-seen element.
4. Pitch-row entrance stagger on load — *how often seen?* Daily; same reasoning #166 already used
   to delete `surface-arrive` for this exact pattern.
5. Nav bar "gooey merge" animation on mount — *purpose?* Static shape now achieved structurally via
   the mask; nothing left to animate toward.
6. Ambient wash colour-cycling/hue rotation — breaks "no fourth accent," and is the slow-oscillating
   loop pattern `apple-design` cautions against.
7. Bench shirts sliding in with a stagger offset from the starting XI — same frequency gate as #4;
   #166 already deleted the equivalent bench animation-delay for being decorative.
8. Nav icon wiggle/bounce on tab switch — *how often?* Tens of times per session; too frequent per
   the framework's own table.
9. Verdict points figure count-up animation — *purpose?* The value doesn't change while visible;
   decorative theatre around the one number the brief explicitly wants calm, not loud.
10. Dual-rate parallax (grain moving separately from the wash) — *does the added complexity buy
    anything the single-rate version doesn't?* No; rejected in favour of one unified transform.
11. Dome-rim SVG arc "draw-in" on mount — the nav bar is structurally excluded from the
    screen-enter animation (#194 section H, "the floating bar must not animate"); this arc is part
    of the bar, so it follows the same rule.

## CANNOT VERIFY (device-only)

- Whether the backdrop, grain and parallax together make the glass read as material.
- Whether the parallax and a blurred fixed bar hold frame rate over a scrolling pitch.
- Whether the bar's circular centre clears the home indicator and sits in the thumb arc.
- Whether the widened pitch reads as generous at arm's length in a dark room.
- Whether the section E overflow-coupling fix actually resolves the pinned-content symptom on the
  owner's phone.
- Whether the nav bar's mask-based silhouette reads as one continuous piece of glass rather than
  merely "better" — `mask-image`/`mask-composite` rendering can vary by iOS version and could not
  be screenshotted in this environment.
