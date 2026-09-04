import { useEffect, useRef, type ReactNode } from 'react'
import './AppShell.css'

/**
 * Ticket #202, section A — "parallax it against the scroll... a slow
 * counter-movement makes what sits behind a panel change continuously as
 * the page moves." The backdrop is already `position: fixed` (scrolls at
 * 0x by default, which is already a full parallax relative to the
 * scrolling column), so this adds a small NONZERO drift instead of
 * leaving it perfectly static: as the page scrolls down, the backdrop
 * eases downward by a small fraction of that distance, which continuously
 * changes what sits behind any one panel rather than presenting the same
 * frozen frame all the way down a long screen (the reasoning screen's 12
 * panels, say). Clamped so the drift stays a subtle depth cue on a short
 * scroll and never runs away on a long one.
 */
const PARALLAX_FACTOR = 0.05
const PARALLAX_MAX_PX = 28

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface AppShellProps {
  children?: ReactNode
  /**
   * F19 (docs/ui-audit-2026-08-31.md) — crossfades in a second, more
   * present wash layer for the deadline's inside-24-hours escalation:
   * "the app leaning forward" (design-reference.md, and the audit's P4
   * resolution: the countdown is the largest figure, the wash is what
   * leans forward). Defaults to false. No screen passes this yet —
   * DeadlineCountdown.ts, which knows whether `isEscalated` is true, is
   * out of this ticket's scope (CLAUDE.md), so wiring
   * `<AppShell escalated={...}>` into HomeScreen.tsx is the follow-up
   * ticket's job. This ticket builds the layer and the prop; with it
   * left false everywhere, no screen's backdrop changes today.
   */
  escalated?: boolean
}

/**
 * The single-column, iPhone-first shell every screen renders inside.
 * iOS safe-area aware top and bottom.
 *
 * Ticket #26: the ambient wash lives on `app-shell__backdrop`, a
 * `position: fixed` element painted behind everything and pinned to the
 * viewport, not on `app-shell` itself. `app-shell` grows tall with page
 * content and scrolls with the document; a background painted directly
 * on it would scroll in lockstep with the panels above it, which is the
 * bug this ticket fixes. The "fixed" value of CSS's background
 * attachment property was considered and rejected — iOS Safari ignores
 * it, so the shipped result would scroll on the one device that
 * matters. `aria-hidden` because it is
 * decorative and `pointer-events: none` (in CSS) keeps it from ever
 * intercepting a tap.
 *
 * Ticket #166 / F19: `app-shell__backdrop--escalated` is a second such
 * layer, always rendered, crossfaded via `escalated` above rather than
 * painted conditionally — see AppShell.css for why (custom properties
 * don't interpolate, so two full layers plus an opacity transition is
 * the reliable mechanism, not one layer whose gradient values change).
 *
 * Ticket #202, section A: the grain layer #194 added as a separate
 * `app-shell__grain` div is now folded into `app-shell__backdrop` itself
 * as one more layer of its own background (AppShell.css) — one material
 * with real per-pixel detail and several colour centres, not three
 * independent divs. This component now also drives that backdrop's
 * scroll parallax (see the module-level comment on PARALLAX_FACTOR):
 * `window.scrollY` is read because the section E fix (src/index.css,
 * this file's own sibling — `html`/`body`'s `overflow-x: clip` in place
 * of `overflow-x: hidden`) keeps the DOCUMENT as the real scroller rather
 * than turning it into a nested `overflow: auto` container, which is
 * what `window.scrollY` needs to be meaningful at all.
 */
function AppShell({ children, escalated = false }: AppShellProps) {
  const rootClasses = ['app-shell', escalated ? 'app-shell--escalated' : ''].filter(Boolean).join(' ')
  const backdropRef = useRef<HTMLDivElement>(null)
  const escalatedBackdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0

    function applyParallax() {
      frame = 0
      // Checked every frame rather than once at mount, so a change to
      // the OS setting while the app is open takes effect immediately —
      // and, if it's on, the two backdrop layers simply keep whatever
      // transform they last had (none, on first paint), never move.
      if (prefersReducedMotion()) return
      const offset = Math.max(-PARALLAX_MAX_PX, Math.min(PARALLAX_MAX_PX, window.scrollY * PARALLAX_FACTOR))
      const transform = `translate3d(0, ${offset}px, 0)`
      if (backdropRef.current) backdropRef.current.style.transform = transform
      if (escalatedBackdropRef.current) escalatedBackdropRef.current.style.transform = transform
    }

    function onScroll() {
      if (frame) return
      frame = requestAnimationFrame(applyParallax)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className={rootClasses}>
      <div className="app-shell__backdrop" ref={backdropRef} aria-hidden="true" />
      <div className="app-shell__backdrop--escalated" ref={escalatedBackdropRef} aria-hidden="true" />
      <div className="app-shell__column">{children}</div>
    </div>
  )
}

export default AppShell
