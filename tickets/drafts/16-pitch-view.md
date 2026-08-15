## Context

Feature-list item 16 — the first item in wave 4, the app surface. Depends on #8 (app shell, design
tokens, `Surface`) and #13 (`squads` / `squad_picks`, `src/lib/squad/`, routing) — both merged.
Depends on nothing in items 10–15 and is not depended on by them.

`product-brief.md` §1: the home screen, opened on an iPhone on a Thursday evening, is **the one
screen that matters most**. It shows, in order, a thin deadline countdown, the recommended actions,
and the current squad as a pitch. This ticket builds the third of those three. The countdown is item
18 and the verdict card is item 17; both are separate tickets and neither is anticipated here.

`design-reference.md` is explicit that the pitch is a **domain form, not a generic dashboard grid** —
it is named as one of the five things that make this app's execution a decision rather than a
default. It is also the one convention worth keeping from the official FPL app, which is otherwise
the anti-reference.

**This ticket establishes new visual direction** — it is the first real domain surface in the app,
and the `frontend-design` skill applies per `CLAUDE.md`'s design-pass rule. `design-reference.md` is
read regardless. Impeccable and `emil-design-eng` do **not** apply — this is not a polish ticket.

## Scope

**In scope:**

- A `Pitch` component under `src/components/`, rendering a 15-man squad as a formation: the starting
  XI laid out by position row, the four bench players separated below.
- A `PlayerShirt` (or equivalently named) child component: **shirt, name, and exactly one
  contextual number.** Nothing else.
- Availability rings on the shirt: solid coral for out or suspended, hollow coral for doubtful,
  nothing at all for available.
- Reading the current gameweek's squad from Supabase, reusing `fetchTargetGameweek` and
  `fetchExistingSquad` from `src/lib/squad/api.ts` rather than writing new query functions.
- Rendering the pitch on the home screen, below the existing mark, replacing the
  `home-demo` design-token placeholder panel that #8 left there.
- Loading, empty and error states.
- Vitest tests for any pure layout/derivation helper the component needs.

**Explicitly out of scope:**

- **No deadline countdown.** Item 18.
- **No verdict card, no recommendation, no projected points, no captain suggestion.** Items 13
  and 17. The pitch shows the squad as it *is*, not as it should be.
- **No reading of `player_projections`.** That table exists and is populated; it is item 17's input,
  not this ticket's. Do not surface a projection anywhere on this screen.
- **No tap-through, no player detail screen, no modal, no reasoning screen.** Item 21.
- **No editing.** No drag to reorder, no captain toggle, no substitution, no transfer. Editing lives
  at `/squad` and stays there.
- **No new stored data. No writes of any kind.** This screen only reads.
- **No new database table, no migration, no change to anything under `supabase/`.**
- **No changes to `scripts/`, `.github/workflows/`, `src/lib/scoring/` or `src/lib/projection/`.**
  Another ticket may be running in the same batch and owns `scripts/` and the workflow file.
- No club crests, no team colour fills, no green pitch texture, no celebratory graphics — see the
  anti-reference in `design-reference.md`.
- No new dependency. No component library, no animation library, no icon pack.
- No light theme, no theme toggle.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] No new entry in `package.json` `dependencies` or `devDependencies`.

**Layout and data**

- [ ] The starting XI renders in formation rows: goalkeeper, defenders, midfielders, forwards, in
      that vertical order. The number in each row follows the actual saved squad, not a fixed
      assumption — a 3-4-3 and a 5-3-2 both render correctly, and there is a named test for each.
- [ ] The four bench players render in a visually separate group below the pitch, **in
      `bench_order` 1–4**, lowest first. A bench player is never mixed into a formation row.
- [ ] Position codes, squad-slot ranges and formation bounds come from `src/lib/squad/positions.ts`.
      The literals `1`, `2`, `3`, `4` are not used as position codes anywhere in the new components,
      and `SQUAD_SIZE`, `STARTING_XI_SIZE` and `BENCH_SIZE` are not re-declared. Verifiable by
      search.
- [ ] The squad is read via `fetchTargetGameweek` and `fetchExistingSquad` from
      `src/lib/squad/api.ts`. The new components contain no `supabase.from(` call of their own.
      Verifiable by search.
- [ ] Each player shows exactly **three** things: shirt, name, and one number. There is no fourth
      element per player — no position label, no team badge, no second figure.
- [ ] The one contextual number is **price**, formatted by `formatMoney` from `src/lib/format.ts`,
      and rendered through the `.num` class so it is tabular Geist Mono.
- [ ] The captain and vice-captain are marked distinguishably from each other and from every other
      player, without adding a fourth element per player.

**Availability rings**

- [ ] `players.status` and `players.chance_of_playing_next_round` drive the ring: `'i'`, `'s'`,
      `'u'` render a **solid** coral ring; `'d'`, or any non-null chance below 100, renders a
      **hollow** coral ring; `'a'` with no chance renders **no ring**. There is a named test per
      case.
- [ ] The ring is the only availability indicator. No icon, no flag graphic, no emoji, no text
      badge. The strings for any emoji character do not appear in the new files.
- [ ] Ring state is conveyed to assistive technology by text, not by colour alone — an
      `aria-label` or visually-hidden string naming the status.

**States**

- [ ] **No squad saved for the target gameweek** renders an invitation to act, not a shrug: it names
      what is missing and links to `/squad`. It does not render an empty pitch outline.
