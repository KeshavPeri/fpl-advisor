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
 */
function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__column">{children}</div>
    </div>
  )
}

export default AppShell
