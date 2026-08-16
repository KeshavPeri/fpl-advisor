# Decisions — ticket #44

## HIGH-IMPACT

None. This is a polish ticket — every choice below is Tier 3 (visual/convention), no
data-structure, library, or account/credential decision was involved.

## ROUTINE

- **Shirt made visible with a gradient fill (`surface-2` → `panel-fill-raised`), a new
  `--panel-border-strong` token (same ink hue as `--panel-border`, alpha 0.14→0.34), and a
  small collar-notch pseudo-element in `--surface-1`** — no new hue introduced, matching the
  ticket's "no per-team colours, no jersey accuracy" constraint. (Tier 3)
- **Name truncation fixed with a 2-line `-webkit-line-clamp` instead of nowrap+ellipsis**, with
  `overflow-wrap`/`word-break: break-word` and `hyphens: auto`, and `min-height: var(--space-8)`
  to keep row height uniform across all 15 slots. A new `--text-label-tight` token
  (`0.6875rem/1.25`, down from `0.8125rem`) was chosen **empirically** — verified against real
  FPL `web_name`s including the actual longest current name ("Alexander-Arnold") in a rendered
  check, not estimated from CSS math alone. (Tier 3)
- **Panel glow reworked, not removed**: `Surface.css`'s `::before` layer now uses an
  explicit-size ellipse (`60% 50%` at `50% 20%`) inside a box sized larger than it
  (`inset: -60% -35% 0 -35%`) with `blur(20px)` (was 12px), so the gradient reaches true
  transparency with margin to spare before the box edge — the root cause of the old hard
  line/band. The soft glow inside the panel border is retained. (Tier 3)
- **Backdrop ambient intensity raised via two new tokens** kept separate from the existing
  `-dim` tokens (`--accent-cyan-ambient: rgba(94,200,222,0.24)`, was 0.16;
  `--accent-coral-ambient: rgba(232,130,95,0.21)`, was 0.16, kept lower than cyan so it stays
  secondary rather than a second focal point) — because reusing the `-dim` tokens directly would
  have brightened badges/banners elsewhere as a side effect. (Tier 3)
- **Horizontal scroll fixed at the root cause**: the old `white-space: nowrap` name gave
  `.player-shirt` a large min-content width that busted flexbox's automatic minimum sizing at
  narrow widths. Fixed via the name-wrap change above plus `min-width: 0`, with
  `overflow-x: hidden` / `overscroll-behavior-x: none` added only as a backstop, not the primary
  fix. (Tier 3)
- **Arrival-motion stagger: 90ms delay on the bench panel only** (`.pitch__bench`, shared with
  `PitchSkeleton`) rather than suppressing motion entirely — the pitch has only 2 `Surface`
  panels (field, bench), not 15, so the "page assembling itself" risk the ticket flags is mild
  here; a small stagger communicates field-then-bench order without added complexity.
  `prefers-reduced-motion` handling in `Surface.css` is untouched. (Tier 3)
- **Price treatment**: added `font-weight: 500` and `letter-spacing: 0.02em` to
  `.player-shirt__price` (already on `.num`), matching the existing repo convention of layering
  raw weight/letter-spacing literals on top of `font: var(...)` shorthand (e.g.
  `.pitch__bench-title`, `.home-mark`). Font size deliberately untouched — the ticket forbids
  fixing name-fit by shrinking the number. (Tier 3)
