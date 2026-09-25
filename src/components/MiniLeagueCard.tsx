import { useEffect, useState } from 'react'
import { fetchLatestMiniLeagueStandings } from '../lib/miniLeague/api.ts'
import { deriveMiniLeagueView } from '../lib/miniLeague/derive.ts'
import type { MiniLeagueStandingRow, MiniLeagueView } from '../lib/miniLeague/types.ts'
import { toErrorMessage } from '../lib/format'
import { getFplEntryId } from '../lib/squad/env.ts'
import Surface from './Surface'
import './MiniLeagueCard.css'

/**
 * The mini-league standings card (ticket #271, feature-list item 33). product-brief.md §1:
 * standings "may be displayed. They must never enter the optimiser's objective" — this component
 * (and everything it reads under src/lib/miniLeague/) is display only, read by nothing else in
 * the app.
 *
 * Same pattern as AccuracyCard: owns its own read, independent of every other card's load state
 * — a slow or failed mini-league fetch must never block or blank the pitch or the verdict above
 * it. Loading/empty/error states follow AccuracyCard's own shapes (skeleton Surface, role="alert"
 * Surface, role="status" Surface).
 *
 * Sized deliberately below VerdictCard's points figure: design-reference.md/F30 (see
 * VerdictCard.css) reserve --text-display for exactly one figure per screen. The rank figure
 * here uses --text-headline — still the second-most prominent number on the home screen, never
 * the loudest.
 */
function MiniLeagueCard() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; view: MiniLeagueView }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const rows = await fetchLatestMiniLeagueStandings()
        if (cancelled) return
        setState({ status: 'ready', view: deriveMiniLeagueView(rows, getFplEntryId()) })
      } catch (err) {
        if (cancelled) return
        setState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <Surface className="mini-league-card mini-league-card--loading" aria-hidden="true">
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--title" />
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--figure" />
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--body" />
      </Surface>
    )
  }

  if (state.status === 'error') {
    return (
      <Surface className="mini-league-card" role="alert">
        <p className="mini-league-card__title">Mini-league</p>
        <p className="mini-league-card__error">
          Couldn't load mini-league standings: {state.message}. Reload this page to try again.
        </p>
      </Surface>
    )
  }

  const { view } = state

  if (!view.hasData) {
    return (
      <Surface className="mini-league-card" role="status">
        <p className="mini-league-card__title">Mini-league</p>
        <p className="mini-league-card__empty">{view.emptyStateMessage}</p>
      </Surface>
    )
  }

  return (
    <Surface className="mini-league-card">
      <p className="mini-league-card__title">Mini-league</p>

      {view.entryNotInLeague ? (
        <p className="mini-league-card__notice">
          Your entry isn't showing in this league's standings yet.
        </p>
      ) : (
        <>
          <div className="mini-league-card__headline">
            <div className="mini-league-card__rank-figure">
              <span className="mini-league-card__rank-value num">{view.you?.rank}</span>
              <span className="mini-league-card__rank-of">of {view.leagueSize}</span>
            </div>
            <MovementBadge movement={view.movement} />
          </div>

          <p className="mini-league-card__gap">{gapSentence(view)}</p>
        </>
      )}

      <ul className="mini-league-card__table">
        {view.rows.map((row) => (
          <StandingsRow key={row.entryId} row={row} isYou={view.you?.entryId === row.entryId} />
        ))}
      </ul>
    </Surface>
  )
}

/**
 * Sentence-cased, plain-verb wording per design-reference.md's interface-writing rules. Reads as
 * a single line: gap to the leader, then (when there is one, and it isn't zero) the gap to the
 * place directly above — never a second sentence for a home-screen card.
 */
function gapSentence(view: MiniLeagueView): string {
  if (view.gapToLeader === null || view.you === null) return ''
  if (view.gapToLeader === 0) {
    const aboveClause =
      view.gapToAbove && view.gapToAbove > 0
        ? ` — ${pointsPhrase(view.gapToAbove)} clear of ${nameOf(view.above)}`
        : ''
    return `You're leading the league${aboveClause}.`
  }
  const leaderClause = `${pointsPhrase(view.gapToLeader)} behind the leader`
  const aboveClause =
    view.above && view.gapToAbove !== null && view.gapToAbove > 0
      ? `, ${pointsPhrase(view.gapToAbove)} behind ${nameOf(view.above)}`
      : ''
  return `${leaderClause}${aboveClause}.`
}

function nameOf(row: MiniLeagueStandingRow | null): string {
  if (!row) return 'the place above'
  return row.entryName ?? row.playerName ?? 'the place above'
}

function pointsPhrase(points: number): string {
  return `${points} point${points === 1 ? '' : 's'}`
}

function MovementBadge({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) {
    return (
      <span className="mini-league-card__movement mini-league-card__movement--flat">
        <span className="num">–</span>
      </span>
    )
  }
  const up = movement > 0
  return (
    <span
      className={
        up
          ? 'mini-league-card__movement mini-league-card__movement--up'
          : 'mini-league-card__movement mini-league-card__movement--down'
      }
    >
      <span className="mini-league-card__movement-arrow" aria-hidden="true">
        {up ? '▲' : '▼'}
      </span>
      <span className="num">{Math.abs(movement)}</span>
    </span>
  )
}

function StandingsRow({ row, isYou }: { row: MiniLeagueStandingRow; isYou: boolean }) {
  return (
    <li className={isYou ? 'mini-league-card__row mini-league-card__row--you' : 'mini-league-card__row'}>
      <span className="mini-league-card__row-rank num">{row.rank}</span>
      <span className="mini-league-card__row-name">{row.entryName ?? row.playerName ?? 'Unknown entry'}</span>
      <span className="mini-league-card__row-total num">{row.total}</span>
    </li>
  )
}

export default MiniLeagueCard
