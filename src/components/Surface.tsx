import type { ReactNode } from 'react'
import './Surface.css'

interface SurfaceProps {
  children: ReactNode
  /** Raises the tonal lift slightly — for a surface stacked above another. */
  raised?: boolean
  className?: string
}

/**
 * The elevated translucent-material surface. Every panel in this app —
 * the verdict card, the pitch, the reasoning screen — is built from this:
 * a tonal lift off the base ink, blurred over whatever sits behind it,
 * not a flat card with a border. See design-reference.md, "References,
 * item 1" (Apple Music) and "Committed decisions, Colour".
 */
function Surface({ children, raised = false, className }: SurfaceProps) {
  const classes = ['surface', raised ? 'surface--raised' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return <div className={classes}>{children}</div>
}

export default Surface
