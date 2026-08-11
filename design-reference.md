v1.0 — written 10 Aug 2026 in the Phase 1 design workshop. Replaces the generic copy inherited
from `app-factory/assets`, which referenced a fitness planner and had nothing to do with this
app.

# Design reference — FPL Advisor

Per §5.3 of the system design: a design skill supplies heuristics, not taste. This file is what
tells the Builder what *this specific app* should look like. The Builder reads it on every
normal ticket.

---

## Creative north star

**"The late-night team sheet."**

Opened on an iPhone on a Thursday evening, often after 11pm, to answer one question and then be
put down. Dark, calm, confident, quiet. Closer to a well-kept team sheet than to a consumer
sports app. Nothing shouts. The recommendation is the loudest thing on the screen, and it isn't
loud — it's just the only thing that matters.

**Dark only.** Not dark mode, not a toggle. There is no light theme and no ticket should add
one.

---

## References

Five, each with one thing to take. Take that thing; do not import the whole product.

1. **Apple Music (iOS, dark)** — take the **layered translucent surfaces**. Elevated panels
   read as frosted material floating over the base, not as bordered boxes sitting on it. This
   is the single strongest signal separating this app from a default component-library build.
   Also take its willingness to let large type carry hierarchy without dividers.

2. **Revolut (iOS, dark)** — take the **treatment of a single important number**: large,
   tabular, generously spaced, with a small quiet label, on a card that does nothing else. This
   is the model for the deadline countdown and for projected points on the verdict card. Also
   take its colour restraint — a mostly neutral surface where accent appears only when it means
   something.

3. **Apple Weather (iOS)** — take the **at-a-glance hierarchy for live-changing values**. One
   dominant figure, supporting values arranged around it, no chrome competing for attention.
   Relevant specifically to the home screen, where the countdown and the verdict must both be
   readable in under two seconds.

4. **Linear (linear.app)** — take the **information density of the reasoning screen only**.
   Linear communicates a great deal of state using weight, alignment and restrained colour
   rather than extra UI. The reasoning screen is the one place in this app where density is
   correct; the home screen must stay calm.

5. **The official FPL app** — the **anti-reference**. Keshav uses it and will compare directly.
   Diverge deliberately: no club crests as decoration, no saturated team colours, no green
   pitch texture, no celebratory graphics. Where FPL is busy and bright, this is quiet and
   dark. The pitch layout is the one convention worth keeping, because it is genuinely the
   fastest way to read a squad's shape.

---

## Committed decisions

These bind. Anything not listed is a Tier 3 judgement for the Builder.

### Colour

- **Base surface:** `#0b0f19` — Deep Ink. The existing anchor, retained. All neutrals derive
  from it; do not introduce an unrelated base.
- **Elevation** is achieved through **translucent layered surfaces** — tonal lift plus blur —
  not through heavy drop shadows and not through 1px borders on every card.
- **Accent, positive / recommended action:** a cool blue-cyan.
- **Accent, risk / warning / injury:** coral. Warmer and calmer than pure red, and legible on
  dark.
- **No green. No yellow.** Explicitly excluded by the owner. This rules out the default
  sports-app "good is green, bad is red" convention — use blue-cyan for good, coral for bad.
- **Never** the Vite template purple (`#aa3bff` / `#c084fc`) or the template green/red
  (`#4ade80` / `#f87171`). These are unedited scaffold defaults, not decisions.

### Typography

- **Geist** for interface text, **Geist Mono** for all numbers — prices, projected points,
  countdowns, accuracy figures.
- **Mono figures must be tabular**, so numbers do not jitter as a countdown ticks or a price
  updates.
- **Explicitly not Inter.** Inter is the single strongest visual tell of AI-generated interface
  work, and avoiding it is a stated requirement.
- Hierarchy is carried by **size and weight, not by borders and rules.**
- Pending confirmation of Geist's licensing and self-hosting (open question 1 in
  `product-brief.md`). If it fails, substitute a named alternative — not Inter, and not the
  system stack by default.

### Layout

- **Home screen order:** thin deadline countdown, then the verdict, then the squad as a pitch.
  The decision is reachable without scrolling.
- **The countdown is understated by default and escalates inside 24 hours** — larger, accented,
  more present. It should feel like the app leaning forward, not like an alarm.
