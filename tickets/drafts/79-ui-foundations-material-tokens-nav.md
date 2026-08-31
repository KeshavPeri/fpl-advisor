## Context

**Run this one manually, now. Three other tickets depend on the tokens it defines.**

`docs/ui-audit-2026-08-31.md` (31 Aug 2026) audited every UI file against `docs/my-ui-problems.md`,
`design-reference.md` and the installed design skills. It produced 51 numbered findings and a verdict
backed by measured contrast ratios rather than opinion:

- `--panel-fill` over `--surface-0`: **1.079:1**
- `--panel-border` over `--panel-fill`: **1.260:1**
- the decorative `.surface::before` glow over the fill: **1.380:1**

**The elevation is the least visible thing on a panel and the border is the most** — the exact
inversion of what `design-reference.md` commits to, and the mechanical definition of the failure
mode it names and rejects ("a dark page with flat cards and a bright accent").

Two consequences the audit proves and this ticket acts on:

1. **`backdrop-filter: blur(22px)` is doing nothing on all 60 panels.** Every panel's backdrop is
   `app-shell__backdrop`, a smooth gradient; blurring a smooth gradient returns the same gradient.
   Panels never overlap and nothing scrolls behind them. **The floating navigation bar is the only
   surface in this app where blur can ever do visible work** — which is why F17 sits in this ticket
   and not a later one. It resolves P2, P3 and P10 together (audit F13, F17).
2. **`.num` is defeated on 13 of the app's 14 combined-class numbers.** The `font:` shorthand resets
   `font-family` and `font-variant-numeric`; specificity is equal, so source order decides, and every
   component stylesheet loads after `index.css`. Verified in the built bundle. **The app's most
   important number renders in Geist Sans, non-tabular** — a hard constraint in `design-reference.md`
   broken since tokens shipped (audit F1).

The audit's own verdict on scale: *"the distance from here to the brief is about forty CSS values
and one component — not a redesign."* This ticket is the tokens, the material and the component. A
follow-up applies them to every screen.

**Read `docs/ui-audit-2026-08-31.md` before writing any code.** It carries the exact current value
and the exact proposed value for every finding below. Do not re-derive them.

## Scope

**In scope — audit findings F1, F2, F3, F5, F6, F7, F8, F10, F11, F12, F13, F14, F15, F16, F17,
F18, F19, F20, F51, plus Part 3's "Consolidation" section:**

- **The constraint defects** — F1 (`.num` defeated), F2 (`--text-tertiary` fails WCAG AA), F3 (every
  link underlined), F51 (`mobile-web-app-capable`). **F1's fix must live in `src/index.css`**, by
  specificity or by ordering — not by editing 13 component stylesheets, which the follow-up ticket
  owns.
- **A real elevation scale** — F5, F7, F10, F12, F15, F16. At least three materially distinct levels,
  a radius scale rather than one radius, a type step between 17px and 36px, the glow removed from
  every panel, and the `raised` prop made real.
- **The material** — F13, F14. Blur that has something to blur, and a light-catching edge.
- **The floating navigation bar** — F17. A new component plus whatever `src/App.tsx` needs to render
  it. Deciding which of the six routes are top-level is part of the work; the audit proposes a set.
- **The shell** — F18, F19, F20. Vertical rhythm that varies by screen, a wash that responds, and a
  documented way for a child to break out of the column (the follow-up's full-bleed pitch depends on
  this existing).
- **Motion tokens and consolidation** — F6, F8, F11. Delete `surface-arrive`, fix the backwards
  letter-spacing, gentle rather than destroy `prefers-reduced-motion`, and introduce
  `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--dur-press: 160ms`, `--dur-enter: 200ms`,
  `--dur-state: 220ms`, `--dur-ambient: 600ms` as tokens.

**Explicitly out of scope:**

- **Every screen and every panel component.** `DeadlineCountdown`, `Pitch`, `PlayerShirt`,
  `VerdictCard`, `AccuracyCard` and everything under `src/screens/` belong to the follow-up ticket,
  which consumes what this one defines. **Do not start applying the new tokens to them.**
- **F9 (`prefers-reduced-transparency`) and every finding marked optional.** Not this ticket.
- **Any change to `src/lib/`, `scripts/`, `supabase/` or `.github/`.**
- **No new dependency.** No animation library, no UI library, no CSS framework.
- **No light mode, no theme toggle, no change to `#0b0f19`, no green, no yellow, no purple, no
  Inter.** See `docs/my-ui-problems.md`'s constraints section.
