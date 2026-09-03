## Context

Three UI tickets have shipped against `docs/ui-audit-2026-08-31.md`: #166 (elevation, material,
floating bar), #171 (restore the glass, bar icons) and #174 (apply the system to every screen).
The owner has now reviewed the result on his own iPhone and the material direction has
regressed rather than improved, four rendering faults are visible on the first screen, and
several items from `docs/my-ui-problems.md` are still open.

This is a **polish** ticket in the sense of `CLAUDE.md`'s design-pass rule: `impeccable`,
`emil-design-eng` and `apple-design` are all in scope and are asked for by name below.

`design-reference.md` and `product-brief.md` §8 bind throughout and none of their constraints
are up for negotiation here: dark only, `#0b0f19` base, no green/yellow/purple, cyan for good
and coral for risk, Geist and Geist Mono, tabular mono figures, no emoji as icons, no decimal
projected points in the recommendation UI, pitch stays a pitch, honour
`prefers-reduced-motion`.

## Scope

### A. Four rendering faults — fix these first, they are not taste

1. **Home screen content renders underneath the iOS status bar.** The gameweek label and the
   countdown figure overlap the system clock. The top safe-area inset is not reaching the
   countdown.
2. **The verdict card's action row sticks to the top of the viewport while scrolling** and
   lands on the status bar. Remove the sticky behaviour; the actions belong with the card.
3. **Page content runs underneath the floating nav bar** on both Home and Chips — cut-off text
   is legible through it. The column's bottom padding is short of the bar's real height and the
   scroll-edge scrim is not covering what remains.
4. **Player names hyphenate mid-word** on the pitch: "B.Fernan-des", "Ver-brugg…",
   "João Pe-dro", "I.San-garé". Suppress automatic hyphenation, and combine with the wider
   shirts in section E so real names fit.

### B. The material — restore the glass

The owner's words: the app looked more luminous and more transparent **before** the polish, and
now reads as flat plastic. That is traceable to two specific decisions.

- #166 bought elevation with **alpha** (0.55 → 0.72/0.84). That spent the material to buy
  contrast, and the panels stopped transmitting the ambient wash.
- #171 correctly returned alpha to 0.55, but bought the elevation back with **fill
  brightness** instead — `rgba(23,31,51)` became `rgba(40,54,88)`. Glass over dark ink is dark.
  A paler fill is what makes a panel read as a light grey-blue box. This is the regression.

**Neither alpha nor fill luminosity may carry elevation.** Elevation is carried by the
light-catching top edge and by a directional specular sheen across the surface, which is what
makes a material read as lit rather than as tinted.

- Take the panel fills back down toward their pre-#166 darkness, alpha at or below 0.55.
- Add a fine, high-frequency grain layer to the fixed ambient backdrop.
- **Restore `backdrop-filter` blur on the panels.** The audit's F13 concluded that panel blur
  is a no-op because the backdrop is a smooth gradient. That reasoning is wrong and should be
  corrected in the audit doc: `.app-shell__backdrop` is `position: fixed` while the panels
  scroll over it, so what sits behind a panel changes continuously as the page moves. Blur does
  real work the moment there is high-frequency detail behind it to work on — which is what the
  grain layer supplies.
- The nav bar stays the glassiest surface in the app. If the bar and the panels ever read as
  the same substance, that is the failure.

### C. The navigation bar

- **One continuous silhouette, not three pills:** Home at the centre as a circle, with Chips
  and Record contouring outward from it to each end of the bar.
- Home is the centre item. Rename the label from "This week" to **"Home"**.
- **The type is the weakest thing about the bar.** It is 13px Geist at weight 550 with positive
  tracking, which reads soft. Choose one sharp register and commit to it across the bar —
  smaller, heavier and tighter, or small uppercase with wide tracking. Not both.
- Remove the `← Home` link from the Chips and Record screens, and the redundant screen-name
  caption opposite it. The bar is the navigation now.

### D. The home screen

- **The deadline countdown becomes its own component with its own container.** It is currently
  the only element on the screen with no surface of its own, which is part of why it reads as
  unfinished.
