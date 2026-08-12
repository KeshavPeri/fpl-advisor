import type { ReactNode } from 'react'
import './AppShell.css'

interface AppShellProps {
  children: ReactNode
}

/**
 * The single-column, iPhone-first shell every screen renders inside.
 * iOS safe-area aware top and bottom — there is no router yet (that
 * arrives with ticket #13), so this simply frames whatever page content
 * is passed to it.
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
 */
function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__backdrop" aria-hidden="true" />
      <div className="app-shell__column">{children}</div>
    </div>
  )
}

export default AppShell
