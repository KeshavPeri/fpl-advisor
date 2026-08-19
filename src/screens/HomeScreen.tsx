import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import DeadlineCountdown, { type DeadlineCountdownState } from '../components/DeadlineCountdown'
import { deriveAvailability } from '../components/pitchAvailability'
import Pitch, { type PitchPlayer } from '../components/Pitch'
import PitchSkeleton from '../components/PitchSkeleton'
import Surface from '../components/Surface'
import VerdictCard from '../components/VerdictCard'
import { toErrorMessage } from '../lib/format'
import { fetchExistingSquad, fetchPlayers, fetchTargetGameweek } from '../lib/squad/api'
import { SQUAD_SIZE } from '../lib/squad/positions'
import type { TargetGameweek } from '../lib/squad/types'
import './HomeScreen.css'

/**
 * Ticket #38 — the squad as a pitch. The countdown (item 18, ticket #42)
 * renders above everything else in this component, fed by the same
 * fetchTargetGameweek() call the pitch section already makes (see
 * countdownState below; ticket #42: "do not add a second query for the same
 * row"). Replaces the design-token demo panel #8 left on this screen.
 *
 * The verdict card (item 17, ticket #61) now sits between the countdown and
 * the pitch — product-brief.md §1's full home-screen order. It owns its own
 * read (fetchVerdict, not filtered to this gameweek — see
 * src/lib/verdict/api.ts) and only needs this screen's target gameweek
 * id/name to decide fresh vs stale, so it's handed those via
 * `targetGameweek` state below rather than a prop drilled out of
 * countdownState (which doesn't carry the gameweek id).
 *
 * Data note (see decisions/ticket-38.md): the pitch reads via
 * fetchTargetGameweek + fetchExistingSquad, plus fetchPlayers for player
 * name/position/price — fetchExistingSquad's picks carry only a bare
 * playerId, so fetchPlayers is the only existing read that supplies those.
 * Ticket #61 added `status` and `chance_of_playing_next_round` to
 * fetchPlayers, so every player's availability ring below is now real.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'no-gameweek' }
  | { status: 'no-squad'; gameweekName: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; gameweekName: string; pickCount: number; players: PitchPlayer[] }

function HomeScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [countdownState, setCountdownState] = useState<DeadlineCountdownState>({
    status: 'loading',
  })
  // VerdictCard needs the gameweek id (countdownState only carries the name
  // and the deadline) — see the file header comment.
  const [targetGameweek, setTargetGameweek] = useState<TargetGameweek | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const gw = await fetchTargetGameweek()
        if (cancelled) return
        if (!gw) {
          setLoadState({ status: 'no-gameweek' })
          setCountdownState({ status: 'unavailable' })
          setTargetGameweek(null)
          return
        }

        setCountdownState({
          status: 'ready',
          gameweekName: gw.name,
          deadlineIso: gw.deadlineTime,
        })
        setTargetGameweek(gw)

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
            availability: deriveAvailability(player.status, player.chanceOfPlayingNextRound),
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
        // Covers a fetchTargetGameweek() failure too (countdownState would
        // otherwise be stuck on 'loading' forever) as well as a later
        // players/squad failure, where it was already set to 'ready' —
        // re-setting to 'unavailable' here is wrong in that second case
        // only if countdownState is already 'ready', so guard on that.
        setCountdownState((current) =>
          current.status === 'ready' ? current : { status: 'unavailable' }
        )
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell>
      <DeadlineCountdown state={countdownState} />
      <header className="home-mark">FPL Advisor</header>

      {targetGameweek && (
        <VerdictCard gameweekId={targetGameweek.id} gameweekName={targetGameweek.name} />
      )}

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
