## Context

Feature-list item 1, and the ticket that establishes visual direction for the whole app per
`design-reference.md`. Today `src/App.tsx` renders a Supabase connectivity-check page from Phase 3,
and `src/index.css` / `src/App.css` are unedited Vite template styling — light-first, `system-ui`
fonts, and carrying the exact tokens `design-reference.md` bans (`#aa3bff`, `#c084fc`, `#4ade80`,
`#f87171`). This ticket replaces all of it with the dark-only token layer and app shell that every
later screen is built on. No dependencies.

## Scope

**In scope:**

- Remove the Supabase connectivity-check UI from `src/App.tsx`. `src/lib/supabase.ts` stays on disk,
  unchanged.
- Replace `src/index.css` and `src/App.css` with a dark-only design-token layer: base surface
  `#0b0f19`, elevation via translucent layered surfaces (tonal lift plus `backdrop-filter: blur`),
  a cool blue-cyan accent for positive/recommended, a coral accent for risk/warning.
- Self-host Geist and Geist Mono via the `@fontsource-variable` packages. Interface text in Geist;
  all numerals in Geist Mono with tabular figures.
- A reusable numeric token/class that carries `font-variant-numeric: tabular-nums`, so countdowns
  and prices do not jitter as they tick.
- An app shell: iPhone-first single column, iOS safe-area aware, that later screens render inside.
- At least one elevated surface component demonstrating the translucent-material treatment, used on
  a minimal placeholder home surface.
- Invoke the `frontend-design` skill. This is the one ticket in the first wave that establishes new
  visual direction, per the design-pass rule in `CLAUDE.md`.

**Explicitly out of scope:**

- **Does not add any new stored data.** No Supabase queries, no fetching, no new tables, no new
  personal-data field.
- No routing and no second screen — the router arrives with the squad-entry ticket (#13).
- No real home-screen content. The deadline countdown, verdict card and pitch view are items 16–18
  in `feature-list.md` and are separate, later tickets. The placeholder surface exists only to prove
  the tokens render.
- No light theme, no theme toggle, no `prefers-color-scheme: light` handling. Dark only, per
  `design-reference.md`.
- No changes to `index.html` or `vite.config.ts`. Their `theme_color` / `background_color` / Apple
  meta tags are already `#0b0f19` and correct — ticket #6 landed that.
- No changes to `public/` icons.
- Do not invoke Impeccable or emil-design-eng. Those are confined to polish tickets (§5.4).

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` are in `package.json`
      dependencies, and the built `dist/` serves their `.woff2` files from the app's own origin.
- [ ] No runtime request to a third-party font host: the strings `fonts.googleapis.com`,
      `fonts.gstatic.com` and `cdn.jsdelivr.net` appear nowhere in `src/` or `dist/`.
- [ ] The string `Inter` appears nowhere in `src/` or `dist/`.
- [ ] `src/index.css` and `src/App.css` contain none of these strings: `#aa3bff`, `#c084fc`,
      `#4ade80`, `#f87171`, `system-ui`, `1126px`, `color-scheme: light dark`.
- [ ] No `@media (prefers-color-scheme: light)` block anywhere in `src/`.
- [ ] Body text resolves to the `Geist Variable` family and the numeric class resolves to the
      `Geist Mono Variable` family, verified from the compiled CSS.
- [ ] The numeric class declares `font-variant-numeric: tabular-nums`.
- [ ] At least one component's elevation is produced by a translucent background colour plus
      `backdrop-filter: blur(...)`. No card in the new CSS gets its elevation from a `1px` border
      alone or from a drop shadow alone.
- [ ] The page background computes to `#0b0f19`.
- [ ] The shell applies `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- [ ] Any transition introduced is disabled under `@media (prefers-reduced-motion: reduce)`.
- [ ] The words "Supabase", "connectivity" and "scaffold" no longer appear in rendered UI text.
- [ ] `src/lib/supabase.ts` is byte-identical to `main`.
- [ ] Scope constraint: the only files changed are `src/App.tsx`, `src/App.css`, `src/index.css`,
      `package.json`, `package-lock.json`, plus new files under `src/`. `index.html`,
      `vite.config.ts`, `src/lib/supabase.ts` and everything under `public/` are untouched.
- [ ] Renders correctly on the installed iPhone PWA. *(Device-level — expect CANNOT VERIFY.)*

## Notes for the Analyst / Builder

**Open question 1 in `product-brief.md` §9 is resolved — Geist is cleared, no fallback needed.**
Verified 11 Aug 2026 against `github.com/vercel/geist-font/blob/main/LICENSE.txt`: Geist is released
under the **SIL Open Font License 1.1**, which permits self-hosting, bundling and redistribution
provided the licence and copyright notice travel with it. The only restriction is that the font may
not be sold by itself, which does not apply here.

Delivery, also verified 11 Aug 2026:

- `@fontsource-variable/geist@^5.3.0` and `@fontsource-variable/geist-mono@^5.3.0`, both published
  as `OFL-1.1`.
- Import `@fontsource-variable/geist/wght.css` and `@fontsource-variable/geist-mono/wght.css` — the
  roman-only files. Skip `wght-italic.css`; this app needs no italics and it doubles the payload.
- The CSS family names are exactly `'Geist Variable'` and `'Geist Mono Variable'`. Using `'Geist'`
  will silently fall through to the fallback stack.
- Both ship variable `woff2` with `font-weight: 100 900`, so one file covers every weight.
- Keep the licence file that ships in each package; do not strip `node_modules` licence text.

Other pre-answers:

- Adding two font packages is a **Tier 3** asset decision, not a Tier 2 framework choice. Decided
  here. Do not escalate.
- The exact accent hex values are yours, inside the constraint: a cool blue-cyan for
  positive/recommended, a coral for risk/warning. **No green, no yellow, no purple** — all three are
  explicitly excluded by the owner. Record the chosen values in `decisions.md` as Tier 3 with the
  because, so later tickets have something to match.
- `design-reference.md` warns that "dark base plus one bright accent" is itself one of the three
  default AI looks. What makes this a decision rather than a default is the translucent layered
  material and the tabular mono figures. If surfaces render as flat bordered cards, the ticket has
  not met its intent even if every checkbox passes.
- Do not add a router, a state library, a CSS framework or a component library. Any of those would
  be a Tier 2 choice and none is needed for this ticket.
