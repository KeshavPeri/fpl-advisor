import { POSITION_LABEL } from '../lib/squad/positions'
import PlayerShirt, { type Captaincy } from './PlayerShirt'
import { buildPitchLayout, type PitchPlayer } from './pitchLayout'
import Surface from './Surface'
import './Pitch.css'
export type { PitchPlayer } from './pitchLayout'

interface PitchProps {
  players: readonly PitchPlayer[]
}

function captaincyFor(player: PitchPlayer): Captaincy {
  if (player.isCaptain) return 'captain'
  if (player.isViceCaptain) return 'vice-captain'
  return null
}

/**
 * The squad as a pitch (ticket #38, feature-list item 16). Purely
 * presentational: takes already-resolved `PitchPlayer` objects and lays
 * them out — starting XI in GK/DEF/MID/FWD rows sized to the actual saved
 * squad, bench visually separated below, sorted by benchOrder. No fetching,
 * no editing, no tap-through; see HomeScreen.tsx for how the picks in
 * `players` were composed and decisions/ticket-38.md for the read path.
 */
function Pitch({ players }: PitchProps) {
  const { rows, bench } = buildPitchLayout(players)

  return (
    <div className="pitch">
      <Surface className="pitch__field">
        {rows.map((row) => (
          <div
            className="pitch__row"
            role="group"
            aria-label={POSITION_LABEL[row.position]}
            key={row.position}
          >
            {row.players.map((player) => (
              <PlayerShirt
                key={player.playerId}
                name={player.name}
                price={player.price}
                captaincy={captaincyFor(player)}
                availability={player.availability}
              />
            ))}
          </div>
        ))}
      </Surface>

      {bench.length > 0 && (
        <Surface className="pitch__bench" raised aria-label="Bench">
          <p className="pitch__bench-title">Bench</p>
          <div className="pitch__bench-row">
            {bench.map((player) => (
              <PlayerShirt
                key={player.playerId}
                name={player.name}
                price={player.price}
                captaincy={captaincyFor(player)}
                availability={player.availability}
              />
            ))}
          </div>
        </Surface>
      )}
    </div>
  )
}

export default Pitch
