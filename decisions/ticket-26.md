# Ticket #26 — Pin the backdrop to the viewport

## HIGH-IMPACT

None.

## ROUTINE

- **Backdrop uses `z-index: -1` rather than `z-index: 0` on the backdrop plus an explicit
  `z-index` on `.app-shell__column`.** Because it needs no change to `.app-shell__column` or any
  other component, keeping the diff to the ticket's stated scope constraint.
- **Backdrop implemented as a sibling `<div aria-hidden="true">` before the content column,
  rather than a `::before` pseudo-element on `.app-shell`.** Because a real element made it
  possible to verify independently with Playwright (computed styles, `getBoundingClientRect`),
  and keeps `AppShell.tsx` self-documenting; behaviourally equivalent to a pseudo-element.
- **Removed `body`'s own `background: var(--surface-0)` declaration in `src/index.css`; no hex
  value changed.** Because leaving it in place silently defeated the ticket: per CSS stacking
  rules, `body`'s in-flow background paints above a `z-index: -1` descendant once `:root`
  already supplies a non-transparent background (confirmed empirically against the spec), so the
  new fixed backdrop rendered correctly in computed styles but was invisible on screen. Removing
  the now-redundant declaration is what makes the pinned backdrop actually visible; `:root`'s
  token block, which the ticket forbids touching, is unchanged.
