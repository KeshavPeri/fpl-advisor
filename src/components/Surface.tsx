import type { ComponentPropsWithoutRef } from 'react'
import './Surface.css'

interface SurfaceProps extends ComponentPropsWithoutRef<'div'> {
  /**
   * Legacy boolean elevation switch (ticket #8). Kept exactly as-is —
   * every existing call site (Pitch.tsx's bench, ReasoningScreen.tsx's
   * nested player cards) passes this prop, and this ticket (#166) is not
   * allowed to edit those files (CLAUDE.md's scope constraint). Equivalent
   * to `level={3}` when `level` is not given.
   *
   * F15 — this used to resolve to a --panel-fill-raised that measured
   * 1.067:1 against the unraised fill: a no-op, worse than no prop at all
   * because it read as though hierarchy were expressed when it wasn't. It
   * now resolves to --material-3, genuinely distinct — 1.24:1 against
   * level 2 (docs/ui-audit-2026-08-31.md F5) — with no change to either
   * call site's code.
   */
  raised?: boolean
  /**
   * F15/F5 — the real three-level elevation scale. 1 = recessed (list
   * rows, nested cards, sits at 1.06:1 over the base ink — present,
   * never a card), 2 = the standard panel (default, 1.25:1 over base),
   * 3 = the loudest surface on a screen, meant for exactly one per
   * screen (1.55:1 over base, 1.24:1 over level 2). Defaults to 2, or to
   * 3 if `raised` is set and `level` is not (see `raised` above). No
   * existing call site passes this yet — wiring individual screens to
   * the level they actually need is the follow-up ticket's job.
   */
  level?: 1 | 2 | 3
  /**
   * F16 — the two densities design-reference.md asks for (the reasoning
   * screen's Linear-like density vs the home screen's calm), which the
   * component could not express before this prop existed. 'compact'
   * drops padding to --space-4 and radius to --radius-panel-sm (F7).
   * Defaults to 'default' (--space-6, --radius-panel) — today's only
   * behaviour, and still every existing call site's behaviour.
   */
  padding?: 'compact' | 'default'
  /**
   * F12 — the cyan "signature" glow, demoted from every panel (60 call
   * sites, one radial gradient each) to an explicit opt-in reserved for
   * exactly one element per screen (audit: home's verdict card, chips's
   * remaining-chips panel, decisions' season summary — wiring that up is
   * the follow-up ticket's job). Defaults to false; no existing call site
   * sets it, so no panel glows today. See the comment on `.surface__glow`
   * in Surface.css for why this needs a real DOM sibling instead of the
   * old ::before.
   */
  focal?: boolean
}

/**
 * The elevated translucent-material surface. Every panel in this app —
 * the verdict card, the pitch, the reasoning screen — is built from this:
 * a tonal lift off the base ink, blurred over whatever sits behind it,
 * not a flat card with a border. See design-reference.md, "References,
 * item 1" (Apple Music) and "Committed decisions, Colour", and
 * docs/ui-audit-2026-08-31.md F5/F12/F14/F15/F16 for what changed here in
 * ticket #166 and why.
 *
 * Forwards standard div attributes (className, role, aria-*, …) so callers
 * — e.g. #13's squad-entry screen using role="alert" on a validation
 * panel — don't need a second wrapper element. Added by #13; behaviour and
 * markup for existing callers, and the props above defaulting to today's
 * exact look, are unchanged by this ticket.
 */
function Surface({
  raised = false,
  level,
  padding = 'default',
  focal = false,
  className,
  children,
  ...rest
}: SurfaceProps) {
  const resolvedLevel = level ?? (raised ? 3 : 2)
  const classes = [
    'surface',
    `surface--level-${resolvedLevel}`,
    padding === 'compact' ? 'surface--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const panel = (
    <div className={classes} {...rest}>
      {children}
    </div>
  )

  if (!focal) {
    return panel
  }

  // F12 — the glow renders as a sibling *before* the panel, inside a
  // relatively-positioned wrapper, so it paints behind the panel in DOM
  // order and the panel's own backdrop-filter genuinely blurs it. See
  // Surface.css for why a ::before on `.surface` itself cannot do this.
  return (
    <div className="surface__focal-wrap">
      <div className="surface__glow" aria-hidden="true" />
      {panel}
    </div>
  )
}

export default Surface
