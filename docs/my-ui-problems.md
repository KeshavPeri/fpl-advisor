Written 31 Aug 2026 by Keshav, articulated with the orchestrator. This is the OWNER'S brief for the
UI/UX polish pass — first-class input to `docs/ui-audit-2026-08-31.md`, not background context.

# What's wrong with this app's interface

## STATUS, 3 September 2026 — round two shipped and Keshav is still not satisfied

`#195` ("UI polish round two") merged on 3 Sep. It was written from this file plus a fresh round
of the owner's feedback and his own device screenshots, and it covered: the material regression
(fills lightened by `#171`, blur removed), four rendering faults (content under the iOS status
bar, a sticky action row, content under the nav bar, mid-word hyphenation of player names), the
nav bar's shape and type, the verdict card's buttons, the pitch and bench proportions, the chips
and record screens, and an animation pass.

**Keshav has reviewed the result and still has UI problems with it. He has not yet listed them.**

This is the standing item to raise the next time there are not three good tickets in the backlog
— which is his own standing instruction, recorded in the orchestrator handover. **Ask him to
list what is still wrong before writing anything**, and add it to this file in his words, the way
P1–P11 below were captured. Do not write a third UI ticket from the audit or from this file
alone: two rounds have now shipped against them and the gap that remains is one only he can
describe.


## How to use this file

Every numbered item below is a real complaint from using the app, restated precisely and traced to
the code where I could find the cause. **Address every one explicitly** — confirm it, name the
mechanism, propose an exact fix, or say plainly that you disagree and why. The "Direction" lines are
starting points, not decisions; a better answer that respects the constraints is welcome.

**The one-line summary of the whole brief:** the app currently reads as a *default dark-mode
component library*, not as a decision. `design-reference.md` predicted this exact failure mode — see
its "three looks AI design currently defaults to", number two — and warned that avoiding it lives
"entirely in the execution". The execution has not happened yet.

## What I like — do not break these

- **The ambient background wash.** It is the single best thing in the app. Keep it, and consider
  making more of it rather than less.
- **The pitch as a concept.** The idea is right. The rendering is not (P5).
- **No green, no yellow, dark only.** These stay.

---

## P1 — The whole thing looks like AI output. Specifically, like AI-generated slides.

**What it actually is.** Every panel in the app is the same `Surface` component, at the same
elevation, with the same radius, the same padding and the same gap between it and the next one.
Screens are a single centred column of identically-weighted rectangles stacked top to bottom. That
uniform rhythm — same box, same spacing, same emphasis, over and over — is exactly what makes an
AI-generated slide deck look like one.

**Why it happens.** The design system has **one surface and one rhythm**, and it is applied
everywhere without hierarchy. `design-reference.md` asks for "layered translucent surfaces — tonal
lift plus blur — not flat cards with 1px borders", and for hierarchy carried by "size and weight,
not by borders and rules". Right now every element is the same size and the same weight.

**Direction.** Establish a real elevation scale — at least three distinct material levels with
genuinely different blur, tint and tonal lift — and make the most important thing on each screen
visibly dominant. One element per screen should be unmistakably the loudest. Nothing else should
compete with it.

---

## P2 — I want a liquid-glass, premium feel

**What I mean.** Apple's current material language: real translucency with background blur, content
you can sense behind the panel, edges that catch light, depth that responds to what's underneath it
rather than sitting flatly on top.

**This is not a change of direction.** `design-reference.md` already commits to "layered translucent
surfaces … tonal lift plus blur" and names Apple Music's frosted material as the single strongest
signal separating this app from a default component build. **Liquid glass is that commitment,
executed properly.** No Tier 2 decision is needed — this is the brief already written down, not yet
delivered.

**Direction.** Audit whether `backdrop-filter` is actually doing anything visible over the ambient
wash today, and whether the surfaces read as material or as flat translucent rectangles. If they
read flat, that is the highest-severity finding in the whole audit — the brief says so in as many
words.

---

## P3 — Navigation is a pile of text links, and it is the biggest problem

**What it actually is.** `App.tsx` has **six routes** — home, squad, reasoning, chips, override,
decisions — and **no navigation structure at all.** Getting anywhere is done through inline text
links with a "→" glued on the end: "Decisions →", "Chips →", "Full reasoning →", "Register an
override →", scattered across the home screen and the verdict card.

**Why it is worse than it looks.** There is no persistent sense of where you are or what else
exists. Every screen is a dead end you reverse out of with the browser back gesture. Six
destinations with no map is well past the point where a real navigation model is required.

**Direction.** A proper navigation structure — my instinct is a small set of primary destinations in
a persistent bar, with the rest reached contextually from within them. Not every one of the six
routes deserves top-level status; deciding which do is part of the work. See P11 for what I want it
to look and feel like.

---

## P4 — The header is the most obviously AI-generated thing on the screen

**What it actually is.** The home screen opens with a countdown, then a `<header>` reading
**"FPL Advisor"**, then a right-aligned row of two arrow links. A wordmark plus a link row is the
default header every AI-generated interface produces.

**Why it is wrong here specifically.** This is a **single-user app on my own phone**. I know what it
is. The app titling itself to me every time I open it spends the most valuable space on the screen —
the top — on zero information. `design-reference.md` asks the home screen to answer one question in
under two seconds, in the order: countdown, verdict, squad. The wordmark is not in that list.

