import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { formatSyncTimestamp, toErrorMessage } from '../lib/format'
import {
  fetchLatestRecommendation,
  fetchOverrideDecisions,
  fetchSquadPlayerIds,
  registerOverride,
} from '../lib/override/api.ts'
import {
  buildOverrideTarget,
  buildTransferChoice,
  deriveOverrideAccess,
  deriveOverrideFlowView,
  deriveOverrideWriteErrorMessage,
  deriveRegisteredOverrideView,
  elementTypeOf,
  selectableTransferInPlayers,
  squadMemberOptions,
  type TransferModeSelection,
} from '../lib/override/derive.ts'
import type {
  OverrideDecisionsContext,
  OverrideEntry,
  OverridePlayerOption,
  OverrideRecommendation,
  StoredOverrideDecision,
} from '../lib/override/types.ts'
import { fetchPlayers } from '../lib/squad/api'
import { POSITION_LABEL } from '../lib/squad/positions'
import './OverrideScreen.css'

/**
 * Override registration (ticket #91, feature-list item 20) — `/override`.
 * Reached from the verdict card's new link, but works as a direct
 * navigation too (hence its own fetch and its own access guard — see
 * OverrideContent below — rather than trusting the link's caller to have
 * already checked).
 *
 * Owns its own read, independent of the home screen and the verdict card,
 * same pattern as ReasoningScreen.tsx / ChipsScreen.tsx: fetch → derive →
 * render whatever the view says. All decision logic — entry completeness,
 * the recommended-vs-actual comparison, the identical-entry refusal, the
 * one-decision-per-gameweek access gate — lives in src/lib/override/
 * derive.ts; this file fetches, wires the pure results into form state, and
 * renders. It performs no comparison or validation of its own (DoD: "the
 * screen does no derivation").
 *
 * Registering records a decision. It never calls any private, write-capable
 * FPL endpoint — see src/lib/override/api.ts's own header and the
 * migration's (Context: the FPL API is never authenticated by this app).
 */

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-recommendation' }
  | {
      status: 'ready'
      recommendation: OverrideRecommendation
      players: OverridePlayerOption[]
      squadPlayerIds: Set<number>
      decisions: OverrideDecisionsContext
    }

function OverrideScreen() {
  const [state, setState] = useState<ScreenState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const recommendation = await fetchLatestRecommendation()
        if (cancelled) return
        if (!recommendation) {
          setState({ status: 'no-recommendation' })
          return
        }

        const [playerRows, squadIds, decisions] = await Promise.all([
          fetchPlayers(),
          fetchSquadPlayerIds(recommendation.gameweekId),
          fetchOverrideDecisions(recommendation.gameweekId, recommendation.planIndex),
        ])
        if (cancelled) return

        const players: OverridePlayerOption[] = playerRows.map((p) => ({
          id: p.id,
          webName: p.webName,
          elementType: p.elementType,
        }))

        setState({
          status: 'ready',
          recommendation,
          players,
          squadPlayerIds: new Set(squadIds),
          decisions,
        })
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
      <div className="override-header">
        <Link className="override-back" to="/">
          ← Home
        </Link>
        <p className="override-mark">Override</p>
      </div>

      {state.status === 'loading' && (
        <Surface className="override-loading" aria-hidden="true">
          <div className="override-skeleton-line override-skeleton-line--title" />
          <div className="override-skeleton-line override-skeleton-line--body" />
          <div className="override-skeleton-line override-skeleton-line--body" />
        </Surface>
      )}

      {state.status === 'error' && (
        <Surface role="alert">
          <p className="override-error">
            Couldn't load this gameweek's recommendation: {state.message}. Reload this page to
            try again.
          </p>
        </Surface>
      )}

      {state.status === 'no-recommendation' && (
        <Surface role="status">
          <p className="override-empty-title">Nothing to register an override against yet</p>
          <p className="override-empty-body">
            Run <code className="num">scripts/generate-recommendations.ts</code> to produce a
            recommendation, then reload this page.
          </p>
        </Surface>
      )}

      {state.status === 'ready' && <OverrideContent state={state} />}
    </AppShell>
  )
}

