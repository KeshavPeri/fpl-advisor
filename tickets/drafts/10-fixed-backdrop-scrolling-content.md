## Context

Fix to the app shell established in #8. Nothing on `feature-list.md` — a correctness issue found by
using the built app.

Today the ambient background wash scrolls with the content: the whole page, backdrop and panels
together, translates as one surface. Two consequences. First, it reads as a long painted sheet being
dragged past the viewport rather than as panels resting on a base. Second, and more importantly,
`design-reference.md` names **translucent layered materials** as "the primary differentiator" of this
app's look, and `Surface`'s `backdrop-filter: blur()` currently has nothing varying behind it to
reveal — the backdrop moves in lockstep with the panel, so the blur samples the same pixels at every
scroll position. The frosted effect #8 built is present in the CSS and invisible in use.

Pinning the backdrop to the viewport is what makes the existing translucency legible. **No new
visual direction, no new colour, and no animation is being added** — the apparent movement is a
consequence of layering, not of motion.

## Scope

**In scope:**

- A backdrop layer fixed to the viewport, painted behind all content, that does not scroll.
- Content — the header, `Surface` panels, the squad form — scrolls over it normally.
- Applies on every route, since the shell wraps both `/` and `/squad`.
- Reuse #8's existing gradient and wash values exactly. This ticket **repositions** the backdrop; it
  does not redesign it.

**Explicitly out of scope:**

- **No new colours, gradients or token values.** The palette #8 chose is settled. If a value must
  change to make the layering work, say so in the handback rather than changing it quietly.
- **No animation, no parallax, no scroll-linked motion, no scroll event listeners, no
  `IntersectionObserver`.** Nothing here is a motion feature; a fixed layer is a static one.
- **Does not run `frontend-design`.** This extends existing UI, so it matches existing components
  per the design-pass rule in `CLAUDE.md`.
- **Does not invoke Impeccable or emil-design-eng.** This is not a polish ticket (§5.4).
- No layout restructuring of the squad form, no new components beyond the backdrop element itself.
- No new dependency.
- Adds no stored data, touches no migration, no script, no workflow.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Scrolling `/squad` to the bottom leaves the backdrop stationary: the brightest region of the
      wash sits at the same viewport position at full scroll as it does at scroll-top. State how you
      verified it.
- [ ] **`background-attachment` appears nowhere in `src/`.** iOS Safari ignores
      `background-attachment: fixed`, so the shipped result would scroll on the one device that
      matters most. The backdrop must be a `position: fixed` element behind the content.
- [ ] The backdrop element sets `pointer-events: none` and never sits above content in the stacking
      order — every control on `/squad` remains clickable, including at the bottom of the page.
- [ ] `Surface` still declares `backdrop-filter`, and a panel visibly differs where it overlaps a
      lighter versus a darker region of the backdrop. A screenshot at two scroll positions is
      acceptable evidence.
- [ ] No hex value in `src/index.css`'s token block changes — `git diff` on the token section shows
      no altered colour.
- [ ] `env(safe-area-inset-*)` handling from #8 still applies; the backdrop covers the full viewport
      including the area behind the notch and home indicator.
- [ ] Exactly one blurred layer per panel. No nested or stacked `backdrop-filter` — see the notes.
- [ ] Scrolling the full 15-row squad form stays smooth on the installed iPhone PWA.
      *(Device-level — expect CANNOT VERIFY.)*
- [ ] Scope constraint: only `src/index.css`, `src/App.css`, `src/components/AppShell.tsx`,
      `src/components/AppShell.css` and `src/components/Surface.css` change. No new route, no
      migration, no script, no workflow.

## Notes for the Analyst / Builder

- **The single most common wrong implementation is `background-attachment: fixed`.** It is ignored
  on iOS Safari, which means it would appear to work on the laptop and fail on the phone — the exact
  failure shape this pipeline is worst at catching, since QA has no device. Use a fixed-position
  element.
- **Performance is the real risk, not correctness.** A fixed backdrop under several
  `backdrop-filter` panels forces the compositor to re-sample on every frame. Keep it to one blurred
  layer per panel, avoid blurring the backdrop itself as well as the panels, and prefer a simple
  gradient over a large image. If the squad form scrolls badly, reducing blur radius is a better
  first move than removing the effect.
- **This is not a polish ticket and not an animation ticket.** No motion is added. §5.4's heavy
  design skills stay off, and `prefers-reduced-motion` needs no new handling because there is
  nothing new to reduce.
- **Priority.** This is not on `feature-list.md` and it does not advance the value loop, which
  closes at item 15. It is small and it improves the screen Keshav looks at most, so it is a good
  night-mate for a heavier ticket — but it should never displace one.