- **Squad is a pitch layout**, not a list. Bench sits visually separated below the pitch, which
  the formation naturally provides.
- **Per player on the pitch:** shirt, name, and one contextual number. Everything else is a tap
  away. Resist adding a fourth element.
- **Injuries and suspensions:** a coloured ring on the shirt — solid coral for out or
  suspended, hollow coral for doubtful. No icons, no flag graphics, no emoji.
- **Reasoning lives on its own screen**, with a one-line summary on the verdict card so a bare
  number is never the whole story.

### Motion

- Motion is for **orientation and state change**, never decoration. Screen transitions and the
  commit action earn animation; nothing else does.
- Respect `prefers-reduced-motion`.
- Per §5.4 of the system design, the animation skills are confined to designated polish
  tickets. Do not reach for them on a normal ticket.

### Interaction

- **One tap to commit each recommendation**, individually. No "accept all".
- **Registering an override carries deliberate friction** — a confirm step that shows what the
  model expected and what it is being overridden with. The friction is the feature; it makes
  the ledger entry meaningful.

---

## What "not generic AI output" means here, concretely

Checkable items. A reviewer should be able to say yes or no to each.

- **No Inter**, and no unmodified system-font stack standing in as a decision.
- **No centred-card-on-gradient-background** as a layout.
- **No emoji used as icons**, anywhere, including in Telegram notifications.
- **No unmodified shadcn or Tailwind default spacing, radius or colour tokens.** If a token is
  the library default, it must be that way because someone chose it.
- **No purple.** The scaffold's Vite purple is not a brand colour.
- **No decimal projected-points values in the recommendation UI** — see the confidence rule in
  `product-brief.md` §8. This is a design constraint as much as a product one; false precision
  is a visual lie.
- **No "AI" framing in the interface** — no sparkle icons, no "AI suggests", no chat bubbles.
  It is a model, and it should present as an instrument.
- Every typography and spacing decision should be traceable to one of the five references
  above, not to whatever the model reached for first.

### The three looks AI design currently defaults to — all banned

Named in Anthropic's own `frontend-design` skill as the clusters AI-generated design falls into
regardless of subject:

1. **Warm cream background (near `#F4F1EA`), high-contrast serif display, terracotta accent.**
2. **Near-black background with a single bright acid-green or vermilion accent.**
3. **Broadsheet layout — hairline rules, zero border-radius, dense newspaper columns.**

**Read number two carefully, because this app is adjacent to it.** A dark base with one accent
*is* the default. We are not exempt just because we picked cyan instead of acid green.

What makes this app's direction a choice rather than a default lives entirely in the execution,
which means **the execution is not optional**:

- **Translucent layered materials** with blur and tonal lift — not flat cards with 1px borders.
  This is the primary differentiator. If surfaces render flat, the design has collapsed into
  default two.
- **Geist and Geist Mono**, not a serif display and not Inter.
- **Tabular mono figures** for every number.
- **Pitch layout** for the squad — a domain form, not a generic dashboard grid.
- **Coral, not vermilion; cyan, not acid green.** Calmer, lower chroma, no neon.

A Builder that produces a dark page with flat cards and a bright accent has produced the
default, not the brief. That is a valid reason to reject the work.

## Interface writing

Copy is design material. These are rules, not suggestions.

- **Errors never apologise and are never vague.** Say what happened and what to do about it.
  "The registered squad doesn't reconcile with FPL — re-check your last transfer" beats
  "Something went wrong."
- **An action keeps the same name through the whole flow.** A button that says *Commit*
  produces a confirmation that says *Committed*. Never *Submit*.
- **An empty state is an invitation to act, not a mood.** The week where the recommendation is
  "roll your transfer" is not an empty state — it is a real answer and should read as a
  confident one, not as the app having nothing to say.
- **Name things by what Keshav controls**, in FPL's own vocabulary — gameweek, fixture, clean
  sheet, bench boost. Never by how the system is built.
- **Sentence case, plain verbs, no filler.** Each element does exactly one job.

---

## Superseding `DESIGN.md`

`DESIGN.md` is an Impeccable seed that predates any built feature and commits only to
`#0b0f19`. This file now supplies typography, accent, elevation and layout direction. Once the
first real surface exists — most likely the home screen — re-run `/impeccable document` so
`DESIGN.md` reflects real tokens and components, and treat its current placeholders as
resolved by this file in the meantime.
