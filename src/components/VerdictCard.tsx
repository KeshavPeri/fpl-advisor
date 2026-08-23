import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatSyncTimestamp, toErrorMessage } from '../lib/format'
import { deriveVerdictView } from '../lib/verdict/derive.ts'
import { fetchVerdict } from '../lib/verdict/api.ts'
import type { VerdictRecommendationData } from '../lib/verdict/types.ts'
import { commitRecommendation, fetchCommitContext } from '../lib/commit/api.ts'
import { deriveCommitView } from '../lib/commit/derive.ts'
import type { CommitTarget, StoredCommitDecision } from '../lib/commit/types.ts'
import { fetchOverrideDecisions } from '../lib/override/api.ts'
import { deriveOverrideAccess, type OverrideAccessStatus } from '../lib/override/derive.ts'
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

interface VerdictPointsFigureProps {
  label: string
  points: number | null
}

/**
 * The card's primary figure — this gameweek's projected points (ticket
 * #68) — split out of VerdictCard so it can be rendered and asserted on
 * directly in a test. VerdictCard itself fetches via useEffect and can't
 * be rendered synchronously into its 'ready' state, so before this split
 * the no-decimal-figure requirement (DoD) was only ever verified against
 * deriveVerdictView's return value (derive.test.ts), never against
 * anything React actually renders. See VerdictCard.test.ts.
 */
export function VerdictPointsFigure({ label, points }: VerdictPointsFigureProps) {
  return (
    <div className="verdict-card__points">
      <p className="verdict-card__points-label">{label}</p>
      {points !== null ? (
        <p className="verdict-card__points-value num">{points}</p>
      ) : (
        <p className="verdict-card__points-value verdict-card__points-value--unavailable">
          Unavailable
        </p>
      )}
    </div>
  )
}

type CommitFetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; decision: StoredCommitDecision | null; solverRunId: number | null }

/** Everything the commit control needs to know about the plan it belongs
 *  to, resolved by VerdictCard from its own already-fetched
 *  VerdictRecommendationData — the one field it does NOT have
 *  (solverRunId) is read separately inside CommitControl itself, via
 *  fetchCommitContext (see src/lib/commit/api.ts's own comment on why). */
type CommitControlTarget = Omit<CommitTarget, 'solverRunId'>

/**
 * The commit action (ticket #84, feature-list item 19) — one tap, on the
 * recommendation it belongs to, individually (design-reference.md: "One tap
 * to commit each recommendation, individually. No 'accept all'."). Commits
 * whichever plan is actually shown on this card — `target.gameweekId` is
 * the recommendation's OWN gameweek (VerdictRecommendationData.gameweekId),
 * not the home screen's current target gameweek, so a stale card commits
 * the stale plan it displays, never silently substitutes today's gameweek
 * id for it.
 *
 * Committing records a decision. It never calls any FPL-authenticated
 * endpoint — see src/lib/commit/api.ts's own header and the migration's.
 *
 * Owns its own read (fetchCommitContext), independent of VerdictCard's own
 * recommendation read — same "a failed or slow read here must never block
 * or blank something else" principle VerdictCard's own header comment
 * states for its relationship to the pitch below it. Renders nothing while
 * that read is in flight, deliberately: showing a "Commit" button before
 * we know whether this gameweek is already committed risks a flash of the
 * wrong state.
 */