function OverrideContent({ state }: { state: Extract<ScreenState, { status: 'ready' }> }) {
  const { recommendation, players, squadPlayerIds, decisions } = state
  const [liveDecisions, setLiveDecisions] = useState(decisions)

  const playerNames = useMemo(() => new Map(players.map((p) => [p.id, p.webName])), [players])
  const access = deriveOverrideAccess(liveDecisions.commitDecidedAt, liveDecisions.existingOverride)

  if (access === 'blocked-commit') {
    return (
      <Surface role="status">
        <p className="override-blocked__title">This gameweek is already committed</p>
        <p className="override-blocked__body">
          {recommendation.gameweekName} was already recorded as committed on the verdict card.
          An override is for a gameweek where you did something different — there's nothing to
          register here.
        </p>
      </Surface>
    )
  }

  if (access === 'registered' && liveDecisions.existingOverride) {
    return (
      <RegisteredOverride
        decision={liveDecisions.existingOverride}
        gameweekName={recommendation.gameweekName}
        playerNames={playerNames}
      />
    )
  }

  return (
    <OverrideForm
      recommendation={recommendation}
      players={players}
      squadPlayerIds={squadPlayerIds}
      playerNames={playerNames}
      onRegistered={(decision) => {
        setLiveDecisions((prev) => ({ ...prev, existingOverride: decision }))
      }}
    />
  )
}

function RegisteredOverride({
  decision,
  gameweekName,
  playerNames,
}: {
  decision: StoredOverrideDecision
  gameweekName: string
  playerNames: ReadonlyMap<number, string>
}) {
  const view = deriveRegisteredOverrideView(decision, playerNames)

  return (
    <Surface className="override-registered" role="status">
      <p className="override-registered__title">Override registered</p>
      <p className="override-registered__gameweek">{gameweekName}</p>
      <dl className="override-registered__list">
        <div className="override-registered__row">
          <dt>Captain</dt>
          <dd>{view.captainText}</dd>
        </div>
        <div className="override-registered__row">
          <dt>Vice-captain</dt>
          <dd>{view.viceCaptainText}</dd>
        </div>
        <div className="override-registered__row">
          <dt>Transfer</dt>
          <dd>{view.transferText}</dd>
        </div>
      </dl>
      <p className="override-registered__meta num">Recorded {formatSyncTimestamp(decision.decidedAt)}</p>
    </Surface>
  )
}

interface OverrideFormProps {
  recommendation: OverrideRecommendation
  players: OverridePlayerOption[]
  squadPlayerIds: Set<number>
  playerNames: ReadonlyMap<number, string>
  onRegistered: (decision: StoredOverrideDecision) => void
}

/**
 * The two-step entry-then-confirm flow — design-reference.md: "Registering
 * an override carries deliberate friction … The friction is the feature."
 * `step` is local React state; every gate that matters (whether Continue is
 * enabled, whether the confirm step has anything confirmable to show, the
 * identical-entry refusal) comes from deriveOverrideFlowView, not from
 * anything decided in this component. Do not collapse the two steps, add a
 * skip-confirmation affordance, or pre-fill the entry from the
 * recommendation (Notes: all three are explicitly out of scope).
 */
