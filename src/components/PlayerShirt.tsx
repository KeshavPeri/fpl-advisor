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
 */
function PlayerShirt({ name, price, captaincy, availability }: PlayerShirtProps) {
  const ringClass = RING_CLASS[availability.ring]
  const badgeClass = ['player-shirt__badge', ringClass].filter(Boolean).join(' ')

  return (
    <div className="player-shirt">
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
      <p className="player-shirt__price num">{formatMoney(price)}</p>
    </div>
  )
}

export default PlayerShirt