- **The verdict card is the hero.** Give it a materially different glass treatment from every
  other panel in the app — the one surface that gets the strongest sheen and the widest bleed.
  Improvise within the palette; it should be immediately obvious which panel matters.
- **`Why this` and `Register override` become buttons, not links.** One row directly under
  Commit, both smaller than Commit, both in the same secondary treatment as each other.
  Commit stays the only solid cyan control on the screen. No arrow glyphs.
- **Rewrite every string on the screen** against `design-reference.md`'s interface-writing
  rules. Delete any sentence that reads as the app explaining itself. This includes the
  accuracy line, which stays a single line.
- Surface the captain confidence band next to the plan confidence on the verdict card, so the
  two are read together rather than one being on the reasoning screen. **Do not change the
  thresholds** — see Notes.

### E. The pitch and the bench

- The pitch keeps a **narrow side margin** — it does not run to the screen edge.
- Widen the shirts and the horizontal gaps to use the width that is currently wasted. Today a
  five-defender row is 344px inside a 393px viewport.
- **Close the vertical gap between each player's name and his price.** That gap is what makes
  each shirt block tall, and it is the real reason the rows read as far apart.
- Then reduce the row-to-row gap. Wider rows plus tighter rows is what stops the formation
  reading as tall and thin.
- **The bench shirts must be visibly smaller than the starting XI's**, and the bench must not
  be a panel. It is subordinate, and size plus spacing should say so before the label does.

### F. The chips screen

- The advisory panel currently holds **two different advisories** — the chip-timing advisory
  and the squad-rebuild advisory — stacked inside one surface with their own headings. Split
  them into two surfaces at different weights.
- The hero headline is a comma-separated list of chip names set at display size. Demote it: the
  remaining chips are a list, not a headline.
- The horizon caveat stays above the figure it qualifies. The advisory keeps no accent colour
  — it is information, never an instruction (`product-brief.md` §6a).

### G. The record screen

- More than half the screen is empty below the content, and the four largest numbers on it
  ("2 decisions recorded", "1 commit", "1 override", "0 gameweeks with no decision") are the
  least important thing in the app.
- Demote that block to a quiet line and let the decision ledger be the screen.

### H. Animation pass

Run `emil-design-eng` and `apple-design` over the app as it stands after the changes above.

- **Reject more opportunities than you accept.** Record every rejection with the gate question
  that killed it, in this ticket's decisions file, alongside every acceptance with its purpose.
- The commit action, screen transitions, the countdown crossing into its escalated state and
  the override confirm step are the standing candidates. Anything seen on every open — the
  pitch, the bar, list rows, badges — is presumed rejected.

**Explicitly out of scope:**

- No new stored data, no migration, no schema change, no new Supabase read, no workflow change.
- No change to any projection, recommendation, solver or scoring logic. This ticket changes how
  things are shown, never what is computed.
- **No change to `deriveCaptainConfidenceBand`'s thresholds** (0.5 / 1.5) or to any other
  confidence threshold.
- No light mode or theme toggle. No green, yellow or purple. No Inter. No emoji as icons. No
  decimal projected-points values in the recommendation UI.
- No new icon set beyond the nav icons that already exist.
- No new route, and no change to what any route does.

## Definition of done

Rendering faults:

- [ ] On a 393×852 viewport, no home-screen content renders above the top safe-area inset; the
      countdown's container respects `env(safe-area-inset-top)`.
- [ ] `position: sticky` appears nowhere in `VerdictCard.css`.
- [ ] `.app-shell__column`'s bottom padding is at least the bar's rendered height plus one gap
      plus `env(safe-area-inset-bottom)`, and no content is legible under the bar at any scroll
      position on Home or Chips.
- [ ] Automatic hyphenation is disabled on the player name, and every name in the current squad
      renders without a mid-word hyphen at the new shirt width. Extend
      `PlayerShirt.truncation.test.ts` with the four names named in section A4.

Material:

- [ ] The composited relative luminance of `--material-2` over `--surface-0` is **strictly
      lower** than its current value, asserted in `src/index.css.test.ts`.
- [ ] No `--material-*` fill alpha exceeds 0.55.
- [ ] Every adjacent elevation step is still more visible than `--panel-border`; the existing
      assertions in `src/index.css.test.ts` continue to pass.
