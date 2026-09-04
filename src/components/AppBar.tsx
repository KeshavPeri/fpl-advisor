import { NavLink } from 'react-router'
import { ChipsIcon, RecordIcon, ThisWeekIcon } from './NavIcons.tsx'
import './AppBar.css'

/**
 * Ticket #202, section C — the dome-rim arc's own path data, derived from
 * the exact same two tokens (--nav-home-size, --nav-bump-overshoot,
 * index.css) the CSS union mask uses (AppBar.css), so the stroke and the
 * fill's own edge can never drift apart the way two independently
 * hand-typed shapes could. rem values here are resolved against a 16px
 * root font size — this app never changes the root font size (no
 * accessibility text-scaling setting is wired to it; iOS Dynamic Type
 * affects native controls, not arbitrary web em/rem), so this stays
 * accurate rather than needing a live measurement.
 *
 * The geometry: a circle of radius R (half of --nav-home-size), its own
 * top at y=0 and centre at y=R. The pill's flat top line sits at y=H
 * (--nav-bump-overshoot). The two points where that line crosses the
 * circle are at x = R ± sqrt(R² − (R − H)²) — this is the one piece of
 * trigonometry either shape depends on, so it is computed here once
 * rather than re-derived (or silently drifting) if either token ever
 * changes. The arc drawn is the MINOR arc between those two points
 * (large-arc-flag 0) — the short way over the top of the circle, not the
 * long way under it — swept clockwise (sweep-flag 1, correct in SVG's
 * y-down coordinate system for a path running left → top → right).
 */
const NAV_HOME_SIZE_PX = 3.75 * 16 // --nav-home-size, index.css
const NAV_BUMP_OVERSHOOT_PX = 0.9375 * 16 // --nav-bump-overshoot, index.css
const DOME_RADIUS = NAV_HOME_SIZE_PX / 2
const DOME_TANGENT_HALF_WIDTH = Math.sqrt(DOME_RADIUS ** 2 - (DOME_RADIUS - NAV_BUMP_OVERSHOOT_PX) ** 2)
const DOME_ARC_PATH = `M ${DOME_RADIUS - DOME_TANGENT_HALF_WIDTH} ${NAV_BUMP_OVERSHOOT_PX} A ${DOME_RADIUS} ${DOME_RADIUS} 0 0 1 ${DOME_RADIUS + DOME_TANGENT_HALF_WIDTH} ${NAV_BUMP_OVERSHOOT_PX}`

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
 * of the bar." Ticket #202, section C corrects HOW that silhouette is
 * drawn — #194's Home circle was its own independently bordered,
 * backdrop-filtered box, which merely overlapped the pill (two shapes,
 * two borders, a doubled seam where they crossed: "a ring drawn on a
 * bar"). `.app-bar` itself is now the single silhouette via a CSS mask
 * union of the pill and a fixed-radius circle, with Home reduced to
 * plain content (icon + label, no background of its own) positioned
 * inside it, plus a small SVG arc tracing the one curve a native
 * `border` cannot follow around a masked shape. See AppBar.css's own
 * header comment for the full mechanism.
 *
 * ICONS — correction B to #166, which shipped this bar text-only. The
 * audit's reasoning for text alone (the app draws no icons, so inventing
 * a set is a bigger decision than F17 should make) held for the audit
 * and does not hold for a navigation bar: a bar of three text labels is
 * still the pile of text links P3 objected to, just pinned to the
 * bottom. NavIcons.tsx draws the three glyphs in this repo — no library,
 * no dependency, no emoji — on one grid at one stroke weight (raised
 * again by #202, section C — see AppBar.css), in currentColor. See that
 * file's header for the full set of rules.
 *
 * ACCESSIBLE NAME AND THE ACTIVE STATE. Each destination keeps its
 * visible text label, so its accessible name is unchanged from the
 * text-only bar and the icons are decorative (aria-hidden) additions
 * rather than the sole carrier of meaning. The current destination is
 * marked four ways, only one of which is colour: a heavier icon stroke
 * (--nav-stroke-active), a heavier label weight, a cyan fill, and —
 * ticket #202, section C, "bring back the glow on Home" — an outer
 * bloom (--nav-active-glow, index.css). Remove colour entirely and the
 * active item is still the one drawn in bolder line.
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
      {/* Ticket #202, section C — one continuous PIECE OF GLASS rather
          than a pill with a separately-bordered circle overlapping it:
          `.app-bar` itself is now the union shape (a CSS mask, see
          AppBar.css's own header comment for the full mechanism), so
          Home no longer needs its own background/blur/border at all —
          it is plain content sitting inside the parent's already-unified
          fill. `.app-bar__row` holds the ordinary flex row (Chips,
          spacer, Record); Home and its dome-rim arc are absolutely
          positioned siblings of that row, not inside it, since they sit
          in the box's upper (bump) region rather than its pill row. */}
      <nav className="app-bar" aria-label="Primary">
        <div className="app-bar__row">
          <NavLink to="/chips" className="app-bar__item app-bar__item--side">
            <ChipsIcon className="app-bar__icon" />
            <span className="app-bar__label">Chips</span>
          </NavLink>
          <span className="app-bar__home-spacer" aria-hidden="true" />
          <NavLink to="/decisions" className="app-bar__item app-bar__item--side">
            <RecordIcon className="app-bar__icon" />
            <span className="app-bar__label">Record</span>
          </NavLink>
        </div>
        {/* The dome's own visible rim — the one curve a plain CSS
            `border` cannot draw around a masked shape. Decorative only;
            the Home link below still carries the visible text label
            that gives it its accessible name. */}
        <svg className="app-bar__dome-rim" viewBox={`0 0 ${NAV_HOME_SIZE_PX} ${NAV_BUMP_OVERSHOOT_PX}`} aria-hidden="true" focusable="false">
          <path className="app-bar__dome-rim-path" d={DOME_ARC_PATH} fill="none" strokeLinecap="round" />
        </svg>
        <NavLink to="/" end className="app-bar__item app-bar__item--home">
          <ThisWeekIcon className="app-bar__icon" />
          <span className="app-bar__label">Home</span>
        </NavLink>
      </nav>
    </>
  )
}

export default AppBar
