import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChipsIcon, RecordIcon, ThisWeekIcon, WhyIcon } from './NavIcons.tsx'
import './AppBar.css'

/**
 * Ticket #275 — the Reddit-style glass nav bar, replacing #202's dome/
 * bump silhouette entirely. Full spec: docs/ui-nav-spec-2026-09-25.md and
 * the reference frames in docs/ui-refs/reddit-*.jpg.
 *
 * Four equal destinations now (Why is new — every route stays reachable,
 * per the ticket, so /squad and /override stay contextual, reached from
 * the surfaces they belong to). One active treatment for all four: a
 * sliding inner pill, not a raised centre item — the ticket is explicit
 * that today's Home "hump" and its separate active style both go.
 */
const TABS: ReadonlyArray<{
  to: string
  label: string
  end?: boolean
  Icon: typeof ThisWeekIcon
}> = [
  { to: '/', label: 'Home', end: true, Icon: ThisWeekIcon },
  { to: '/reasoning', label: 'Why', Icon: WhyIcon },
  { to: '/chips', label: 'Chips', Icon: ChipsIcon },
  { to: '/decisions', label: 'Record', Icon: RecordIcon },
]

/** rem values resolved against a 16px root font size — see the identical
 * note this codebase already carries on this exact assumption (git blame
 * on this file, ticket #202): the app never changes the root font size. */
const NAV_CIRCLE_DIAMETER_PX = 3.5 * 16 // --nav-bar-height, index.css — the bar's own height doubles as the collapsed circle's diameter, see AppBar.css's header comment.

/**
 * Feature-detects `backdrop-filter: url(#svg-filter)` — real refraction
 * via `feDisplacementMap`, per the nav spec's "honest limit": Chromium
 * supports SVG filter references inside `backdrop-filter`, Safari
 * (including iOS, the owner's own phone) as far as we know does not.
 * `CSS.supports` validates syntax rather than guaranteeing the filter
 * actually renders, which is the best static test available; it is what
 * the nav spec itself asks the Builder to use ("feature-detect it").
 * Computed once at module load, not per render — support doesn't change
 * mid-session — and guarded so it never throws where `CSS` doesn't exist
 * at all (this module's own test file renders under Node/vitest, with no
 * DOM, no `CSS` global).
 */
function supportsBackdropRefraction(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  try {
    return CSS.supports('backdrop-filter', 'url(#nav-glass-refraction-probe)')
  } catch {
    return false
  }
}
const SUPPORTS_REFRACTION = supportsBackdropRefraction()

/**
 * The scroll-direction → collapsed/expanded state machine, factored out
 * as a pure function per the ticket's own DoD ("a test for the scroll-
 * direction → collapsed/expanded state logic (pure function, with a
 * threshold)") — AppBar.test.ts exercises this directly, with no DOM.
 *
 * Hysteresis, not an instant per-frame direction check: `lastY` only
 * advances when this function actually decides something (a state flip,
 * or the top guard) — never on a call that falls inside the threshold
 * band. That means small back-and-forth jitter (the kind rubber-band
 * scrolling or a trackpad produces) keeps measuring its delta against
 * the SAME reference point instead of resetting every call, so it only
 * ever flips state once real, sustained motion in one direction
 * accumulates past NAV_COLLAPSE_THRESHOLD_PX — "a small threshold so it
 * doesn't flicker," per the nav spec.
 */
export const NAV_COLLAPSE_THRESHOLD_PX = 14
export const NAV_COLLAPSE_TOP_GUARD_PX = 24

export interface NavScrollState {
  lastY: number
  collapsed: boolean
}

export function nextNavScrollState(prev: NavScrollState, rawY: number): NavScrollState {
  const y = Math.max(0, rawY) // clamp iOS's negative rubber-band overscroll
  if (y <= NAV_COLLAPSE_TOP_GUARD_PX) {
    // Never collapsed this close to the top — the bar should always be
    // fully visible on a screen that hasn't really been scrolled yet.
    return { lastY: y, collapsed: false }
  }
  const delta = y - prev.lastY
  if (delta >= NAV_COLLAPSE_THRESHOLD_PX) {
    return prev.collapsed ? { ...prev, lastY: y } : { lastY: y, collapsed: true }
  }
  if (delta <= -NAV_COLLAPSE_THRESHOLD_PX) {
    return prev.collapsed ? { lastY: y, collapsed: false } : { ...prev, lastY: y }
  }
  return prev
}