function OverrideForm({ recommendation, players, squadPlayerIds, playerNames, onRegistered }: OverrideFormProps) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [captainPlayerId, setCaptainPlayerId] = useState<number | null>(null)
  const [viceCaptainPlayerId, setViceCaptainPlayerId] = useState<number | null>(null)
  const [transferMode, setTransferMode] = useState<TransferModeSelection>('unset')
  const [outPlayerId, setOutPlayerId] = useState<number | null>(null)
  const [inPlayerId, setInPlayerId] = useState<number | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeErrorMessage, setWriteErrorMessage] = useState<string | null>(null)

  const squadMembers = useMemo(() => squadMemberOptions(players, squadPlayerIds), [players, squadPlayerIds])
  const transferOutElementType = elementTypeOf(players, outPlayerId)
  const transferInOptions = useMemo(
    () => selectableTransferInPlayers(players, squadPlayerIds, transferOutElementType),
    [players, squadPlayerIds, transferOutElementType]
  )

  const transfer = buildTransferChoice(transferMode, outPlayerId, inPlayerId)
  const entry: OverrideEntry = { captainPlayerId, viceCaptainPlayerId, transfer }
  const flowView = deriveOverrideFlowView({ step, entry, recommendation, playerNames })

  function handleTransferModeChange(mode: TransferModeSelection) {
    setTransferMode(mode)
    if (mode !== 'transfer') {
      setOutPlayerId(null)
      setInPlayerId(null)
    }
  }

  function handleOutPlayerChange(rawValue: string) {
    const id = rawValue === '' ? null : Number(rawValue)
    setOutPlayerId(id)
    // The in-selector's own position pool depends on who's going out — a
    // previously-picked "in" player may no longer be a legal option once
    // "out" changes, so it's cleared rather than silently left stale.
    setInPlayerId(null)
  }

  async function handleRegister() {
    if (writing || !flowView.comparison) return
    setWriting(true)
    setWriteErrorMessage(null)
    try {
      const target = buildOverrideTarget(recommendation, entry)
      const decision = await registerOverride(target)
      onRegistered(decision)
    } catch (err) {
      setWriteErrorMessage(toErrorMessage(err))
    } finally {
      setWriting(false)
    }
  }

  return (
    <>
      <Surface className="override-recommendation">
        <p className="override-recommendation__label">Registering against</p>
        <p className="override-recommendation__gameweek">{recommendation.gameweekName}</p>
      </Surface>

      {step === 'enter' && (
        <Surface className="override-entry">
          <p className="override-entry__title">What did you actually do?</p>

          <label className="override-field">
            <span className="override-field__label">Captain</span>
            <select
              className="override-field__input"
              value={captainPlayerId ?? ''}
              onChange={(e) => setCaptainPlayerId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">— Pick from your squad —</option>
              {squadMembers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.webName} ({POSITION_LABEL[p.elementType]})
                </option>
              ))}
            </select>
          </label>

          <label className="override-field">
            <span className="override-field__label">Vice-captain</span>
            <select
              className="override-field__input"
              value={viceCaptainPlayerId ?? ''}
              onChange={(e) => setViceCaptainPlayerId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">— Pick from your squad —</option>
              {squadMembers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.webName} ({POSITION_LABEL[p.elementType]})
                </option>
              ))}
            </select>
          </label>

          <div className="override-transfer">
            <span className="override-field__label">Transfer</span>
            <div className="override-transfer__modes">
              <label className="override-radio">
                <input
                  type="radio"
                  name="override-transfer-mode"
                  checked={transferMode === 'roll'}
                  onChange={() => handleTransferModeChange('roll')}
                />
                Rolled
              </label>
              <label className="override-radio">
                <input
                  type="radio"
                  name="override-transfer-mode"
                  checked={transferMode === 'transfer'}
                  onChange={() => handleTransferModeChange('transfer')}
                />
                Made a transfer
              </label>
            </div>

            {transferMode === 'transfer' && (
              <>
                <label className="override-field">
                  <span className="override-field__label">Player out</span>
                  <select
                    className="override-field__input"
                    value={outPlayerId ?? ''}
                    onChange={(e) => handleOutPlayerChange(e.target.value)}
                  >
                    <option value="">— Pick from your squad —</option>
                    {squadMembers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.webName} ({POSITION_LABEL[p.elementType]})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="override-field">
                  <span className="override-field__label">Player in</span>
                  <select
                    className="override-field__input"
                    value={inPlayerId ?? ''}
                    onChange={(e) => setInPlayerId(e.target.value === '' ? null : Number(e.target.value))}
                    disabled={outPlayerId === null}
                  >
                    <option value="">
                      {outPlayerId === null ? '— Pick a player out first —' : '— Pick a player in —'}
                    </option>
                    {transferInOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.webName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <p className="override-limitation">
            Records one transfer, or a roll. A gameweek with more than one real transfer is
            recorded here as a roll being overridden with a single transfer — FPL's own transfer
            history stays the authoritative record for those weeks.
          </p>

          {flowView.missingFields.length > 0 && (
            <ul className="override-missing">
              {flowView.missingFields.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="override-continue-button"
            disabled={!flowView.canContinue}
            onClick={() => setStep('confirm')}
          >
            Continue to confirm
          </button>
        </Surface>
      )}

      {step === 'confirm' && (
        <Surface className="override-confirm">
          <p className="override-confirm__title">Confirm what will be recorded</p>

          {flowView.refusalMessage && (
            <>
              <p className="override-refusal" role="alert">
                {flowView.refusalMessage}
              </p>
              <button type="button" className="override-back-button" onClick={() => setStep('enter')}>
                Back to editing
              </button>
            </>
          )}

          {flowView.comparison && (
            <>
              <div className="override-compare">
                <div className="override-compare__header">
                  <span />
                  <span className="override-compare__col-label">Recommended</span>
                  <span className="override-compare__col-label">Will be recorded</span>
                </div>
                {[flowView.comparison.captain, flowView.comparison.viceCaptain, flowView.comparison.transfer].map(
                  (field) => (
                    <div
                      key={field.label}
                      className={
                        field.differs
                          ? 'override-compare__row override-compare__row--differs'
                          : 'override-compare__row'
                      }
                    >
                      <span className="override-compare__field-label">{field.label}</span>
                      <span className="override-compare__value">{field.recommendedText}</span>
                      <span className="override-compare__value">{field.actualText}</span>
                    </div>
                  )
                )}
              </div>

              {writeErrorMessage && (
                <p className="override-write-error" role="alert">
                  {deriveOverrideWriteErrorMessage(writeErrorMessage)}
                </p>
              )}

              <div className="override-confirm__actions">
                <button type="button" className="override-back-button" onClick={() => setStep('enter')}>
                  Back to editing
                </button>
                <button
                  type="button"
                  className="override-register-button"
                  disabled={writing}
                  onClick={() => void handleRegister()}
                >
                  {writing ? 'Registering…' : 'Register override'}
                </button>
              </div>
            </>
          )}
        </Surface>
      )}
    </>
  )
}

export default OverrideScreen
