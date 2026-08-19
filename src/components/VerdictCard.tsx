import { useEffect, useState } from 'react'
import { toErrorMessage } from '../lib/format'
import { deriveVerdictView } from '../lib/verdict/derive.ts'
import { fetchVerdict } from '../lib/verdict/api.ts'
import type { VerdictRecommendationData } from '../lib/verdict/types.ts'
import Surface from './Surface'
import './VerdictCard.css'

interface VerdictCardProps {
  /** The home screen's own target gameweek (see HomeScreen.tsx's single
   *  fetchTargetGameweek() call) — used only to decide fresh vs stale; the
   *  card's own read (fetchVerdict) is not filtered to it. */
  gameweekId: number
  gameweekName: string
}

type VerdictState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: VerdictRecommendationData }

/**
 * The recommendation, on the home screen (ticket #61, feature-list item 17).
 * product-brief.md §1: home screen order is countdown, verdict, pitch — this
 * renders between DeadlineCountdown and Pitch in HomeScreen.tsx.
 *
 * Owns its own fetch, independent of the pitch's loading/error state
 * (HomeScreen's `loadState`) — a failed or slow recommendation read must
 * never block or blank the squad pitch below it, and vice versa. Plan A
 * only (`plan_index = 0`); Plan B/C rendering is item 19+, out of scope here.
 *
 * No commit action, no override registration, no link to a reasoning
 * screen — all out of scope (items 19, 20, 21). This card displays; it
 * never acts.
 *
 * The card's primary figure is THIS gameweek's projected points (ticket
 * #68), not the multi-gameweek horizon total — see derive.ts's
 * `sumGameweekPoints` and api.ts's solver_picks read for how that's
 * derived. `view.gameweekPoints` renders as a number when available and as
 * an explicit "Unavailable" state when the underlying solver_picks rows
 * couldn't be found — never as 0, NaN, or a blank card.
 */
function VerdictCard({ gameweekId, gameweekName }: VerdictCardProps) {
  const [state, setState] = useState<VerdictState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const result = await fetchVerdict()
        if (cancelled) return
        setState(result ? { status: 'ready', data: result } : { status: 'none' })
      } catch (err) {
        if (cancelled) return
        setState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // Re-fetches only when the home screen's target gameweek id changes
    // (e.g. after a deadline passes while the app is left open).
    // gameweekName is display text only, not part of the fetch, and is
    // deliberately left out of the dependency list.
  }, [gameweekId])

  if (state.status === 'loading') {
    return (
      <Surface className="verdict-card verdict-card--loading" aria-hidden="true">
        <div className="verdict-card__skeleton-line verdict-card__skeleton-line--headline" />
        <div className="verdict-card__skeleton-line verdict-card__skeleton-line--body" />
        <div className="verdict-card__skeleton-line verdict-card__skeleton-line--points" />
        <div className="verdict-card__skeleton-line verdict-card__skeleton-line--body" />
      </Surface>
    )
  }

  if (state.status === 'none') {
    return (
      <Surface className="verdict-card" role="status">
        <p className="verdict-card__invitation-title">No recommendation yet for {gameweekName}</p>
        <p className="verdict-card__invitation-body">
          Run <code className="num">scripts/generate-recommendations.ts</code> to produce this
          gameweek's plan, then reload this page.
        </p>
      </Surface>
    )
  }

  if (state.status === 'error') {
    return (
      <Surface className="verdict-card" role="alert">
        <p className="verdict-card__error">
          Couldn't load the recommendation: {state.message}. Reload this page to try again.
        </p>
      </Surface>
    )
  }

  const view = deriveVerdictView(state.data, gameweekId)

  return (
    <Surface className="verdict-card">
      {view.isStale && (
        <p className="verdict-card__stale">
          Stale
          {view.staleGameweeksOld !== null && (
            <>
              {' — '}
              <span className="num">{view.staleGameweeksOld}</span>{' '}
              gameweek{view.staleGameweeksOld === 1 ? '' : 's'} old
            </>
          )}
          {view.staleGameweekName && <> (from {view.staleGameweekName})</>}. Not this gameweek's
          recommendation.
        </p>
      )}

      <p className="verdict-card__headline">{view.headline}</p>
      <p className="verdict-card__captains">{view.captainLine}</p>

      <div className="verdict-card__points">
        <p className="verdict-card__points-label">{view.gameweekPointsLabel}</p>
        {view.gameweekPoints !== null ? (
          <p className="verdict-card__points-value num">{view.gameweekPoints}</p>
        ) : (
          <p className="verdict-card__points-value verdict-card__points-value--unavailable">
            Unavailable
          </p>
        )}
      </div>

      {view.hit && (
        <div className="verdict-card__hit-block">
          {view.hitBasisLabel && <p className="verdict-card__hit-label">{view.hitBasisLabel}</p>}
          <p className="verdict-card__hit">
            <span className="num">−{view.hit.cost}</span> hit ·{' '}
            <span className="num">{view.hit.gross}</span> before it ·{' '}
            <span className="num">{view.hit.net}</span> after
          </p>
        </div>
      )}

      <p className="verdict-card__confidence">Confidence: {view.confidenceWord}</p>
      {view.coinFlipNote && <p className="verdict-card__confidence-note">{view.coinFlipNote}</p>}

      {view.coverageNote && <p className="verdict-card__coverage">{view.coverageNote}</p>}
    </Surface>
  )
}

export default VerdictCard
