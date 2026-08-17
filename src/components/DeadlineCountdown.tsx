import { useEffect, useState } from 'react'
import {
  computeRemaining,
  formatDeadlineInstant,
  formatRemaining,
} from '../lib/deadlineCountdown'
import './DeadlineCountdown.css'

export type DeadlineCountdownState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; gameweekName: string; deadlineIso: string }

interface DeadlineCountdownProps {
  state: DeadlineCountdownState
}

/**
 * The thin, topmost element of the home screen (design-reference.md: "Home
 * screen order: thin deadline countdown, then the verdict, then the squad
 * as a pitch"). Understated by default; escalates — larger, accented —
 * inside the pure module's ESCALATE_WITHIN_MS threshold. Never flashes or
 * pulses (design-reference.md: "should feel like the app leaning forward,
 * not like an alarm").
 *
 * Deliberately not a `Surface` — no translucent panel, no blur, no border.
 * A card would restructure the home screen around this element; the ticket
 * is explicit that it must not.
 *
 * Data comes in as a prop, not fetched here — HomeScreen owns the single
 * `fetchTargetGameweek` call the pitch section already needs, and passes
 * its result down, so there is exactly one query for that row, not two
 * (ticket #42: "do not add a second query for the same row").
 *
 * The live tick is this component's own concern: a plain `setInterval`
 * re-renders once a second so the figure counts down, cleaned up with
 * `clearInterval` on unmount or whenever `state` stops being 'ready'. This
 * is the one place in the whole feature that reads a live clock — the
 * arithmetic itself (src/lib/deadlineCountdown.ts) stays pure and takes
 * "now" as a plain argument.
 */
function DeadlineCountdown({ state }: DeadlineCountdownProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state.status !== 'ready') return
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [state.status])

  if (state.status === 'loading') {
    return (
      <div className="deadline-countdown" aria-live="off">
        <p className="deadline-countdown__label">Deadline</p>
        <p className="deadline-countdown__value">Checking the next gameweek…</p>
      </div>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <div className="deadline-countdown" aria-live="off">
        <p className="deadline-countdown__label">Deadline</p>
        <p className="deadline-countdown__value">No upcoming deadline is available right now.</p>
      </div>
    )
  }

  const remaining = computeRemaining(state.deadlineIso, now)
  const instant = formatDeadlineInstant(state.deadlineIso)
  const wrapperClass =
    'deadline-countdown' + (remaining.isEscalated ? ' deadline-countdown--escalated' : '')

  return (
    <div
      className={wrapperClass}
      // The figure ticks every second while mounted. A live region would
      // force assistive tech to announce every tick; this element is
      // fully readable on demand via normal linear navigation, it just
      // isn't force-announced on each change (ticket #42 DoD).
      aria-live="off"
    >
      <p className="deadline-countdown__label">{state.gameweekName} deadline</p>
      <p className="deadline-countdown__value">
        <span className="num">{instant}</span>
        {remaining.hasPassed ? (
          <span className="deadline-countdown__remaining">
            Deadline passed — next gameweek not confirmed yet
          </span>
        ) : (
          <span className="deadline-countdown__remaining num">
            {formatRemaining(remaining)} left
          </span>
        )}
      </p>
    </div>
  )
}

export default DeadlineCountdown
