import { NavLink } from 'react-router'
import { ChipsIcon, RecordIcon, ThisWeekIcon } from './NavIcons.tsx'
import './AppBar.css'

/**
 * F17 (docs/ui-audit-2026-08-31.md) — the floating navigation bar, and
 * the single highest-leverage change in the audit: it is simultaneously
 * the answer to P3 ("navigation is a pile of text links") and the fix
 * for P2/F13 (backdrop-filter had nothing to blur anywhere else in the
 * app — this is the one surface with real content scrolling behind it).
 *
 * Three top-level destinations, per the audit's P3 table — three is the
 * right number for a persistent bar: under the five-item ceiling, and
 * every item is a *place* rather than an *action*:
 *   - "Home" (/) — the screen the app exists for. Renamed from "This
 *     week" (#194, section C) — the label named the screen's cadence, not
 *     the destination, and this is a single-user app on Keshav's own
 *     phone: "Home" is what he already calls it.
 *   - "Chips" (/chips) — standing season state, checked periodically,
 *     not reached from any single decision.
 *   - "Record" (/decisions) — the track record, a destination in its own
 *     right.
 * /reasoning, /override and /squad stay contextual, reached from the
 * surfaces they belong to (the verdict card, the pitch, the incomplete
 * banner) rather than from here.
 *
 * #194, section C — Home moved from the left end to the centre, rendered
 * as a circle that bulges above the bar's own top edge rather than as a
 * third equal pill: "one continuous silhouette... Home at the centre as
 * a circle, with Chips and Record contouring outward from it to each end
 * of the bar." See AppBar.css for the shape mechanism.
 *
 * ICONS — correction B to #166, which shipped this bar text-only. The
 * audit's reasoning for text alone (the app draws no icons, so inventing
 * a set is a bigger decision than F17 should make) held for the audit
 * and does not hold for a navigation bar: a bar of three text labels is
 * still the pile of text links P3 objected to, just pinned to the
 * bottom. NavIcons.tsx draws the three glyphs in this repo — no library,
 * no dependency, no emoji — on one grid at one stroke weight, in
 * currentColor. See that file's header for the full set of rules.
 *
 * ACCESSIBLE NAME AND THE ACTIVE STATE. Each destination keeps its
 * visible text label, so its accessible name is unchanged from the
 * text-only bar and the icons are decorative (aria-hidden) additions
 * rather than the sole carrier of meaning. The current destination is
 * marked three ways, only one of which is colour: a heavier icon stroke
 * (--nav-stroke-active), a heavier label weight, and — the colour one —
 * --text-primary on a --accent-cyan-dim pill. Remove colour entirely and
 * the active item is still the one drawn in bolder line.
 *
 * Rendered once in App.tsx, outside <Routes>, so it is a single
 * persistent DOM node across every navigation instead of remounting per
 * screen — react-router's <NavLink> applies `aria-current="page"`
 * automatically when its `to` matches the current location, which is
 * what AppBar.css's `[aria-current='page']` selector targets; no local
 * active-route state is needed here.
 */
function AppBar() {
  return (
    <>
      {/* F17 — apple-design §12: the boundary where scrolling content
          meets floating chrome gets a short gradient mask, not a
          hairline divider (a welded-on 1px rule is the tell that a bar
          isn't really hovering). This fades content toward the base ink
          as it nears the bar, anchored to the viewport via position:
          fixed rather than a CSS mask on the scrolling column —
          mask-attachment: fixed shares background-attachment: fixed's
          documented iOS Safari unreliability (see AppShell.css's own
          comment on why the ambient wash uses a fixed *element*, not
          that CSS value), so this uses the mechanism this codebase
          already trusts instead.

          It no longer fades to FULL opacity, though: see AppBar.css and
          --scrim-strength. A scrim that reaches opaque --surface-0
          before the bar's top edge leaves the bar as glass over nothing,
          which is the exact defect F13 found on the panels.

          Purely decorative: pointer-events: none so it never intercepts
          a tap either for content beneath it or for the bar itself,
          which paints above it (z-index 10 vs 9). */}
      <div className="app-bar__scrim" aria-hidden="true" />
      {/* #194, section C — one continuous silhouette rather than three
          equal pills: Home is a circle at the centre, sharing the bar's
          own fill/blur/edge so it reads as one lit material bulging above
          the pill rather than a separate floating button welded on top.
          Chips and Record are ordinary flex items either side; a plain
          spacer (`app-bar__home-spacer`) reserves the width the absolutely
          positioned Home circle occupies so the two side items never
          collide with it. Home is last in DOM order (after the spacer) so
          its own rule can win the cascade tie with `.app-bar__item` at
          equal specificity without `!important` — see AppBar.css. */}
      <nav className="app-bar" aria-label="Primary">
        <NavLink to="/chips" className="app-bar__item app-bar__item--side">
          <ChipsIcon className="app-bar__icon" />
          <span className="app-bar__label">Chips</span>
        </NavLink>
        <span className="app-bar__home-spacer" aria-hidden="true" />
        <NavLink to="/decisions" className="app-bar__item app-bar__item--side">
          <RecordIcon className="app-bar__icon" />
          <span className="app-bar__label">Record</span>
        </NavLink>
        <NavLink to="/" end className="app-bar__item app-bar__item--home">
          <ThisWeekIcon className="app-bar__icon" />
          <span className="app-bar__label">Home</span>
        </NavLink>
      </nav>
    </>
  )
}

export default AppBar
