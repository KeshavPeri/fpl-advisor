import { useEffect, useState } from 'react'
import {
  computeRemaining,
  ESCALATE_WITHIN_MS,
  formatDeadlineInstant,
  type RemainingTime,
} from '../lib/deadlineCountdown'
import Surface from './Surface'
import './DeadlineCountdown.css'

export type DeadlineCountdownState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; gameweekName: string; deadlineIso: string }

interface DeadlineCountdownProps {
  state: DeadlineCountdownState
  /**
   * F19/F22 (docs/ui-audit-2026-08-31.md) — the escalated ambient wash is
   * AppShell's job (its `escalated` prop, built by the foundations ticket
   * and otherwise unwired), but AppShell has no clock of its own — this
   * component owns the only live clock the whole feature reads (see the
   * file header below). Reporting the boolean up here, rather than giving
   * HomeScreen a second setInterval on the same deadline, keeps that "one
   * clock" property true. Called only when the boolean actually changes,
   * not once a second — see the effect below.
   */
  onEscalatedChange?: (escalated: boolean) => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * F23 (must-fix) — a zero-padded, fixed-character-count alternative to
 * src/lib/deadlineCountdown.ts's `formatRemaining`, which does not
 * zero-pad and so changes the countdown's own character count as digits
 * roll over ("3d 4h" -> "3d 14h"; inside the final hour, the seconds field
 * changes width once every ten seconds — once a second at the worst point,
 * per the audit). `tabular-nums` (`.num`) fixes the width of each *digit*,
 * not the *count* of digits, so it cannot fix this on its own.
 *
 * SCOPE NOTE — reported to the orchestrator as a finding, not worked around
 * silently: the audit's own proposed fix (F23) edits `formatRemaining` in
 * `src/lib/deadlineCountdown.ts` directly. This ticket's scope constraint
 * (CLAUDE.md) explicitly forbids touching anything under `src/lib/`, so
 * that file is untouched — `formatRemaining` and its existing tests
 * (`src/lib/deadlineCountdown.test.ts`) are unchanged, still correct for
 * what they assert, and still pass. This function re-implements the same
 * padding fix as a second, component-local formatter operating on the same
 * already-pure `RemainingTime` fields `formatRemaining` reads — no time
 * arithmetic happens here, only formatting, which keeps it "presentation
 * only" per this ticket's own scope. See DeadlineCountdown.test.ts, which
 * drives this through the rendered component with a pinned clock
 * (vi.setSystemTime) rather than importing this function directly — so it
 * stays module-private and this file keeps exporting only components
 * (react-refresh/only-export-components).
 *
 * Also implements F22's escalation format: inside `ESCALATE_WITHIN_MS`,
 * the figure switches from the static "Nd HHh" shape to a ticking
 * `hh:mm:ss` clock — a ticking clock reads as more urgent than a static
 * "4h 12m" on its own, independent of the size/colour step CSS carries
 * (DeadlineCountdown.css).
 */
function formatRemainingPadded(remaining: RemainingTime): string {
  if (remaining.totalMs >= ESCALATE_WITHIN_MS) {
    return `${remaining.days}d ${pad(remaining.hours)}h`
  }
  return `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`
}

/**
 * The thin, topmost element of the home screen (design-reference.md: "Home
 * screen order: thin deadline countdown, then the verdict, then the squad
 * as a pitch"). Never flashes or pulses (design-reference.md: "should feel
 * like the app leaning forward, not like an alarm").
 *
 * F21 (must-fix) — was three lines, all 13-15px, ~40px total: a caption,
 * not a figure. Now a Revolut/Weather-style treatment (design-reference.md
 * reference 2/3, and the audit's resolution of P4 vs "understated by
 * default": the countdown is the largest FIGURE on the screen, the verdict
 * stays the loudest STATEMENT — size and loudness are different axes). The
 * gameweek name is promoted to the app's first `<h1>` — F38 deletes
 * HomeScreen's own wordmark `<header>`, so this is the only heading
 * candidate the home screen has, and "Gameweek 4" is real information where
 * "FPL Advisor" was not.
 *
 * #194, section D — now a `Surface` of its own (level 1, compact padding):
 * "the deadline countdown becomes its own component with its own
 * container." It was the only element on the home screen with no surface
 * behind it; a recessed, quiet panel gives it a place to sit without
 * competing with the verdict card's own, louder hero material below it.
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
function DeadlineCountdown({ state, onEscalatedChange }: DeadlineCountdownProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state.status !== 'ready') return
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [state.status])

  // F19/F22 — computed unconditionally (not just in the 'ready' branch
  // below) so the hook order never depends on `state.status`; cheap, since
  // computeRemaining is pure and this is the same call the 'ready' render
  // path below makes again for its own rendering.
  const isEscalatedNow =
    state.status === 'ready' && computeRemaining(state.deadlineIso, now).isEscalated

  useEffect(() => {
    onEscalatedChange?.(isEscalatedNow)
  }, [isEscalatedNow, onEscalatedChange])

  if (state.status === 'loading') {
    return (
      <Surface className="deadline-countdown" level={1} padding="compact" aria-live="off">
        <h1 className="deadline-countdown__label">Deadline</h1>
        <p className="deadline-countdown__message">Checking the next gameweek…</p>
      </Surface>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <Surface className="deadline-countdown" level={1} padding="compact" aria-live="off">
        <h1 className="deadline-countdown__label">Deadline</h1>
        <p className="deadline-countdown__message">No deadline available right now.</p>
      </Surface>
    )
  }

  const remaining = computeRemaining(state.deadlineIso, now)
  const instant = formatDeadlineInstant(state.deadlineIso)
  const wrapperClass =
    'deadline-countdown' + (remaining.isEscalated ? ' deadline-countdown--escalated' : '')

  return (
    <Surface
      className={wrapperClass}
      level={1}
      padding="compact"
      // The figure ticks every second while mounted. A live region would
      // force assistive tech to announce every tick; this element is
      // fully readable on demand via normal linear navigation, it just
      // isn't force-announced on each change (ticket #42 DoD).
      aria-live="off"
    >
      <h1 className="deadline-countdown__label">{state.gameweekName}</h1>
      {remaining.hasPassed ? (
        <p className="deadline-countdown__message">Deadline passed — next gameweek not set yet.</p>
      ) : (
        <p className="deadline-countdown__remaining num">{formatRemainingPadded(remaining)}</p>
      )}
      <p className="deadline-countdown__deadline-line">
        Deadline <span className="num">{instant}</span>
      </p>
    </Surface>
  )
}

export default DeadlineCountdown
