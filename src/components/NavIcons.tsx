/**
 * The navigation bar's icon set — three glyphs, drawn here as inline
 * SVG. Correction B to ticket #166: the bar shipped text-only because
 * "this app draws no icons anywhere" and the audit judged inventing a
 * set to be a larger decision than it should make (F17, P10). It is a
 * navigation bar; it needs icons, and drawing three is smaller than
 * taking a dependency for them.
 *
 * The rules these follow, all of them constraints on this ticket:
 *
 *  - **No icon library, no new dependency.** Every path below is drawn
 *    in this repo.
 *  - **No emoji, ever.** design-reference.md forbids emoji as icons
 *    anywhere in this app.
 *  - **One grid.** All three are drawn on the same 24x24 viewBox and
 *    rendered at the same size (--nav-icon-size, AppBar.css), so their
 *    optical weights match rather than each glyph having its own scale.
 *  - **One stroke weight, stroke not fill.** `fill="none"` is set here;
 *    `stroke-width` is deliberately NOT set here, because AppBar.css
 *    owns it — that is what lets the active destination thicken its
 *    glyph (1.5 -> 2) as a non-colour state cue. Round caps and joins
 *    throughout, matching the app's soft-cornered geometry (28px/20px
 *    panel radii, 22px bar radius) rather than cutting square corners
 *    into it.
 *  - **`currentColor`.** Active and inactive states come from the
 *    existing --text-* tokens the labels already use. No icon introduces
 *    a colour of its own, so there is nothing here to review against the
 *    no-green/no-yellow/no-purple constraint.
 *  - **Decorative.** Each <svg> is aria-hidden with focusable="false"
 *    (the latter for IE/older-Edge-era engines that would otherwise put
 *    an SVG in the tab order). The accessible name of every destination
 *    comes from its visible text label in AppBar.tsx — the icons add a
 *    second, redundant channel and never become the only one.
 *
 * Restraint over invention: each glyph is the plainest conventional
 * form for its destination, because a nav icon's whole job is to be
 * recognised in peripheral vision. No badges, no filled shapes, no
 * accent fills, no motion.
 */
import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

/** Shared geometry. See the file header for why stroke-width is absent. */
function Glyph({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * "This week" (`/`) — a calendar. The home screen is the current
 * gameweek: a deadline, a squad and one decision, all scoped to a single
 * week. A calendar is the one glyph that says "a bounded stretch of
 * time" without needing a label to disambiguate it.
 */
export function ThisWeekIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="3.5" />
      <path d="M3.5 10.5h17" />
      <path d="M8.25 3.5v4M15.75 3.5v4" />
    </Glyph>
  )
}

/**
 * "Chips" (`/chips`) — a stack, drawn as the standard two-stroke layers
 * form. Chips are a small, finite set of one-use items held in reserve
 * and spent one at a time, which is exactly what a stack depicts. A
 * literal poker chip (concentric circles) was the obvious alternative
 * and was rejected: at 22px it is indistinguishable from a target or a
 * record button, and it depicts the token rather than the fact that
 * there are a countable few of them left.
 */
export function ChipsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5Z" />
      <path d="M3.5 12.75 12 17.25l8.5-4.5" />
    </Glyph>
  )
}

/**
 * "Record" (`/decisions`) — a log: three rules, the last one short. The
 * decisions screen is an append-only ledger of what was committed or
 * overridden, and a part-written last line is what distinguishes a log
 * that is still being added to from a menu of three equal items.
 */
export function RecordIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 7h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 17h8.5" />
    </Glyph>
  )
}

/**
 * "Why" (`/reasoning`) — ticket #275, the fourth tab added by the Reddit-
 * style nav rewrite (docs/ui-nav-spec-2026-09-25.md). A circle holding a
 * question mark: the plainest conventional glyph for "why", matching the
 * other three icons' own restraint (a calendar for a bounded week, a
 * stack for a finite held-in-reserve set, a log for an append-only
 * ledger) rather than reaching for something that only reads once you
 * already know what it means. A lightbulb or a chat bubble were both
 * considered and rejected — a bulb reads as "idea/tip" more than "why
 * this decision", and design-reference.md's "no chat bubbles, no AI
 * framing" rule is specifically about not presenting the model's output
 * as a conversation, which a nav icon for a literal, permanent screen
 * destination would risk evoking for no gain over the simpler mark.
 */
export function WhyIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.6a2.75 2.75 0 0 1 5.25 1.15c0 1.85-2.75 2.1-2.75 3.45" />
      <path d="M12 17.15h.01" />
    </Glyph>
  )
}
