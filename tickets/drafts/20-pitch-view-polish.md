## Context

**Type: polish. UI only.** Visual refinement of the pitch view built by the previous ticket, from
Keshav's own review of the running preview. No functional or logic concerns are raised here — every
item below is about how it looks and feels on the phone.

Per `CLAUDE.md`'s design-pass rule, this is a ticket explicitly typed polish, so the polish design
skills (`impeccable`, `emil-design-eng`) apply here and `design-reference.md` is read as always.
This is the exception §5.4 reserves them for, not a normal build ticket.

The pitch-view ticket is merged. **Build this on a fresh branch from `main` in the normal way** —
there is no open branch to continue, and the previous ticket's work is already in `main`.

Depends on the pitch view (merged), #8 (app shell, `Surface`, design tokens) and #26 (the fixed
backdrop).

## Scope — the five findings, plus two the review surfaced

**In scope:**

**1. The shirt is effectively invisible.** Each player is supposed to carry a kit/shirt mark and it
barely renders. It needs to read clearly as a shirt at a glance, at the size it occupies on a phone.
**No per-team colours and no jersey accuracy are wanted** — a clean, classy placeholder that sits
inside the app's own palette and the glass aesthetic.

**2. Player names truncate badly.** Names are cutting off mid-word with ellipses — "Bruno…",
"Pedro…" — which reads as broken rather than as designed. Fix it by whichever of these works best
at the real size: a responsive size reduction, a permitted second line, or a cleaner truncation rule
such as surname only. The result must never show a mid-word ellipsis at the default viewport.

**3. The panel glow reads as an artificial line, not as depth.** `src/components/Surface.css`'s
`::before` layer is a radial gradient with `inset: -40% -30% auto -30%` and `height: 70%`, blurred
12px. Because the layer terminates at a hard boundary rather than fading out, it renders as a
solid band across the panel rather than as light behind glass. **The soft glow inside the border is
right and should stay — it is specifically the thick fixed line low on the panel that must go.**
Rework it to fade out genuinely, or remove that layer entirely if it cannot be made to read as
refraction. Separately: raise the ambient backdrop gradient's intensity slightly — still ambient,
still minimal — so the glass reads more clearly as it moves over it.

**4. Scrolling and centring feel like a web page, not an app.** Horizontal scroll is possible and
the layout shifts off-centre when it happens. Lock the horizontal axis and constrain overscroll so
the column stays put.

**5. The notch area renders as flat black instead of carrying the design.** This is **not** a
platform limitation — it is a missing viewport declaration. `index.html`'s viewport meta is
`width=device-width, initial-scale=1.0` with **no `viewport-fit=cover`**, so iOS never extends the
layout under the safe areas and every `env(safe-area-inset-*)` value the app already uses resolves
to zero. `AppShell.css`'s backdrop is already written with `inset: 0` specifically so it covers the
notch area once this is allowed. Also add the Apple status-bar style meta so the status bar sits
over the design rather than over a black band, and make sure `theme-color` still reads correctly
against the gradient.

**Two more, from reviewing the code against `design-reference.md`:**

**6. Every `Surface` plays an arrival animation on mount.** On a screen with one panel that is
elegant. On a pitch it risks reading as a page assembling itself. Check how it feels with the full
squad rendered and, if it is busy, stagger it or suppress it for the pitch's own panels. Motion is
for orientation and state change, never decoration.

**7. One number per player, and it should read as the important thing.** Reference 2 in
`design-reference.md` (Revolut) is the model: a single figure, tabular, generously spaced, with a
small quiet label. Check the price is getting that treatment rather than sitting as incidental text.

**Explicitly out of scope:**

- **No functional change of any kind.** No new data read, no new query, no change to what is
  displayed — only to how. The squad shown, the formation logic, the bench ordering, the
  availability-ring rules and the empty/loading/error states all keep their current behaviour.
- **No projections, no recommendation, no verdict card, no countdown.** Items 13, 17 and 18.
- **No reading of `player_projections`, `solver_runs` or `solver_picks`.**
- **No per-team colours, no club crests, no kit accuracy, no external image assets.** Explicitly not
  wanted. Any shirt mark is inline SVG or CSS, drawn from the existing palette.
- **No new dependency** — no icon pack, no animation library, no component library.
- **No light theme, no theme toggle.**
- **No changes to `scripts/`, `.github/workflows/`, `supabase/`, `src/lib/scoring/`,
  `src/lib/projection/` or `src/lib/squad/`.** Other tickets in this batch own `scripts/` and the
  workflow directory.
- **No change to `src/screens/HomeScreen.tsx`'s structure or to what it renders.** A CSS-level
  change there is fine; adding or removing an element is not.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] No new entry in `package.json` `dependencies` or `devDependencies`.
- [ ] **No test that passed before this ticket now fails or was deleted.** This is a visual ticket;
      the behaviour it polishes is already proven and must stay proven.

**The five findings**

- [ ] The shirt mark renders visibly at the size it occupies on a 390px-wide viewport — clearly
      identifiable as a shirt, not a faint smudge. It uses only existing tokens from
      `src/index.css`, contains no club crest, no team colour, and no external image file.
- [ ] **No player name renders with a mid-word ellipsis at a 390px-wide viewport**, for any of the
      15 slots, including the longest name in the current player set. There is a named test or a
      documented check for the longest-name case.
- [ ] The thick terminating band on the panel glow is gone. Either `Surface.css`'s `::before` layer
      fades out with no hard boundary, or it is removed. **The soft glow inside the panel border is
      retained** — the panel still reads as lit glass, not as a flat card. If the layer is removed,
      the comment explaining why replaces the one currently describing it.
- [ ] The backdrop gradient in `AppShell.css` is raised in intensity but remains ambient — no
      visible banding, no hard edge, no second focal point competing with the panels.
