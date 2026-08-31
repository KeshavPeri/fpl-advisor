import { NavLink } from 'react-router'
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
 *   - "This week" (/) — the screen the app exists for.
 *   - "Chips" (/chips) — standing season state, checked periodically,
 *     not reached from any single decision.
 *   - "Record" (/decisions) — the track record, a destination in its own
 *     right.
 * /reasoning, /override and /squad stay contextual, reached from the
 * surfaces they belong to (the verdict card, the pitch, the incomplete
 * banner) rather than from here.
 *
 * Text labels, not icons: design-reference.md forbids emoji as icons
 * anywhere, and this app draws no icon set at all — inventing one here
 * would be a larger, less reversible decision than this ticket should
 * make (Tier 2/3 boundary, see the ticket's decision log).
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
          already trusts instead. Purely decorative: pointer-events: none
          so it never intercepts a tap either for content beneath it or
          for the bar itself, which paints above it (z-index 10 vs 9). */}
      <div className="app-bar__scrim" aria-hidden="true" />
      <nav className="app-bar" aria-label="Primary">
        <NavLink to="/" end className="app-bar__item">
          This week
        </NavLink>
        <NavLink to="/chips" className="app-bar__item">
          Chips
        </NavLink>
        <NavLink to="/decisions" className="app-bar__item">
          Record
        </NavLink>
      </nav>
    </>
  )
}

export default AppBar