**Direction.** Consider removing the wordmark entirely, or reducing it to something very small and
quiet. Give the deadline the top of the screen and treat it the way Revolut treats a balance and
Apple Weather treats a temperature — one large, calm, tabular figure that owns its space, with the
date unambiguous (deadlines fall after midnight Singapore time). The escalation inside 24 hours
should feel like the app leaning forward, which it currently does not.

---

## P5 — The squad looks compressed and squashed

**What it actually is.** The pitch sits **inside a `Surface` panel**, inside the single centred
column, with the panel's own padding on both sides. The rows are `display: flex` with
`flex-wrap: wrap` and a small gap, so five defenders compress to fit the remaining width. The result
is a squeezed little diagram rather than a pitch.

**The reference, and its limits.** Take the **layout, proportion and breathing room** from the
official FPL app's pitch — the one convention `design-reference.md` says is genuinely worth keeping,
because it is the fastest way to read a squad's shape. **Take nothing else from it**: no green, no
pitch texture, no crests, no team colours, no saturated anything. It remains the anti-reference for
everything except this one thing.

**Direction.** Let the pitch break out of the panel and run closer to the full width of the screen.
Give the rows real vertical separation so the formation reads as a shape. Make the shirts big enough
that the name and the one contextual number are comfortable rather than cramped. I am not going to
specify the solution — but the current version is smaller than it should be in every dimension.

---

## P6 — The bench looks bad, in the same way

**What it actually is.** The bench is a second panel under the field with a small uppercase
"BENCH"-style label and the same wrapped row of the same cramped shirts, offset by a 90ms
animation delay.

**Direction.** The bench should read as clearly *separate from and subordinate to* the eleven — that
is a hierarchy problem, not a spacing problem. `design-reference.md` says the formation itself
should provide the separation. Right now two near-identical panels sit on top of each other and the
distinction is carried entirely by a small text label.

---

## P7 — The prediction accuracy card is ugly and the writing is bad

**What it actually is.** Small type throughout, a large cyan figure that does not feel like it earns
its size, and body copy that reads like it was generated rather than written.

**Direction.** Two separate fixes and they should not be confused. **Visually**, this card follows
the same one-big-number pattern as the verdict card, which means two cards on one screen are
competing for the same role — decide which one wins and demote the other. **In writing**, apply
`design-reference.md`'s interface-writing rules properly: sentence case, plain verbs, no filler,
every element doing exactly one job. If a sentence sounds like an assistant explaining itself,
rewrite it or delete it. This applies to the empty and "too small to read" states as much as the
populated one.

---

## P8 — The chips screen is not intuitive

**What it actually is.** It presents chip state, expiry urgency and the wildcard/free-hit advisory
in one long screen. I cannot tell at a glance which chips I still have, when they expire, or what
the advisory number is telling me to do.

**Direction.** Answer the three questions in order of how often I ask them: *what do I still have*,
*when do I lose it*, *is now a good time*. The advisory is deliberately never an instruction
(`product-brief.md` §6a) — but "this is information, not a recommendation" has to be legible from
the design, not just true in the code.

---

## P9 — The decisions screen looks pretty but is not intuitive

**What it actually is.** It renders the ledger of what I committed or overrode. It looks fine and
tells me very little. Reading it, I cannot easily answer "what did I actually do that week, and was
it right?"

**Direction.** This screen exists to let me see my own track record. Group by gameweek, make the
committed-versus-overridden distinction obvious at a glance, and — where the data exists — let me
see how the decision turned out. If the outcome data isn't there yet, say so in the audit rather
than inventing it.

---

## P10 — I want floating glass panels, especially for navigation

**What I mean.** Navigation that floats above the content as its own material — a bar that hovers
over the scrolling page with real translucency and blur, the way iOS system UI does, rather than
being welded to the top or bottom of the document.

**Direction.** This is my preferred answer to P3, and it is also the single clearest place to
demonstrate the material language P2 asks for. It has to respect iOS safe areas — the shell is
already safe-area aware — and it must not obscure the thing it floats over. If the audit concludes a
floating bar is the wrong pattern for six destinations, say so and propose what is; I want the
outcome, not the specific component.

---

## P11 — Nothing feels like it responds to me

**What it actually is.** Committing a recommendation, registering an override, tapping through to a
screen — these are the moments the app is *for*, and none of them acknowledge that anything
happened. `design-reference.md` reserves motion for "orientation and state change" and says the
commit action specifically earns animation. It does not have one.

**Direction.** Be ruthless here. Per Emil Kowalski's "You Don't Need Animations", a frequently-seen
element that animates for decoration makes the app feel slower, not better. **Reject more animation
opportunities than you accept.** The ones that plausibly earn it: the commit action, screen
transitions, and the countdown crossing into its escalated state. Almost nothing else should move.

---

## Constraints that override anything above

From `design-reference.md` and `product-brief.md` §8. A proposal that breaks one of these is wrong,
however good it looks:

- Dark only. No light mode, no toggle. `#0b0f19` stays the base.
- No green, no yellow, no purple. Cyan for good, coral for risk.
- Geist and Geist Mono. Never Inter, never an unmodified system stack.
- Every number tabular mono.
- No emoji as icons, anywhere.
- No decimal projected-points values in the recommendation UI. Bands — clear / marginal /
  coin-flip — not false precision. (The accuracy card is the stated exception: it is a measurement.)
- The pitch layout stays a pitch.
- Respect `prefers-reduced-motion`.
- Anything only checkable on a physical iPhone must be flagged as such — it will come back from QA
  as CANNOT VERIFY and lands on my own list.
