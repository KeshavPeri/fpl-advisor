# Ticket #79 (follow-up) — Two corrections to the design foundations (#166)

Two defects in what #166 shipped, one of them the priority: (A) the elevation scale was bought
with opacity, which spends the very material it was supposed to serve, and (B) the navigation bar
shipped text-only. Scope: `src/index.css`, `src/components/Surface.tsx/.css`,
`src/components/AppBar.tsx/.css`, the new `src/components/NavIcons.tsx`, and their tests. Nothing
in `src/App.tsx`, any screen, any other component, `src/lib/`, `scripts/`, `supabase/` or
`.github/` was touched — three overnight tickets are queued against those files.

## HIGH-IMPACT

### 1. Tier 2 — the elevation scale is re-derived at ONE CONSTANT FILL ALPHA (0.55), with every fill's colour changed to compensate exactly, because opacity is not a currency elevation is allowed to spend.

There are exactly two ways to make a panel read as raised: shift its tint and luminosity, or raise
its opacity. Only the first is compatible with translucency. #166 took the second — F5's measured
elevation problem was solved by moving `--panel-fill` from 0.55 to 0.72 alpha and
`--panel-fill-raised` from 0.62 to 0.84 — and the measurement improved while the app got worse:
every panel stopped transmitting the ambient wash behind it, so the surfaces read as frosted
rather than as glass. **F5 asked for visible elevation and F13 asked for real material; solving F5
with alpha defeats F13.**

The correction treats 0.55 / 0.62 as **ceilings, not targets**, and goes further than the ceiling
requires: all three levels now share one alpha, 0.55, so the elevation is provably a function of
colour alone. Each new fill is the exact RGB that alpha-composites over `--surface-0` to the same
result its higher-alpha predecessor did, so **this is not a trade** — the whole elevation scale
survives to within 0.003 of a contrast point while 0.17–0.29 of alpha is handed back to the
material. Over the base ink the panels are indistinguishable from #166's; over the ambient wash
they now transmit 45% of the cyan/coral gradient instead of 28% (L2) or 16% (L3), and that
transmitted tint is what "material" means in this app.

**Fill alpha, before and after:**

