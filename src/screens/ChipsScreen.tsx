import { useEffect, useState, type ReactNode } from 'react'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { fetchChipSourceData } from '../lib/chips/api.ts'
import { deriveChipState } from '../lib/chips/derive.ts'
import type { ChipAdvisoryView, ChipExpiryWarning, ChipSetView, DerivedChipState, UsedChipView } from '../lib/chips/types.ts'
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
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md — F40/F41 (must-fix): reordered
 * to the owner's own three questions, in the order he asks them (P8):
 * what do I still have, when do I lose it, is now a good time. What's
 * already used/lost moves to the bottom. The chip-timing caveat now sits
 * ABOVE the figure it qualifies, not below it — a caveat read after the
 * number has already been believed doesn't do its job. F42 (should-fix):
 * three panel weights instead of seven identical ones — one focal L3
 * (what's left + when), one recessed L1 (the advisories, a deliberately
 * quieter register: no accent colour, per product-brief.md §6a's "never an
 * instruction"), one L2 (the used/lost history, both sets in one panel).
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

/** "Wildcard", "Wildcard and Free Hit", "Wildcard, Free Hit and Bench Boost". */
function formatChipNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function ChipsContent({ state }: { state: DerivedChipState }) {
  const unknownFirst = state.usedChips.filter((chip) => !chip.isKnown && chip.set === 'first')
  const unknownSecond = state.usedChips.filter((chip) => !chip.isKnown && chip.set === 'second')
  const unclassified = state.usedChips.filter((chip) => chip.set === 'unknown')
  const totalUsed = state.firstSet.usedCount + state.secondSet.usedCount + unclassified.length

  // F40 — "what do I still have", combining both sets' genuinely-available
  // remaining chips (the second set's own `remaining` list is populated
  // before it's actually reachable — `isAvailable` is what gates that).
  const remainingChips = [
    ...state.firstSet.remaining,
    ...(state.secondSet.isAvailable ? state.secondSet.remaining : []),
  ]

  return (
    <>
      {/* F40/F42 — "what's left" and "when do I lose it", the two things
          answered first because they're asked first. The one focal panel
          on this screen (F12's own note names this exact panel). */}
      <Surface className="chips-summary" level={3} focal>
        <p className="chips-summary__label">
          {state.hasUsedAnyChip ? (
            <>
              <span className="num">{totalUsed}</span> of <span className="num">8</span> used
            </>
          ) : (
            'Season chips'
          )}
        </p>
        {/* #194, section F — "the hero headline is a comma-separated list
            of chip names at display size. Demote it: remaining chips are
            a list, not a headline." A real <ul>, one chip per row, at
            --text-title rather than --text-display — the panel's own
            level={3}/focal treatment still carries the "this is the
            important panel" signal; the chip names themselves don't need
            to shout too. */}
        {remainingChips.length > 0 ? (
          <ul className="chips-summary__list">
            {remainingChips.map((chip, index) => (
              // `id` (KnownChipId) can repeat across the two sets when both
              // still hold the same chip type unused — `index` disambiguates
              // since this list is never reordered in place.
              <li key={`${chip.id}-${index}`} className="chips-summary__list-item">
                {chip.displayName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="chips-summary__headline">None remaining</p>
        )}

        {!state.firstSet.expired && state.firstSet.timeRemaining && (
          <p className="chips-summary__closes">
            {state.firstSet.timeRemaining.gameweeksRemaining !== null && (
              <>
                <span className="num">{state.firstSet.timeRemaining.gameweeksRemaining}</span>{' '}
                {state.firstSet.timeRemaining.gameweeksRemaining === 1 ? 'gameweek' : 'gameweeks'} left ·{' '}
              </>
            )}
            Closes {state.firstSet.timeRemaining.calendarLabel}
          </p>
        )}

        {!state.firstSet.expired && !state.firstSet.deadlineKnown && (
          <p className="chips-summary__closes chips-summary__closes--unavailable">
            Deadline unavailable — Gameweek 19 hasn't been loaded yet.
          </p>
        )}

        {state.expiryWarning && state.expiryWarning.band !== 'none' && (
          <p className={`chips-expiry chips-expiry--${state.expiryWarning.band}`}>
            <ExpiryWarningLine warning={state.expiryWarning} />
          </p>
        )}
      </Surface>

      {/* F41/F42, rebuilt for #194 section F — "the advisory panel
          currently holds two different advisories... stacked inside one
          surface. Split into two surfaces at different weights." Neither
          ever takes an accent colour (product-brief.md §6a: never an
          instruction) — the two weights come from Surface's own `level`
          alone. Chip timing (level 1, the quieter of the two — it is the
          more speculative of the two advisories, several solver runs
          agreeing on a plan rather than a single stored figure) sits
          above squad-rebuild (level 2, closer to the standard panel
          weight — a single computed delta, read once a state exists to
          show). Every caveat still sits ABOVE the figure it qualifies. */}
      {state.chipAdvisories.length > 0 && (
        <Surface className="chips-advisory chips-advisory--timing" level={1} padding="compact">
          <p className="chips-advisory__heading">Chip timing</p>
          {state.chipAdvisoryNote && <p className="chips-advisory__note">{state.chipAdvisoryNote}</p>}
          {state.chipAdvisories.map((plan) => (
            <ChipAdvisoryPlan
              key={plan.decisions.map((d) => `${d.chipCode}@${d.chipGameweekId}`).join('|')}
              plan={plan}
              showSolutionCount={state.chipAdvisories.length > 1}
            />
          ))}
        </Surface>
      )}

      {state.squadAdvisories.length > 0 && (
        <Surface className="chips-advisory chips-advisory--rebuild" level={2} padding="compact">
          <p className="chips-advisory__heading">Squad rebuild</p>
          {state.squadAdvisoryNote && <p className="chips-advisory__note">{state.squadAdvisoryNote}</p>}
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
        </Surface>
      )}

      {/* F40/F42 — "what's already gone": both sets' used/lost history,
          collapsed into one panel at the bottom. */}
      <Surface className="chips-history">
        <ChipHistoryBlock
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
          unknownChips={unknownFirst}
        />

        <ChipHistoryBlock
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
          unknownChips={unknownSecond}
          locked={!state.secondSet.isAvailable}
        />
      </Surface>

      {unclassified.length > 0 && (
        <Surface className="chips-unclassified" level={1} role="status">
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

interface ChipHistoryBlockProps {
  title: string
  set: ChipSetView
  statusLine: ReactNode
  unknownChips: readonly UsedChipView[]
  locked?: boolean
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

/**
 * Ticket #169 — the used/lost history for one set (formerly
 * `ChipSetSection`, which also owned the expiry/time-remaining display
 * that F40 promoted up to the summary panel, and its own `<Surface>` —
 * both sets now share one panel, rendered by the caller). Purely history:
 * what was used, when, and what's lost.
 */
function ChipHistoryBlock({ title, set, statusLine, unknownChips, locked = false }: ChipHistoryBlockProps) {
  return (
    <div className={locked ? 'chips-history__set chips-history__set--locked' : 'chips-history__set'}>
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
    </div>
  )
}

export default ChipsScreen
