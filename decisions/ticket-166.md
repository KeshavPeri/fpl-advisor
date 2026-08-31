# Ticket #166 — Build the design system: real elevation, working material, floating nav bar

## HIGH-IMPACT

1. **F1 (`.num` cascade defeat) fixed with `!important` on `.num`'s three properties, not pure
   specificity, because a repeated-class selector (`.num.num`) still ties `DeadlineCountdown.css`'s
   real 2-class selector and loses that tie on source order — specificity-chasing has no ceiling
   once a component stylesheet can add another class. `!important` is unconditional as long as
   nothing else in `src/**/*.css` marks a font property `!important`; that invariant is now enforced
   by a generic test (`src/index.css.test.ts`) rather than left to convention.
2. **`--panel-fill` / `--panel-fill-raised` kept as live aliases of the new `--material-2` /
   `--material-3` tokens rather than removed**, because 8 files outside this ticket's scope
   (`PlayerShirt.css`, `VerdictCard.css`, `AccuracyCard.css`, `PitchSkeleton.css`, four screens'
   `.css`) read those variable names directly. Removing them would silently break rendering in
   files this ticket is not allowed to touch; the follow-up ticket migrates those call sites and can
   retire the aliases then.
3. **The new `AppBar` mounts once in `src/App.tsx` as a sibling of `<Routes>`, not inside each
   screen's own `AppShell`**, because every screen independently wraps itself in `<AppShell>`.
   Mounting the bar inside `AppShell` would remount it on every navigation, defeating the
   persistent-spatial-anchor behaviour the audit's motion analysis depends on for a floating nav
   bar to read as one continuous object rather than a per-screen element.
4. **F12's glow reimplemented as a real DOM sibling (new `Surface` `focal` prop) instead of fixing
   the existing `::before` pseudo-element**, because `backdrop-filter` always creates its own
   stacking context per spec — no `z-index` on a pseudo-element inside `.surface` can ever paint
   behind that same element's own background. The only real fix is a preceding sibling that the
   panel's blur can sample from behind, so the glow is now optional and structural rather than
   decorative-and-broken.

## ROUTINE

- `--radius-panel-sm: 20px`, the `--material-1/2/3` alpha and blur values, and
  `--material-edge: rgba(190,205,235,0.1)` taken directly from the audit's own proposed values
  (F5/F7/F13/F14).
- `--text-headline: 24px` and `--text-figure: 48px` (Geist Mono) — audit-specified sizes for F10's
  type step between 17px and 36px.
- `--tracking-headline: -0.01em` and `--tracking-figure: 0em` — the audit only specified
  display/title/body/label tracking; these two were interpolated to fit the new headline/figure
  steps consistently.
- Nav bar destinations and order ("This week" `/`, "Chips" `/chips`, "Record" `/decisions`) taken
  verbatim from the audit's P3 proposed table.
- New component named `AppBar` (`AppBar.tsx` / `AppBar.css`, class `.app-bar`) — the audit's own
  naming for F17.
- Scroll-edge treatment (`.app-bar__scrim`) implemented as a fixed-position gradient fading to
  `--surface-0`, rather than a `mask-image` on the scrolling column, because `mask-attachment: fixed`
  shares `background-attachment: fixed`'s documented iOS Safari unreliability — the same reasoning
  `AppShell.css` already records (ticket #26) for why the background wash uses a fixed element
  instead of that CSS property. This is a simplification: the scrim fades to a flat colour rather
  than sampling the wash's actual gradient colour at the seam, which is fine for this ticket but may
  need revisiting if the wash becomes non-uniform at that screen position.
- `AppShellProps.children` widened from required to optional — a one-line typing fix so a test's
  `createElement` call type-checks; no behavioural change.

## Before/after — elevation boundary contrast (WCAG relative luminance)

| Boundary | Before | After |
|---|---|---|
| Fill vs base (old fill / new L2) | 1.079:1 | **1.25:1** |
| Raised fill vs fill (old / new L2→L1, new L3→L2) | 1.067:1 | **1.18:1** (L2/L1), **1.24:1** (L3/L2) |
| L1 vs base | — | **1.06:1** |
| L3 vs base | — | **1.55:1** |
| Border vs fill | 1.260:1 | **~1.14:1** |
| `--text-tertiary` vs L2 panel | 3.86:1 (fails AA) | **5.05:1** |
| `--text-tertiary` vs base | 4.17:1 | **6.31:1** |

Every adjacent elevation pair (1.18:1, 1.24:1) now beats the border between them (~1.14:1) — the
exact inversion the audit flagged is corrected. Values verified in `src/index.css.test.ts`.

## CANNOT VERIFY (device judgement — for Keshav)

1. Whether the nav bar's `blur(28px) saturate(180%)` over scrolling shirts/text reads as glass or fog.
2. `backdrop-filter` performance/flicker scrolling under the fixed bar on a real device.
3. Whether the bar clears the home indicator / sits in the thumb arc, in Safari and installed-to-home-screen (safe-area values differ between the two).
4. Whether `.app-bar__scrim`'s flat fade leaves a visible seam against the wash's actual gradient colour at that screen position.
5. Whether the new elevation levels read as intended in a dark room versus on a monitor.

## Note on `design-reference.md`

Per the ticket's own instruction: `design-reference.md` may need updating after this lands, since it
currently describes intent the code did not deliver until now. Not updated in this ticket — flag for
`/impeccable document` once the follow-up ticket (screens consuming these tokens) has also landed.
