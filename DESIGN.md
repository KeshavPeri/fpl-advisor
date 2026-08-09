<!-- SEED: established ahead of any built feature, for infrastructure task 3.14. Provisional —
     re-run /impeccable document (or let /impeccable shape's new-work workshop commit a real
     world) once the first real feature exists, so this gets replaced with actual tokens and
     components rather than revised in place. -->

---
name: FPL Advisor
description: Personal, advice-led Fantasy Premier League companion — dark by default.
colors:
  bg: "#0b0f19"
---

# Design System: FPL Advisor

## Overview

**Creative North Star: "The Late-Night Team Sheet"**

FPL Advisor is a single-user tool Keshav checks before each gameweek deadline, often from a
phone, often at odd hours, to decide transfers and captaincy. The visual world is dark by
default, quiet, and data-dense without feeling cluttered — closer to a well-kept team sheet or
a terminal dashboard than a consumer sports app. Nothing here is provisional in *tone* even
though most of the token system below is still open: dark, calm, legible, no stadium-hype
graphics or oversized club branding.

This is a seed, not an implementation. Only the base surface color is currently committed;
typography, accent color, component shapes, and elevation are intentionally left open for
`/impeccable shape` to resolve against a real first surface (most likely the weekly
transfer/lineup recommendation view).

**Key Characteristics:**
- Dark-by-default, not dark-mode-as-an-option — this is the primary surface.
- Advice-led density: recommendations get visual priority over raw stat tables, per
  PRODUCT.md's "advice over data dump" principle.
- Restrained, functional palette — no decorative color until a real surface earns it.

## Colors

Only the base surface is committed; everything else is a placeholder until a real feature
picks a direction.

### Neutral
- **Deep Ink** (`#0b0f19`): primary app background, committed as the starting anchor for the
  whole system. All other neutrals (text, borders, elevated surfaces) are
  [to be resolved during implementation] — derive them from this anchor rather than
  introducing an unrelated base.

### Primary / Accent
[To be resolved during implementation. The current scaffold carries Vite's default purple
(`#aa3bff` / `#c084fc`) and default green/red status colors (`#4ade80` / `#f87171`) — these are
template defaults, not a chosen brand accent, and should not be treated as committed.]

### Named Rules
**The One Anchor Rule.** Until a real surface is shaped, `#0b0f19` is the only color decision
that binds future work. Do not extrapolate a full palette from it without running
`/impeccable shape` or `new-work` on an actual surface.

## Typography

[To be resolved during implementation. No font pairing has been chosen; the scaffold still
uses the Vite template's system-font stack (`system-ui, "Segoe UI", Roboto, sans-serif`), which
is a placeholder, not a decision.]

## Layout

[To be resolved during implementation. No grid, container, or spacing rhythm has been chosen
yet.]

## Elevation & Depth

[To be resolved during implementation. Given the dark, low-glare intent, tonal layering is the
likely direction over heavy drop shadows, but this is not yet a confirmed invariant.]

## Shapes

[To be resolved during implementation.]

## Do's and Don'ts

### Do:
- **Do** treat `#0b0f19` as the anchor for a dark-by-default system, not a dark-mode toggle.
- **Do** prioritize the weekly recommendation (transfers, captain, XI) visually over
  supporting stats, per PRODUCT.md's advice-led purpose.
- **Do** re-run `/impeccable document` or `/impeccable shape`'s new-work workshop once the
  first real feature is built, and treat this file as superseded at that point.

### Don't:
- **Don't** treat the scaffold's current Vite-default purple accent or system-font stack as
  committed brand decisions — they're unedited template defaults.
- **Don't** design for multi-tenant or shareable views; PRODUCT.md confirms single-user only.
- **Don't** add stadium-hype visual language (large club crests, hero photography, high-chroma
  team colors) without a deliberate decision — the north star is calm and functional, not fan
  merchandise.