- [ ] **Horizontal scrolling is not possible at any viewport from 320px upward**, and the column
      does not shift off-centre. Verifiable at 320px and 390px in a build.
- [ ] `index.html`'s viewport meta includes **`viewport-fit=cover`**.
- [ ] `index.html` declares an Apple status-bar style appropriate for content extending under the
      status bar, and the existing `theme-color`, `apple-mobile-web-app-capable` and
      `apple-touch-icon` declarations are preserved.
- [ ] The safe-area padding already present on `.app-shell__column` still keeps content clear of the
      notch and the home indicator once the layout extends under them — content is not clipped, and
      the backdrop reaches the physical screen edges.

**The two additions**

- [ ] The pitch's arrival motion is deliberate: either staggered, suppressed for the pitch's panels,
      or left as-is with a one-line note in the decisions log saying it was checked and kept.
      `prefers-reduced-motion` is still respected.
- [ ] Each player's number renders through the `.num` class, tabular, with a quiet label treatment
      rather than as undifferentiated body text.

**Design constraints — grep-checkable**

- [ ] Every colour, spacing, radius and font value added or changed is a `var(--…)` token. **No raw
      hex colour and no `rgb(`/`rgba(` literal is introduced** outside `src/index.css` itself, where
      a token's own definition may legitimately change value.
- [ ] The strings `#aa3bff`, `#c084fc`, `#4ade80`, `#f87171`, `Inter`, `system-ui` and
      `-apple-system` appear nowhere in `src/`.
- [ ] **No green and no yellow.** No new hue is introduced — any new token is a tonal variation of
      the existing ink, cyan or coral.
- [ ] No emoji, no icon font, no image file is added.
- [ ] The panels still read as translucent layered material — `backdrop-filter` blur remains the
      elevation mechanism, and no panel gains an opaque background or a `box-shadow` standing in for
      elevation. *(`design-reference.md`: if surfaces render flat, the design has collapsed into the
      default and the work should be rejected.)*

**Device**

- [ ] **CANNOT VERIFY, expected:** how this reads on the installed iPhone PWA — the notch treatment,
      the glass over the gradient, and the scroll feel are all device-level. QA should say so plainly
      rather than claiming them. These are the whole point of the ticket and they are Keshav's check.
- [ ] Scope constraint: only files under `src/components/`, `src/index.css`,
      `src/screens/HomeScreen.css`, `index.html`, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. `src/screens/HomeScreen.tsx` may change
      only if a CSS class name changes with it. Nothing under `src/lib/`, `scripts/`, `supabase/` or
      `.github/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **This is a polish ticket and the polish skills apply.** That is the exception `CLAUDE.md`
  reserves them for. Read `design-reference.md` first regardless — the committed decisions there
  bind, and no skill overrides them.
- **The notch finding is a one-line fix and it is diagnosed, not guessed.** Without
  `viewport-fit=cover`, iOS Safari does not extend the layout into the safe areas, so every
  `env(safe-area-inset-*)` the app already uses evaluates to zero and the notch band paints as the
  page's flat background. `AppShell.css`'s backdrop was deliberately written with `inset: 0` — with
  a comment saying so — precisely so it would cover that area. The groundwork is done; the
  declaration is missing.
- **Adding `viewport-fit=cover` changes the layout everywhere at once.** The existing safe-area
  padding starts doing real work the moment it lands, so check the top and bottom of every screen,
  including `/squad`, not just the pitch.
- **On the glow: the aim is refraction, not a light source.** `design-reference.md`'s first
  reference is Apple Music's layered translucent surfaces — panels that read as frosted material
  floating over the base. The current layer fails because it stops abruptly; a glow that terminates
  is a shape, and a shape reads as a graphic rather than as light. **Removing it entirely is an
  acceptable outcome** if it cannot be made to fade convincingly — the fill plus blur is what
  carries the elevation, as `Surface.css`'s own comment says. Do not replace it with a `box-shadow`.
- **Raise the backdrop gradient carefully.** It is currently built from `--accent-cyan-dim` and
  `--accent-coral-dim` at low alpha. Raising alpha is the obvious lever; raising it too far turns an
  ambient wash into a decorative background, which is the opposite of the calm this screen needs.
  Small change, checked at 390px, on a dark screen.
- **Horizontal lock: fix the cause, don't just clip it.** `overflow-x: hidden` on the container will
  hide the symptom, but something is exceeding the width — most likely the pitch rows at the
  narrowest viewport. Find it, then constrain it, and use `overscroll-behavior` to stop the rubber
  banding that makes it feel like a web page. Check at 320px, not just 390px.
- **Name truncation: surname-only is the strongest option and it is the domain convention.** FPL's
  own `web_name` is already a short form. If a second line is chosen instead, the row height must
  stay uniform across all fifteen slots or the formation stops reading as a formation.
- **Do not fix a name-fit problem by shrinking the number.** The number is one of the three elements
  each player is allowed and it is the one carrying information.
- **Two other tickets are running in this batch.** One owns `scripts/` and a new workflow file, the
  other owns `scripts/` only. Neither touches `src/`. Stay inside `src/components/`, `src/index.css`,
  `src/screens/HomeScreen.css` and `index.html` and none of the three can collide.
- **What a substitute cannot catch.** A build at 320px and 390px proves the scroll lock, the
  truncation rule and the shirt's legibility. It cannot prove the notch treatment (no simulator),
  how the glass reads over the raised gradient on a real OLED panel in a dark room, or whether the
  scroll now *feels* native. All three are device-level, all three are the reason this ticket
  exists, and all three are Keshav's — in a private tab, because the PWA service worker caches CSS
  on iOS and a correct change can look absent.
