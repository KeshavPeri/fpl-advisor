import type { CSSProperties } from 'react'
import { formatMoney } from '../lib/format'
import { getTeamColours } from '../lib/teamColours'
import type { Availability } from './pitchAvailability'
import './PlayerShirt.css'

export type Captaincy = 'captain' | 'vice-captain' | null

interface PlayerShirtProps {
  name: string
  /** Tenths of a million — formatted here via formatMoney, never pre-formatted by the caller. */
  price: number
  captaincy: Captaincy
  availability: Availability
  /**
   * `players.teams(short_name)` (ticket #276, H3) — looked up against src/lib/teamColours.ts to
   * tint the shirt body/trim. `undefined`/`null`, or a club teamColours.ts doesn't recognise,
   * both fall back to the app's own neutral placeholder gradient — never a crash, never a blank
   * shirt.
   */
  teamShortName?: string | null
}

const RING_CLASS: Record<Availability['ring'], string> = {
  solid: 'player-shirt__badge--ring-solid',
  hollow: 'player-shirt__badge--ring-hollow',
  none: '',
}

/**
 * A custom-property style object, typed loosely because React's CSSProperties doesn't know
 * about custom properties — the one place this component reaches for an inline style rather than
 * a class, because the colour is genuinely per-instance data (one of 20 clubs), not a design
 * decision a shared class could express (PlayerShirt.css's own `--player-shirt-*` consumers carry
 * the actual design decision: how a primary/secondary pair becomes a shirt).
 */
function shirtColourStyle(shortName: string | null | undefined): CSSProperties | undefined {
  const colours = getTeamColours(shortName)
  if (!colours) return undefined
  return {
    '--player-shirt-primary': colours.primary,
    '--player-shirt-secondary': colours.secondary,
  } as CSSProperties
}

/**
 * One player on the pitch: shirt, name, one number (price) — exactly three
 * things (design-reference.md, ticket #38 DoD). Captaincy and the
 * availability ring both render *on* the shirt badge rather than as
 * separate lines, so neither counts as a fourth element.
 *
 * Ticket #276 (docs/ui-audit-2026-09-25.md H2/H3) — the starting/bench size
 * split is gone: every shirt on the pitch, bench included, is the same
 * size and always shows its price (H2, "make them same size as main
 * team" — bench price was previously withheld on the theory that "bench
 * price is not a decision input"; the owner's own instruction this ticket
 * implements says otherwise). H3 — the shirt body now tints toward the
 * player's own club colour (src/lib/teamColours.ts) instead of one
 * identical dark placeholder for every player, subtly (see that file's own
 * header for why it stays well short of a literal club-kit graphic) and
 * falls back to the original neutral gradient (PlayerShirt.css) for a
 * player with no resolvable team colour.
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md F26 (must-fix) — the starting
 * badge/shirt grew from 48px to 56px (PlayerShirt.css); F29 (should-fix)
 * — the badge is now a recess and the shirt a lift off it, so the
 * silhouette reads as a garment sitting on the badge rather than as an
 * outline barely distinguishable from its own background.
 */
function PlayerShirt({ name, price, captaincy, availability, teamShortName = null }: PlayerShirtProps) {
  const ringClass = RING_CLASS[availability.ring]
  const badgeClass = ['player-shirt__badge', ringClass].filter(Boolean).join(' ')
  const colourStyle = shirtColourStyle(teamShortName)
  const shirtClass = colourStyle ? 'player-shirt__shirt player-shirt__shirt--club' : 'player-shirt__shirt'

  return (
    <div className="player-shirt">
      <div className={badgeClass}>
        <div className={shirtClass} style={colourStyle} />
        {captaincy && (
          <span
            className={
              captaincy === 'captain'
                ? 'player-shirt__captaincy player-shirt__captaincy--captain'
                : 'player-shirt__captaincy player-shirt__captaincy--vice'
            }
          >
            <span aria-hidden="true">{captaincy === 'captain' ? 'C' : 'V'}</span>
            <span className="player-shirt__visually-hidden">
              {captaincy === 'captain' ? 'Captain' : 'Vice-captain'}
            </span>
          </span>
        )}
        {availability.ring !== 'none' && (
          <span className="player-shirt__visually-hidden">{availability.label}</span>
        )}
      </div>
      <p className="player-shirt__name">{name}</p>
      <p className="player-shirt__price num">{formatMoney(price)}</p>
    </div>
  )
}

export default PlayerShirt
