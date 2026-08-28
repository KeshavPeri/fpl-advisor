import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { fetchChipSourceData } from '../lib/chips/api.ts'
import { deriveChipState } from '../lib/chips/derive.ts'
import type { ChipAdvisoryView, ChipExpiryWarning, ChipSetTimeRemaining, ChipSetView, DerivedChipState, UsedChipView } from '../lib/chips/types.ts'
import { toErrorMessage } from '../lib/format'
import './ChipsScreen.css'

/**
 * The chips screen (ticket #85, feature-list item 25) — `/chips`. States
 * which of the season's eight chips (two sets of four) are used, remaining
 * or lost, and how long the active set has left. It states the position; it
 * does not warn or recommend — item 26 (chip expiry, #97) added the
 * warning above; item 27 (ticket #126) adds the chip-timing ADVISORY below,
 * and item 28 (ticket #134) adds the squad-rebuild advisory beneath it — a
 * number and its limitation, never a "play this chip" instruction
 * (product-brief.md §6a). Owns its own fetch, independent of the home
 * screen, same
 * "fetch → derive → render whatever the view says" split as
 * src/screens/ReasoningScreen.tsx and src/lib/reasoning/derive.ts. `Date.now()`
 * is called exactly once, right here — deriveChipState itself reads no
 * clock (its own DoD: every instant is a parameter).
 */

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; state: DerivedChipState }