| Token | Role | Before (#166) | After | Ceiling |
|---|---|---|---|---|
| `--material-1` | L1, recessed | 0.42 | **0.55** | 0.55 |
| `--material-2` = `--panel-fill` | L2, standard panel | 0.72 | **0.55** | 0.55 |
| `--material-3` = `--panel-fill-raised` | L3, loudest per screen | 0.84 | **0.55** | 0.62 |
| `--material-bar` | the floating nav bar | 0.72 | **0.50** | — (see 3) |

L1 is the one alpha that rises (0.42 → 0.55). It is deliberate and it changes nothing on screen:
no call site passes `level={1}` today (`Surface.tsx`), so L1 is unrendered. The constant was set
at the ceiling rather than at the floor of the three so that **the standard panel — the surface
covering most of every screen — lands exactly on its known-good pre-foundations value** rather
than on a translucency nobody has seen. Going below 0.55 was available and was not taken: the
brief is to restore what was lost, not to overshoot past it.

**Computed contrast at every elevation boundary** (WCAG relative-luminance formula,
alpha-composited over `--surface-0` — the same measurement the audit used, re-derived from the
literal token text in `src/index.css.test.ts`):

| Boundary | Before (#166) | After | Δ |
|---|---|---|---|
| L1 vs base | 1.0620:1 | **1.0624:1** | +0.0004 |
| L2 vs base | 1.2495:1 | **1.2482:1** | −0.0013 |
| **L2 vs L1** (adjacent pair) | 1.1765:1 | **1.1750:1** | −0.0015 |
| L3 vs base | 1.5507:1 | **1.5475:1** | −0.0032 |
| **L3 vs L2** (adjacent pair) | 1.2411:1 | **1.2398:1** | −0.0013 |
| `--panel-border` vs L2 (the border between the levels) | 1.1445:1 | **1.1445:1** | 0 |
| the bar vs base | 1.0772:1 | **1.0772:1** | 0 |

**Both required properties hold at once, and neither was traded away.** Every adjacent elevation
step (1.1750, 1.2398) is still more visible than the border between the levels (1.1445), and no
fill alpha exceeds its ceiling. There was no tension to resolve in the end, because the tension
was never real: it only looked real while "more raised" was assumed to mean "more opaque". Both
facts are now enforced as tests, not as prose — `src/index.css.test.ts` asserts the ceilings, the
constant-alpha property, and the border-versus-step ordering against the committed token values.

### 2. Tier 2 — a level that needs to read as more raised gets there through a brighter light-catching edge, which replaces the alpha step as the second non-colour-of-fill mechanism.

#166 gave all three levels the same `--material-edge` (0.10 alpha). An edge that is constant
across the scale carries no elevation — it is decoration on every level equally. A higher surface
catches more light, so the edge and its inner sheen now brighten with the level:

| Level | edge alpha (before → after) | edge contrast vs its own fill (before → after) | sheen (before → after) |
|---|---|---|---|
| L1 | 0.10 → **0.06** | 1.232:1 → **1.123:1** | 0.04 → **0.03** |
| L2 | 0.10 → **0.10** | 1.261:1 → **1.261:1** | 0.04 → **0.045** |
| L3 | 0.10 → **0.16** | 1.260:1 → **1.453:1** | 0.04 → **0.07** |

Recorded honestly: **L3's top edge (1.453:1) is more visible than the L3-vs-L2 step (1.240:1)**,
and L2's (1.261:1) is more visible than the L2-vs-L1 step (1.175:1). That is not the inversion F5
named and is not a reintroduction of it. F5's finding was that a **uniform stroke around all four
sides** out-shouted the fill; the measurement it defined for that — and the one the constraint
above is checked against — is `--panel-border`, which is unchanged at 1.1445:1 and quieter than
every step. `--material-edge-*` applies to the **top border side only** (`Surface.css`), and a
one-sided bright edge is what F14 asked for precisely because it reads as light falling on an
object rather than as a line drawn around one. This asymmetry is the mechanism that lets elevation
come from light instead of from opacity, which is the whole point of correction A.

### 3. Tier 2 — backdrop blur is removed from panels entirely and kept only on the navigation bar, and the bar's scrim is capped so the bar has something left to blur.

**Measured, then decided.** F13 established the mechanism: a panel's entire backdrop is
`.app-shell__backdrop`, a static two-radial-gradient wash, and a Gaussian blur of a smooth
gradient returns the same gradient. #166 accepted that finding and then kept the blur anyway
(22px → 24px/32px per level, i.e. an increase for two of the three levels) alongside
`saturate(150%)`. Heavy blur plus saturation over a flat backdrop is the recipe for fog, and "fog"
is what "frosted" describes.

- **Panels: `backdrop-filter: saturate(var(--panel-saturate))`, no blur.** The blur was producing
  a pixel-identical result to no blur on 60 panels, at the cost of a compositor pass each and a
  sampling halo at every panel's own boundary. `saturate()` is the opposite case — it acts on the
  wash's chroma transmitted through the fill, and now that the fill passes 45% instead of 28% it
  has appreciably more to act on. The `--material-*-blur` tokens are deleted rather than zeroed,
  so nothing can quietly reintroduce a panel blur by setting one.
- **The bar keeps `blur(28px) saturate(180%)`** — it is the one surface with live content
  (shirts, figures, text) scrolling behind it, so it is the one place a blur has high-frequency
  detail to soften.
- **The bar's scrim was erasing exactly that.** `#166`'s `.app-bar__scrim` faded content to
  **fully opaque** `--surface-0`, reaching solid ink roughly 36px from the bottom of the viewport,
  well above the bar's own top edge at ~69px. So the app's only real glass was glass over a flat
  field — the F13 defect, recreated in the one place it was supposed to be fixed. The scrim now
  caps at `--scrim-strength: 0.7`, applied as `opacity` on the element (which keeps `--surface-0`
  referenced by token rather than restated as an `rgba()` triple). 30% of the content survives
  underneath for the blur to act on.

**The bar is now the glassiest surface in the app on four independent axes**, which is what makes
it read as a different substance from the panels rather than as another panel that floats: the
lowest alpha anywhere (0.50, strictly under the panels' 0.55, asserted in the tests), the only
backdrop blur, the strongest saturation (180% vs 150%), and the brightest light-catching edge
(`--material-edge-3`).

### 4. Tier 2 — the bar's inactive label is raised from `--text-tertiary` to `--text-secondary`, because making the bar genuinely translucent gives it a worst case the panels do not have.

Every other surface in this app sits on a known, static backdrop. The bar sits on whatever happens
to be scrolling under it. Its worst case is solid `--text-primary` content directly beneath the
glass, muted only by the scrim and the bar's own fill: `--text-tertiary` measures **3.84:1** there
and fails WCAG AA; `--text-secondary` measures **4.67:1** and holds (7.13:1 with nothing behind
it). `--scrim-strength: 0.7` is the value that keeps that true — it is a legibility floor, not a
taste value, and it is asserted as such in `src/index.css.test.ts`. No new colour was introduced
to solve this; the fix is an existing token.

### 5. Tier 2 — correction B: three navigation icons are drawn in this repo, reversing #166's "text labels, not icons".

#166's reasoning (F17/P10) was that "no emoji as icons" binds and this app draws no icon set, so
inventing one is a larger, less reversible decision than the audit should make. That was the right
call **for an audit** and the wrong outcome **for a navigation bar**: three text labels in a pill
is still the pile of text links P3 objected to, relocated to the bottom of the screen. Drawing
three glyphs is smaller and more reversible than taking a dependency for them, and it is now
`src/components/NavIcons.tsx` — no icon library, no new dependency of any kind, no emoji, one
24×24 grid, one stroke weight, `stroke` not `fill`, `currentColor` so both states come from the
existing `--text-*` tokens and no icon introduces a colour of its own.

`stroke-width` is deliberately **not** set in the SVGs — it lives in `AppBar.css`
(`--nav-stroke: 1.5` / `--nav-stroke-active: 2`). That is what lets the active destination be
marked **without relying on colour alone**: the current item thickens its glyph and its label
weight (550 → 620) in addition to the `--text-primary`-on-`--accent-cyan-dim` pill. Desaturate the
app entirely and the active destination is still the one drawn in bolder line. Every destination
keeps its visible text label, so accessible names are unchanged from the text-only bar and every
`<svg>` is `aria-hidden="true" focusable="false"` — the icons are a second, redundant channel and
never the only one.

## ROUTINE

- The three new fills — `--material-1: rgba(21,28,46,0.55)`, `--material-2: rgba(40,54,88,0.55)`,
  `--material-3: rgba(61,82,130,0.55)` — and `--material-bar: rgba(24,32,54,0.5)` are not judgement
  calls: each is `(C − (1−a)·base) / a` for the composite `C` its predecessor produced over
  `--surface-0`, rounded to whole channel values. The ≤0.003 contrast deltas in the table above are
  that rounding, nothing else.
- `--panel-fill` / `--panel-fill-raised` stay live aliases of L2/L3, so the eight out-of-scope
  stylesheets that read those names (`PlayerShirt.css`, `VerdictCard.css`, `AccuracyCard.css`,
  `PitchSkeleton.css`, four screens) inherit the alpha correction with no edit. Where one of those
  files paints a `--panel-fill-raised` element **on top of** an already-lifted panel (the pitch
  shirt), the lower alpha makes it slightly brighter than before rather than dimmer, because a
  translucent material over a lifted backdrop picks that backdrop up. That is correct material
  behaviour and it increases the shirt's separation from the panel; noted here because it is a
  visible change in files this ticket did not touch.
- `--panel-blur` deleted — it had no consumer anywhere in `src/`.
- Icon subjects: **This week** = a calendar (a bounded stretch of time); **Chips** = the two-stroke
  layers/stack form (a countable few one-use items held in reserve — a literal poker chip was
  rejected as indistinguishable from a target at 22px and as depicting the token rather than the
  scarcity); **Record** = a three-rule log with a short last line (an append-only ledger still
  being added to, rather than a menu of three equal items).
- Bar item layout changed from a single centred label to icon-over-label, `gap: 2px`,
  `padding: var(--space-1) 0`. The item clears the 44px iOS floor **on its own content** (22px icon
  + 2 + ~17px label + 8 = ~49px), so nothing is padded out to fake a tap target. The bar grows from
  ~52px to ~59px; `AppShell.css` already reserves `4rem + var(--space-6)` above the safe area
  (88px) against the bar's 12px offset + 59px height = 71px, so no out-of-scope change was needed
  to keep content clear of it.
- `--nav-icon-size` / `--nav-stroke` / `--nav-stroke-active` are declared on `.app-bar` rather than
  in `:root`, because they are the bar's own geometry and nothing else in the app draws icons yet.
- No motion was added. The bar's only transform values remain `translateX(-50%)` (centring),
  `scale(0.96)` (the foundations' press feedback) and `none` (its `prefers-reduced-motion`
  override) — asserted in `AppBar.test.ts`.

## NOT DONE, AND WHY

- **`npm test` does not pass clean, and did not before this ticket either.** Three tests fail on
  `main` at `c06fbfe`, verified by stashing this ticket's changes and re-running: two in
  `scripts/ingest-core-insights.test.ts` and one in `scripts/build-feature-history.test.ts`, all
  three asserting that `supabase/README.md` still lists migrations `20260827090000`,
  `20260828090000` and `20260829090000` as "not yet applied" — the README now records all three as
  applied (28–29 Aug 2026). The fix is in `scripts/` and `supabase/`, both explicitly outside this
  ticket's scope and both queued for tonight's tickets. Nothing was touched there.
  `npm run build` and `npm run lint` pass clean, and all 68 test files in this ticket's own scope
  pass (1,551 of 1,554 tests; the 3 failures are exactly the pre-existing ones).
- **The blur decision is measured on the mechanism, not on a device.** That a Gaussian blur of a
  smooth gradient returns the same gradient is arithmetic, not an aesthetic judgement, and the
  scrim's arithmetic (opaque ink above the bar's top edge) was read off the committed values. The
  remaining question — whether 30% content transmission under the bar reads as material or as
  noise on a real iPhone screen — is a device check, not a simulator one, and is worth doing on
  the preview build before this is treated as settled.
