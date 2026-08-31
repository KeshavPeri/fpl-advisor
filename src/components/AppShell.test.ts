/**
 * Coverage for AppShell.tsx/.css's ticket #166 changes
 * (docs/ui-audit-2026-08-31.md F17/F18/F19/F20). Same renderToStaticMarkup
 * pattern as Surface.test.ts / VerdictCard.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell.tsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'AppShell.css'), 'utf8')

describe('F19 — the escalated wash is a real, opt-in layer', () => {
  it('defaults to escalated: false — no current screen changes today', () => {
    const html = renderToStaticMarkup(createElement(AppShell, {}, 'x'))
    expect(html).toMatch(/class="app-shell"/)
    expect(html).not.toMatch(/app-shell--escalated/)
    expect(html).toMatch(/app-shell__backdrop--escalated/)
  })

  it('escalated: true adds the modifier class that drives the CSS crossfade', () => {
    const html = renderToStaticMarkup(createElement(AppShell, { escalated: true }, 'x'))
    expect(html).toMatch(/class="app-shell app-shell--escalated"/)
  })

  it('the escalated layer opacity-crossfades using --dur-ambient, not a hand-typed duration', () => {
    expect(css).toMatch(/\.app-shell__backdrop--escalated\s*\{[^}]*transition:\s*opacity\s+var\(--dur-ambient\)/)
    expect(css).not.toMatch(/\d+ms\s+cubic-bezier/) // no hand-typed cubic-bezier survives here
  })
})

describe('F17 — the column reserves space for the floating bar', () => {
  it('padding-bottom accounts for the bar height, not just the safe area', () => {
    expect(css).toMatch(/padding-bottom:\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*var\(--space-6\)\s*\+\s*4rem\)/)
  })
})

describe('F20 — .bleed exists and cancels the column\'s own horizontal inset', () => {
  it('is defined in AppShell.css', () => {
    expect(css).toMatch(/\.bleed\s*\{[^}]*margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)/)
  })
})

describe('F18 — the column gap is overridable per screen without editing this file again', () => {
  it('defaults to the unchanged var(--space-6) via a --shell-gap seam', () => {
    expect(css).toMatch(/gap:\s*var\(--shell-gap,\s*var\(--space-6\)\)/)
  })
})
