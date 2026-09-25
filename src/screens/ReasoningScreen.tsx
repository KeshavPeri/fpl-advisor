import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { toErrorMessage } from '../lib/format'
import { fetchReasoning } from '../lib/reasoning/api.ts'
import { deriveReasoningView } from '../lib/reasoning/derive.ts'
import type { ReasoningOtherOptionView, ReasoningPlayerView } from '../lib/reasoning/derive.ts'
import type { ReasoningRecommendationData } from '../lib/reasoning/types.ts'
import './ReasoningScreen.css'

/**
 * The "Why" tab (ticket #79, feature-list item 21; rebuilt for plain
 * language by ticket #277 — "the plan and the reasons in ten seconds, no
 * jargon"). Owns its own fetch, independent of the home screen and the
 * verdict card. All display logic lives in `src/lib/reasoning/derive.ts`
 * (`deriveReasoningView`) — this component fetches, derives, and renders
 * whatever the view says, the same split VerdictCard/deriveVerdictView and
 * Pitch/pitchLayout already establish.
 *
 * Ticket #277's own DoD: the hero (gameweek, plan, confidence badge, at
 * most one plain sentence) plus the first player card must fit on one
 * 390px phone screen without scrolling — see ReasoningScreen.css's own
 * comment on why the hero Surface is one compact panel rather than
 * several, and why player cards default to their disclosures CLOSED.
 *
 * No screen-title header is added here (out of this ticket's scope — see
 * its own Files list) and `<AccuracyCard variant="full" />` is removed
 * outright (build item 8, R5): accuracy stays a Home-screen concern.
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
      {/* Ticket #277, build items 1-2 — the whole plan, one confidence
          badge, at most one plain sentence, and the headline figure, all
          in ONE panel: this is the "read in 10 seconds" section, and the
          DoD requires it (plus the first player card) to fit on one 390px
          screen. Deliberately not two Surfaces (hero + headline) — one
          panel is less vertical padding to spend on the same information. */}
      <Surface className="reasoning-hero" focal>
        <p className="reasoning-hero__gameweek">{view.gameweekName}</p>
        <p className="reasoning-hero__line">{view.heroLine}</p>

        <div className="reasoning-hero__meta">
          {view.confidenceLabel && (
            <span className={`reasoning-badge reasoning-badge--${view.confidenceBand}`}>
              {view.confidenceLabel}
            </span>
          )}
          {view.heroSentence && <span className="reasoning-hero__sentence">{view.heroSentence}</span>}
        </div>

        <div className="reasoning-hero__headline">
          <p className="reasoning-hero__headline-value num">
            {view.headlineValue !== null ? view.headlineValue : '—'}
          </p>
          <p className="reasoning-hero__headline-caption">{view.headlineCaption}</p>
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
      </Surface>

      {view.captainLabel ? (
        <Surface
          className={`reasoning-captain reasoning-captain--${view.captainBand}`}
          level={1}
          padding="compact"
          role={view.captainBand === 'coin-flip' ? 'status' : undefined}
        >
          <p className="reasoning-captain__label">{view.captainLabel}</p>
          {view.captainNote && <p className="reasoning-captain__note">{view.captainNote}</p>}
        </Surface>
      ) : (
        <Surface className="reasoning-captain" level={1} padding="compact">
          <p className="reasoning-captain__label">Captain confidence unavailable</p>
          <p className="reasoning-captain__note">
            The starting XI for this gameweek couldn't be read, so the captain gap can't be
            compared.
          </p>
        </Surface>
      )}

      <div className="reasoning-players">
        {view.players.map((player) => (
          <PlayerCard key={player.role} player={player} />
        ))}
      </div>

      {/* Other options (ticket #277, build item 6; was "Alternatives
          considered", ticket #102) — one collapsed line per plan, each its
          own <details> for the full detail. No duplicated transfer
          sentence: the summary line IS the difference, nothing repeats
          it. */}
      {(view.otherOptionsEmptyNote || view.otherOptions.length > 0) && (
        <Surface
          className="reasoning-other-options"
          level={1}
          role="region"
          aria-label="Other options"
        >
          <p className="reasoning-other-options__heading">Other options</p>

          {view.otherOptionsEmptyNote && (
            <p className="reasoning-other-options__empty">{view.otherOptionsEmptyNote}</p>
          )}

          {view.otherOptions.map((option) => (
            <OtherOptionRow key={option.label} option={option} />
          ))}
        </Surface>
      )}

      {/* Ticket #277, build item 7 — the footer used to read a resolved
          projection row's model/computed-at, which could legitimately
          differ from when the recommendation itself was produced (the
          bug this ticket fixes). Now the recommendation's own solve time
          only, no model name. */}
      <p className="reasoning-footer">
        {view.updatedAtLabel ? `Updated ${view.updatedAtLabel}` : 'Update time unavailable'}
      </p>
    </>
  )
}

