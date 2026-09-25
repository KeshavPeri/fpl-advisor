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
   * now resolves to --material-3, genuinely distinct — 1.240:1 against
   * level 2 (docs/ui-audit-2026-08-31.md F5) — with no change to either
   * call site's code. The ticket-79 follow-up keeps that number and takes
   * the alpha back out of it: all three levels now share one 0.55 fill
   * alpha and separate on colour and top-edge light instead.
   */
  raised?: boolean
  /**
   * F15/F5, then ticket #275 (audit G2 — "two card styles (blue glass vs
   * near-black) used with no meaning. Pick one, plus one emphasis
   * variant"). This prop's three-way VALUE is unchanged, deliberately —
   * every existing call site (DeadlineCountdown, ChipsScreen,
   * ReasoningScreen…) still passes `level={1}`, `level={2}` or
   * `level={3}`, and this ticket cannot edit those files (CLAUDE.md's
   * scope constraint; "screens are not edited, they inherit through
   * Surface"). What changed is the RESOLUTION: 1 and 2 now render
   * identically — the one card material (--material-2) — and only 3
   * renders as the emphasis variant (--material-3). The near-black
   * level-1 fill (--material-1) that G2 named is gone from Surface
   * entirely; see Surface.css's own header comment for why the token
   * itself stays defined in index.css regardless (PlayerShirt.css and
   * VerdictCard.css, both outside this ticket's scope, still read it
   * directly for their own unrelated recess treatments).
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
 * a tonal lift off the base ink that the ambient wash tints through,
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
  // Ticket #275 — one card material plus one emphasis variant (audit
  // G2): every caller's own level (1, 2 or 3) still resolves, but only
  // resolvedLevel 3 renders as the distinct "emphasis" class; 1 and 2
  // both render as the one base "surface--level-2" class. See the
  // `level` prop's own doc comment above for the because.
  const visualTier = resolvedLevel >= 3 ? 3 : 2
  const classes = [
    'surface',
    `surface--level-${visualTier}`,
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
  // order rather than on top of its fill. See Surface.css for why a
  // ::before on `.surface` itself cannot do this.
  return (
    <div className="surface__focal-wrap">
      <div className="surface__glow" aria-hidden="true" />
      {panel}
    </div>
  )
}

export default Surface
