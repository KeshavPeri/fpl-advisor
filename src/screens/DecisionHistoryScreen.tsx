import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { fetchDecisionHistorySource } from '../lib/decisions/api.ts'
import { deriveDecisionHistoryView } from '../lib/decisions/derive.ts'
import type { DecisionEntryView, DecisionHistoryView } from '../lib/decisions/types.ts'
import { toErrorMessage } from '../lib/format'
import './DecisionHistoryScreen.css'

/**
 * The decision history screen (ticket #103) — `/decisions`. The ledger of
 * what Keshav actually did, as opposed to what he was told to do: every
 * `recommendation_decisions` row, newest first, plus the season's headline
 * counts. Reached from the home screen's mark row, alongside the existing
 * `/chips` link (same pattern src/screens/ChipsScreen.tsx already sets).
 *
 * Owns its own read (src/lib/decisions/api.ts), independent of every other
 * screen's state, same "a failed or slow read here must never block or
 * blank something else" principle src/components/AccuracyCard.tsx's own
 * header states. `Date.now()` is called exactly once, right here —
 * deriveDecisionHistoryView itself reads no clock (its own DoD: every
 * instant is a parameter — same convention src/screens/ChipsScreen.tsx
 * already sets for deriveChipState).
 *
 * This ticket establishes a genuinely new surface (frontend-design skill
 * invoked per the ticket's own Notes) but every token, every colour and
 * `Surface` itself are reused unchanged from design-reference.md's
 * committed decisions — a new surface is not a new design system. Coral is
 * used for nothing on this screen: an override is not a failure
 * (design-reference.md's own explicit rule), so it renders in exactly the
 * same neutral tone as a commit, distinguished only by its label and its
 * honest recommendation-gap note.
 *
 * Ticket #107 adds the recommended-vs-decided comparison for an override
 * that carries one — rendered the same neutral way, still no colour: the
 * exact same "gap-note" visual slot now carries either the honest
 * not-preserved note OR the comparison summary, never both. All decision
 * logic (which note wins, exactly what differed) lives in
 * src/lib/decisions/derive.ts; this file renders whichever of the two
 * fields on `DecisionEntryView` is non-null.
 */

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; view: DecisionHistoryView }

