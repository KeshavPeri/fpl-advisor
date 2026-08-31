/**
 * F23 (docs/ui-audit-2026-08-31.md, must-fix) — the countdown's remaining-
 * time figure must be zero-padded, so its character count stays constant
 * through every digit rollover (`tabular-nums` fixes digit *width*, not
 * digit *count*). Drives this through the actual rendered component
 * (react-dom/server's renderToStaticMarkup, same technique
 * VerdictCard.test.ts uses) with a pinned clock, rather than importing the
 * internal formatter directly — it stays module-private so this file keeps
 * exporting only components (react-refresh/only-export-components).
 *
 * No supabase-touching import chain here (DeadlineCountdown.tsx imports
 * only React and src/lib/deadlineCountdown.ts), so — unlike
 * VerdictCard.test.ts — no client mock is needed to import the module.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeadlineCountdown from './DeadlineCountdown.tsx'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderReady(nowIso: string, deadlineIso: string): string {
  vi.setSystemTime(new Date(nowIso))
  return renderToStaticMarkup(
    createElement(DeadlineCountdown, {
      state: { status: 'ready', gameweekName: 'Gameweek 4', deadlineIso },
    })
  )
}

describe('DeadlineCountdown — zero-padded remaining-time figure (F23)', () => {
  it('pads single-digit hours in the "Nd HHh" branch so the string never shortens as hours roll over', () => {
    const nine = renderReady('2026-08-01T00:00:00Z', '2026-08-02T09:00:00Z') // 1d 09h
    const ten = renderReady('2026-08-01T00:00:00Z', '2026-08-02T10:00:00Z') // 1d 10h
    expect(nine).toContain('1d 09h')
    expect(ten).toContain('1d 10h')
  })

  // The exact boundary the audit names: inside the final hour, the old
  // unpadded format changed width every ten seconds. Going from :09 to :10
  // must not change the rendered string's length.
  it('holds a constant character count across the single-to-double-digit seconds boundary', () => {
    const before = renderReady('2026-08-01T00:00:00Z', '2026-08-01T00:05:09Z') // 00:05:09
    const after = renderReady('2026-08-01T00:00:00Z', '2026-08-01T00:05:10Z') // 00:05:10
    expect(before).toContain('00:05:09')
    expect(after).toContain('00:05:10')
  })

  it('renders a ticking hh:mm:ss clock inside the escalation threshold (F22), not the old "Xh Ym" shape', () => {
    const html = renderReady('2026-08-01T00:00:00Z', '2026-08-01T23:00:00Z') // 23h away
    expect(html).toContain('23:00:00')
  })

  it('uses the "Nd HHh" form once outside the escalation threshold', () => {
    const html = renderReady('2026-08-01T00:00:00Z', '2026-08-04T04:00:00Z') // 3d 4h away
    expect(html).toContain('3d 04h')
  })
})