- [ ] **Loading** renders a stable placeholder that does not shift layout when data arrives.
- [ ] **A failed read** renders a message that says what happened and what to do, per
      `design-reference.md`'s interface-writing rules. The words "Something went wrong", "Oops" and
      "Sorry" appear nowhere in the new files. Verifiable by search.
- [ ] **A saved squad with fewer than 15 picks** renders the picks that exist rather than crashing,
      and says plainly that the squad is incomplete.
- [ ] Supabase not being configured is handled the same way the existing screens handle it — the
      screen does not throw an unhandled error.

**Design constraints — grep-checkable**

- [ ] Every panel is built from the existing `Surface` component. The new CSS declares no
      `background` on a panel-level element that bypasses `--panel-fill`, and adds no `box-shadow`
      as an elevation mechanism.
- [ ] Every colour, spacing, radius, and font value in the new CSS is a `var(--…)` token from
      `src/index.css`. **No raw hex colour, no `rgb(`/`rgba(` literal, and no `px` spacing value
      outside a border width, appears in the new CSS.** Verifiable by search.
- [ ] The strings `#aa3bff`, `#c084fc`, `#4ade80`, `#f87171`, `Inter`, `system-ui` and
      `-apple-system` appear nowhere in `src/`.
- [ ] No green and no yellow is introduced. No new colour token is added to `src/index.css` — the
      shirt fill is a tonal lift of the existing surface tokens, not a new hue.
- [ ] `prefers-reduced-motion` is respected by any transition the pitch introduces.
- [ ] The home screen's `home-demo` design-token placeholder panel from #8 is **removed**, and the
      strings `home-demo` and `Design tokens` appear nowhere in `src/`.

**Device**

- [ ] The pitch is legible and does not overflow horizontally at a 390px-wide viewport. *(A Builder
      and QA can verify this at that viewport in a build; the installed-PWA check is Keshav's, and
      will come back CANNOT VERIFY.)*
- [ ] **CANNOT VERIFY, expected:** appearance on the installed iPhone PWA. QA should say so plainly
      rather than claiming it.
- [ ] Scope constraint: only new files under `src/components/`, changes to
      `src/screens/HomeScreen.tsx` and `src/screens/HomeScreen.css`, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/lib/`, `scripts/`,
      `supabase/` or `.github/` changes; `src/index.css` gains no new token; `package.json` is
      untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **The one contextual number is price, and that is a deliberate placeholder.** It becomes projected
  points once item 17 lands, and the component should make that swap a one-line change — but **do
  not read `player_projections` in this ticket.** Showing a projection here, before the confidence
  rules in `product-brief.md` §8 exist in the UI, would put a bare number on screen with no band and
  no reasoning behind it, which that section explicitly forbids. Price is honest, useful, and
  already formatted.
- **No decimals on any projected-points value, ever, anywhere in the recommendation UI**
  (`product-brief.md` §8). Price is exempt — it is an in-game currency, Tier 3, and `£8.5m` with one
  decimal is its correct format per §8's money rule. Do not "fix" the price to a whole number.
- **The pitch must not look like the FPL app.** `design-reference.md` names it the anti-reference.
  No green pitch texture, no club crests, no saturated team colours, no gradients suggesting turf.
  The shirt is an abstract shape in the app's own neutral palette with a tonal lift — think team
  sheet, not broadcast graphic.
- **Read the "three looks AI design defaults to" section of `design-reference.md` before starting.**
  Look two — near-black background with a single bright accent — is the one this app is adjacent to,
  and the file is explicit that we are not exempt just because the accent is cyan. What makes this a
  decision rather than a default is the translucent layered material, the tabular mono figures, and
  the pitch being a domain form. If the panels render flat, the design has collapsed into the
  default and the work should be rejected.
- **Reuse `Surface`. Do not build a second card component.** It already carries the fill, the blur,
  the hairline and the ambient cyan wash, and it forwards standard div attributes.
- **The formation is derived, not stored.** `squad_picks` carries `is_starting` and `bench_order`;
  the number of defenders, midfielders and forwards in the XI falls out of counting the starters by
  `players.element_type`. `FORMATION_BOUNDS` in `positions.ts` says which shapes are legal — use it
  to validate what you render, not to assume a shape.
- **`squad_position` is not formation position.** Slots 1–15 are fixed position blocks (1–2 GK, 3–7
  DEF, 8–12 MID, 13–15 FWD) so the database's primary key is stable. Which of those players start is
  `is_starting`. Do not lay the pitch out by `squad_position`.
- **There may be no squad saved at all when this is reviewed**, and that is the state the empty
  path exists for. Do not treat it as a failure, and do not seed placeholder players to make the
  screen look populated.
- **Availability data lives on `players`, not on `squad_picks`.** `fetchExistingSquad` returns the
  picks; the status fields come from the players read. If joining them needs a small addition to
  `src/lib/squad/api.ts`, that is out of this ticket's scope constraint — prefer composing the two
  existing reads in the component. If that genuinely cannot work, that is a real finding: report it
  rather than widening the scope silently, and see `deltas.md` D10 for why this ticket lists its
  files the way it does.
- **A ticket running alongside this one owns `scripts/` and `.github/workflows/`.** Stay inside
  `src/components/` and `src/screens/` and the two cannot collide.
- **What a substitute cannot catch.** A build at a 390px viewport proves layout and legibility. It
  cannot prove how the frosted material reads on a real OLED iPhone in a dark room, which is the
  entire creative premise, and it cannot prove the installed PWA picked up the new CSS — the service
  worker caches it on iOS. Both are Keshav's checks, in a private tab.