function DecisionHistoryScreen() {
  const [screenState, setScreenState] = useState<ScreenState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setScreenState({ status: 'loading' })

    async function load() {
      try {
        const source = await fetchDecisionHistorySource()
        if (cancelled) return
        setScreenState({ status: 'loaded', view: deriveDecisionHistoryView(source, Date.now()) })
      } catch (err) {
        if (cancelled) return
        setScreenState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell>
      <div className="decisions-header">
        <Link className="decisions-back" to="/">
          ← Home
        </Link>
        <p className="decisions-mark">Decisions</p>
      </div>

      {screenState.status === 'loading' && (
        <Surface className="decisions-loading" aria-hidden="true">
          <div className="decisions-skeleton-line decisions-skeleton-line--title" />
          <div className="decisions-skeleton-line decisions-skeleton-line--body" />
          <div className="decisions-skeleton-line decisions-skeleton-line--body" />
        </Surface>
      )}

      {screenState.status === 'error' && (
        <Surface role="alert">
          <p className="decisions-error">
            Couldn't load the decision history: {screenState.message}. Reload this page to try
            again.
          </p>
        </Surface>
      )}

      {screenState.status === 'loaded' && <DecisionHistoryContent view={screenState.view} />}
    </AppShell>
  )
}

function HeadlineSummary({ view }: { view: DecisionHistoryView }) {
  const { headline } = view
  return (
    <Surface className="decisions-summary">
      <p className="decisions-summary__label">This season</p>
      <div className="decisions-summary__grid">
        <div className="decisions-summary__figure">
          <p className="decisions-summary__value num">{headline.decisionsRecorded}</p>
          <p className="decisions-summary__figure-label">
            {headline.decisionsRecorded === 1 ? 'decision recorded' : 'decisions recorded'}
          </p>
        </div>
        <div className="decisions-summary__figure">
          <p className="decisions-summary__value num">{headline.commits}</p>
          <p className="decisions-summary__figure-label">
            {headline.commits === 1 ? 'commit' : 'commits'}
          </p>
        </div>
        <div className="decisions-summary__figure">
          <p className="decisions-summary__value num">{headline.overrides}</p>
          <p className="decisions-summary__figure-label">
            {headline.overrides === 1 ? 'override' : 'overrides'}
          </p>
        </div>
        <div className="decisions-summary__figure">
          <p className="decisions-summary__value num">{headline.gameweeksWithNoDecision}</p>
          <p className="decisions-summary__figure-label">
            {headline.gameweeksWithNoDecision === 1
              ? 'gameweek with no decision'
              : 'gameweeks with no decision'}
          </p>
        </div>
      </div>
      <p className="decisions-summary__footnote">
        <span className="num">{headline.gameweeksElapsed}</span>{' '}
        {headline.gameweeksElapsed === 1 ? 'gameweek has' : 'gameweeks have'} elapsed this season.
      </p>
    </Surface>
  )
}

function DecisionEntryRow({ entry }: { entry: DecisionEntryView }) {
  return (
    <Surface className="decisions-entry">
      <div className="decisions-entry__header">
        <p className="decisions-entry__gameweek">{entry.gameweekName}</p>
        <span
          className={`decisions-entry__kind decisions-entry__kind--${entry.kind}`}
        >
          {entry.kindLabel}
        </span>
      </div>

      <dl className="decisions-entry__fields">
        <div className="decisions-entry__field">
          <dt>Transfer</dt>
          <dd>{entry.recorded.transferText}</dd>
        </div>
        <div className="decisions-entry__field">
          <dt>Captain</dt>
          <dd>{entry.recorded.captainText}</dd>
        </div>
        <div className="decisions-entry__field">
          <dt>Vice-captain</dt>
          <dd>{entry.recorded.viceCaptainText}</dd>
        </div>
        <div className="decisions-entry__field">
          <dt>Hit cost</dt>
          <dd>{entry.recorded.hitCostText}</dd>
        </div>
        {/* F45 (should-fix, docs/ui-audit-2026-08-31.md) — a defined,
            labelled slot for how the decision turned out. The audit's own
            table found this honestly computable for a transfer or a
            captaincy pick (prediction_log joined to squad_picks) but NOT
            for a gameweek total or rank (nothing ingests FPL entry
            history) — "a data/feature ticket, not a UI fix." This ticket
            computes nothing and joins nothing (out of scope per the
            audit's own instruction and CLAUDE.md's src/lib boundary): the
            slot always renders "Not settled yet" so the screen is shaped
            for the answer without inventing one. */}
        <div className="decisions-entry__field">
          <dt>Outcome</dt>
          <dd>Not settled yet</dd>
        </div>
      </dl>

      {/* Ticket #107: exactly one of the two notes below ever renders for an
          override — the honest gap note when no `recommended` side was
          stored, or the comparison summary when one was. Reuses the same
          "gap-note" visual treatment (neutral secondary text, a hairline
          separator) for both, per design-reference.md's rule for this
          screen: an override compared against its recommendation is not a
          failure, so it gets no colour treatment of its own — only the
          words differ. */}
      {entry.recommendationGapNote && (
        <p className="decisions-entry__gap-note">{entry.recommendationGapNote}</p>
      )}
      {entry.recommendationComparison && (
        <p className="decisions-entry__gap-note">{entry.recommendationComparison.summaryText}</p>
      )}

      <p className="decisions-entry__decided-at">
        Decided <time dateTime={entry.decidedAtIso}>{entry.decidedAtLabel}</time>
      </p>
    </Surface>
  )
}

function DecisionHistoryContent({ view }: { view: DecisionHistoryView }) {
  return (
    <>
      <HeadlineSummary view={view} />

      {!view.hasEntries && (
        <Surface className="decisions-empty" role="status">
          <p className="decisions-empty__text">{view.emptyStateMessage}</p>
        </Surface>
      )}

      {view.hasEntries && (
        <div className="decisions-list">
          {view.entries.map((entry) => (
            <DecisionEntryRow entry={entry} key={entry.id} />
          ))}
        </div>
      )}
    </>
  )
}

export default DecisionHistoryScreen
