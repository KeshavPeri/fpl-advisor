import type { ComponentPropsWithoutRef } from 'react'
import './Surface.css'

interface SurfaceProps extends ComponentPropsWithoutRef<'div'> {
  /** Raises the tonal lift slightly — for a surface stacked above another. */
  raised?: boolean
}

/**
 * The elevated translucent-material surface. Every panel in this app —
 * the verdict card, the pitch, the reasoning screen — is built from this:
 * a tonal lift off the base ink, blurred over whatever sits behind it,
 * not a flat card with a border. See design-reference.md, "References,
 * item 1" (Apple Music) and "Committed decisions, Colour".
 *
 * Forwards standard div attributes (className, role, aria-*, …) so callers
 * — e.g. #13's squad-entry screen using role="alert" on a validation
 * panel — don't need a second wrapper element. Added by #13; behaviour and
 * markup for existing callers are unchanged.
 */
function Surface({ raised = false, className, ...rest }: SurfaceProps) {
  const classes = ['surface', raised ? 'surface--raised' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return <div className={classes} {...rest} />
}

export default Surface
