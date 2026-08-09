v0.1 — provisional, revised at Phase 8. Copied from app-factory/assets for app #1 (FPL
advisor) in Phase 4 — the Builder reads this file on every normal ticket (§5.4); making it
genuinely distinctive per app is Phase 8's job.

# Design reference

Per §5.3 of the system design: a design skill supplies heuristics, not taste. This file is what
tells the Builder what *this specific app* should look like, not just "not generic AI output."

## References

1. **Linear** (linear.app) — take the **density and information hierarchy**: a lot of state
   (status, priority, assignee) shown compactly without feeling cluttered. Look at how much is
   communicated with colour and weight alone, not extra UI chrome.

2. **Notion** (notion.so) — take the **restrained, near-monochrome colour use**: colour is
   reserved for meaning (tags, status), not decoration. Most of the surface is neutral grey/white
   with typography doing the work.

3. **Apple's own Weather / Fitness apps** (iOS system apps) — take the **at-a-glance layout for
   a small number of live-changing numbers** (deadline countdowns, budgets, scores) — relevant
   to the FPL app's home screen specifically. Big number, small label, minimal surrounding noise.

4. **Arc browser / Arc Search** (arc.net) — take the **typographic confidence**: large, clear
   type doing the hierarchy work instead of borders and boxes. Fewer dividers, more whitespace.

5. **Things 3** (culturedcode.com/things) — take the **calm, single-purpose screen feel**: each
   screen answers one question, nothing competes for attention. Useful register for the fitness
   planner's daily-view screens later.

## What "not generic AI output" means here, concretely

- No default shadcn/Tailwind starter look-and-feel with unchanged spacing/colour tokens
- No emoji-as-icon substitutes
- No centered-card-on-gradient-background pattern as the default layout
- Typography and spacing decisions traceable to one of the five references above, not to
  whatever the model defaults to
