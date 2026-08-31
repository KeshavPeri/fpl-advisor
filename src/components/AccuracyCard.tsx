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

// F37 (should-fix) — was two separate strings for the same state
// ("Too small to read yet" on the card figure, "Too small to read" on a
// per-gameweek row), neither of which said what was actually missing.
// design-reference.md's interface-writing rules apply to every state, not
// only the populated one.
const TOO_SMALL_MESSAGE = 'Not enough gameweeks yet.'

/**
 * One figure with its sample size beside it (DoD: "Every figure rendered
 * with its sample size beside it"). Renders TOO_SMALL_MESSAGE instead of a
 * number when the underlying sample is below MIN_SAMPLE_SIZE
 * (src/lib/accuracy/derive.ts) — never a number built on noise. Only used
 * by the 'full' variant (ReasoningScreen) — the home screen's 'summary'
 * variant never shows a bare figure at all (F34).
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
          {TOO_SMALL_MESSAGE}
        </p>
      ) : (
        <p className="accuracy-card__figure-value num">{value}</p>
      )}
      <p className="accuracy-card__figure-sample">{sampleLabel}</p>
    </div>
  )
}

// F37 — was "N player-gameweek(s) measured" plus an optional parenthetical
// non-appearance clause: an invented unit ("player-gameweek") and a
// three-clause sentence at 13px. "Over N gameweeks and M projections."
// says the same thing the reader actually needs in four words fewer than
// the old measured-count clause alone, dropping the non-appearance detail
// (it already appears, unabridged, on each per-gameweek row below).
function sampleLabel(gameweeksSettled: number, measuredCount: number): string {
  const gwWord = gameweeksSettled === 1 ? 'gameweek' : 'gameweeks'
  return `Over ${gameweeksSettled} ${gwWord} and ${measuredCount} projections.`
}

// F37/F34 — the home screen's single-line summary. Composed from the
// already-pure biasWord/meanSignedError fields on AccuracyView (not from
// derive.ts's own pre-built `biasSentence` string, which this ticket's
// scope does not permit editing — see this ticket's report) so the wording
// can be tightened without touching src/lib/accuracy/derive.ts:
// "The model is under-projecting by an average of 2 points per
// player-gameweek." (30 words across the two source sentences it draws
// from) becomes "It runs 2 points low per player." (F37's own proposed
// replacement, verbatim).
function biasLine(view: AccuracyView): string | null {
  if (!view.biasWord || !view.rolling || view.rolling.meanSignedError === null) return null
  const magnitude = Math.abs(view.rolling.meanSignedError)
  const direction = view.biasWord === 'under-projecting' ? 'low' : 'high'
  return `It runs ${magnitude} points ${direction} per player.`
}

function GameweekRow({ figure }: { figure: GameweekAccuracyFigure }) {
  return (
    <li className="accuracy-card__gw-row">
      <span className="accuracy-card__gw-label">{figure.gameweekLabel}</span>
      {figure.tooSmall || figure.mae === null ? (
        <span className="accuracy-card__gw-value accuracy-card__gw-value--small">
          {TOO_SMALL_MESSAGE}
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

interface AccuracyCardProps {
  /**
   * F34 (must-fix, docs/ui-audit-2026-08-31.md) — 'summary' (the home
   * screen) collapses the whole card to one quiet line: no Surface, no
   * --text-display figure, --text-body/--text-secondary throughout. It
   * existed on the home screen at the same 36px/cyan/labelled-card
   * treatment as VerdictCard's own points figure — two elements claiming
   * the loudest role on one screen (F30's DoD: "exactly one element on the
   * home screen carries the display type size"). 'full' keeps the panel,
   * the rolling figure, the bias line and the per-gameweek breakdown, for
   * /reasoning — the one screen design-reference.md names as correct for
   * this density. Defaults to 'full' so an unspecified call site never
   * silently loses detail.
   */
  variant?: 'summary' | 'full'
}

/**
 * The rolling accuracy display (ticket #96). product-brief.md §2: "every
 * projection stored, scored against actuals after gameweek lockdown, and
 * shown as a rolling figure in-app."
 *
 * Owns its own read regardless of `variant` — same "a failed or slow read
 * here must never block or blank something else" principle every other
 * card in this app follows. The two variants are two independent mounts
 * (home + reasoning), each fetching for itself; ticket #169 chose this
 * over threading the data through a shared parent because every other
 * card/screen in this codebase already owns its own fetch the same way,
 * and `fetchPredictionLog` is a single indexed read, not an expensive one
 * (Tier 3 — see decisions/ticket-169.md).
 *
 * Renders figures and words only — no chart, no sparkline (ticket's own
 * Scope OUT). The empty state names what it's waiting for rather than
 * showing a spinner or a bare zero, per the DoD.
 */
function AccuracyCard({ variant = 'full' }: AccuracyCardProps) {
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
    if (variant === 'summary') {
      return <p className="accuracy-card-summary accuracy-card-summary--loading">Checking model accuracy…</p>
    }
    return (
      <Surface className="accuracy-card accuracy-card--loading" aria-hidden="true">
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--title" />
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--figure" />
        <div className="accuracy-card__skeleton-line accuracy-card__skeleton-line--body" />
      </Surface>
    )
  }

  if (state.status === 'error') {
    if (variant === 'summary') {
      return (
        <p className="accuracy-card-summary accuracy-card-summary--error" role="alert">
          Couldn't load model accuracy: {state.message}.
        </p>
      )
    }
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
    if (variant === 'summary') {
      return (
        <p className="accuracy-card-summary" role="status">
          {view.emptyStateMessage}
        </p>
      )
    }
    return (
      <Surface className="accuracy-card" role="status">
        <p className="accuracy-card__title">Prediction accuracy</p>
        <p className="accuracy-card__empty">{view.emptyStateMessage}</p>
      </Surface>
    )
  }

  const rolling = view.rolling
  if (!rolling) return null // hasData: true always carries a rolling figure — defensive only.

  if (variant === 'summary') {
    const bias = biasLine(view)
    return (
      <p className="accuracy-card-summary" role="status">
        {rolling.tooSmall || rolling.mae === null ? (
          TOO_SMALL_MESSAGE
        ) : (
          <>
            Model accuracy: <span className="num">{rolling.mae}</span> points average error over{' '}
            <span className="num">{rolling.gameweeksSettled}</span>{' '}
            {rolling.gameweeksSettled === 1 ? 'gameweek' : 'gameweeks'}.{bias ? ` ${bias}` : ''}
          </>
        )}
      </p>
    )
  }

  return (
    <Surface className="accuracy-card">
      <p className="accuracy-card__title">
        Prediction accuracy{' '}
        <span className="accuracy-card__model-version num">{view.modelVersion}</span>
      </p>

      <div className="accuracy-card__rolling">
        <AccuracyFigure
          label="Average error"
          value={rolling.mae}
          sampleLabel={sampleLabel(rolling.gameweeksSettled, rolling.measuredCount)}
          tooSmall={rolling.tooSmall}
        />
      </div>

      {biasLine(view) && <p className="accuracy-card__bias">{biasLine(view)}</p>}

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