- [ ] `backdrop-filter` is present on `.surface` and on the nav bar, and the bar's blur and
      saturation both exceed the panels'.
- [ ] A `position: fixed` high-frequency grain layer exists in `AppShell`, behind the panels.
- [ ] `docs/ui-audit-2026-08-31.md` F13 carries a dated correction recording why panel blur is
      not a no-op.

Navigation and screens:

- [ ] The string `← Home` appears in no file under `src/screens/`.
- [ ] The nav bar renders as one continuous shape with a circular centre; the centre item is
      Home and its label is `Home`.
- [ ] `Commit`, `Why this` and `Register override` are all `<button>` elements; no `<a>`
      remains in `VerdictCard.tsx`; the two secondary buttons share one class and sit in one
      row, and their rendered height is less than Commit's.
- [ ] Bench shirt width is strictly less than starting-XI shirt width, and the bench is not a
      `Surface`.
- [ ] The starting-XI shirt width is strictly greater than its current value, and on a 393px
      viewport a five-shirt row plus its gaps spans at least 96% of the width remaining inside
      the retained side margin.
- [ ] The name-to-price vertical gap and the row-to-row gap on the pitch are both strictly
      smaller than their current values.
- [ ] The chip-timing advisory and the squad-rebuild advisory render as two separate surfaces.
- [ ] The captain confidence band renders on the verdict card; `deriveCaptainConfidenceBand`
      still returns `clear` above 1.5 and `coin-flip` below 0.5 — its unit tests are unchanged.

Process:

- [ ] The decisions file lists every accepted animation with its purpose and every rejected one
      with the gate question that rejected it, and rejections outnumber acceptances.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` all exit 0.
- [ ] Scope constraint: only files under `src/components/`, `src/screens/`, `src/index.css`,
      `src/index.css.test.ts`, `src/lib/verdict/` (and their tests),
      `docs/ui-audit-2026-08-31.md` and this ticket's own `decisions/ticket-<issue>.md` change.
      Nothing under `scripts/`, `supabase/` or `.github/`.

## Verifiable only on a physical iPhone — expect CANNOT VERIFY

Flag these in the review packet rather than claiming them:

- Whether the restored blur and grain read as luminous material rather than as noise.
- Whether a fixed blurred bar over a scrolling pitch holds frame rate on the owner's handset.
- Whether the circular centre item clears the home indicator and sits in the thumb arc.
- Whether the widened pitch reads as generous at arm's length in a dark room.

## Notes for the Analyst / Builder

- **The two wrong implementations are both already in this repo's history — do not repeat
  either.** #166 bought elevation with alpha and lost the material; #171 bought it with fill
  brightness and produced the plastic look the owner is complaining about now. Edge light and
  specular sheen are the mechanism.
- **On captain confidence:** the handover records the app labelling a 0.49-point captain gap
  as "clear". The shipped thresholds say a 0.49 gap is `coin-flip`, so that claim could not be
  reproduced from the code. This ticket therefore does **not** retune anything — it surfaces
  the band on the verdict card next to the plan confidence so the two can be read together, and
  the human check afterwards is whether they ever disagree in a way that looks wrong. Changing
  a threshold on an unreproduced report would be tuning against a number nobody has confirmed.
- `src/lib/verdict/api.ts` already selects `expected_points`, `is_captain` and `is_lineup` from
  `solver_picks`, so the captain gap is computable in `src/lib/verdict/derive.ts` by importing
  `deriveCaptainConfidenceBand` from `src/lib/reasoning/derive.ts`. That is why
  `src/lib/verdict/` is in the scope list — see `deltas.md` D10 for what happens when an
  instructed import's file is left out of it.
- The pitch keeps a narrow side margin. This is an owner decision made on 3 Sep, and it
  departs from the audit's F25, which proposed a full bleed.
- Do not add a fourth accent colour for the secondary buttons. Coral is reserved for risk, so
  Override cannot use it; both secondary buttons should share one neutral treatment.
- The screenshots this ticket is written from were taken on 3 Sep 2026 against `main` at
  `7bca83e`.
