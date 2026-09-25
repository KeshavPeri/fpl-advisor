import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AccuracyCard from '../components/AccuracyCard'
import AppShell from '../components/AppShell'
import DeadlineCountdown, { type DeadlineCountdownState } from '../components/DeadlineCountdown'
import MiniLeagueCard from '../components/MiniLeagueCard'
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
 *
 * Ticket #85's only change here is the "Chips →" link next to the mark,
 * through to the new /chips screen — that screen owns its own fetch
 * entirely (src/lib/chips/api.ts), independent of everything above.
 *
 * Ticket #96 adds AccuracyCard below the pitch — product-brief.md §2's
 * rolling accuracy figure — completing design-reference.md's home-screen
 * order (countdown, verdict, pitch, then this card). It owns its own read
 * (src/lib/accuracy/api.ts) and renders unconditionally, the same
 * independence VerdictCard already has from the pitch's own load state.
 *
 * Ticket #103 adds the "Decisions →" link beside "Chips →" in the same mark
 * row, through to the new /decisions screen — that screen owns its own read
 * entirely (src/lib/decisions/api.ts), independent of everything above.
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md F38 (must-fix, HIGH-IMPACT —
 * see decisions/ticket-169.md) — the wordmark `<header>` and its
 * "Decisions →" / "Chips →" link row are deleted outright, not shrunk.
 * Both destinations are now reachable from the persistent `<AppBar>`
 * (App.tsx, the foundations ticket), which also fixes the accessibility
 * defect the old header caused: a bare `<header>` whose only content was
 * the app's own name declared a banner landmark with nothing in it worth
 * navigating to, and the app had zero real headings anywhere.
 * DeadlineCountdown's gameweek name is now the app's first `<h1>` (F21).
 *
 * F39 (should-fix, not reached this ticket — see decisions/ticket-169.md)
 * — the audit's proposed final order (countdown, verdict, pitch, bench,
 * accuracy) is already this screen's order and is unchanged. Varying the
 * RHYTHM between sections (a bigger break before the verdict than between
 * the pitch and the accuracy line) is not done here; every section still
 * sits at AppShell's one constant `--shell-gap`.
 *
 * Ticket #271 adds MiniLeagueCard below the accuracy line — product-brief.md
 * §1/§5's display-only mini-league standings (feature-list item 33). It owns
 * its own read (src/lib/miniLeague/api.ts), independent of every state above,
 * same "a failed or slow read here must never block or blank something else"
 * principle AccuracyCard already follows. Nothing it reads or renders ever
 * feeds the solver or a recommendation.
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
  // F19/F22 — reported up by DeadlineCountdown (the component that owns
  // the live clock) whenever the 24-hour escalation boolean changes, and
  // passed straight through to AppShell's own `escalated` prop so the
  // ambient wash "leans forward" alongside the countdown figure.
  const [escalated, setEscalated] = useState(false)
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
            // Ticket #276 (H3) — src/lib/teamColours.ts looks this up to tint the shirt.
            teamShortName: player.teamShortName,
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
    <AppShell escalated={escalated}>
      <DeadlineCountdown state={countdownState} onEscalatedChange={setEscalated} />

      {/* F39 (should-fix) — AppShell's own `--shell-gap` (F18) is one
          constant value shared by every sibling on every screen; it can't
          by itself express "countdown to verdict is a bigger break than
          verdict to pitch." This wrapper's own margin-top adds ON TOP of
          that constant gap, giving the verdict card a real break above it
          (--space-8 total) without changing AppShell.css (out of scope). */}
      {targetGameweek && (
        <div className="home-verdict">
          <VerdictCard gameweekId={targetGameweek.id} gameweekName={targetGameweek.name} />
        </div>
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

      {/* Ticket #96 — the rolling accuracy display, below the pitch per
          design-reference.md's home-screen order (countdown, verdict,
          pitch, then this card). Owns its own read, independent of every
          state above (loadState, countdownState, VerdictCard's own fetch)
          — same "a failed or slow read here must never block or blank
          something else" principle those already follow, so it renders
          unconditionally regardless of whether a squad is saved.

          F34 (must-fix) — `variant="summary"` collapses this to a single
          quiet line (no Surface, no 36px figure) so it stops competing
          with VerdictCard for the one --text-display figure a screen is
          allowed (F30). The full breakdown moves to /reasoning via the
          same component's `variant="full"` (see ReasoningScreen.tsx).

          F39 — wrapped for the same reason as .home-verdict above: a
          bigger break (--space-8 total) before this quiet closing line
          than between the pitch and the bench above it. */}
      <div className="home-accuracy">
        <AccuracyCard variant="summary" />
      </div>

      {/* Ticket #271 — mini-league standings, display only, below the accuracy
          line per this ticket's own DoD. Wrapped the same way as
          .home-accuracy/.home-verdict above so it gets a real break rather
          than AppShell's one constant --shell-gap alone. */}
      <div className="home-mini-league">
        <MiniLeagueCard />
      </div>
    </AppShell>
  )
}

export default HomeScreen
