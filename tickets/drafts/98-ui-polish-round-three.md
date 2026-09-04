## Context

Third UI round. #166, #171, #174 and #194 have all shipped against
`docs/ui-audit-2026-08-31.md` and `docs/my-ui-problems.md`, and the owner has reviewed each on his
own iPhone. The material still does not read as glass, the pitch still reads narrow, and one
rendering fault from #194 is still visible on device.

**The reference is now concrete and is attached to this ticket: the macOS Tahoe dock.** That is the
target look — not "Apple-like" in the abstract, a specific artefact the owner pointed at.

This is a **polish** ticket per `CLAUDE.md`'s design-pass rule. `impeccable`, `emil-design-eng` and
`apple-design` are all in scope and are asked for by name.

`design-reference.md` and `product-brief.md` §8 bind and are not negotiable: dark only, `#0b0f19`
base, no green/yellow/purple, cyan for good and coral for risk, Geist and Geist Mono, tabular mono
figures, no emoji as icons, no decimal projected points in the recommendation UI, the pitch stays a
pitch, honour `prefers-reduced-motion`.

## The diagnosis this ticket exists to act on — read before anything else

**Two rounds have tried to make glass over a void, and that cannot work.**

Look at why the dock reads as glass: there is a *photograph* behind it. Water ripples, high-frequency
detail, real structure. The blur has something to blur, the translucency has something to transmit,
and the eye reads material because it can see the world continuing through the panel.

This app's backdrop is `AppShell.css`'s two smooth radial gradients over near-black. There is almost
nothing behind any panel. Blur a smooth gradient and you get the same smooth gradient; lower the
alpha of a panel over near-black and you get a slightly different near-black. **Every previous
attempt has tuned the glass. The problem is the thing behind it.**

So the order of work is: **fix the backdrop first, then the glass.** A backdrop with real
structure — several colour centres rather than two, fine grain, and enough contrast between light
and dark regions — is what makes every `backdrop-filter` in the app start doing visible work at the
same time. Nothing else in this ticket will read correctly until that lands.

