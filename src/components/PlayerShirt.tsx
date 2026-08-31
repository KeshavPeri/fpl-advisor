import { formatMoney } from '../lib/format'
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
   * F26/F28 (docs/ui-audit-2026-08-31.md, must-fix) — 'starting' (default)
   * is the eleven: 56px, price shown. 'bench' is smaller (40px) and drops
   * the price line entirely — "bench price is not a decision input"
   * (F28's own wording) — which, together with Pitch.css's own
   * separation, is what makes the bench read as subordinate to the eleven
   * without relying on the "Bench" text label alone.
   */
  size?: 'starting' | 'bench'
}

const RING_CLASS: Record<Availability['ring'], string> = {
  solid: 'player-shirt__badge--ring-solid',
  hollow: 'player-shirt__badge--ring-hollow',
  none: '',
}

/**
 * One player on the pitch: shirt, name, one number (price) — exactly three
 * things (design-reference.md, ticket #38 DoD). Captaincy and the
 * availability ring both render *on* the shirt badge rather than as
 * separate lines, so neither counts as a fourth element.
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md F26 (must-fix) — the starting
 * badge/shirt grew from 48px to 56px (PlayerShirt.css); F29 (should-fix)
 * — the badge is now a recess and the shirt a lift off it, so the
 * silhouette reads as a garment sitting on the badge rather than as an
 * outline barely distinguishable from its own background.
 */
function PlayerShirt({ name, price, captaincy, availability, size = 'starting' }: PlayerShirtProps) {
  const ringClass = RING_CLASS[availability.ring]
  const rootClass = size === 'bench' ? 'player-shirt player-shirt--bench' : 'player-shirt'
  const badgeClass = ['player-shirt__badge', ringClass].filter(Boolean).join(' ')

  return (
    <div className={rootClass}>
      <div className={badgeClass}>
        <div className="player-shirt__shirt" />
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
      {size === 'starting' && <p className="player-shirt__price num">{formatMoney(price)}</p>}
    </div>
  )
}

export default PlayerShirt