function ChipsScreen() {
  const [screenState, setScreenState] = useState<ScreenState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setScreenState({ status: 'loading' })

    async function load() {
      try {
        const source = await fetchChipSourceData()
        if (cancelled) return
        setScreenState({ status: 'loaded', state: deriveChipState(source, Date.now()) })
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
      <div className="chips-header">
        <Link className="chips-back" to="/">
          ← Home
        </Link>
        <p className="chips-mark">Chips</p>
      </div>

      {screenState.status === 'loading' && (
        <Surface className="chips-loading" aria-hidden="true">
          <div className="chips-skeleton-line chips-skeleton-line--title" />
          <div className="chips-skeleton-line chips-skeleton-line--body" />
          <div className="chips-skeleton-line chips-skeleton-line--body" />
        </Surface>
      )}

      {screenState.status === 'error' && (
        <Surface role="alert">
          <p className="chips-error">
            Couldn't load chip state: {screenState.message}. Reload this page to try again.
          </p>
        </Surface>
      )}

      {screenState.status === 'loaded' && <ChipsContent state={screenState.state} />}
    </AppShell>
  )
}

function ChipsContent({ state }: { state: DerivedChipState }) {
  const unknownFirst = state.usedChips.filter((chip) => !chip.isKnown && chip.set === 'first')
  const unknownSecond = state.usedChips.filter((chip) => !chip.isKnown && chip.set === 'second')
  const unclassified = state.usedChips.filter((chip) => chip.set === 'unknown')
  const totalUsed = state.firstSet.usedCount + state.secondSet.usedCount + unclassified.length

  return (
    <>
      <Surface className="chips-summary">
        <p className="chips-summary__label">Season chips</p>
        <p className="chips-summary__headline">
          {state.hasUsedAnyChip ? (
            <>
              <span className="num">{totalUsed}</span> of <span className="num">8</span> used
            </>
          ) : (
            'No chips used yet'
          )}
        </p>
      </Surface>

      <ChipSetSection
        title="First set"
        set={state.firstSet}
        statusLine={
          state.firstSet.expired ? (
            <>
              Closed — <span className="num">{state.firstSet.lostCount}</span>{' '}
              {state.firstSet.lostCount === 1 ? 'chip' : 'chips'} lost
            </>
          ) : (
            <>
              <span className="num">{state.firstSet.usedCount}</span> of{' '}
              <span className="num">{state.firstSet.totalCount}</span> used
            </>
          )
        }
        timeRemaining={state.firstSet.timeRemaining}
        deadlineUnknownNote={!state.firstSet.deadlineKnown && !state.firstSet.expired}
        unknownChips={unknownFirst}
        expiryWarning={state.expiryWarning}
      />

      <ChipSetSection
        title="Second set"
        set={state.secondSet}
        statusLine={
          state.secondSet.isAvailable ? (
            <>
              <span className="num">{state.secondSet.usedCount}</span> of{' '}
              <span className="num">{state.secondSet.totalCount}</span> used
            </>
          ) : (
            'Not yet available'
          )
        }
        timeRemaining={null}
        deadlineUnknownNote={false}
        unknownChips={unknownSecond}
        locked={!state.secondSet.isAvailable}
      />

      {state.chipAdvisories.length > 0 && (
        <Surface className="chips-advisory">
          <p className="chips-advisory__label">Chip advisory</p>
          {state.chipAdvisories.map((plan) => (
            <ChipAdvisoryPlan key={plan.decisions.map((d) => `${d.chipCode}@${d.chipGameweekId}`).join('|')} plan={plan} showSolutionCount={state.chipAdvisories.length > 1} />
          ))}
          {state.chipAdvisoryNote && <p className="chips-advisory__note">{state.chipAdvisoryNote}</p>}
        </Surface>
      )}

      {state.squadAdvisories.length > 0 && (
        <Surface className="chips-advisory">
          <p className="chips-advisory__label">Squad-rebuild advisory</p>
          <ul className="chips-advisory__list">
            {state.squadAdvisories.map((advisory) => (
              <li key={advisory.chipCode} className="chips-advisory__row">
                <span className="chips-advisory__name">{advisory.displayName}</span>
                <span className="chips-advisory__meta">
                  <span className="num">
                    {advisory.deltaWhole > 0 ? '+' : ''}
                    {advisory.deltaWhole}
                  </span>{' '}
                  pts if rebuilt now
                </span>
              </li>
            ))}
          </ul>
          {state.squadAdvisoryNote && <p className="chips-advisory__note">{state.squadAdvisoryNote}</p>}
        </Surface>
      )}

      {unclassified.length > 0 && (
        <Surface className="chips-unclassified" role="status">
          <p className="chips-unclassified__label">Chip activity with no recorded gameweek</p>
          {unclassified.map((chip) => (
            <p key={chip.id} className="chips-unclassified__line">
              {chip.displayName}
            </p>
          ))}
        </Surface>
      )}
    </>
  )
}

/**
 * One distinct chip-timing plan within the chip advisory — ticket #141.
 * Renders the plan's own chip decisions once each (no delta on a decision
 * row — see ChipAdvisoryDecision's own doc comment) and states the
 * points figure exactly once, for the plan as a whole. `showSolutionCount`
 * is only ever true when ChipsScreen.tsx found more than one distinct
 * plan — the only case where "N of M solutions" is informative, since a
 * single plan by construction means every solution that named a chip
 * agreed on it (see deriveChipAdvisories's own comment in derive.ts).
 */
function ChipAdvisoryPlan({ plan, showSolutionCount }: { plan: ChipAdvisoryView; showSolutionCount: boolean }) {
  return (
    <div className="chips-advisory__plan">
      <ul className="chips-advisory__list">
        {plan.decisions.map((decision) => (
          <li key={`${decision.chipCode}-${decision.chipGameweekId}`} className="chips-advisory__row">
            <span className="chips-advisory__name">{decision.displayName}</span>
            <span className="chips-advisory__meta">{decision.gameweekLabel}</span>
          </li>
        ))}
      </ul>
      <p className="chips-advisory__delta">
        <span className="num">
          {plan.deltaWhole > 0 ? '+' : ''}
          {plan.deltaWhole}
        </span>{' '}
        pts across the horizon
        {showSolutionCount && (
          <>
            {' '}
            · <span className="num">{plan.solutionCount}</span> of{' '}
            <span className="num">{plan.totalSolutionCount}</span> solutions
          </>
        )}
      </p>
    </div>
  )
}

interface ChipSetSectionProps {
  title: string
  set: ChipSetView
  statusLine: ReactNode
  timeRemaining: ChipSetTimeRemaining | null
  deadlineUnknownNote: boolean
  unknownChips: readonly UsedChipView[]
  locked?: boolean
  /** Ticket #97 — only ever passed for the first set; the second set has no expiry within this app's scope. */
  expiryWarning?: ChipExpiryWarning
}

/** "Wildcard", "Wildcard and Free Hit", "Wildcard, Free Hit and Bench Boost". */
function formatChipNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Ticket #97's own DoD: names the specific unused chips and gameweeks
 * remaining, sentence case, plain verbs, no filler, no exclamation point —
 * design-reference.md's interface-writing rules. The same wording at every
 * band; escalation is carried entirely by the CSS class (chips-expiry--…)
 * per design-reference.md's "understated by default and escalates," not by
 * louder copy. Returns JSX rather than a string so the gameweeks figure
 * renders through the app's shared `.num` token (Geist Mono, tabular) like
 * every other number on this screen — design-reference.md's typography
 * rule, not a plain string this app's own convention would flag.
 */
function ExpiryWarningLine({ warning }: { warning: Extract<ChipExpiryWarning, { band: 'noted' | 'pressing' | 'final' }> }) {
  const names = formatChipNames(warning.chipsAtRisk.map((chip) => chip.displayName))
  const pronoun = warning.chipsAtRisk.length === 1 ? 'it' : 'them'
  const gwWord = warning.gameweeksRemaining === 1 ? 'gameweek' : 'gameweeks'
  return (
    <>
      {names} — <span className="num">{warning.gameweeksRemaining}</span> {gwWord} left to use {pronoun}.
    </>
  )
}

function ChipSetSection({
  title,
  set,
  statusLine,
  timeRemaining,
  deadlineUnknownNote,
  unknownChips,
  locked = false,
  expiryWarning,
}: ChipSetSectionProps) {
  return (
    <Surface className={locked ? 'chips-set chips-set--locked' : 'chips-set'}>
      <div className="chips-set__header">
        <p className="chips-set__title">{title}</p>
        <p className="chips-set__status">{statusLine}</p>
      </div>

      <ul className="chips-set__list">
        {set.slots.map((slot) => (
          <li key={slot.id} className={`chips-slot chips-slot--${slot.status}`}>
            <span className="chips-slot__name">{slot.displayName}</span>
            <span className="chips-slot__meta num">
              {slot.status === 'used' && slot.gameweekLabel}
              {slot.status === 'lost' && 'Lost'}
              {slot.status === 'remaining' && (locked ? 'Locked' : 'Available')}
            </span>
          </li>
        ))}
      </ul>

      {timeRemaining && (
        <p className="chips-set__time">
          {timeRemaining.gameweeksRemaining !== null && (
            <>
              <span className="num">{timeRemaining.gameweeksRemaining}</span>{' '}
              {timeRemaining.gameweeksRemaining === 1 ? 'gameweek' : 'gameweeks'} left ·{' '}
            </>
          )}
          Closes {timeRemaining.calendarLabel}
        </p>
      )}

      {deadlineUnknownNote && (
        <p className="chips-set__time chips-set__time--unavailable">
          Deadline unavailable — Gameweek 19 hasn't been loaded yet.
        </p>
      )}

      {expiryWarning && expiryWarning.band !== 'none' && (
        <p className={`chips-expiry chips-expiry--${expiryWarning.band}`}>
          <ExpiryWarningLine warning={expiryWarning} />
        </p>
      )}

      {unknownChips.length > 0 && (
        <p className="chips-set__unknown">
          Also used:{' '}
          {unknownChips.map((chip, index) => (
            <span key={chip.id}>
              {index > 0 && ', '}
              {chip.displayName} (
              {chip.gameweekId !== null ? (
                <>
                  Gameweek <span className="num">{chip.gameweekId}</span>
                </>
              ) : (
                'gameweek unknown'
              )}
              )
            </span>
          ))}
        </p>
      )}
    </Surface>
  )
}

export default ChipsScreen