function CommitControl(target: CommitControlTarget) {
  const { gameweekId, planIndex } = target
  const [fetchState, setFetchState] = useState<CommitFetchState>({ status: 'loading' })
  const [writing, setWriting] = useState(false)
  const [writeErrorMessage, setWriteErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFetchState({ status: 'loading' })
    setWriteErrorMessage(null)

    async function load() {
      try {
        const context = await fetchCommitContext(gameweekId, planIndex)
        if (cancelled) return
        setFetchState({
          status: 'ready',
          decision: context.decision,
          solverRunId: context.solverRunId,
        })
      } catch (err) {
        if (cancelled) return
        setFetchState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [gameweekId, planIndex])

  if (fetchState.status === 'loading') return null

  if (fetchState.status === 'error') {
    return (
      <p className="verdict-card__commit-error" role="alert">
        Couldn't check whether this gameweek is committed: {fetchState.message}. Reload this
        page to try again.
      </p>
    )
  }

  const { decision, solverRunId } = fetchState
  const view = deriveCommitView(decision, writeErrorMessage)

  async function handleCommit() {
    if (writing || view.isCommitted) return
    setWriting(true)
    setWriteErrorMessage(null)
    try {
      const committed = await commitRecommendation({ ...target, solverRunId })
      setFetchState({ status: 'ready', decision: committed, solverRunId })
    } catch (err) {
      setWriteErrorMessage(toErrorMessage(err))
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="verdict-card__commit">
      {view.isCommitted ? (
        <p className="verdict-card__commit-badge">
          Committed
          {decision && (
            <>
              {' · '}
              <span className="num">{formatSyncTimestamp(decision.decidedAt)}</span>
            </>
          )}
        </p>
      ) : (
        <button
          type="button"
          className="verdict-card__commit-button"
          onClick={() => void handleCommit()}
          disabled={writing}
        >
          {writing ? 'Committing…' : view.buttonLabel}
        </button>
      )}
      {view.errorMessage && (
        <p className="verdict-card__commit-error" role="alert">
          {view.errorMessage}
        </p>
      )}
    </div>
  )
}

type OverrideLinkFetchState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; access: OverrideAccessStatus }

/**
 * The override entry point (ticket #91, feature-list item 20) —
 * design-reference.md: "Registering an override carries deliberate
 * friction — a confirm step that shows what the model expected and what it
 * is being overridden with." This link is only the doorway to that flow;
 * the friction itself lives entirely on `/override` (src/screens/
 * OverrideScreen.tsx).
 *
 * Owns its own read (fetchOverrideDecisions), independent of CommitControl's
 * own fetch and of VerdictCard's own recommendation read — same "a failed or
 * slow read here must never block or blank something else" principle
 * CommitControl's own comment states. Renders nothing while that read is in
 * flight or if it fails: a link that might be wrong (offering "Register
 * override" on an already-committed gameweek, say) is worse than a link
 * that's briefly absent.
 *
 * DoD: "A gameweek with an existing commit row does not offer the override
 * entry point" — deriveOverrideAccess returns 'blocked-commit' and this
 * renders nothing at all in that case. "a gameweek with an existing
 * override row shows the registered override rather than the form" is
 * `/override`'s own job once reached; here the link's own label just
 * reflects which case applies, so the label promises the state the screen
 * will actually show.
 */
function OverrideLink({ gameweekId, planIndex }: { gameweekId: number; planIndex: number }) {
  const [fetchState, setFetchState] = useState<OverrideLinkFetchState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setFetchState({ status: 'loading' })

    fetchOverrideDecisions(gameweekId, planIndex)
      .then((decisions) => {
        if (cancelled) return
        setFetchState({
          status: 'ready',
          access: deriveOverrideAccess(decisions.commitDecidedAt, decisions.existingOverride),
        })
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [gameweekId, planIndex])

  if (fetchState.status !== 'ready' || fetchState.access === 'blocked-commit') return null

  return (
    <Link className="verdict-card__override-link" to="/override">
      {fetchState.access === 'registered' ? 'Override registered' : 'Register override'} →
    </Link>
  )
}

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
 * Ticket #91 adds the override entry point (item 20, see `OverrideLink`
 * above) alongside the commit control — the two are mutually exclusive per
 * gameweek, enforced by `deriveOverrideAccess` reading the same
 * `recommendation_decisions` table both controls write to.
 *
 * The card's primary figure is THIS gameweek's projected points (ticket
 * #68), not the multi-gameweek horizon total — see derive.ts's
 * `sumGameweekPoints` and api.ts's solver_picks read for how that's
 * derived. `view.gameweekPoints` renders as a number when available and as
 * an explicit "Unavailable" state when the underlying solver_picks rows
 * couldn't be found — never as 0, NaN, or a blank card.
 *
 * Ticket #79 added a link through to the full reasoning screen (`/reasoning`),
 * per design-reference.md's "one-line summary on the verdict card so a bare
 * number is never the whole story."
 *
 * Ticket #84 adds the commit action (feature-list item 19, see
 * `CommitControl` above): one tap to record that this recommendation was
 * accepted, via `src/lib/commit/`. Rendered for every ready plan, stale or
 * fresh — see CommitControl's own comment for why staleness doesn't gate
 * it. Ticket #91 adds the override entry point alongside it (see
 * `OverrideLink` above). No undo/edit/delete, no accept-all — still out of
 * scope.
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

      <VerdictPointsFigure label={view.gameweekPointsLabel} points={view.gameweekPoints} />

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

      {/* Ticket #84: commits the plan actually on screen — state.data's OWN
          gameweek_id, not the `gameweekId` prop (the home screen's current
          target). Those two only differ when view.isStale is true, and
          committing the stale plan on the card is the correct behaviour —
          see CommitControl's own comment. */}
      <CommitControl
        gameweekId={state.data.gameweekId}
        planIndex={0}
        isRoll={state.data.isRoll}
        transferInPlayerId={state.data.transferInPlayerId}
        transferOutPlayerId={state.data.transferOutPlayerId}
        captainPlayerId={state.data.captainPlayerId}
        viceCaptainPlayerId={state.data.viceCaptainPlayerId}
        hitCost={state.data.hitCost}
      />

      <OverrideLink gameweekId={state.data.gameweekId} planIndex={0} />

      <Link className="verdict-card__reasoning-link" to="/reasoning">
        Full reasoning →
      </Link>
    </Surface>
  )
}

export default VerdictCard
