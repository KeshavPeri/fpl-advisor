import type { ReactNode } from 'react'
import './AppShell.css'

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
 */
function AppShell({ children, escalated = false }: AppShellProps) {
  const rootClasses = ['app-shell', escalated ? 'app-shell--escalated' : ''].filter(Boolean).join(' ')

  return (
    <div className={rootClasses}>
      <div className="app-shell__backdrop" aria-hidden="true" />
      <div className="app-shell__backdrop--escalated" aria-hidden="true" />
      <div className="app-shell__column">{children}</div>
    </div>
  )
}

export default AppShell
