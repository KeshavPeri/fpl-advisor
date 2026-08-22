import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { toErrorMessage } from '../lib/format'
import { fetchReasoning } from '../lib/reasoning/api.ts'
import { deriveReasoningView } from '../lib/reasoning/derive.ts'
import type { ReasoningRecommendationData } from '../lib/reasoning/types.ts'
import './ReasoningScreen.css'

/**
 * The reasoning screen (ticket #79, feature-list item 21) — `/reasoning`.
 * design-reference.md names this the one screen in the app where
 * information density is correct (the Linear reference); everywhere else
 * stays calm. Owns its own fetch, independent of the home screen and the
 * verdict card — reached by tapping through from VerdictCard's new link,
 * but works as a direct navigation too.
 *
 * Renders Plan A only (`plan_index = 0`), matching the verdict card's own
 * scope. All display logic lives in `src/lib/reasoning/derive.ts`
 * (`deriveReasoningView`) — this component fetches, derives, and renders
 * whatever the view says, the same split VerdictCard/deriveVerdictView and
 * Pitch/pitchLayout already establish.
 */

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: ReasoningRecommendationData | null }

function ReasoningScreen() {
  const [state, setState] = useState<ScreenState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const result = await fetchReasoning()
        if (cancelled) return
        setState({ status: 'loaded', data: result })
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

  return (
    <AppShell>
      <div className="reasoning-header">
        <Link className="reasoning-back" to="/">
          ← Home
        </Link>
        <p className="reasoning-mark">Reasoning</p>
      </div>

      {state.status === 'loading' && (
        <Surface className="reasoning-loading" aria-hidden="true">
          <div className="reasoning-skeleton-line reasoning-skeleton-line--title" />
          <div className="reasoning-skeleton-line reasoning-skeleton-line--body" />
          <div className="reasoning-skeleton-line reasoning-skeleton-line--body" />
        </Surface>
      )}

      {state.status === 'error' && (
        <Surface role="alert">
          <p className="reasoning-error">
            Couldn't load the reasoning: {state.message}. Reload this page to try again.
          </p>
        </Surface>
      )}

      {state.status === 'loaded' && <ReasoningContent data={state.data} />}
    </AppShell>
  )
}

function ReasoningContent({ data }: { data: ReasoningRecommendationData | null }) {
  const view = deriveReasoningView(data)

  if (view.status === 'empty') {
    return (
      <Surface role="status">
        <p className="reasoning-empty-title">Nothing to explain yet</p>
        <p className="reasoning-empty-body">{view.emptyMessage}</p>
      </Surface>
    )
  }

  return (
    <>
      <Surface className="reasoning-summary">
        <p className="reasoning-gameweek">{view.gameweekName}</p>
        <p className="reasoning-headline">{view.headline}</p>

        {view.reasons.length > 0 && (
          <ul className="reasoning-list">
            {view.reasons.map((reason, index) => (
              // Stored reason lines have no stable id of their own — this
              // list is a static, ordered render of a fetched snapshot
              // (never reordered or edited in place), so the position in
              // the array is a safe key here, same convention already used
              // by Pitch.tsx for its own read-only, order-stable lists.
              <li key={index} className="reasoning-list__item">
                {reason}
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface className="reasoning-totals">
        <div className="reasoning-total">
          <p className="reasoning-total__label">{view.horizonLabel}</p>
          <p className="reasoning-total__value num">
            {view.horizonGross !== null ? view.horizonGross : 'Unavailable'}
          </p>
        </div>

        {view.hit && (
          <div className="reasoning-hit">
            <p className="reasoning-hit__label">After the transfer hit</p>
            <p className="reasoning-hit__figures">
              <span className="num">−{view.hit.cost}</span> hit ·{' '}
              <span className="num">{view.hit.gross}</span> gross ·{' '}
              <span className="num">{view.hit.net}</span> net
            </p>
          </div>
        )}

        <div className="reasoning-confidence">
          <p className="reasoning-confidence__label">Confidence: {view.confidenceWord}</p>
        </div>
      </Surface>

      {view.captainBand !== null && (
        <Surface
          className={`reasoning-captain reasoning-captain--${view.captainBand}`}
          role={view.captainBand === 'coin-flip' ? 'status' : undefined}
        >
          <p className="reasoning-captain__label">Captain confidence: {view.captainBand}</p>
          {view.captainNote && <p className="reasoning-captain__note">{view.captainNote}</p>}
        </Surface>
      )}

      {view.captainBand === null && (
        <Surface className="reasoning-captain">
          <p className="reasoning-captain__label">Captain confidence unavailable</p>
          <p className="reasoning-captain__note">
            The starting XI for this gameweek couldn't be read, so the captain gap can't be
            compared.
          </p>
        </Surface>
      )}

      <div className="reasoning-players">
        {view.players.map((player) => (
          <Surface key={player.role} className="reasoning-player" raised>
            <p className="reasoning-player__role">{player.role}</p>
            <p className="reasoning-player__name">{player.name}</p>
            <p className="reasoning-player__coverage">{player.coverageNote}</p>

            {player.hasProjection ? (
              <table className="reasoning-player__table">
                <tbody>
                  {player.components.map((component) => (
                    <tr key={component.key}>
                      <td className="reasoning-player__component-label">{component.label}</td>
                      <td className="reasoning-player__component-value num">
                        {component.value.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="reasoning-player__unavailable">
                No stored projection for this player this gameweek.
              </p>
            )}
          </Surface>
        ))}
      </div>

      <Surface className="reasoning-meta">
        <p className="reasoning-meta__line">
          Model: {view.modelVersion ?? 'Unavailable'}
          {view.computedAtLabel && <> · Computed {view.computedAtLabel}</>}
        </p>
      </Surface>
    </>
  )
}

export default ReasoningScreen