The second half of the dock's look is the **edge**, not the fill: a bright specular rim along the
top, falling off around the perimeter, with an inner sheen softening it into the surface. That is
what says "a lit solid object" rather than "a tinted rectangle". Elevation comes from the rim and
the sheen. It does not come from alpha (#166's mistake) and it does not come from a paler fill
(#171's mistake).

## Scope

### A. The backdrop — the enabling change

- Give `.app-shell__backdrop` real structure: more than two colour centres, at genuinely different
  scales, plus a fine grain layer, so there is high-frequency detail behind every panel and behind
  the nav bar.
- **Parallax it against the scroll.** The backdrop is `position: fixed` and the content scrolls, so
  a slow counter-movement makes what sits behind a panel change continuously as the page moves.
  This is what turns a static blur into living material, and it doubles as one of the accepted
  animations in section F.
- Stay inside the palette. Cyan and coral centres over `#0b0f19`. No new hue.

### B. The material

- Panel fills go back toward the base ink's darkness. Alpha at or below 0.55 and never used to buy
  elevation.
- Every surface gets a **bright specular top rim** that falls off around the perimeter, plus an
  inner sheen, both scaling with the elevation level.
- Restore `backdrop-filter` blur on the panels now that section A gives it something to act on.
- The nav bar stays the glassiest surface in the app and must never read as the same substance as a
  panel.

### C. The navigation bar

- **The shape is nearly right and the execution is not.** Keep the owner's sketched silhouette — a
  pill with a circular boss at the centre, the circle overflowing the bar's own top edge — but it
  must read as **one continuous piece of glass**, not a bar with a ring drawn on it. The circle's
  outline and the bar's outline should form a single unbroken contour.
- **Bring back the glow on Home.** The active destination gets a cyan-tinted fill and a soft outer
  bloom. Its absence is the owner's most specific complaint about the current bar.
- **The icons are too thin and read as amateur at this size.** Sharpen them: heavier strokes,
  crisper geometry, consistent optical weight across all three, aligned to the pixel grid. The
  active icon takes the accent; the inactive ones stay quiet.
- Labels keep one sharp register — smaller, heavier, tighter tracking than today.

### D. The pitch, the bench and the names

- **The real cause of "the squad looks narrow" is `justify-content: center` on `.pitch__row`.** A
  five-defender row nearly fills the width; a three-player row clusters in the middle at about 57%
  of it, leaving a wide empty gutter. Most rows are three or four players, so most of the pitch
  reads narrow no matter how big the shirts are. **Distribute each row across the full available
  width regardless of how many players are in it** — the row's width should not depend on its
  count.
- Widen the shirts to use the width that frees up, keeping the owner's small side margin.
- **Player names must never break mid-word.** "B.Fernande / s", "Verbrug / gen", "I.Sanga / ré" are
  all visible on device today. One line, no wrapping, no hyphenation; use FPL's own short name, and
  truncate with an ellipsis if it still does not fit.
- Move the price closer to the name. The gap between them is what makes each shirt block tall and
  the rows feel far apart.
- The bench sits on the base ink, not in a panel, with visibly smaller shirts, and spreads across
  the full width the same way the pitch rows now do.

### E. The rendering fault that survived #194

The verdict card's action row (`Why this` / `Register override`) is **still pinned to the top of the
viewport while scrolling, and still renders on top of the iOS status bar.** #194's definition of
done required `position: sticky` to be gone from `VerdictCard.css`; whatever is producing this
behaviour now, it is still there on device. Find it and remove it — those buttons belong with the
card.

### F. Animation

Run `emil-design-eng` and `apple-design`. The owner will accept a few more than last time, but the
rule stands: **reject more than you accept**, and record every rejection with the gate question that
killed it.

Standing candidates: the backdrop parallax from section A; the nav bar's circle blooming on tab
change; the commit action; screen transitions; the countdown crossing into its escalated state.
Anything seen on every open — shirts, list rows, badges — is presumed rejected.

**Explicitly out of scope:**

- No new stored data, no migration, no schema change, no Supabase read, no workflow change.
- No change to any projection, recommendation, solver or scoring logic.
- No light mode. No green, yellow or purple. No Inter. No emoji as icons. No decimals in the
  recommendation UI.
- No change to any route, or to what any route does.
- No change to any confidence threshold.

## Definition of done

- [ ] `.app-shell__backdrop` carries more than two colour sources and a grain layer, and translates
      on scroll at a different rate from the content.
- [ ] `backdrop-filter` is present on `.surface` and on the nav bar, and the bar's blur and
      saturation both exceed the panels'.
- [ ] The composited relative luminance of `--material-2` over `--surface-0` is strictly lower than
      its current value, asserted in `src/index.css.test.ts`.
- [ ] No `--material-*` fill alpha exceeds 0.55, and every adjacent elevation step is still more
      visible than `--panel-border` — the existing assertions keep passing.
- [ ] Each surface has a top rim value distinct from its other three sides, and an inner sheen; both
      scale with the level.
- [ ] The nav bar renders as one continuous contour with a circular centre; the active item carries
      a cyan fill and an outer bloom; a test asserts the active item has a box-shadow the inactive
      items do not.
- [ ] The three nav icons share one stroke weight, and that weight is greater than today's.
- [ ] `.pitch__row` no longer uses `justify-content: center`; a three-player row and a five-player
      row occupy the same width. A test asserts the computed row width does not vary with the
      player count.
- [ ] Starting-XI shirt width is strictly greater than today's; bench shirt width is strictly less
      than the starting XI's; the bench is not a `Surface`.
- [ ] No player name wraps or hyphenates. `PlayerShirt.truncation.test.ts` covers "B.Fernandes",
      "Verbruggen", "I.Sangaré", "Calvert-Lewin" and "João Pedro" at the new width and asserts a
      single line for each.
- [ ] The name-to-price gap is strictly smaller than today's.
- [ ] Nothing in `VerdictCard` remains pinned to the viewport while scrolling, and no element in the
      app renders above the top safe-area inset.
- [ ] The decisions file lists every accepted animation with its purpose and every rejected one with
      the gate that rejected it, and rejections outnumber acceptances.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: files under `src/components/` and `src/screens/`, `src/index.css`,
      `src/index.css.test.ts`, and this ticket's own `decisions/ticket-<issue>.md`. Nothing under
      `scripts/`, `supabase/`, `.github/` or `src/lib/`.

## Verifiable only on a physical iPhone — expect CANNOT VERIFY

- Whether the backdrop, grain and parallax together make the glass read as material.
- Whether the parallax and a blurred fixed bar hold frame rate over a scrolling pitch.
- Whether the bar's circular centre clears the home indicator and sits in the thumb arc.
- Whether the widened pitch reads as generous at arm's length in a dark room.

## Notes for the Analyst / Builder

- **The three failed approaches, so none is tried a fourth time.** #166 raised panel alpha and lost
  the material. #171 lightened the fill and produced the plastic look. #194 kept both corrections
  but left the backdrop flat, so the blur still had nothing to act on. The backdrop is the missing
  piece, and section A is the ticket.
- The owner's sketch is a bar whose outline bulges into a circle at the centre — one silhouette. If
  the circle reads as a separate ring sitting on a bar, that is the current state, not the target.
- Parallax must be `transform`-only and must be disabled under `prefers-reduced-motion`.
- Do not add a fourth accent colour anywhere.
- The screenshots this ticket is written from were taken on 4 September 2026.