function AppBar() {
  const location = useLocation()
  const activeIndex = useMemo(() => TABS.findIndex((tab) => tab.to === location.pathname), [location.pathname])
  // /squad and /override stay contextual — no tab matches them. The
  // collapsed circle and the active pill still need SOME icon/position to
  // show; Home is the reasonable default rather than showing nothing.
  const displayIndex = activeIndex === -1 ? 0 : activeIndex

  const [collapsed, setCollapsed] = useState(false)
  const scrollStateRef = useRef<NavScrollState>({ lastY: 0, collapsed: false })
  const shapeRef = useRef<HTMLDivElement>(null)
  const pillFillRef = useRef<HTMLSpanElement>(null)
  const iconRefs = useRef<Array<HTMLSpanElement | null>>([])
  const prevDisplayIndexRef = useRef(displayIndex)

  // New screen: show the full bar again rather than carrying over
  // whatever collapse state the previous screen's scroll position left
  // behind. Also re-anchors the scroll reference point to wherever this
  // screen actually starts, so the very first scroll event on it measures
  // a real delta instead of jumping against a stale lastY from before.
  useEffect(() => {
    const y = typeof window === 'undefined' ? 0 : window.scrollY
    scrollStateRef.current = { lastY: y, collapsed: false }
    setCollapsed(false)
  }, [location.pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame = 0
    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = nextNavScrollState(scrollStateRef.current, window.scrollY)
        scrollStateRef.current = next
        setCollapsed((was) => (was === next.collapsed ? was : next.collapsed))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Measures the glass shape's own rendered pixel width, so the pill-to-
  // circle collapse is a pure `transform: scaleX()` anchored at the
  // shape's own left edge (`transform-origin: left`, AppBar.css) instead
  // of animating width/border-radius directly — both non-composited
  // properties, and the nav spec requires transform/opacity only for
  // 60fps. At the exact scale NAV_CIRCLE_DIAMETER_PX / measuredWidth, a
  // box that is already --nav-bar-height tall with a border-radius of
  // half that stays a true circle of that diameter throughout — not an
  // approximation, because the vertical axis is never scaled (scaleY
  // stays 1 the whole time). A ResizeObserver, not a plain resize
  // listener, so a width change from anything other than the viewport
  // (font load, safe-area changes on rotation) still stays in sync. A
  // plain useEffect, not useLayoutEffect — the bar always starts expanded
  // (scaleX(1), which ignores --nav-collapse-scale entirely) and no
  // scroll interaction can happen before this effect has run, so there is
  // no pre-paint flash to guard against, and useLayoutEffect would only
  // add an SSR dev-warning this codebase otherwise has none of.
  useEffect(() => {
    const shape = shapeRef.current
    if (!shape || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (!width) return
      const scale = Math.min(1, NAV_CIRCLE_DIAMETER_PX / width)
      shape.style.setProperty('--nav-collapse-scale', scale.toFixed(4))
    })
    observer.observe(shape)
    return () => observer.disconnect()
  }, [])

  // Retriggers the pill-stretch / icon-bounce keyframes on every genuine
  // tab change (never on first mount) by removing the modifier class,
  // forcing a reflow, then re-adding it — the standard way to restart a
  // CSS animation without remounting the element. Both are @keyframes
  // (AppBar.css), so prefers-reduced-motion's existing global rule
  // (animation-duration: 0.01ms !important, index.css) already collapses
  // them to imperceptible on its own — no local reduced-motion check
  // needed here, same reasoning AppShell.tsx's own header comment gives
  // for its screen-enter keyframe.
  useEffect(() => {
    if (prevDisplayIndexRef.current === displayIndex) return
    prevDisplayIndexRef.current = displayIndex
    for (const el of [pillFillRef.current, iconRefs.current[displayIndex]]) {
      if (!el) continue
      el.classList.remove('app-bar__pulse')
      void el.offsetWidth
      el.classList.add('app-bar__pulse')
    }
  }, [displayIndex])

  const pillStyle = { '--nav-active-index': displayIndex } as CSSProperties
  const CollapsedTabIcon = TABS[displayIndex].Icon

  return (
    <nav className="app-bar" aria-label="Primary" data-collapsed={collapsed}>
      {/* Hidden defs powering the real-refraction tier — Chromium only
          (SUPPORTS_REFRACTION), never rendered as visible content. Width/
          height 0 plus overflow hidden keeps it out of layout entirely. */}
      <svg className="app-bar__defs" aria-hidden="true" focusable="false">
        <filter id="nav-glass-refraction" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.09" numOctaves="1" seed="7" result="nav-noise" />
          <feDisplacementMap in="SourceGraphic" in2="nav-noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      {/* The glass material itself — background, blur/refraction, rim,
          sheen and outer glow. Carries none of the interactive content,
          so it can be the one element that scales (collapse) without
          squashing anything inside it (AppBar.css's own header comment
          on why this is a separate layer from .app-bar__row). */}
      <div
        ref={shapeRef}
        className={`app-bar__shape ${SUPPORTS_REFRACTION ? 'app-bar__shape--refract' : 'app-bar__shape--faux'}`}
      >
        <span className="app-bar__sheen" aria-hidden="true" />
      </div>

      <div className="app-bar__row" aria-hidden={collapsed}>
        <span className="app-bar__active-pill" style={pillStyle} aria-hidden="true">
          <span className="app-bar__active-pill-fill" ref={pillFillRef} />
        </span>
        {TABS.map((tab, index) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="app-bar__item">
            <span
              className="app-bar__icon-wrap"
              ref={(el) => {
                iconRefs.current[index] = el
              }}
            >
              <tab.Icon className="app-bar__icon" />
            </span>
            <span className="app-bar__label">{tab.label}</span>
          </NavLink>
        ))}
      </div>

      {/* The collapsed state — one glass circle, bottom-left, showing
          only the current tab's icon. A real <button>, not a NavLink:
          tapping it restores the bar (per the nav spec) rather than
          navigating anywhere. Always sized/positioned to exactly match
          where .app-bar__shape's own scaleX collapse lands it (top:0;
          left:0; width/height: --nav-bar-height), so it never needs its
          own measurement. */}
      <button
        type="button"
        className="app-bar__collapsed"
        onClick={() => setCollapsed(false)}
        aria-hidden={!collapsed}
        aria-label={`Show navigation (currently on ${TABS[displayIndex].label})`}
      >
        <CollapsedTabIcon className="app-bar__icon" />
      </button>
    </nav>
  )
}

export default AppBar
