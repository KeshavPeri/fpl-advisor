import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { fetchChipSourceData } from '../lib/chips/api.ts'
import { deriveChipState } from '../lib/chips/derive.ts'
import type { ChipSetTimeRemaining, ChipSetView, DerivedChipState, UsedChipView } from '../lib/chips/types.ts'
import { toErrorMessage } from '../lib/format'
import './ChipsScreen.css'

/**
 * The chips screen (ticket #85, feature-list item 25) — `/chips`. States
 * which of the season's eight chips (two sets of four) are used, remaining
 * or lost, and how long the active set has left. It states the position; it
 * does not warn or recommend — that's items 26 and 27 (see the ticket's own
 * Scope OUT). Owns its own fetch, independent of the home screen, same
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
          {state.hasUsedAnyChip ? `${totalUsed} of 8 used` : 'No chips used yet'}
        </p>
      </Surface>

      <ChipSetSection
        title="First set"
        set={state.firstSet}
        statusLine={
          state.firstSet.expired
            ? `Closed — ${state.firstSet.lostCount} ${state.firstSet.lostCount === 1 ? 'chip' : 'chips'} lost`
            : `${state.firstSet.usedCount} of ${state.firstSet.totalCount} used`
        }
        timeRemaining={state.firstSet.timeRemaining}
        deadlineUnknownNote={!state.firstSet.deadlineKnown && !state.firstSet.expired}
        unknownChips={unknownFirst}
      />

      <ChipSetSection
        title="Second set"
        set={state.secondSet}
        statusLine={
          state.secondSet.isAvailable
            ? `${state.secondSet.usedCount} of ${state.secondSet.totalCount} used`
            : 'Not yet available'
        }
        timeRemaining={null}
        deadlineUnknownNote={false}
        unknownChips={unknownSecond}
        locked={!state.secondSet.isAvailable}
      />

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

interface ChipSetSectionProps {
  title: string
  set: ChipSetView
  statusLine: string
  timeRemaining: ChipSetTimeRemaining | null
  deadlineUnknownNote: boolean
  unknownChips: readonly UsedChipView[]
  locked?: boolean
}

function ChipSetSection({
  title,
  set,
  statusLine,
  timeRemaining,
  deadlineUnknownNote,
  unknownChips,
  locked = false,
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

      {unknownChips.length > 0 && (
        <p className="chips-set__unknown">
          Also used: {unknownChips.map((chip) => `${chip.displayName} (${chip.gameweekLabel})`).join(', ')}
        </p>
      )}
    </Surface>
  )
}

export default ChipsScreen
