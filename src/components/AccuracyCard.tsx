import { useEffect, useState } from 'react'
import { fetchPredictionLog } from '../lib/accuracy/api.ts'
import { deriveAccuracyView } from '../lib/accuracy/derive.ts'
import type { AccuracyView, GameweekAccuracyFigure } from '../lib/accuracy/types.ts'
import { toErrorMessage } from '../lib/format'
import Surface from './Surface'
import './AccuracyCard.css'

type AccuracyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: AccuracyView }

/**
 * One figure with its sample size beside it (DoD: "Every figure rendered
 * with its sample size beside it"). Renders "Too small to read" instead of
 * a number when the underlying sample is below MIN_SAMPLE_SIZE
 * (src/lib/accuracy/derive.ts) — never a number built on noise.
 */
function AccuracyFigure({
  label,
  value,
  sampleLabel,
  tooSmall,
}: {
  label: string
  value: number | null
  sampleLabel: string
  tooSmall: boolean
}) {
  return (
    <div className="accuracy-card__figure">
      <p className="accuracy-card__figure-label">{label}</p>
      {tooSmall || value === null ? (
        <p className="accuracy-card__figure-value accuracy-card__figure-value--small">
          Too small to read yet
        </p>
      ) : (
        <p className="accuracy-card__figure-value num">{value}</p>
      )}
      <p className="accuracy-card__figure-sample">{sampleLabel}</p>
    </div>
  )
}

function sampleLabel(measuredCount: number, nonAppearanceCount: number): string {
  const measuredWord = measuredCount === 1 ? 'player-gameweek' : 'player-gameweeks'
  const base = `${measuredCount} ${measuredWord} measured`
  if (nonAppearanceCount === 0) return base
  const naWord = nonAppearanceCount === 1 ? 'non-appearance' : 'non-appearances'
  return `${base} · ${nonAppearanceCount} correctly-predicted ${naWord} (not counted above)`
}

function GameweekRow({ figure }: { figure: GameweekAccuracyFigure }) {
  return (
    <li className="accuracy-card__gw-row">
      <span className="accuracy-card__gw-label">{figure.gameweekLabel}</span>
      {figure.tooSmall || figure.mae === null ? (
        <span className="accuracy-card__gw-value accuracy-card__gw-value--small">
          Too small to read
        </span>
      ) : (
        <span className="accuracy-card__gw-value num">{figure.mae} MAE</span>
      )}
      <span className="accuracy-card__gw-sample">
        {figure.measuredCount} measured
        {figure.nonAppearanceCount > 0 ? ` · ${figure.nonAppearanceCount} non-appearances` : ''}
      </span>
    </li>
  )
}

/**
 * The rolling accuracy display (ticket #96). product-brief.md §2: "every
 * projection stored, scored against actuals after gameweek lockdown, and
 * shown as a rolling figure in-app." Sits below the pitch on the home
 * screen (design-reference.md's home-screen order: countdown, verdict,
 * pitch, then this card — see HomeScreen.tsx).
 *
 * Owns its own read, independent of the verdict card's and the pitch's own
 * loading/error state — same "a failed or slow read here must never block
 * or blank something else" principle VerdictCard's own header states. Not
 * filtered to any particular gameweek: `fetchPredictionLog` reads every
 * settled row across the whole rolling history at the current model_version
 * (src/lib/accuracy/derive.ts's `selectCurrentModelVersion`).
 *
 * Renders figures and words only — no chart, no sparkline, no per-player
 * table (ticket's own Scope OUT). The empty state names what it's waiting
 * for rather than showing a spinner or a bare zero, per the DoD.
 */
function AccuracyCard() {
  const [state, setState] = useState<AccuracyState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const rows = await fetchPredictionLog()
        if (cancelled) return
        setState({ status: 'ready', view: deriveAccuracyView(rows) })
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
      <Surface className="accuracy-card accuracy-card--loading" aria-hidden="true">
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--title" />
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--figure" />
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--body" />
      </Surface>
    )
  }

  if (state.status === 'error') {
    return (
      <Surface className="accuracy-card" role="alert">
        <p className="accuracy-card__title">Prediction accuracy</p>
        <p className="accuracy-card__error">
          Couldn't load accuracy figures: {state.message}. Reload this page to try again.
        </p>
      </Surface>
    )
  }

  const { view } = state

  if (!view.hasData) {
    return (
      <Surface className="accuracy-card" role="status">
        <p className="accuracy-card__title">Prediction accuracy</p>
        <p className="accuracy-card__empty">{view.emptyStateMessage}</p>
      </Surface>
    )
  }

  const rolling = view.rolling
  if (!rolling) return null // hasData: true always carries a rolling figure — defensive only.

  return (
    <Surface className="accuracy-card">
      <p className="accuracy-card__title">
        Prediction accuracy{' '}
        <span className="accuracy-card__model-version num">{view.modelVersion}</span>
      </p>

      <div className="accuracy-card__rolling">
        <AccuracyFigure
          label="Mean absolute error, rolling"
          value={rolling.mae}
          sampleLabel={`${rolling.gameweeksSettled} gameweek${
            rolling.gameweeksSettled === 1 ? '' : 's'
          } settled · ${sampleLabel(rolling.measuredCount, rolling.nonAppearanceCount)}`}
          tooSmall={rolling.tooSmall}
        />
      </div>

      {view.biasSentence && <p className="accuracy-card__bias">{view.biasSentence}</p>}

      {view.perGameweek.length > 0 && (
        <ul className="accuracy-card__gw-list">
          {view.perGameweek.map((figure) => (
            <GameweekRow figure={figure} key={figure.gameweekId} />
          ))}
        </ul>
      )}
    </Surface>
  )
}

export default AccuracyCard
