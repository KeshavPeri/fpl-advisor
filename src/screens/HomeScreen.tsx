import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import { deriveAvailability } from '../components/pitchAvailability'
import Pitch, { type PitchPlayer } from '../components/Pitch'
import PitchSkeleton from '../components/PitchSkeleton'
import Surface from '../components/Surface'
import { toErrorMessage } from '../lib/format'
import { fetchExistingSquad, fetchPlayers, fetchTargetGameweek } from '../lib/squad/api'
import { SQUAD_SIZE } from '../lib/squad/positions'
import './HomeScreen.css'

/**
 * Ticket #38 — the squad as a pitch. Countdown (item 18) and verdict card
 * (item 17) are separate tickets and deliberately not here yet
 * (product-brief.md §1: home screen order is countdown, verdict, pitch —
 * this ticket builds only the third piece). Replaces the design-token demo
 * panel #8 left on this screen.
 *
 * Data note (see decisions/ticket-38.md): the pitch reads via
 * fetchTargetGameweek + fetchExistingSquad, plus fetchPlayers for player
 * name/position/price — fetchExistingSquad's picks carry only a bare
 * playerId, so fetchPlayers is the only existing read that supplies those.
 * Neither fetchPlayers nor fetchExistingSquad expose `players.status` or
 * `players.chance_of_playing_next_round`, so every player renders with no
 * availability ring for now — a real, reported gap, not a design choice.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'no-gameweek' }
  | { status: 'no-squad'; gameweekName: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; gameweekName: string; pickCount: number; players: PitchPlayer[] }

function HomeScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const gw = await fetchTargetGameweek()
        if (cancelled) return
        if (!gw) {
          setLoadState({ status: 'no-gameweek' })
          return
        }

        const [playerList, existing] = await Promise.all([
          fetchPlayers(),
          fetchExistingSquad(gw.id),
        ])
        if (cancelled) return

        if (!existing || existing.picks.length === 0) {
          setLoadState({ status: 'no-squad', gameweekName: gw.name })
          return
        }

        const playersById = new Map(playerList.map((p) => [p.id, p]))
        const pitchPlayers: PitchPlayer[] = []
        for (const pick of existing.picks) {
          const player = playersById.get(pick.playerId)
          if (!player) continue // stale/unknown id — skip rather than crash
          pitchPlayers.push({
            playerId: pick.playerId,
            position: player.elementType,
            name: player.webName,
            price: player.nowCost,
            isStarting: pick.isStarting,
            benchOrder: pick.benchOrder,
            isCaptain: pick.isCaptain,
            isViceCaptain: pick.isViceCaptain,
            // Availability data isn't exposed by any existing read yet —
            // see the file header comment. `deriveAvailability` itself is
            // fully implemented and tested against the real rules; this is
            // the one line to change once status/chance are readable.
            availability: deriveAvailability('a', null),
          })
        }

        setLoadState({
          status: 'ready',
          gameweekName: gw.name,
          pickCount: existing.picks.length,
          players: pitchPlayers,
        })
      } catch (err) {
        if (cancelled) return
        setLoadState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell>
      <header className="home-mark">FPL Advisor</header>

      {loadState.status === 'loading' && <PitchSkeleton />}

      {loadState.status === 'no-gameweek' && (
        <Surface>
          <p className="home-status-text">
            No gameweeks are loaded yet. Run the FPL ingest job
            (<code className="num">scripts/ingest-fpl.ts</code>) to populate them, then reload
            this page.
          </p>
        </Surface>
      )}

      {loadState.status === 'no-squad' && (
        <Surface className="home-invitation">
          <p className="home-invitation__title">No squad saved for {loadState.gameweekName}</p>
          <p className="home-invitation__body">
            Enter your 15 picks to see them here as a pitch.
          </p>
          <Link className="home-invitation__link" to="/squad">
            Enter your squad →
          </Link>
        </Surface>
      )}

      {loadState.status === 'error' && (
        <Surface role="alert">
          <p className="home-status-text home-status-text--error">
            Couldn't load your squad: {loadState.message}. Check your connection and reload this
            page to try again.
          </p>
        </Surface>
      )}

      {loadState.status === 'ready' && (
        <>
          {loadState.pickCount < SQUAD_SIZE && (
            <Surface className="home-incomplete" role="status">
              <p className="home-incomplete__text">
                {loadState.gameweekName} squad is incomplete — {loadState.pickCount} of{' '}
                {SQUAD_SIZE} picks saved.{' '}
                <Link className="home-incomplete__link" to="/squad">
                  Finish it →
                </Link>
              </p>
            </Surface>
          )}
          <Pitch players={loadState.players} />
        </>
      )}
    </AppShell>
  )
}

export default HomeScreen
