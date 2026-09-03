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

describe('#194, section H — M2 (screen transitions), accepted in the Part 3 motion audit and finally built', () => {
  it('the column plays a real entrance keyframe at the app\'s own --dur-enter/--ease-out tokens, no hand-typed values', () => {
    expect(css).toMatch(/animation:\s*app-shell-screen-enter\s+var\(--dur-enter\)\s+var\(--ease-out\)/)
  })

  it('the entrance keyframe moves from a settled offset, never from scale(0) or off past the safe area', () => {
    const keyframes = css.match(/@keyframes app-shell-screen-enter\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(keyframes).toMatch(/from\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translateY\(0\.5rem\)/)
    expect(keyframes).toMatch(/to\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translateY\(0\)/)
  })

  it('the floating bar is structurally excluded from the entrance animation — AppShell.tsx renders no <AppBar>, only the backdrop/grain layers and the column', () => {
    const tsx = readFileSync(path.join(here, 'AppShell.tsx'), 'utf8')
    expect(tsx).not.toMatch(/AppBar/)
    // AppBar.test.ts's own "adds no motion" assertion is what proves the
    // bar carries no animation at all — this only proves AppShell can't
    // apply one to it, since the bar isn't one of AppShell's children
    // (it's a sibling of <Routes> in App.tsx, so it never remounts and
    // this keyframe never has a reason to touch it).
  })
})

describe('#194, section A1 — no home-screen content renders above the top safe-area inset', () => {
  it('the column\'s own padding-top adds --space-6 on top of env(safe-area-inset-top), so every child (including the countdown, its first child) starts clear of it', () => {
    expect(css).toMatch(/padding-top:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*var\(--space-6\)\)/)
  })
})

describe('F17/#194 A3 — the column reserves space for the floating bar', () => {
  it('padding-bottom accounts for the bar\'s real reserved height via the shared --nav-bar-reserve token, not just the safe area', () => {
    expect(css).toMatch(/padding-bottom:\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*var\(--nav-bar-reserve\)\)/)
  })

  it('the static (non-safe-area) portion of the reserve is at least the bar height plus one gap (rendering-fault DoD)', () => {
    const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    const px = (raw: string) => (raw.trim().endsWith('rem') ? parseFloat(raw) * 16 : parseFloat(raw))
    const extract = (name: string) => {
      const match = indexCss.match(new RegExp(`--${name}:\\s*([^;]+);`))
      if (!match) throw new Error(`token --${name} not found`)
      return match[1].trim()
    }
    const barHeight = px(extract('nav-home-size')) // the bar's own rendered height is at least as tall as its circular centre item
    const oneGap = px(extract('space-3')) // the bar's own offset from the safe area — the "one gap" the DoD names
    const reserve = px(extract('nav-bar-reserve'))
    expect(reserve).toBeGreaterThanOrEqual(barHeight + oneGap)
  })
})

describe('F20 — .bleed exists and cancels the column\'s own horizontal inset', () => {
  it('is defined in AppShell.css', () => {
    expect(css).toMatch(/\.bleed\s*\{[^}]*margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)/)
  })
})

describe('#194, section E — .bleed-narrow retains a margin, departing from F25\'s full-bleed proposal', () => {
  it('cancels only part of the column\'s horizontal inset, unlike .bleed', () => {
    const rule = css.match(/\.bleed-narrow\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)\s*\+\s*var\(--space-4\)\s*-\s*var\(--space-2\)\)\)/)
  })
})

describe('#194, section B — the grain layer', () => {
  it('is fixed, behind content, and built from an inline SVG turbulence filter (no new asset/dependency)', () => {
    const rule = css.match(/\.app-shell__grain\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/z-index:\s*-1/)
    expect(rule).toMatch(/background-image:\s*url\("data:image\/svg\+xml/)
    expect(rule).toMatch(/feTurbulence/)
  })
})

describe('F18 — the column gap is overridable per screen without editing this file again', () => {
  it('defaults to the unchanged var(--space-6) via a --shell-gap seam', () => {
    expect(css).toMatch(/gap:\s*var\(--shell-gap,\s*var\(--space-6\)\)/)
  })
})
