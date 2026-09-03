import { POSITION_LABEL } from '../lib/squad/positions'
import PlayerShirt, { type Captaincy } from './PlayerShirt'
import { buildPitchLayout, type PitchPlayer } from './pitchLayout'
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
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md — F25 (must-fix): the field is
 * no longer a `<Surface>`. F28 (must-fix): the bench is no longer a
 * `<Surface>` either — it sits directly on the base ink, visually
 * subordinate to the eleven through smaller shirts (PlayerShirt's
 * `size="bench"`) and a full `--space-8` break, not through the "Bench"
 * label alone. See Pitch.css and PlayerShirt.css for the exact values
 * (F26/F27/F29).
 *
 * #194, section E — `.bleed-narrow` (AppShell.css) replaces F25's full
 * `.bleed`: the owner reviewed the shipped full-bleed pitch and chose to
 * keep a narrow side margin rather than run to the screen edge (3 Sep
 * 2026, see the dated correction on F25 in docs/ui-audit-2026-08-31.md).
 * The reclaimed width goes into wider shirts and gaps instead
 * (PlayerShirt.css, Pitch.css).
 */
function Pitch({ players }: PitchProps) {
  const { rows, bench } = buildPitchLayout(players)

  return (
    // F25 (must-fix) — the field used to render inside <Surface>, which
    // cost 82px of chrome (column padding + border + panel padding) on a
    // 393px viewport, 21% of the screen, before a single shirt was drawn.
    // #194 — `.bleed-narrow` (AppShell.css) recovers most of that width
    // while keeping a narrow side margin, per the owner's 3 Sep decision;
    // see this file's own header comment. The field has no panel behind
    // it either way.
    <div className="pitch bleed-narrow">
      <div className="pitch__field" role="group" aria-label="Starting XI">
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
      </div>

      {/* F28 (must-fix) — the bench used to be a second <Surface raised>:
          the same panel material as the field above it (`raised` measured
          1.067:1 against the unraised fill — a no-op), the same 48px
          shirts, only 16px of separation. It now sits directly on the base
          ink — no panel at all — with smaller shirts (PlayerShirt's own
          `size="bench"`, PlayerShirt.css) and a full --space-8 break above
          it, so the hierarchy is carried by size, material and space, not
          by the word "Bench" being the only signal. */}
      {bench.length > 0 && (
        <div className="pitch__bench" aria-label="Bench">
          <p className="pitch__bench-title">Bench</p>
          <div className="pitch__bench-row">
            {bench.map((player) => (
              <PlayerShirt
                key={player.playerId}
                name={player.name}
                price={player.price}
                captaincy={captaincyFor(player)}
                availability={player.availability}
                size="bench"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Pitch
