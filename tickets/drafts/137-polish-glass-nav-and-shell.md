**Type: polish.** Impeccable and emil-design-eng are allowed (CLAUDE.md design-pass rule). This ticket
also sets new visual direction for the nav, so `frontend-design` applies to the nav only.

## Why

Keshav wants the bottom nav to feel like Reddit's iOS app, only more premium. Full spec, in his words:
**`docs/ui-nav-spec-2026-09-25.md`. Read it first.** Reference frames from his screen recording are in
`docs/ui-refs/` (open the images):
- `reddit-01-full-bar-home-active.jpg`: the floating pill, 4 tabs, active tab in a darker inner pill.
- `reddit-02-…` and `reddit-03-collapsed-circle-over-content.jpg`: scrolled down, the bar has
  become one circle with the current tab's icon, bottom-left.
- `reddit-04-restoring-to-full-bar.jpg`: scrolled up, it grows back.
- `reddit-05/06/07-…`: the inner pill has moved to Games, then Inbox.
- `current-nav-bar.jpg`: today's bar, which has 3 tabs, a raised "hump" on Home, and two different
  active styles. All of that goes.

## Build

- **Four tabs:** Home `/`, **Why** `/reasoning` (new tab), Chips `/chips`, Record `/decisions`.
  Add a Why icon to `NavIcons.tsx` in the same stroke style. Keep every route.
- **Floating glass pill** with side and bottom margins, above the safe-area inset. Icon + small label.
- **Glass: glow, not frost.** Keshav rejected heavy blur. Use light blur at most, clear glass, a
  bright rim, a specular sheen and a soft outer glow in the accent colour. Where the browser supports
  `backdrop-filter: url(#svg)` with `feDisplacementMap`, add real refraction at the edges. Feature-detect it.
  As far as we know, iOS Safari (his phone) doesn't support it. **Keshav accepts that limit.** Say in
  the PR what the iPhone gets.
- **Tab switch:** the active inner pill slides and stretches to the new tab with a spring, and the new
  icon gives a small bounce. One active style for every tab.
- **Collapse on scroll:** scrolling down morphs the pill into one glass circle at bottom-left with the
  current icon. Scrolling up, or tapping the circle, morphs it back. Use a small threshold so it
  doesn't flicker.
- Transform/opacity only, 60 fps. `prefers-reduced-motion` means instant state changes, no morph. Tap
  targets ≥ 44 px, the circle included.
- **Screen titles:** `AppShell` shows a real title per route from a route→title map inside
  `AppShell` (Home, Why, Chips, Record, Squad, Override), using `useLocation`. Screens are not edited.
  Style it as a confident large title that fades or shrinks under the status bar on scroll (fixes audit
  G8: the header blob sitting under the clock).
- **One card style:** `Surface` and the tokens in `index.css` define one card material plus one
  emphasis variant (audit G2). Today's near-black second style goes. Screens are not edited. They
  inherit through `Surface`.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean. Update `AppBar.test.ts`, `AppShell.test.ts`,
  `Surface.test.ts` for the new behaviour.
- A test for the scroll-direction → collapsed/expanded state logic (pure function, with a threshold).
- The PR packet includes a short screen recording or GIF from the Vercel preview on a narrow viewport:
  tab switching, collapse and restore.

## Post-merge owner check (does not block this PR)

Keshav tries it on his iPhone. **Not a gate.**

## Files

Edit: `src/components/AppBar.tsx` + `.css` + `AppBar.test.ts`, `src/components/NavIcons.tsx`,
`src/components/AppShell.tsx` + `.css` + `AppShell.test.ts`, `src/components/Surface.tsx` + `.css` +
`Surface.test.ts`, `src/index.css`, `src/App.tsx` (only if the bar's mount point must change).
**Not** any file in `src/screens/`, and not `AccuracyCard`, `MiniLeagueCard`, `Pitch*`, `PlayerShirt*`
or `VerdictCard*` (other tickets tonight).