/** One player: role, name, the single-gameweek figure, up to 3 plain
 *  reason chips, a coverage note only when there's a data gap, and the
 *  8-row breakdown behind a closed-by-default "See the numbers"
 *  disclosure (build item 5). Native `<details>`/`<summary>`, same pattern
 *  DecisionHistoryScreen.tsx already uses — free keyboard/VoiceOver
 *  disclosure semantics, no extra React state. */
function PlayerCard({ player }: { player: ReasoningPlayerView }) {
  return (
    <Surface className="reasoning-player" level={1} padding="compact">
      <p className="reasoning-player__role">{player.role}</p>
      <p className="reasoning-player__name">{player.name}</p>
      {/* Only the number itself is mono/tabular (.num) — the surrounding
          words stay sans, per design-reference.md's G3 rule that mono is
          for figures only, never a whole sentence. */}
      <p className="reasoning-player__points">
        {player.points !== null ? (
          <>
            <span className="num">{player.points.toFixed(1)}</span> pts next gameweek
          </>
        ) : (
          'Points unavailable'
        )}
      </p>

      {player.chips.length > 0 && (
        <ul className="reasoning-player__chips">
          {player.chips.map((chip) => (
            <li key={chip} className="reasoning-chip">
              {chip}
            </li>
          ))}
        </ul>
      )}

      {player.coverageNote && <p className="reasoning-player__coverage">{player.coverageNote}</p>}

      {player.hasProjection ? (
        <details className="reasoning-player__details">
          <summary className="reasoning-player__details-summary">See the numbers</summary>
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
        </details>
      ) : (
        <p className="reasoning-player__unavailable">No stored points for this player this gameweek.</p>
      )}
    </Surface>
  )
}

/** One alternative plan, collapsed to its own one-line summary, expanding
 *  on tap into confidence, hit cost and the per-player detail. */
function OtherOptionRow({ option }: { option: ReasoningOtherOptionView }) {
  return (
    <details className="reasoning-other-option">
      <summary className="reasoning-other-option__summary">
        <span className="reasoning-other-option__label">{option.label}</span>
        <span className="reasoning-other-option__line">{option.summaryLine}</span>
      </summary>

      <div className="reasoning-other-option__detail">
        <p className="reasoning-other-option__confidence">Confidence: {option.confidenceLabel}</p>

        {option.hit && (
          <p className="reasoning-other-option__hit">
            <span className="num">−{option.hit.cost}</span> hit ·{' '}
            <span className="num">{option.hit.net}</span> net
          </p>
        )}

        <ul className="reasoning-other-option__players">
          {option.players.map((player) => (
            <li key={player.role} className="reasoning-other-option__player">
              <span className="reasoning-other-option__player-role">{player.role}</span>
              <span className="reasoning-other-option__player-name">{player.name}</span>
              {player.coverageNote && (
                <span className="reasoning-other-option__player-coverage">{player.coverageNote}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

export default ReasoningScreen