- **No content or copy changes.** Wording is the follow-up's.

## Definition of done

- [ ] Every finding listed in Scope is addressed, each with a comment citing its finding number.
- [ ] **Grep-checkable:** no element carrying `.num` has its font family or numeric variant
      overridden by a later rule. A test or a build-output check proves the app's projected-points
      figure resolves to Geist Mono with `tabular-nums`. **This is the most important item here.**
- [ ] `--text-tertiary` meets WCAG AA at its smallest used size, with the computed ratio in the
      comment.
- [ ] No link in the built stylesheet renders underlined by default.
- [ ] The elevation scale has at least three levels, and **each adjacent pair is more visible than
      the border between them.** The decisions file states the computed contrast ratio for every
      boundary — the same measurement the audit used, so the before/after is directly comparable.
- [ ] `surface-arrive` is deleted. No panel animates on arrival.
- [ ] The navigation bar is a distinct component, floats above content, respects
      `env(safe-area-inset-bottom)`, and is reachable from every route it links to.
- [ ] `prefers-reduced-motion` gentles motion rather than removing feedback entirely (F8).
- [ ] The five motion tokens exist and every duration and easing in the files this ticket touches
      uses them. No hand-typed cubic-bezier survives in those files.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch, and it is most of the value here.** Whether the blur reads as
      glass or as fog, whether the bar clears the home indicator, whether it holds 60fps over a
      scrolling pitch, and whether the new elevation is visible at arm's length in a dark room are
      all device judgements — see the audit's Part 4. **These come back as CANNOT VERIFY and land on
      Keshav's own list.** The build-level check is that the tokens exist, the ratios are computed and
      recorded, and nothing regressed.
- [ ] **What will NOT change:** every screen still looks largely as it does today, because this
      ticket defines the system and does not apply it. **The pitch is still squashed, the accuracy
      card is still ugly and the countdown is still a caption after this merges.** That is correct.
      The follow-up ticket fixes them.

## Notes for the Analyst / Builder

**The audit is the specification. Read it first and cite finding numbers everywhere** — in code
comments, in the decisions file, in the PR body. Its numbers were computed, not estimated; do not
substitute your own values for its proposed ones without saying why.

**Why the navigation bar is in the foundations ticket and not the UI ticket.** It is the only surface
in the app with live content passing behind it, so it is the only place `backdrop-filter` can be
proven to work. Building the material without it means shipping a material nobody can see. The audit
calls this the highest-leverage change in the document and it belongs with the material it
demonstrates.

**Leave `Pitch.css`'s `animation-delay: 90ms` alone.** Deleting `surface-arrive` makes that rule
inert. `Pitch.css` belongs to the follow-up ticket, which removes the dead rule. One day of harmless
dead CSS is cheaper than two tickets touching one file.

**This is Tier 2** — a design-token and material system is expensive to reverse once nine screens
consume it. Log it as HIGH-IMPACT with its *because*, and record the before/after contrast ratios.

**`design-reference.md` may need updating after this**, since it currently describes intent that the
code did not deliver. **Do not update it in this ticket** — note in the decisions file that it should
be re-run through `/impeccable document` once the follow-up has landed and real tokens exist.

**Run alone, manually, and merge before tonight's scheduled run.** Three tickets in that run assume
this is on the default branch.

## Scope constraint

Nothing outside the following files changes:

- `src/index.css`
- `src/components/Surface.tsx`, `src/components/Surface.css`
- `src/components/AppShell.tsx`, `src/components/AppShell.css`
- One new navigation component and its stylesheet, under `src/components/`
- `src/App.tsx`
- `index.html`
- The matching `*.test.ts` beside any of the above, and `decisions/ticket-<this issue number>.md`

Nothing under `src/screens/`, `src/lib/`, `scripts/`, `supabase/`, `docs/` or `.github/` changes, and
no other file under `src/components/` changes — `DeadlineCountdown`, `Pitch`, `PlayerShirt`,
`VerdictCard`, `AccuracyCard` and `PitchSkeleton` all belong to the follow-up ticket. No dependency
is added, removed or upgraded.
